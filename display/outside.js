/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view: cockpit forward · chase cam · side cam.
   Aircraft = flat-shaded 3-D wireframe (painter's algorithm).
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { renderTerrain } from './terrain.js';
import { getMapReservedRight } from './map.js';

import { computeFaceNormals, _buildRocket, animHinge } from './outside-shared.js';
import { _buildPP, _acPropFromJson } from './outside-pp.js';
import {
  _r, _WB_WING_DEFAULT, _WB_NP, _buildWB, _acGeoFromJson, _wbCache, _GV, _LIGHTS_wb
} from './outside-wb.js';
import {
  _xr, _COLORS_c172, _V_c172, _F_c172, _FC_c172, _E_c172, _FN_c172, _LIGHTS_c172,
  _GV_c172, animSurfaces_c172, _PROP_c172
} from './outside-c172.js';
import {
  _bcR, _COLORS_b109, _V_b109, _F_b109, _FC_b109, _E_b109, _FN_b109, _GV_b109,
  animSurfaces_b109, _PROP_b109
} from './outside-b109.js';
import {
  _COLORS_f4u, _V_f4u, _F_f4u, _FC_f4u, _E_f4u, _FN_f4u, _GV_f4u, animSurfaces_f4u,
  _PROP_f4u
} from './outside-f4u.js';
import {
  _COLORS_mig15, _V_mig15, _F_mig15, _FC_mig15, _E_mig15, _FN_mig15, _GV_mig15,
  animSurfaces_mig15
} from './outside-mig15.js';
import {
  _COLORS_sv, _V_sv, _F_sv, _FC_sv, _E_sv, _FN_sv, _COLORS_lm, _V_lm, _F_lm, _FC_lm,
  _E_lm, _svSepAnims, _dir, _DIR_SHOTS, _dirBlend, _rf9, _gfS, _nzO, _COLORS_f9,
  _V_f9, _F_f9, _FC_f9, _E_f9, _FN_f9
} from './outside-space.js';
import { _ssRocketCache_mut, _drawCSMOrbitDetail, _drawOrbitalClouds } from './outside-rocket.js';
import { drawLandingGear } from './outside-gear-draw.js';
import { drawBoosterFaces, drawRocketPlumesAndNozzles, drawSVStageSepTumble,
         drawF9Nozzles, drawBoosterEdges, drawLaunchPads } from './outside-rocket-draw.js';
import { advanceFanAngle, drawEnginePylons, drawFlapTrackFairings, drawCowlIntake,
         drawPropDisk, drawFanFaces, drawMigIntake } from './outside-engines-draw.js';
import { drawCockpitGlazing, drawMarkingsAndLivery, drawCabinEdges,
         drawPassengerWindows } from './outside-livery.js';

const DEG   = Math.PI / 180;
const FT_NM = 1 / 6076.12;
const FOV_H = 70;   /* must match terrain.js */

/* ── Camera distances ─────────────────────────────────────────── */
const CHASE_BACK = 0.12;
const CHASE_UP   = 120 * FT_NM;
const SIDE_SIDE  = 0.18;
const SIDE_UP    = 80  * FT_NM;

/* ── Light directions in camera-aligned frame (fwd, right, up) ──── */
const _LD  = (v => v.map(x => x / Math.hypot(...v)))([0.25, -0.45,  0.85]);  // key light (sun)
const _LD2 = (v => v.map(x => x / Math.hypot(...v)))([-0.1,  0.60,  0.30]);  // fill (sky bounce)
const _LD2S = 0.70;   // fill light strength
/* Blinn-Phong half-vector for side cam (view = +R direction → [0,1,0]) */
const _H   = (v => v.map(x => x / Math.hypot(...v)))([_LD[0], _LD[1]+1, _LD[2]]);

/* ── Livery color groups  [R, G, B] base (multiplied by brightness) ── */
const _COLORS = [
  [210, 215, 220], // 0 fuselage — near-white
  [195, 205, 215], // 1 wings    — slightly darker
  [200,  16,  46], // 2 v-stab  — Swiss red
  [200, 210, 218], // 3 h-stabs — slightly lighter than wings
  [ 45,  50,  60], // 4 engines  — near-black
  [ 20,  22,  28], // 5 cockpit band (bandit) — near-black surround
  [215, 218, 222], // 6 radome   — slightly lighter than fuselage
  [ 45,  50,  60], // 7 TR zone  — same shade as engine; sentinel for TR deploy skip
  [  8,  10,  14], // 8 cockpit windows — near-black glass
  [195, 205, 215], // 9 winglets        — default = wing color; override via livery index 9
  [ 15,  15,  18], // 10 engine interior — near-black for intake/nozzle cap faces
  [ 20, 100,  30], // 11 debug green 1 (dark)
  [ 45, 150,  55], // 12 debug green 2
  [ 95, 200,  90], // 13 debug green 3
  [150, 230, 140], // 14 debug green 4 (light)
  [225,  55,  55], // 15 debug red (radome)
  [ 55,  95, 235], // 16 debug blue (roof)
  [172, 176, 184], // 17 nozzle silver (brushed metal — core-nozzle sections)
];

/* ── Render profile → geometry bundle ──────────────────────────────
   Each aircraft declares its renderer via the "render" field in its JSON
   (e.g. "render": "c172"). Several aircraft share one profile — the Robin
   DR400 reuses the C172 geometry, every Falcon variant reuses "falcon9".
   That many-to-one mapping is why the renderer choice belongs in the
   aircraft data, not reverse-engineered from id/panel here. _renderProfile
   falls back to id/panel detection for aircraft that predate the field.

   The procedural geometry itself stays in the outside-*.js modules (it is
   built with trig, not expressible as flat JSON). Starship and the default
   "wb" body build their geometry per-frame, so they are resolved at draw
   time below rather than living in this static table. */
function _renderProfile(ac) {
  if (ac?.render) return ac.render;
  if (ac?.panel === 'g1000' || ac?.panel === 'dr400') return 'c172';
  if (ac?.id === 'saturn-v') return 'saturn-v';
  if (ac?.id === 'starship') return 'starship';
  if (ac?.id?.startsWith('falcon9') || ac?.vehicleType === 'rocket') return 'falcon9';
  if (ac?.id === 'bf109') return 'bf109';
  if (ac?.id === 'f4u1a') return 'f4u';
  if (ac?.id === 'mig15') return 'mig15';
  return 'wb';
}

const _GEO_REGISTRY = {
  c172:       { V_: _V_c172,  F_: _F_c172,  FC_: _FC_c172,  FN_: _FN_c172,  E_: _E_c172,  COL_: _COLORS_c172,  GV_: _GV_c172,  prop: _PROP_c172 },
  bf109:      { V_: _V_b109,  F_: _F_b109,  FC_: _FC_b109,  FN_: _FN_b109,  E_: _E_b109,  COL_: _COLORS_b109,  GV_: _GV_b109,  prop: _PROP_b109 },
  f4u:        { V_: _V_f4u,   F_: _F_f4u,   FC_: _FC_f4u,   FN_: _FN_f4u,   E_: _E_f4u,   COL_: _COLORS_f4u,   GV_: _GV_f4u,   prop: _PROP_f4u  },
  mig15:      { V_: _V_mig15, F_: _F_mig15, FC_: _FC_mig15, FN_: _FN_mig15, E_: _E_mig15, COL_: _COLORS_mig15, GV_: _GV_mig15 },
  falcon9:    { V_: _V_f9,    F_: _F_f9,    FC_: _FC_f9,    FN_: _FN_f9,    E_: _E_f9,    COL_: _COLORS_f9,    GV_: _GV       },
  'saturn-v': { V_: _V_sv,    F_: _F_sv,    FC_: _FC_sv,    FN_: _FN_sv,    E_: _E_sv,    COL_: _COLORS_sv,    GV_: _GV       },
};

/* Cache for prop-plane geometry, keyed by aircraft id (built once per aircraft). */
const _ppCache = {};

/* Per-aircraft control-surface animators. The C172/warbird family shares the
   command model below; each module owns the hinge geometry. */
const _CTRL_ANIM = {
  c172:  animSurfaces_c172,
  bf109: animSurfaces_b109,
  f4u:   animSurfaces_f4u,
  mig15: animSurfaces_mig15,
};

/* Flap/aileron/elevator/rudder commands for the C172/warbird family, derived
   from autopilot/control targets in S. (WB airliners use a different model.) */
function _warbirdCtrlCmd(maxBank) {
  const clamp    = (x) => Math.max(-1, Math.min(1, x));
  const flapCfg  = S.flaps ?? 0;
  const ailCmd   = clamp((S.rollT ?? 0) / maxBank);
  const pitchErr = (S.pitchT ?? 0) - (S.pitch ?? 0);
  const elevCmd  = clamp(pitchErr / 10 + (S.trim ?? 0) / 10);
  const hdgDelta = ((((S.hdgT ?? 0) - (S.hdg ?? 0)) + 540) % 360) - 180;
  const rudCmd   = clamp(hdgDelta / 20);
  const active   = flapCfg > 0 || Math.abs(ailCmd) > 0.01 || Math.abs(elevCmd) > 0.02 || Math.abs(rudCmd) > 0.02;
  return { flapCfg, ailCmd, elevCmd, rudCmd, active };
}

let _canvas    = null;
let _camMode   = 0;
let _finAngle    = 0;            // F9 grid fin fold: 0 = stowed aft, Math.PI/2 = deployed
let _ssFlapAngle = Math.PI / 2;  // Starship body flap: π/2 = extended (static geometry)

let _orbitAz    = 0;     // side-cam orbit azimuth (degrees, 0 = starboard)
let _orbitEl    = 12;    // elevation above horizontal (degrees, +12 = slightly above)
let _orbitZoom  = 1.0;   // side-cam zoom multiplier (1 = auto-fit; >1 = farther out)
let _orbitPanX  = 0;     // chase-cam horizontal pan (pixels at current zoom, right = positive)
let _orbitInitAc = null; // last aircraft id for which orbit defaults were applied
let _bodyCamZoom = 1.0;  // body-cam optical zoom (1 = native FOV)
let _orbitDragX = null;  // non-null while drag is active
let _orbitDragY = null;
let _panDragX   = null;  // non-null while right-click pan drag is active

export function initOutside() {
  _canvas = document.getElementById('outside-canvas');

  /* Left-drag: orbit (Az/El).  Right-drag (chase cam only): pan camera laterally. */
  window.addEventListener('mousedown', e => {
    if (_camMode === 1 || _camMode === 2) {
      if (e.button === 2 && _camMode === 1) { _panDragX = e.clientX; }
      else { _orbitDragX = e.clientX; _orbitDragY = e.clientY; }
    }
  });
  window.addEventListener('mousemove', e => {
    if (_orbitDragX !== null) {
      _orbitAz = ((_orbitAz + (e.clientX - _orbitDragX) * 0.4) % 360 + 360) % 360;
      /* On the ground, allow tilting down to inspect the belly (the belly is only a few
         metres up, so this dips a bit under the runway) but stop short of a fully-inverted
         under-the-aircraft view. */
      const _elMin = (S.wow && S.aircraft?.vehicleType !== 'rocket') ? -10 : -85;
      _orbitEl = Math.max(_elMin, Math.min(85, _orbitEl - (e.clientY - _orbitDragY) * 0.3));  // clamp: tilt elevation, never flip over the top
      _orbitDragX = e.clientX; _orbitDragY = e.clientY;
    }
    if (_panDragX !== null) {
      _orbitPanX += (e.clientX - _panDragX) * (devicePixelRatio || 1);
      _panDragX = e.clientX;
    }
  });
  window.addEventListener('mouseup', () => { _orbitDragX = null; _orbitDragY = null; _panDragX = null; });
  window.addEventListener('contextmenu', e => { if (_camMode === 1) e.preventDefault(); });

  /* Wheel / trackpad gestures in side cam, chase cam, ship cam, and body cam. */
  window.addEventListener('wheel', e => {
    if (_camMode !== 1 && _camMode !== 2 && _camMode !== 5 && _camMode !== 6) return;
    e.preventDefault();
    if (_camMode === 5) {
      _bodyCamZoom = Math.max(0.5, Math.min(8, _bodyCamZoom * Math.exp(e.deltaY * 0.015)));
    } else {
      _orbitZoom = Math.max(0.02, Math.min(10, _orbitZoom * Math.exp(e.deltaY * 0.015)));
      if (_camMode !== 6) _orbitAz = ((_orbitAz - e.deltaX * 0.35) % 360 + 360) % 360;
    }
  }, { passive: false });

  /* 0 key: reset orbit + zoom to default while paused */
  window.addEventListener('keydown', e => {
    if (e.key === '0' && S.paused && (_camMode === 1 || _camMode === 2 || _camMode === 5 || _camMode === 6)) {
      _orbitInitAc = null; _bodyCamZoom = 1;  // force re-apply aircraft defaults on next frame
    }
  });
}
export function setOutsideCamMode(m) { _camMode = m; }
export function outsideInvalidate()  { /* redraws every frame */ }

/* Gear-contact to body-center offset in feet — lifts the terrain camera so gear
   appears to touch the ground rather than sinking into or floating above it.
   Returns 0 when not on ground; vehicle-specific values derived from gear geometry. */
function _bodyCentreFt() {                               // fuselage centre above the wheels (ungated)
  const id = S.aircraft?.id ?? '';
  if (id === 'c172')          return (_xr + 0.0020 + _xr * 0.56) / FT_NM;  // ~32 ft
  if (id.startsWith('bf109')) return 0.0032 / FT_NM;  // ~19 ft
  if (id.startsWith('f4u'))   return 0.0038 / FT_NM;  // ~23 ft
  /* WB / airliners — body-centre to wheel-bottom = |belly z at the main-gear station|
     + main strut + tyre. The main gear sits outboard on the wing-body fairing, where
     the belly is far shallower than the bare fuselage radius, so sample the actual
     lower surface (mirrors _bodyLowerZ in the renderer) — using the radius alone over-
     lifts and the gear floats. */
  const _g  = S.aircraft?.gear ?? {};
  const rr  = S.aircraft?.nose?.r ?? S.aircraft?.geometry?.r ?? _r;
  const gMx = _g.main?.x ?? -0.001, gMy = _g.main?.y ?? 0.0020;
  const _ml = _g.main?.len ?? 0.0032;
  const _mt = _g.main?.tireR ?? rr * 0.16;
  let bz = -Math.sqrt(Math.max(0, rr*rr - gMy*gMy));   // bare fuselage circle at the gear y
  const bf = S.aircraft?.bellyFairing;
  if (bf && bf.fromX != null && gMx <= bf.fromX && gMx >= bf.toX) {
    const prog = (bf.fromX - gMx) / (bf.fromX - bf.toX), ramp = 0.26;
    let t = prog < ramp ? prog/ramp : prog > 1-ramp ? (1-prog)/ramp : 1;
    t = t < 1 ? t*t*(3-2*t) : 1;
    const maxHW = bf.maxWidth ?? rr, depth = bf.maxDepth ?? 0;
    const halfW = rr + t*(maxHW - rr);
    const ztop = rr*(1 - 0.78*t), zbot = -(rr + t*depth);
    const Vz = (ztop-zbot)*0.5, czf = (ztop+zbot)*0.5, nExp = 2 + t*1.1;
    const yn = Math.min(1, Math.abs(gMy)/halfW);
    const zf = czf - Vz * Math.pow(Math.max(0, 1 - Math.pow(yn, nExp)), 1/nExp);
    if (zf < bz) bz = zf;
  }
  return (Math.abs(bz) + _ml + _mt) / FT_NM;
}
function _groundOffsetFt() {                             // body centre, gated (0 unless on the wheels)
  if (!S.wow || S.aircraft?.vehicleType === 'rocket') return 0;
  return _bodyCentreFt();
}
/* Cockpit eye height above the ground: body centre + eye above the centreline. Drives the
   forward-view camera so the pilot sits at cockpit level, not on the floor. */
function _cockpitEyeFt() {
  if (S.aircraft?.vehicleType === 'rocket') return 0;
  const rr = S.aircraft?.nose?.r ?? S.aircraft?.geometry?.r ?? _r;
  return _bodyCentreFt() + (rr * 0.55) / FT_NM;
}

/* Lightweight render profiler. Splits the frame into aircraft geometry build, painter
   sort, painter fill, and terrain+rest, and tracks each phase's peak (peaks reset on
   toggle, to catch transient spikes).
   Configurable at runtime via window.OPENSIM_PROFILER — change the toggle key or the
   overlay position, e.g. OPENSIM_PROFILER.key = 'p'. The on/off state and any config
   changes persist across reloads in localStorage. */
const _profCfg = { key: 'y', x: 8, y: 140, on: false };
try { Object.assign(_profCfg, JSON.parse(localStorage.getItem('opensim.profiler') || '{}')); } catch {}
if (typeof window !== 'undefined') window.OPENSIM_PROFILER = _profCfg;
const _saveProfCfg = () => { try { localStorage.setItem('opensim.profiler', JSON.stringify(_profCfg)); } catch {} };

const _prof = { on: !!_profCfg.on, _inst: false, fps: 60, frameMs: 0, buildT0: 0,
                buildMs: 0, sortMs: 0, fillMs: 0, restMs: 0, faces: 0, drawFaces: 0, lastT: 0,
                max: { render: 0, build: 0, rest: 0, faces: 0 } };

export function tickOutside() {
  if (!_canvas || !_canvas.offsetWidth || !_canvas.offsetHeight) return;
  if (!_prof._inst) { _prof._inst = true;
    addEventListener('keydown', e => {
      if (e.key && e.key.toLowerCase() === (_profCfg.key || 'y').toLowerCase()) {
        _prof.on = !_prof.on;
        if (_prof.on) _prof.max = { render: 0, build: 0, rest: 0, faces: 0 };
        _profCfg.on = _prof.on; _saveProfCfg();
      } }); }
  const _t0 = performance.now();
  if      (_camMode === 1) _renderChaseCam(_canvas);
  else if (_camMode === 2) _renderSideCam(_canvas);
  else if (_camMode === 3) _renderWingView(_canvas);
  else if (_camMode === 4) _renderPlumeCam(_canvas);
  else if (_camMode === 5) {
    if (S.aircraft?.id === 'starship' && (S.rocketStage ?? 1) >= 2) _renderSSBodyCam(_canvas);
    else _renderBoosterCam(_canvas);
  }
  else if (_camMode === 6) _renderShipCam(_canvas);
  else                     renderTerrain(_canvas, { eyeFt: _cockpitEyeFt() });
  const _now = performance.now();
  if (_prof.lastT) _prof.fps = 0.85 * _prof.fps + 0.15 * (1000 / Math.max(1, _now - _prof.lastT));
  _prof.lastT   = _now;
  _prof.frameMs = _now - _t0;
  if (_prof.on) {
    _prof.restMs = Math.max(0, _prof.frameMs - _prof.buildMs - _prof.sortMs - _prof.fillMs);
    const m = _prof.max;
    m.render = Math.max(m.render, _prof.frameMs);
    m.build  = Math.max(m.build,  _prof.buildMs);
    m.rest   = Math.max(m.rest,   _prof.restMs);
    m.faces  = Math.max(m.faces,  _prof.faces);
    _profDraw(_canvas);
  }
}

function _profDraw(canvas) {
  const ctx = canvas.getContext('2d'), dpr = devicePixelRatio || 1, m = _prof.max;
  const lines = [
    `FPS ${_prof.fps.toFixed(0)}    render ${_prof.frameMs.toFixed(1)} / ${m.render.toFixed(1)} ms`,
    `faces ${_prof.faces} / ${m.faces}    2D-draw ${_prof.drawFaces}`,
    `build ${_prof.buildMs.toFixed(1)} / ${m.build.toFixed(1)}   sort ${_prof.sortMs.toFixed(1)}  fill ${_prof.fillMs.toFixed(1)}`,
    `terrain+rest ${_prof.restMs.toFixed(1)} / ${m.rest.toFixed(1)} ms`,
    `(current / max — max resets on toggle)`,
  ];
  ctx.save();
  ctx.font = `${Math.round(11 * dpr)}px monospace`; ctx.textBaseline = 'top';
  const ox = _profCfg.x ?? 8, oy = _profCfg.y ?? 140;   // configurable (default below the MET clock)
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(ox * dpr, oy * dpr, 300 * dpr, (lines.length * 16 + 8) * dpr);
  ctx.fillStyle = '#3cff8c';
  lines.forEach((t, i) => ctx.fillText(t, (ox + 6) * dpr, (oy + 5 + i * 16) * dpr));
  ctx.restore();
}

/* ── Chase cam ────────────────────────────────────────────────── */
function _renderChaseCam(canvas) {
  /* Apply per-aircraft orbit defaults once when aircraft changes */
  const _acId = S.aircraft?.id ?? null;
  if (_acId !== _orbitInitAc) {
    _orbitInitAc = _acId;
    const od = S.aircraft?.chaseCamOrbit;
    if (od) {
      _orbitAz = od.az ?? _orbitAz; _orbitEl = od.el ?? _orbitEl;
      _orbitZoom = od.zoom ?? _orbitZoom; _orbitPanX = od.panX ?? _orbitPanX;
    } else {
      _orbitAz = 0; _orbitEl = 12; _orbitZoom = 1; _orbitPanX = 0;
    }
  }
  const hdgRad = (S.hdg  ?? 0) * DEG;
  const _isSS  = S.aircraft?.id === 'starship';
  const acP    = (_isSS && S.rocketSECO) ? (S.starshipBodyPitch ?? S.pitch ?? 0) : (S.pitch ?? 0);
  const acR    = S.aircraft?.vehicleType === 'rocket' ? (S.rocketRoll ?? 0) : (S.roll ?? 0);
  const cosLat = Math.cos((S.lat ?? 47) * DEG);

  /* Terrain camera: fixed position — _orbitEl only rotates the wireframe, not the terrain */
  const camBack = CHASE_BACK;
  const camUp   = CHASE_UP;

  /* Orbit azimuth: heading-relative (camera behind the nose) so taxiing tracks the
     aircraft and the view stays consistent through takeoff; rockets on the pad keep
     the old absolute azimuth. */
  const isRocket = S.aircraft?.vehicleType === 'rocket';
  const orbitRad = (S.wow && isRocket) ? _orbitAz * DEG : hdgRad - Math.PI + _orbitAz * DEG;
  const camBackZ = camBack * _orbitZoom;
  const camUpZ   = camUp   * _orbitZoom;
  const dN = Math.cos(orbitRad) * camBackZ;
  const dE = Math.sin(orbitRad) * camBackZ;

  const dpr    = devicePixelRatio || 1;
  const _mapPxC = getMapReservedRight() * dpr;
  const _cxC    = (canvas.offsetWidth * dpr - _mapPxC) / 2;

  const sL=S.lat,sLo=S.lon,sA=S.alt,sP=S.pitch,sR=S.roll,sH=S.hdg;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + _groundOffsetFt() + camUpZ / FT_NM;
  S.hdg   = ((_orbitAz + 180) % 360 + 360) % 360;
  const _chasePitch = Math.atan2(-camUpZ, camBackZ) / DEG;
  S.pitch = _chasePitch;
  S.roll  = 0;
  const _tcCLat = S.lat, _tcCLon = S.lon, _tcCAlt = S.alt, _tcCHdg = S.hdg;
  renderTerrain(canvas, { outsideView: true, cxOverride: _cxC, acPose: { lat: sL, lon: sLo, hdg: sH } });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.pitch=sP;S.roll=sR;S.hdg=sH;

  const W = canvas.width, H = canvas.height;
  _drawOrbitalClouds(canvas.getContext('2d'), W, H, _chasePitch, _tcCAlt, _tcCLat, _tcCLon, _tcCHdg);

  const _useWowPitchC = S.wow && S.aircraft?.vehicleType !== 'rocket';
  _drawWireframe(canvas, _useWowPitchC ? 0 : acP, _useWowPitchC ? 0 : acR, camBack, camUp, 0, false, _orbitAz, _orbitEl, _orbitPanX);
  _drawLabel(canvas, `CHASE CAM  Az:${_orbitAz.toFixed(0)}  El:${_orbitEl.toFixed(1)}  Z:${_orbitZoom.toFixed(2)}  PanX:${_orbitPanX.toFixed(0)}`);
}

/* ── Side cam (starboard) ─────────────────────────────────────── */
function _renderSideCam(canvas) {
  const hdgRad   = (S.hdg  ?? 0) * DEG;
  const _isSS    = S.aircraft?.id === 'starship';
  const acP      = (_isSS && S.rocketSECO) ? (S.starshipBodyPitch ?? S.pitch ?? 0) : (S.pitch ?? 0);
  const acR      = S.aircraft?.vehicleType === 'rocket' ? (S.rocketRoll ?? 0) : (S.roll ?? 0);
  const cosLat   = Math.cos((S.lat ?? 47) * DEG);
  const rightRad = hdgRad + Math.PI / 2;

  /* For rockets, scale camera distance with altitude so the globe stays
     in frame — at 175 km orbit this gives ~24 nm side / ~5 nm up.     */
  const isRocket = S.aircraft?.vehicleType === 'rocket';
  const altNm    = (S.alt ?? 0) * FT_NM;
  /* Aircraft: a stable framing distance from the (fixed) model length, shared by the
     terrain camera AND the wireframe, so the airframe stays planted on the runway and
     doesn't slide/float under orbit. Rockets keep the altitude-scaled auto-fit distance. */
  const _acLenNm = (S.aircraft?.nose?.tipX != null && S.aircraft?.geometry?.tailX != null)
    ? S.aircraft.nose.tipX - S.aircraft.geometry.tailX : null;
  const _acFixed = !isRocket && _acLenNm != null;
  const sideDist = (isRocket ? Math.max(SIDE_SIDE, altNm * 0.25)
                             : _acFixed ? _acLenNm * 2.0 : SIDE_SIDE) * _orbitZoom;
  const sideUp   = (isRocket ? Math.max(SIDE_UP,   altNm * 0.05) : SIDE_UP)   * _orbitZoom;

  /* For rockets: _orbitAz rolls the body (longitudinal pre-pitch spin).
     For aircraft: _orbitAz orbits the camera around the aircraft — swings
     terrain camera position + wireframe viewpoint (no banking of model). */
  let terrainOrbit = 0;
  let renderOrbit  = isRocket ? _orbitAz : 0;
  let sideOrbitAz  = isRocket ? 0 : _orbitAz;  // wireframe cam orbit (aircraft only)
  {
    const db = _dirBlend();
    if (db > 0 && _dir.shot) {
      const shotAz = (_DIR_SHOTS[_dir.shot].orbitAz ?? 0) * db;
      terrainOrbit += shotAz;
      if (isRocket) renderOrbit += shotAz;
      else          sideOrbitAz += shotAz;
    }
  }
  // Aircraft: swing terrain camera with user orbit (opposite sign: +az → toward nose)
  if (!isRocket) terrainOrbit -= _orbitAz;

  /* Terrain camera: elevation follows the orbit drag for aircraft (tilt up/down to view
     from above/below); rockets keep the fixed 12°. Heading-relative for aircraft (so
     taxiing tracks the nose); rockets on the pad keep the old absolute framing. */
  const _absGround = S.wow && isRocket;
  const tElRad    = (isRocket ? 12 : _orbitEl) * DEG;
  const tOrbitRad = _absGround ? terrainOrbit * DEG : rightRad + terrainOrbit * DEG;
  const hDist     = sideDist * Math.cos(tElRad);
  const vElev     = sideDist * Math.sin(tElRad);
  const dN = Math.cos(tOrbitRad) * hDist;
  const dE = Math.sin(tOrbitRad) * hDist;

  const dpr    = devicePixelRatio || 1;
  const _mapPxS = getMapReservedRight() * dpr;
  const _cxS    = (canvas.offsetWidth * dpr - _mapPxS) / 2;

  const sL=S.lat,sLo=S.lon,sA=S.alt,sH=S.hdg,sP=S.pitch,sR=S.roll;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + _groundOffsetFt() + (sideUp + vElev) / FT_NM;
  S.hdg   = _absGround ? ((terrainOrbit + 180) % 360 + 360) % 360
                       : ((S.hdg??0) - 90 + terrainOrbit + 360) % 360;   // face the aircraft (camPos+180): anchors it so zoom/orbit don't slide
  const _sidePitch = Math.atan2(-(sideUp + vElev), hDist) / DEG;
  S.pitch = _sidePitch;
  S.roll  = 0;
  const _tcSLat = S.lat, _tcSLon = S.lon, _tcSAlt = S.alt, _tcSHdg = S.hdg;
  renderTerrain(canvas, { outsideView: true, cxOverride: _cxS, acPose: { lat: sL, lon: sLo, hdg: sH } });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  const W = canvas.width, H = canvas.height;
  _drawOrbitalClouds(canvas.getContext('2d'), W, H, _sidePitch, _tcSAlt, _tcSLat, _tcSLon, _tcSHdg);

  /* Wireframe: rockets: _orbitAz rolls body; aircraft: _orbitAz orbits camera via sideOrbitAz.
     El: aircraft with chaseCamOrbit use fixed 12° so chase-calibrated El doesn't bleed here. */
  const _useWowPitch = S.wow && S.aircraft?.vehicleType !== 'rocket';
  const _scEl = (isRocket && S.aircraft?.chaseCamOrbit) ? 12 : _orbitEl;   // wireframe El tracks the terrain El
  _drawWireframe(canvas, _useWowPitch ? 0 : acP, (_useWowPitch ? 0 : acR) + renderOrbit, 0, sideUp, sideDist, false, sideOrbitAz, _scEl, 0, _acFixed);
  _drawLabel(canvas, 'SIDE CAM');
  if (S.paused) _drawPauseOverlay(canvas);
}

/* ── Wing view — just outside fuselage, at cabin-window height ─── */
const WING_SIDE = 0.0033;  // NM — fuselage radius + small margin (r = 0.0025)
const WING_UP   = 0.0008;  // NM — at window level, slightly above fuselage centre

function _renderWingView(canvas) {
  const hdgRad   = (S.hdg  ?? 0) * DEG;
  const acP      =  S.pitch ?? 0;
  const acR      = S.aircraft?.vehicleType === 'rocket' ? (S.rocketRoll ?? 0) : (S.roll ?? 0);
  const cosLat   = Math.cos((S.lat ?? 47) * DEG);
  const rightRad = hdgRad + Math.PI / 2;
  const dN = Math.cos(rightRad) * WING_SIDE;
  const dE = Math.sin(rightRad) * WING_SIDE;

  const sL=S.lat,sLo=S.lon,sA=S.alt,sH=S.hdg,sP=S.pitch,sR=S.roll;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + _groundOffsetFt() + WING_UP / FT_NM;
  S.hdg   = ((S.hdg??0) - 90 + 360) % 360;
  S.pitch = Math.atan2(-WING_UP, WING_SIDE) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true, acPose: { lat: sL, lon: sLo, hdg: sH } });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  _drawWireframe(canvas, acP, acR, 0, WING_UP, WING_SIDE, true);
  _drawLabel(canvas, 'WING VIEW');
}

let _propAngle = Math.PI * 0.5;
/* Stage separation state — reassigned from _drawWireframe; kept here (not in outside-space.js)
   because ES module exports cannot be reassigned by importers. */
let _svSepLastAcId = null;
let _svSepPrevStage = 1;
let _rktSepLastAcId = null;
let _rktSepPrevStage = 1;

/* ── Core wireframe + shading renderer ───────────────────────── */
function _drawWireframe(canvas, acPitchDeg, acRollDeg, camBack, camUp, camSide, wingView = false, orbitAzDeg = 0, orbitElDeg = 0, panX = 0, fixedFraming = false) {
  advanceFanAngle();   /* fan spin state lives in outside-engines-draw.js */
  if (S.engineState === 'running' || S.engineState === 'starting') {
    const _cruiseSpd = S.aircraft?.envelope?.cruiseSpd ?? 122;
    const _throttle  = Math.min(1, Math.max(0, (S.spdT ?? 0) / _cruiseSpd));
    _propAngle = (_propAngle + (0.25 + 0.75 * _throttle) * 0.08) % (Math.PI * 2);
  }

  /* Single-valued render profile (from aircraft JSON "render" field, with
     id/panel fallback). The is* flags are mutually exclusive by construction. */
  const profile = _renderProfile(S.aircraft);
  const isC172  = profile === 'c172';
  const isSV    = profile === 'saturn-v';
  const isSS    = profile === 'starship';
  const isF9    = profile === 'falcon9';
  const isBf109 = profile === 'bf109';
  const isF4U   = profile === 'f4u';
  const isMig15 = profile === 'mig15';
  const isPP    = profile === 'propplane';

  /* Starship / Super Heavy — build from aircraft.rocketGeometry on first use */
  const _ssRocketCache = _ssRocketCache_mut;
  if (isSS && S.aircraft?.rocketGeometry) {
    const _id = S.aircraft.id;
    if (!_ssRocketCache[_id]) _ssRocketCache[_id] = _buildRocket(S.aircraft.rocketGeometry);
  }
  const _ssGeo = isSS ? (_ssRocketCache_mut[S.aircraft?.id] ?? null) : null;

  /* Prop-plane geometry — build once per aircraft id, cache permanently */
  if (isPP && S.aircraft?.propplane) {
    const _id = S.aircraft.id;
    if (!_ppCache[_id]) _ppCache[_id] = _buildPP(_acPropFromJson(S.aircraft));
  }
  const _ppGeo = isPP ? (_ppCache[S.aircraft?.id] ?? null) : null;

  /* Rebuild geometry every frame (no cache) — re-enable cache when geometry is final */
  if (S.aircraft?.nose) {
    const _acId   = S.aircraft.id;
    const _geo2   = _buildWB(_acGeoFromJson(S.aircraft, _WB_NP.default));
    _geo2.FN_ = computeFaceNormals(_geo2.V_, _geo2.F_);
    _wbCache[_acId] = _geo2;
  }
  const _wbGeo = (!isC172 && !isF9 && !isBf109 && !isF4U && !isMig15 && !isSV && !isSS && !isPP)
    ? (_wbCache[S.aircraft?.id] ?? _wbCache.default) : null;
  const _b   = _wbGeo?.b ?? 162;  // base index of non-tube vertices; 162 for nNose=5, 194 for nNose=7
  /* Static geometry comes from the registry; Starship (_ssGeo), prop-plane (_ppGeo),
     and the default body (_wbGeo) are built per-frame / on-demand and resolved here. */
  const _reg = _GEO_REGISTRY[profile];
  const V_   = _reg ? _reg.V_  : isPP ? (_ppGeo?.V_  ?? []) : isSS ? (_ssGeo?.V_  ?? []) : _wbGeo.V_;
  const F_   = _reg ? _reg.F_  : isPP ? (_ppGeo?.F_  ?? []) : isSS ? (_ssGeo?.F_  ?? []) : _wbGeo.F_;
  const FC_  = _reg ? _reg.FC_ : isPP ? (_ppGeo?.FC_ ?? []) : isSS ? (_ssGeo?.FC_ ?? []) : _wbGeo.FC_;
  const FN_  = _reg ? _reg.FN_ : isPP ? (_ppGeo?.FN_ ?? []) : isSS ? (_ssGeo?.FN_ ?? []) : _wbGeo.FN_;
  const E_   = _reg ? _reg.E_  : isPP ? (_ppGeo?.E_  ?? []) : isSS ? (_ssGeo?.E_  ?? []) : _wbGeo.E_;
  const SE_  = _wbGeo?.SE_ ?? [];
  const SL_  = _wbGeo?.SL_ ?? [];
  const _livCol    = S.aircraft?.livery?.colors;
  const _nacPaint  = S.aircraft?.engine?.nacellePaint ?? null;
  /* Build per-frame color table: registry profiles use their fixed palette;
     the default body applies livery overrides first, then nacelle paint over
     slots 4 (engine body) and 7 (TR zone). Always a new array so downstream
     callers can't mutate _COLORS. */
  const COL_ = _reg ? _reg.COL_
             : isPP  ? (_ppGeo?.COL_ ?? [])
             : isSS  ? (_ssGeo?.COLORS_ ?? [])
             : _COLORS.map((c, i) => {
                 if (_nacPaint  && (i === 4 || i === 7)) return _nacPaint;
                 return _livCol?.[i] ?? c;
               });
  const GV_  = _reg ? _reg.GV_ : isPP ? (_ppGeo?.GV_ ?? _GV) : _GV;

  const P = acPitchDeg * DEG, R = acRollDeg * DEG;
  const cosP = Math.cos(P), sinP = Math.sin(P);
  const cosR = Math.cos(R), sinR = Math.sin(R);
  const sinEl = Math.sin(orbitElDeg * DEG), cosEl = Math.cos(orbitElDeg * DEG);
  const sinAz = Math.sin(orbitAzDeg * DEG), cosAz = Math.cos(orbitAzDeg * DEG);
  /* Rockets spin around their longitudinal axis (pre-roll before pitch).
     Aircraft bank around the camera forward axis (post-pitch roll). */
  const isBodyRoll = isSV || isF9 || isSS;

  const W = canvas.width, H = canvas.height;
  const ctx   = canvas.getContext('2d');
  const dpr   = devicePixelRatio || 1;
  const mapPx = getMapReservedRight() * dpr;
  let   cx    = (W - mapPx) / 2;  // mutable — auto-fit shifts for horizontal centering
  let   cy    = H / 2;            // mutable — auto-fit / auto-director shifts this for look-at
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG);

  // Auto-fit: project vertices through attitude rotation, then fit screen extents.
  // Must happen after cosP/sinP/cosR/sinR are computed.
  if (!wingView) {
    /* Effective FOV for visible viewport only (map panel narrows horizontal FOV) */
    const viewW  = W - mapPx;
    const hfH    = Math.atan(Math.tan(FOV_H / 2 * DEG) * viewW / W);
    const hfV    = Math.atan(Math.tan(FOV_H / 2 * DEG) * H / W);
    const PAD    = 1.15;
    /* Stage-aware vertex filtering — only include vertices of currently-shown structure */
    const _afStage      = (isF9 || isSV || isSS) ? (S.rocketStage ?? 1) : 0;
    const _afLesJett    = isSV && !!(S.lesJettisoned);
    const _afSivbSep    = isSV && !!(S.sivbSep);
    let minCR = Infinity, maxCR = -Infinity, minCU = Infinity, maxCU = -Infinity;
    for (let _vi = 0; _vi < V_.length; _vi++) {
      const [vF, vR, vU] = V_[_vi];
      if (isSV) {
        if (vF > 0.030 && _afLesJett) continue;                   // LES tower jettisoned
        if (vF >= 0.010 && vF < 0.024 && _afSivbSep) continue;   // S-IVB separated
        if (vF < 0.010  && _afStage >= 3) continue;               // S-II + S-IC separated
        if (vF < -0.006 && _afStage >= 2) continue;               // S-IC aft separated
      }
      if (isF9 && _afStage >= 2 && _vi < 48) continue;            // F9 first stage separated
      if (isSS && _afStage >= 2 && _ssGeo?.stageRanges?.[0]) {
        const _sepVF = _ssGeo.V_[_ssGeo.stageRanges[0].faceEnd]?.[0] ?? 0.013;
        if (vF < _sepVF) continue;                                // SS booster + grid fin verts
      }
      let fP, rR, uR;
      if (isBodyRoll) {
        const vR2 =  vR * cosR - vU * sinR;
        const vU2 =  vR * sinR + vU * cosR;
        fP = vF * cosP - vU2 * sinP; rR = vR2; uR = vF * sinP + vU2 * cosP;
      } else {
        fP =  vF * cosP - vU * sinP;
        const uP =  vF * sinP + vU * cosP;
        rR =  vR * cosR + uP * sinR; uR = -vR * sinR + uP * cosR;
      }
      if (camSide > 0) {
        minCR = Math.min(minCR, fP); maxCR = Math.max(maxCR, fP);
        minCU = Math.min(minCU, uR); maxCU = Math.max(maxCU, uR);
      } else {
        const _bbUR0 = orbitElDeg !== 0 ? -fP * sinEl + uR * cosEl : uR;
        const _bbRR  = orbitAzDeg !== 0 ? rR * cosAz - _bbUR0 * sinAz : rR;
        const _bbUR  = orbitAzDeg !== 0 ? rR * sinAz + _bbUR0 * cosAz : _bbUR0;
        minCR = Math.min(minCR, _bbRR); maxCR = Math.max(maxCR, _bbRR);
        minCU = Math.min(minCU, _bbUR); maxCU = Math.max(maxCU, _bbUR);
      }
    }
    /* Snapshot rocket-only centre before tower inflates the bounds */
    /* Fixed-framing aircraft: centre on the model ORIGIN (0,0,0), not the bounding-box
       centroid — the terrain camera looks at the origin (where the airframe sits on the
       runway), so centring the wireframe on the centroid instead would offset the two by
       a few metres and parallax-shift the aircraft as you orbit. */
    const pivotCR = fixedFraming ? 0 : (isFinite(minCR) ? (minCR + maxCR) / 2 : 0);
    const pivotCU = fixedFraming ? 0 : (isFinite(minCU) ? (minCU + maxCU) / 2 : 0);
    /* Include launch tower in auto-fit only while still near the pad */
    if ((isSV || isF9 || isSS) && camSide > 0) {
      const _padNm = (S.mission?.departure?.elevation ?? 0) * FT_NM;
      const _rise  = Math.max(0, (S.alt ?? 0) * FT_NM - _padNm);
      if (_rise < 0.050) {
        const _tR  = isSS ? 0.00243 : isSV ? 0.0028 : 0.0020;
        const _top = (isSS ? 0.040 : isSV ? 0.038 : 0.024) + _tR * 3.5;
        const _bot = (isSS ? -0.025 : isSV ? -0.030 : -0.016) - _tR * 3.0;
        minCU = Math.min(minCU, _bot); maxCU = Math.max(maxCU, _top);
        /* SS: tower is at -vU 2.2→6.8r, arm tip at +vU 1.6r → in side cam fP≈-vU */
        const _crLo = isSS ? -_tR * 7.5 : -_tR * 9.8;
        const _crHi = isSS ?  _tR * 2.0 :  _tR * 9.8;
        minCR = Math.min(minCR, _crLo); maxCR = Math.max(maxCR, _crHi);
      }
    }
    /* Fallback if no vertices survived filtering */
    if (!isFinite(minCU)) { minCU = -0.01; maxCU = 0.01; }
    if (!isFinite(minCR)) { minCR = -0.01; maxCR = 0.01; }
    /* Use bounding-box half-extents so zoom always pivots on the model centre */
    const centerCR = (minCR + maxCR) / 2;
    const centerCU = (minCU + maxCU) / 2;
    const halfCR   = (maxCR - minCR) / 2;
    const halfCU   = (maxCU - minCU) / 2;
    const d = Math.max(halfCR * PAD / Math.tan(hfH), halfCU * PAD / Math.tan(hfV));
    if (camSide > 0) {
      const _origCamSide = camSide;
      /* Auto-fit (rockets): re-frame each frame since the model shrinks as stages drop.
         fixedFraming (aircraft) skips it — the caller already sized camSide/camUp to a
         stable framing shared with the terrain camera, so the airframe stays planted. */
      if (!fixedFraming) {
        camSide = d * _orbitZoom;
        /* Keep elevation angle constant through auto-fit: if camUp >> camSide (e.g.
           rocket at high altitude), the camera pitch goes nearly vertical and the
           body cross-section compresses to sub-pixel height.  Scale camUp with the
           same factor so the wireframe elevation stays at the intended angle. */
        camUp = camUp * (camSide / _origCamSide);
      }
      /* Perspective-correct centering: at high altitude camUp >> camSide so the
         camera pitch is nearly vertical.  The naive pivotCU/camSide approximation
         breaks and the rocket drifts off-centre as _orbitZoom changes.  Project
         the pivot through the full tilt transform instead. */
      const _afCuW = pivotCU - camUp;
      const _afCp  = Math.atan2(-camUp, camSide);
      const _afCos = Math.cos(_afCp), _afSin = Math.sin(_afCp);
      const _afCf  = camSide * _afCos + _afCuW * _afSin;
      const _afCu  = _afCuW  * _afCos - camSide * _afSin;
      cx -= pivotCR / _afCf * focal;
      cy += _afCu   / _afCf * focal;
    } else {
      camBack = d * _orbitZoom;
      camUp   = d * _orbitZoom * 0.18;
      const _camD = camBack;
      cx -= pivotCR * focal / _camD;
      cy += pivotCU * focal / _camD;
    }

    /* ── Auto-director: blend camSide (zoom) + cy (look-at shift) ── */
    if (isSV && camSide > 0) {
      const dBlend = _dirBlend();
      if (dBlend > 0 && _dir.shot) {
        const sh  = _DIR_SHOTS[_dir.shot];
        const dOrig = camSide;
        camSide = dOrig * (1 - dBlend + dBlend * sh.zoom);
        /* cy shift: bring vF=sh.lF to screen center.
           A vertex at uR=sh.lF projects to y = cy + sh.lF * focal/camSide (approx),
           so shifting cy down by that amount re-centers it. */
        cy -= sh.lF * dBlend * focal / camSide;
      }
    }
    if (panX !== 0) cx += panX;
  }

  const camDist  = camSide > 0 ? camSide : camBack;
  const camPitch = Math.atan2(-camUp, camDist);
  const cosCP = Math.cos(camPitch), sinCP = Math.sin(camPitch);

  /* Blinn-Phong halfway vector — camera-side-aware, used for specular on aircraft skin */
  const _vDir = camSide > 0 ? [0, 1, 0] : [-1, 0, 0];
  const _Hac  = (v => v.map(x => x / Math.hypot(...v)))(
    [_LD[0]+_vDir[0], _LD[1]+_vDir[1], _LD[2]+_vDir[2]]
  );

  /* Camera direction in body frame [fP, rR, uR] — from surface toward camera.
     Used for cockpit-panel backface culling, which needs 3D normals because
     the 2D cross-product sign flips at orbit elevations (wrong-side panel bleeds).
     When side-cam orbit is active the camera swings in the fP-rR plane, so we
     rotate the direction vector by the inverse orbit angle to match project(). */
  let _cpCamF = camSide > 0 ?  sinEl * sinP  : -1;
  let _cpCamR = camSide > 0 ?  cosEl         :  0;
  const _cpCamU = camSide > 0 ?  sinEl * cosP  :  0;
  if (camSide > 0 && orbitAzDeg !== 0) {
    const oRad = orbitAzDeg * DEG;
    const cosO = Math.cos(oRad), sinO = Math.sin(oRad);
    const cpF2  = _cpCamF * cosO + _cpCamR * sinO;
    _cpCamR     = -_cpCamF * sinO + _cpCamR * cosO;
    _cpCamF     = cpF2;
  }

  /* Project body-frame vertex → { x, y, d } (d = cam fwd depth for sorting) */
  function project([vF, vR, vU]) {
    let fP, rR, uR;
    if (isBodyRoll) {
      const vR2 =  vR * cosR - vU * sinR;
      const vU2 =  vR * sinR + vU * cosR;
      fP = vF * cosP - vU2 * sinP; rR = vR2; uR = vF * sinP + vU2 * cosP;
    } else {
      fP =  vF * cosP - vU * sinP;
      const uP =  vF * sinP + vU * cosP;
      rR =  vR * cosR + uP * sinR; uR = -vR * sinR + uP * cosR;
    }

    /* Elevation orbit: tilt the scene up/down around the camera horizontal axis.
       Chase cam (camSide=0): camera is behind ship → rotate in fP-uR plane.
       Side cam (camSide>0): applied AFTER azimuth below, so the tilt axis follows the
       camera; doing it here (aircraft frame) turned into roll once az swung behind. */
    if (orbitElDeg !== 0 && camSide === 0) {
      const fP2 = fP * cosEl + uR * sinEl;
      uR = -fP * sinEl + uR * cosEl;
      fP = fP2;
    }
    /* Chase cam azimuth: rotate around fP (depth) axis — tilts body L/R in screen space */
    if (orbitAzDeg !== 0 && camSide === 0) {
      const rR2 = rR * cosAz - uR * sinAz;
      uR = rR * sinAz + uR * cosAz;
      rR = rR2;
    }
    /* Side cam azimuth: orbit camera around aircraft's up axis (fP-rR plane).
       Positive az swings camera toward nose; negative toward tail.
       Derived from camera at [camSide·sin(α), camSide·cos(α)] looking at origin:
       cfW = camSide - fP·sinAz - rR·cosAz → achieve via pre-rotation of fP/rR. */
    if (orbitAzDeg !== 0 && camSide > 0) {
      const fP2 = fP * cosAz - rR * sinAz;
      rR        = fP * sinAz + rR * cosAz;
      fP = fP2;
    }
    /* Side cam elevation: AFTER azimuth, so the tilt is about the camera-right axis
       (the post-az forward) rather than the aircraft's forward — otherwise it reads as
       roll as the view swings behind the nose. Rotate in the rR-uR plane. */
    if (orbitElDeg !== 0 && camSide > 0) {
      const rR2 = rR * cosEl + uR * sinEl;
      uR = -rR * sinEl + uR * cosEl;
      rR = rR2;
    }

    let cfW, crW, cuW;
    if (camSide > 0) {
      cfW = camSide - rR; crW = fP;
    } else {
      cfW = camBack + fP; crW = rR;
    }
    cuW = uR - camUp;

    const cf = cfW * cosCP + cuW * sinCP;
    const cu = cuW * cosCP - cfW * sinCP;
    if (cf < 0.002) return null;
    return { x: cx + crW / cf * focal, y: cy - cu / cf * focal, d: cfW };
  }

  /* Flaps + ailerons — C172/warbird family share one command model and
     dispatch to per-aircraft hinge animators living in their own modules.
     Rockets (falcon9/saturn-v/starship) have no surfaces here; WB airliners
     use the distinct Fowler-flap / speedbrake model below. */
  let verts = V_;
  const _ctrlAnim = _CTRL_ANIM[profile];
  if (_ctrlAnim) {
    const cmd = _warbirdCtrlCmd(S.aircraft?.handling?.maxBank ?? 60);
    if (cmd.active) verts = _ctrlAnim(cmd);
  } else if (isPP && _ppGeo) {
    const cmd = _warbirdCtrlCmd(S.aircraft?.handling?.maxBank ?? 60);
    verts = _ppGeo.animSurfaces({ ...cmd, propAngle: _propAngle });
  } else if (profile === 'wb') {
    const flap   = S.flaps ?? 0;
    const sb     = S.speedBrake ?? 0;
    /* AP aircraft (no manualControl): add heading error so arrow-key turns show aileron deflection.
       Manual WB aircraft (AN-225 etc.) use rollT from tickControls; hdgDelta would drift spuriously. */
    const _isAPAircraft = !S.aircraft?.manualControl;
    const hdgDelta = _isAPAircraft ? ((((S.hdgT ?? 0) - (S.hdg ?? 0)) + 540) % 360) - 180 : 0;
    const rollErr  = (S.rollT ?? 0) - (S.roll ?? 0);
    const bankCmd  = Math.max(-1, Math.min(1, (S.roll ?? 0) / 30));  // ±1 at ±30° bank
    const ailCmd   = Math.max(-1, Math.min(1, rollErr / 20 + bankCmd * 0.3 + hdgDelta / 40));
    if (flap > 0 || Math.abs(ailCmd) > 0.02 || sb === 2) {
      verts = _wbGeo.V_.map(v => v.slice());
      const _bL = _wbGeo.b, _wbV = _wbGeo.V_;
      if (flap > 0) {
        const fa = flap * 15 * DEG;
        const { r_rt, r_hs } = _wbGeo.anim;
        /* Rotate decoupled flap TE about the fixed hinge line */
        animHinge(verts, [_bL+200, _bL+201], r_rt, -fa, 'z', _wbV);  // R root lo/up
        animHinge(verts, [_bL+202, _bL+203], r_hs, -fa, 'z', _wbV);  // R break lo/up
        animHinge(verts, [_bL+208, _bL+209], r_rt, -fa, 'z', _wbV);  // L root lo/up
        animHinge(verts, [_bL+210, _bL+211], r_hs, -fa, 'z', _wbV);  // L break lo/up
        /* Fowler slide: flap LE + TE translate aft — hinge stays fixed, gap opens */
        const fowlerShift = fa * r_rt * 1.5;
        for (const vi of [
          _bL+196, _bL+197, _bL+198, _bL+199,   // R flap LE root+break lo/up
          _bL+200, _bL+201, _bL+202, _bL+203,   // R flap TE root+break lo/up
          _bL+204, _bL+205, _bL+206, _bL+207,   // L flap LE root+break lo/up
          _bL+208, _bL+209, _bL+210, _bL+211,   // L flap TE root+break lo/up
        ]) verts[vi][0] -= fowlerShift;
      }
      if (Math.abs(ailCmd) > 0.01) {
        const aa = ailCmd * 40 * DEG;
        const { r_ail } = _wbGeo.anim;
        animHinge(verts, [_bL+132, _bL+3, _bL+133, _bL+119], r_ail, -aa, 'z', _wbV);
        animHinge(verts, [_bL+134, _bL+7, _bL+135, _bL+123], r_ail, +aa, 'z', _wbV);
      }
      if (sb === 2) {
        const { r_sp_rt, r_sp_hs } = _wbGeo.anim;
        const sa = 45 * DEG;
        const r1 = r_sp_rt + 0.25*(r_sp_hs-r_sp_rt);
        const r2 = r_sp_rt + 0.50*(r_sp_hs-r_sp_rt);
        const r3 = r_sp_rt + 0.75*(r_sp_hs-r_sp_rt);
        animHinge(verts, [_bL+228], r_sp_rt, +sa, 'z', _wbV);  // R root TE
        animHinge(verts, [_bL+217], r1,      +sa, 'z', _wbV);  // R 0.25 TE
        animHinge(verts, [_bL+219], r2,      +sa, 'z', _wbV);  // R 0.50 TE
        animHinge(verts, [_bL+221], r3,      +sa, 'z', _wbV);  // R 0.75 TE
        animHinge(verts, [_bL+229], r_sp_hs, +sa, 'z', _wbV);  // R break TE
        animHinge(verts, [_bL+230], r_sp_rt, +sa, 'z', _wbV);  // L root TE
        animHinge(verts, [_bL+223], r1,      +sa, 'z', _wbV);  // L 0.25 TE
        animHinge(verts, [_bL+225], r2,      +sa, 'z', _wbV);  // L 0.50 TE
        animHinge(verts, [_bL+227], r3,      +sa, 'z', _wbV);  // L 0.75 TE
        animHinge(verts, [_bL+231], r_sp_hs, +sa, 'z', _wbV);  // L break TE
      }
    }
  }
  if (isSS && _ssGeo?.bodyFlapInfo?.length) {
    /* Body flap hinge. θ=π/2 → static geometry (perpendicular to body, launch position).
       θ=2π/3 → reentry drag: tips angled forward and further out.
       Tip verts (base+2, base+3) rotate about root edge; root verts fixed at rBody. */

    /* Flap load test — rapid oscillation between the times of the "flap load test"
       ATC callouts in the mission (scan once per render; negligible cost). */
    let _flapTestT0 = 0, _flapTestT1 = 0;
    for (const c of S.mission?.atcClearances ?? []) {
      if (c.text?.includes('flap load test')) {
        if (c.text.includes('started'))  _flapTestT0 = c.t;
        else if (c.text.includes('complete')) _flapTestT1 = c.t;
      }
    }
    const _simT = S.time ?? 0;
    const isLoadTest = _flapTestT0 > 0 && _simT >= _flapTestT0 && _simT <= _flapTestT1;

    let flapTarget;
    let trackRate;
    if (isLoadTest) {
      /* Oscillate ±25° around the reentry hold position at ~5 cycles over 30 s */
      const testPhase = (_simT - _flapTestT0) / Math.max(1, _flapTestT1 - _flapTestT0);
      flapTarget = Math.PI * 2 / 3 + Math.sin(testPhase * Math.PI * 10) * (Math.PI / 7.2);
      trackRate  = 0.25;  // snap fast so oscillation is visible
    } else {
      flapTarget = ((S.rocketStage ?? 1) >= 2 && (S.rocketSECO ?? false))
        ? Math.PI * 2 / 3 : Math.PI / 2;
      trackRate  = 0.015;
    }
    _ssFlapAngle += (flapTarget - _ssFlapAngle) * trackRate;
    /* Differential bank-angle offset: drives left/right flap asymmetry during reentry.
       starshipBankAngle ±75° → ±~19° differential per flap (0.25 rad/rad gain).
       dir=+1 and dir=-1 flaps on each pair deflect in opposite directions. */
    const _bankOff = (S.starshipBankAngle ?? 0) * DEG * 0.25;
    if (verts === V_) verts = V_.map(v => v.slice());
    for (const fi of _ssGeo.bodyFlapInfo) {
      const flapA = _ssFlapAngle + _bankOff * fi.dir;
      const _fsa  = Math.sin(flapA), _fca = Math.cos(flapA);
      const arm   = fi.rTip - fi.rBody;
      const rOut  = (fi.rBody + arm * _fsa) * fi.dir;
      const vFTipFore = fi.vFTopT ?? fi.vFTop;
      if (fi.axis === 'uR') {
        verts[fi.base + 2] = [vFTipFore - arm * _fca, 0, rOut];
        verts[fi.base + 3] = [fi.vFBot  - arm * _fca, 0, rOut];
      } else {
        verts[fi.base + 2] = [vFTipFore - arm * _fca, rOut, 0];
        verts[fi.base + 3] = [fi.vFBot  - arm * _fca, rOut, 0];
        if (fi.thick) {
          verts[fi.base + 6] = [vFTipFore - arm * _fca, rOut, -fi.thick];
          verts[fi.base + 7] = [fi.vFBot  - arm * _fca, rOut, -fi.thick];
        }
      }
    }
  }
  if (isF9) {
    /* Grid fin fold: deploy during S1 coast (descent), stow during powered ascent */
    const finTarget = (S.rocketCoast ?? false) ? Math.PI / 2 : 0;
    _finAngle += (finTarget - _finAngle) * 0.025;  // ~2-3 s deployment
    const arm = _gfS - _rf9;
    const sa = Math.sin(_finAngle), ca = Math.cos(_finAngle);
    if (verts === V_) verts = _V_f9.map(v => v.slice());
    /* Fin A (z+): outer verts 51, 52 */
    verts[99] = [0.005 - arm*ca, 0,             _rf9 + arm*sa];
    verts[100] = [0.002 - arm*ca, 0,             _rf9 + arm*sa];
    /* Fin B (y+): outer verts 55, 56 */
    verts[103] = [0.005 - arm*ca,  _rf9 + arm*sa, 0            ];
    verts[104] = [0.002 - arm*ca,  _rf9 + arm*sa, 0            ];
    /* Fin C (z-): outer verts 59, 60 */
    verts[107] = [0.005 - arm*ca, 0,            -_rf9 - arm*sa ];
    verts[108] = [0.002 - arm*ca, 0,            -_rf9 - arm*sa ];
    /* Fin D (y-): outer verts 63, 64 */
    verts[111] = [0.005 - arm*ca, -_rf9 - arm*sa, 0            ];
    verts[112] = [0.002 - arm*ca, -_rf9 - arm*sa, 0            ];
  }
  const pts = verts.map(project);

  /* T&D — Transposition and Docking visual
     ptsCSM: CSM vertices (ring 7+, vi≥112) re-projected with axial separation offset
     and pitch rotation so the CM nose swings 180° to face the S-IVB adapter. */
  const _tdProgress = (isSV && (S.mission?.hasLM) && !S.sivbSep) ? (S.tdProgress ?? 0) : 0;
  const _inTDSep    = _tdProgress > 0.03;
  const _vfCM       = 0.027;
  let _tdSep = 0, _tdCosRot = 1, _tdSinRot = 0;
  let ptsCSM = null;
  if (_inTDSep) {
    _tdSep = _tdProgress < 0.15 ? (_tdProgress / 0.15) * 0.007
           : _tdProgress < 0.70 ? 0.007
           : _tdProgress < 0.88 ? (1 - (_tdProgress - 0.70) / 0.18) * 0.007 : 0;
    const _tdRot = _tdProgress < 0.15 ? 0
                 : _tdProgress < 0.45 ? ((_tdProgress - 0.15) / 0.30) * Math.PI : Math.PI;
    _tdCosRot = Math.cos(_tdRot); _tdSinRot = Math.sin(_tdRot);
    ptsCSM = V_.map(v => {
      const vfl = v[0] - _vfCM, yl = v[1];
      return project([vfl * _tdCosRot - yl * _tdSinRot + _vfCM + _tdSep,
                      vfl * _tdSinRot + yl * _tdCosRot, v[2]]);
    });
  }
  /* Project a [vf, r, u] point through the CSM T&D rotation+offset transform */
  const _projectCSM = (vf, r, u) => {
    if (!_inTDSep) return project([vf, r, u]);
    const vfl = vf - _vfCM;
    return project([vfl * _tdCosRot - r * _tdSinRot + _vfCM + _tdSep,
                    vfl * _tdSinRot + r * _tdCosRot, u]);
  };

  /* Rise from pad — used to gate pad-structure geometry and nozzle visibility */
  const alt_nm   = (S.alt ?? 0) * FT_NM;
  const _svRise  = Math.max(0, alt_nm - (S.mission?.departure?.elevation ?? 0) * FT_NM);
  if (alt_nm < 0.082 && F_.length) {
    /* Silhouette shadow — project every vertex along the light direction onto the ground,
       then fill ALL geometry faces as one union path (uniform opacity, no per-face
       darkening). Reads the true planform: fuselage, swept wings, engines, tail.
       Rotate each vertex into the world-aligned frame first (same transform as project()). */
    const rot = verts.map(([vF, vR, vU]) => {
      let fR, rR, uR;
      if (isBodyRoll) {
        const vR2 = vR * cosR - vU * sinR, vU2 = vR * sinR + vU * cosR;
        fR = vF * cosP - vU2 * sinP; rR = vR2; uR = vF * sinP + vU2 * cosP;
      } else {
        const uP = vF * sinP + vU * cosP;
        fR = vF * cosP - vU * sinP; rR = vR * cosR + uP * sinR; uR = -vR * sinR + uP * cosR;
      }
      return { fR, rR, uR };
    });
    /* Ground level: rockets (vertical body) sit on their lowest vertex; a parked aircraft
       at its wheel-contact ride height (not MSL, or it would float); airborne, MSL. */
    const groundUR = (isSV || isF9 || isSS)
      ? Math.min(...rot.map(v => v.uR))
      : S.wow ? -_groundOffsetFt() * FT_NM : -alt_nm;
    /* Each vertex → ground along the light dir → orbit → screen. The orbit rotation must
       match project() exactly (chase cam: el then az; side cam: az then el), or the ground
       shadow won't track the airframe as the side cam swings around. */
    const shP = rot.map(({ fR, rR, uR }) => {
      const t  = _LD[2] > 0 ? (uR - groundUR) / _LD[2] : 0;
      let fP = fR - t * _LD[0], rW = rR - t * _LD[1], uW = groundUR;
      if (orbitElDeg !== 0 && camSide === 0) { const a = fP*cosEl + uW*sinEl; uW = -fP*sinEl + uW*cosEl; fP = a; }
      if (orbitAzDeg !== 0 && camSide === 0) { const a = rW*cosAz - uW*sinAz; uW = rW*sinAz + uW*cosAz; rW = a; }
      if (orbitAzDeg !== 0 && camSide  >  0) { const a = fP*cosAz - rW*sinAz; rW = fP*sinAz + rW*cosAz; fP = a; }
      if (orbitElDeg !== 0 && camSide  >  0) { const a = rW*cosEl + uW*sinEl; uW = -rW*sinEl + uW*cosEl; rW = a; }
      const cfW = camSide > 0 ? camSide - rW : camBack + fP;
      const crW = camSide > 0 ? fP : rW;
      const cuW = uW - camUp;
      const cf  = cfW * cosCP + cuW * sinCP;
      if (cf < 0.002) return null;
      return { x: cx + crW / cf * focal, y: cy - (cuW * cosCP - cfW * sinCP) / cf * focal };
    });

    const _ft     = alt_nm / 0.082;
    const opacity = (1 - _ft) * 0.38;
    const blur    = Math.round(2 + _ft * 8);
    ctx.save();
    ctx.filter    = `blur(${blur}px)`;
    ctx.fillStyle = `rgba(0,0,0,${opacity.toFixed(3)})`;
    ctx.beginPath();
    for (const f of F_) {
      const fp = f.map(vi => shP[vi]);
      if (fp.some(p => !p)) continue;
      /* Normalise winding to CCW so the nonzero fill is the UNION of all faces — top and
         bottom surfaces project onto the same footprint with opposite winding and would
         otherwise cancel to a hole. */
      let a2 = 0;
      for (let k = 0; k < fp.length; k++) { const p = fp[k], q = fp[(k + 1) % fp.length]; a2 += p.x * q.y - q.x * p.y; }
      const seq = a2 < 0 ? fp.slice().reverse() : fp;
      ctx.moveTo(seq[0].x, seq[0].y);
      for (let k = 1; k < seq.length; k++) ctx.lineTo(seq[k].x, seq[k].y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  /* Rotate body-frame normal by aircraft pitch + roll → world frame */
  function rotateNormal([nF, nR, nU]) {
    const fP =  nF * cosP - nU * sinP;
    const uP =  nF * sinP + nU * cosP;
    const rW =  nR * cosR + uP * sinR;
    const uW = -nR * sinR + uP * cosR;
    return [fP, rW, uW];
  }

  /* Two-light brightness: key + fill + ambient, scaled by the day/night dim (_acDim,
     set below once the sun height is known). Result in [0,1]. */
  let _acDim = 1;
  function litBr(nF, nR, nU, amb) {
    const d1 = Math.max(0, nF*_LD[0]  + nR*_LD[1]  + nU*_LD[2]);
    const d2 = Math.max(0, nF*_LD2[0] + nR*_LD2[1] + nU*_LD2[2]);
    return _acDim * Math.min(1, amb + (1 - amb) * (d1 + _LD2S * d2));
  }

  /* Per-vertex smooth (radial) normals for cylindrical interpolation */
  const VN_ = V_.map(([, vR, vU]) => {
    const r = Math.hypot(vR, vU);
    return r > 1e-5 ? [0, vR / r, vU / r] : [1, 0, 0];
  });

  /* Booster projection (F9 stage separation) */
  const rStage = (isF9 || isSV || isSS) ? (S.rocketStage ?? 1) : 0;

  /* Detect Saturn V stage separation — tumble animation + director cut */
  if (isSV) {
    if (_svSepLastAcId !== S.aircraft?.id) {
      _svSepLastAcId  = S.aircraft?.id;
      _svSepPrevStage = rStage;
      _svSepAnims.length = 0;
      _dir.shot = null;
      _dir._tliWas = !!(S.rocketTLI);   // don't re-trigger on mission reload mid-TLI
    } else if (rStage > _svSepPrevStage) {
      const sepStage = _svSepPrevStage;
      _svSepPrevStage = rStage;
      _svSepAnims.push({ stage: sepStage, t0: Date.now() });
      /* Cinematic cut: zoom into separation plane */
      _dir.shot = sepStage === 1 ? 'sic_sep' : 'sii_sep';
      _dir.t0   = Date.now();
    }
    /* TLI ignition cut */
    const tliNow = !!(S.rocketTLI);
    if (tliNow && !_dir._tliWas) { _dir.shot = 'tli'; _dir.t0 = Date.now(); }
    _dir._tliWas = tliNow;
  }

  /* Detect F9 / Starship stage separation — snap zoom to active stage */
  if (isF9 || isSS) {
    if (_rktSepLastAcId !== S.aircraft?.id) {
      _rktSepLastAcId  = S.aircraft?.id;
      _rktSepPrevStage = rStage;
    } else if (rStage > _rktSepPrevStage) {
      _rktSepPrevStage = rStage;
      _orbitZoom = 1;
    }
  }

  const hasLM = isSV && ((S.sivbSep ?? false) || _inTDSep) && !!(S.mission?.hasLM);
  const lmPts = (hasLM && !_inTDSep) ? _V_lm.map(project) : null;

  let bPts = null, cosdP = 1, sindP = 0;
  let bOffF = 0, bOffR = 0, bOffU = 0;
  if (isF9 && rStage >= 2 && S.booster?.active) {
    const b = S.booster;
    const cosLat = Math.cos((S.lat ?? 0) * DEG);
    const dN    = ((b.lat ?? 0) - (S.lat ?? 0)) * 60;
    const dE    = ((b.lon ?? 0) - (S.lon ?? 0)) * 60 * cosLat;
    const dUp   = ((b.alt ?? 0) - (S.alt ?? 0)) * FT_NM;
    const cosH  = Math.cos((S.hdg ?? 0) * DEG);
    const sinH  = Math.sin((S.hdg ?? 0) * DEG);
    const dFwdH = dN * cosH + dE * sinH;
    const dRtH  = -dN * sinH + dE * cosH;
    bOffF = dFwdH * cosP + dUp * sinP;
    bOffR = dRtH;
    bOffU = -dFwdH * sinP + dUp * cosP;
    const rec   = S.aircraft?.performance?.recovery ?? {};
    const phAge = (S.time ?? 0) - (b.phaseStartT ?? 0);
    const latePhases = ['boostback','coast','entry','glide','landing'];
    const dPDeg = b.phase === 'flip'
      ? 180 * Math.min(1, phAge / (rec.flipDuration ?? 20))
      : latePhases.includes(b.phase) ? 180 : 0;
    const dP2 = dPDeg * DEG;
    cosdP = Math.cos(dP2); sindP = Math.sin(dP2);
    const bVerts = _V_f9.map(([vF, vR, vU]) => {
      const rvF = vF * cosdP - vU * sindP;
      const rvU = vF * sindP + vU * cosdP;
      return [rvF + bOffF, vR + bOffR, rvU + bOffU];
    });
    bPts = bVerts.map(project);
  }

  /* Starship Super Heavy booster — fall-away / flip / recovery rendering */
  let ssBPts = null, ssCosdP = 1, ssSindP = 0;
  if (isSS && rStage >= 2 && S.booster?.active && _ssGeo?.V_) {
    const b      = S.booster;
    const cosLat = Math.cos((S.lat ?? 0) * DEG);
    const dN     = ((b.lat ?? 0) - (S.lat ?? 0)) * 60;
    const dE     = ((b.lon ?? 0) - (S.lon ?? 0)) * 60 * cosLat;
    const dUp    = ((b.alt ?? 0) - (S.alt ?? 0)) * FT_NM;
    const cosH   = Math.cos((S.hdg ?? 0) * DEG);
    const sinH   = Math.sin((S.hdg ?? 0) * DEG);
    const dFwdH  = dN * cosH + dE * sinH;
    const dRtH   = -dN * sinH + dE * cosH;
    const bOffF  = dFwdH * cosP + dUp * sinP;
    const bOffR  = dRtH;
    const bOffU  = -dFwdH * sinP + dUp * cosP;
    const rec    = S.aircraft?.performance?.recovery ?? {};
    const phAge  = (S.time ?? 0) - (b.phaseStartT ?? 0);
    const latePhases = ['boostback', 'coast', 'entry', 'glide', 'landing'];
    const dPDeg  = b.phase === 'flip'
      ? 180 * Math.min(1, phAge / (rec.flipDuration ?? 18))
      : latePhases.includes(b.phase) ? 180 : 0;
    const dP2    = dPDeg * DEG;
    ssCosdP      = Math.cos(dP2);
    ssSindP      = Math.sin(dP2);
    const ssBVerts = _ssGeo.V_.map(([vF, vR, vU]) => {
      const rvF = vF * ssCosdP - vU * ssSindP;
      const rvU = vF * ssSindP + vU * ssCosdP;
      return [rvF + bOffF, vR + bOffR, rvU + bOffU];
    });
    ssBPts = ssBVerts.map(project);
  }

  const _DBG_CULL   = false;  // ← set true to paint front=blue, back=red

  const _trActive = !isF9 && !isSS && !isSV && !isC172 && !isPP && !isBf109 && !isF4U && !isMig15 && !!(S.thrustReverser);

  /* Build shaded face list with average depth */
  /* Night apron uplight — when parked/taxiing at night the airport surface lights the
     airframe from below, so downward-facing faces get a bluish lift. 0 in daylight or
     airborne. (timeOfDay → sun height, same curve as the golden-hour tint.) */
  const _todUp = S.mission?.timeOfDay ?? 12;
  const _hUp   = _todUp < 1 ? _todUp * 24 : _todUp;
  const _sunUp = Math.sin((_hUp - 6) / 12 * Math.PI);
  const _upStr = (S.wow ? 1 : 0) * Math.max(0, Math.min(1, (0.1 - _sunUp) / 0.35)) * 0.95;
  const _UPCOL = [90, 140, 210];   // apron/taxiway-light blue
  /* Day/night dim — the airframe should go dark at night (lit mainly by the apron
     uplight + its own nav/strobe lights), not stay noon-bright. 1 in daylight, floor
     at night; held at 1 for rockets/space where timeOfDay isn't a ground sun height. */
  const _acDay = (isF9 || isSS || isSV || S.rocketOrbit) ? 1
               : Math.max(0, Math.min(1, (_sunUp + 0.15) / 0.25));
  _acDim = 0.25 + 0.75 * _acDay;

  _prof.buildT0 = performance.now();   // profiler: aircraft geometry build starts here
  const faces = F_.map((fi, i) => {
    /* F9 stage sep: main vehicle = S2 + Dragon + MVac nozzle (faces 48-95 + 96-103) */
    if (isF9 && rStage >= 2 && (i < 48 || (i > 95 && i < 104))) return null;

    /* Starship / Super Heavy stage sep: hide SH body faces + grid fins */
    if (isSS && rStage >= 2 && _ssGeo?.stageRanges?.[0]) {
      const sr0 = _ssGeo.stageRanges[0];
      if (i < sr0.faceEnd) return null;
      if (sr0.gridFinFaceStart != null && i >= sr0.gridFinFaceStart && i < sr0.gridFinFaceEnd) return null;
    }

    /* TR zone: skip C→D faces and replace with cascade overlay */
    if (_trActive && FC_[i] === 7) return null;

    /* Saturn V staging: hide spent stage geometry
       10-ring layout face ranges:
         0–47   = S-IC engine section + S-IC body + interstage  (rings 0→3)
         48–79  = S-II body + forward skirt                     (rings 3→5)
         144–159 = CM nose cone (Ring 9 → LES tip, vertex 160)
         160+   = stabilizer fins                                            */
    if (isSV && rStage >= 2 && (i <= 47 || i >= 160)) return null;
    if (isSV && rStage >= 3 && i <= 79) return null;
    if (isSV && S.sivbSep   && i >= 80 && i <= 111)  return null;
    if (isSV && S.lesJettisoned && i >= 144 && i < 160) return null;
    /* T&D: hide SLA adapter faces (96-111) that span the separation plane;
       CSM faces (112+) render via ptsCSM at the offset position. */
    if (isSV && _inTDSep && i >= 96 && i <= 111) return null;

    const psSrc = (isSV && _inTDSep && ptsCSM && i >= 112) ? ptsCSM : pts;
    const ps = fi.map(vi => psSrc[vi]);
    if (ps.some(p => !p)) return null;

    /* Wing view: skip fuselage, only render wings + control surfaces */
    if (wingView && FC_[i] !== 1) return null;

    /* Back-face culling.
       For body-roll vehicles (SV/F9), the 2D cross-product is unreliable for curved
       cylinder quads (near-vertical axis → degenerate slivers, winding can flip).
       Use 3D VN_ radial normal instead — BUT only for actual curved cylinder quads.
       Flat quads (fins, panels) have adjacent vertices with the same radial direction
       (dot ≈ 1.0); for those, fall through to the 2D cross product like any flat face. */
    let isBackFace = false;
    const _vna = VN_[fi[0]], _vnb = VN_[fi[1]];
    const _isCylQuad = isBodyRoll && fi.length === 4 &&
      (_vna[1]*_vnb[1] + _vna[2]*_vnb[2]) < 0.99;  // adjacent angles differ ≥ 22.5°
    if (_isCylQuad) {
      const [vn0, vn1, vn2] = _vna;
      const nR2 = vn1 * cosR - vn2 * sinR;
      const nU2 = vn1 * sinR + vn2 * cosR;
      const fPn = vn0 * cosP - nU2 * sinP;
      let   rWn = nR2;
      if (orbitElDeg !== 0 && camSide > 0) { const uWn = nU2 * cosP + vn0 * sinP; rWn = rWn * cosEl + uWn * sinEl; }
      isBackFace = camSide > 0 ? rWn < 0 : fPn > 0;
    } else {
      const p0 = ps[0], p1 = ps[1], p2 = ps[2];
      const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
      isBackFace = cross < 0;
    }
    if (isBackFace && !_DBG_CULL) return null;

    /* Wing-root occlusion (WB, no depth buffer). Inboard wing faces sit right at
       the fuselage tangent (root attaches at radius ≈ r). In a head-on/axial view
       the round fuselage should hide the far/tangent root, but the culled near
       belly exposes it, so wing slivers leak across the fuselage. Cull an inboard
       wing face when its outward radial normal doesn't face the camera — the same
       facing test used for the windows. Outboard wing (ρ ≫ r) is never affected,
       and the near-side root (radial toward camera) is kept, so side/¾ views are
       unchanged. */
    if (_wbGeo && FC_[i] === 1) {
      let _cx = 0, _cy = 0, _cz = 0;
      for (const vi of fi) { const v = verts[vi]; _cx += v[0]; _cy += v[1]; _cz += v[2]; }
      _cx /= fi.length; _cy /= fi.length; _cz /= fi.length;
      const _rho = Math.hypot(_cy, _cz);
      const _fr  = _wbGeo.r ?? _r;
      if (_rho > 1e-6 && _rho < _fr * 1.25) {
        const _e   = _fr * 0.6;
        const _pc  = project([_cx, _cy, _cz]);
        const _pco = project([_cx, _cy + (_cy / _rho) * _e, _cz + (_cz / _rho) * _e]);
        if (_pc && _pco && _pco.d > _pc.d - _e * 0.35) return null;
      }
    }

    if (_DBG_CULL) {
      const avgD = ps.reduce((s, p) => s + p.d, 0) / ps.length;
      return { ps, br: 1, avgD, col: isBackFace ? [200, 0, 0] : [0, 80, 200] };
    }

    const [nF, nR, nU] = rotateNormal(FN_[i]);
    const amb  = (isF9 && FC_[i] === 4) ? 0.55 : 0.18;
    let   br   = litBr(nF, nR, nU, amb);
    let   col  = COL_[FC_[i]];
    /* Night apron uplight: lift + tint downward (belly/underside) faces toward blue */
    if (_upStr > 0 && nU < 0) {
      const up = _upStr * (-nU), t = Math.min(0.7, up);
      br  = Math.min(1, br + 0.8 * up);
      col = [ col[0]+(_UPCOL[0]-col[0])*t, col[1]+(_UPCOL[1]-col[1])*t, col[2]+(_UPCOL[2]-col[2])*t ];
    }
    const spec = Math.pow(Math.max(0, nF*_Hac[0] + nR*_Hac[1] + nU*_Hac[2]), 28);
    const avgD = ps.reduce((s, p) => s + p.d, 0) / ps.length;

    /* Smooth shading: gradient across quad using per-vertex radial normals */
    let grad = null;
    if (fi.length === 4) {
      const rnL = rotateNormal(VN_[fi[0]]);
      const rnR = rotateNormal(VN_[fi[1]]);
      let brL = litBr(rnL[0], rnL[1], rnL[2], amb);
      let brR = litBr(rnR[0], rnR[1], rnR[2], amb);
      if (_upStr > 0) {
        if (rnL[2] < 0) brL = Math.min(1, brL + 0.8 * _upStr * (-rnL[2]));
        if (rnR[2] < 0) brR = Math.min(1, brR + 0.8 * _upStr * (-rnR[2]));
      }
      if (Math.abs(brL - brR) > 0.015) {
        const pL = { x: (ps[0].x + ps[3].x) * 0.5, y: (ps[0].y + ps[3].y) * 0.5 };
        const pR = { x: (ps[1].x + ps[2].x) * 0.5, y: (ps[1].y + ps[2].y) * 0.5 };
        grad = { pL, pR, brL, brR };
      }
    }

    return { ps, br, spec, avgD, col, grad, fc: FC_[i] };
  }).filter(Boolean);

  /* ── Render context — the shared seam for extracted domain renderers ──
     Everything a domain pass (rockets, gear, engines, livery, …) needs from
     this closure, gathered once the projection, lighting and face list exist.
     Extraction phases hand `rc` to outside-*-draw.js modules instead of the
     closure variables. All members are final for the frame at this point;
     `verts`/`faces`/`pts` are shared by reference, so passes that mutate them
     (gear pushes faces, nozzles push faces) keep working. Helpers defined
     later in the frame attach where they are born (rc.wCol below). */
  const rc = {
    /* canvas + screen */
    canvas, ctx, dpr, W, H, cx, cy, focal, mapPx,
    /* camera — post auto-fit/auto-director values */
    camBack, camUp, camSide, camPitch, cosCP, sinCP,
    orbitAzDeg, orbitElDeg, cosAz, sinAz, cosEl, sinEl,
    panX, wingView, fixedFraming,
    cpCamF: _cpCamF, cpCamR: _cpCamR, cpCamU: _cpCamU, edgeCamDir,
    /* attitude */
    cosP, sinP, cosR, sinR, isBodyRoll,
    /* render profile */
    profile, isC172, isSV, isSS, isF9, isBf109, isF4U, isMig15, isPP,
    /* geometry tables */
    V_, F_, FC_, FN_, E_, SE_, SL_, COL_, GV_, VN_,
    b: _b, reg: _reg, wbGeo: _wbGeo, ssGeo: _ssGeo, ppGeo: _ppGeo,
    /* per-frame vertex/face data */
    verts, pts, faces, ptsCSM, projectCSM: _projectCSM, inTDSep: _inTDSep,
    /* staging + environment */
    rStage, altNm: alt_nm, svRise: _svRise, hasLM, lmPts, bPts, ssBPts,
    trActive: _trActive, upStr: _upStr, UPCOL: _UPCOL, acDim: _acDim,
    /* shared closures */
    project, rotateNormal, litBr,
    /* rockets — booster sep projection + key/spec light dirs */
    cosdP, sindP, bOffF, bOffR, bOffU, ssCosdP, ssSindP, H: _H,
  };

  /* Booster faces — F9 S1 + SS Super Heavy (outside-rocket-draw.js) */
  drawBoosterFaces(rc);

  /* Cryo venting, Moon, plumes + all nozzle bells, SS reentry plasma
     (outside-rocket-draw.js) */
  drawRocketPlumesAndNozzles(rc);
  /* Engine pylons + thrust-reverser/chevron overlays (outside-engines-draw.js) */
  drawEnginePylons(rc);

  /* Flap track fairings — 3D teardrop pods (outside-engines-draw.js) */
  drawFlapTrackFairings(rc);

  /* LM faces — depth-sorted with main body */
  if (lmPts) {
    for (let i = 0; i < _F_lm.length; i++) {
      const fi = _F_lm[i];
      const ps = fi.map(vi => lmPts[vi]);
      if (ps.some(p => !p)) continue;
      const p0 = ps[0], p1 = ps[1], p2 = ps[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
      const avgD = ps.reduce((s,p) => s+p.d, 0) / ps.length;
      faces.push({ ps, avgD, col: _COLORS_lm[_FC_lm[i]], br: 0.88 });
    }
  }

  /* Gear struts, tires, bay doors — the data-driven landing-gear pass
     (outside-gear-draw.js); pushes depth-sorted faces into rc.faces. */
  drawLandingGear(rc);

  /* ── Cockpit glass + bandit mask as real depth-sorted faces (WebXR) ──────────
     cockpitPanels / cockpitMask are already model-space corners. Push the dark glass
     and the black surround as real faces, nudged proud of the skin so they sort in
     front of the fuselage; the silver frame stays a 2-D stroke (drawn after). */
  if (_wbGeo?.cockpitMask || _wbGeo?.cockpitPanels) {
    const _sub = (a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
    const _crs = (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const _dot = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const _cd  = [_cpCamF, _cpCamR, _cpCamU];
    /* Proud, depth-sorted face from model-space corners (ySign already applied).
       brFixed overrides lighting (used for the flat black mask). */
    const _pushCockpitFace = (corners3d, eps, col, amb, brFixed) => {
      const i1 = Math.floor(corners3d.length/3), i2 = Math.floor(corners3d.length*2/3);
      let n = _crs(_sub(corners3d[i1], corners3d[0]), _sub(corners3d[i2], corners3d[0]));
      const m = Math.hypot(n[0],n[1],n[2]) || 1; n = [n[0]/m, n[1]/m, n[2]/m];
      if (_dot(n, _cd) < 0) n = [-n[0],-n[1],-n[2]];   // orient toward camera
      if (_dot(n, _cd) <= 0.02) return;                // backface / edge-on
      const v3 = corners3d.map(c => [c[0]+n[0]*eps, c[1]+n[1]*eps, c[2]+n[2]*eps]);
      const ps = v3.map(project);
      if (ps.some(p => !p)) return;
      let br = brFixed;
      if (br == null) { const [nF,nR,nU] = rotateNormal(n); br = litBr(nF,nR,nU,amb); }
      faces.push({ ps, br, avgD: ps.reduce((s,p)=>s+p.d,0)/ps.length, col });
    };
    const _EPS_MASK = 0.00005, _EPS_GLASS = 0.00009;
    for (const ySign of [+1, -1]) {
      if (ySign * _cpCamR < -0.15) continue;           // camera on the far side
      if (_wbGeo.cockpitMask)
        _pushCockpitFace(_wbGeo.cockpitMask.map(([x,y,z]) => [x, ySign*y, z]),
                         _EPS_MASK, [8,10,12], 0, 1.0);          // black bandit surround
      if (_wbGeo.cockpitPanels)
        for (const panel of _wbGeo.cockpitPanels)
          _pushCockpitFace(panel.map(([x,y,z]) => [x, ySign*y, z]),
                           _EPS_GLASS, [10,20,38], 0.30);        // dark glass
    }
  }

  /* Painter's algorithm: farthest first */
  const _pfSort0 = performance.now();
  faces.sort((a, b) => b.avgD - a.avgD);
  const _pfFill0 = performance.now();

  /* ── Golden-hour skin sheen ──────────────────────────────────────────────────
     When the sun is near the horizon the key light is warm orange rather than
     white.  Simulate by reducing green and blue on sun-lit faces proportional
     to how low the sun is.  Sun-facing faces (high br) get the strongest tint;
     shadowed faces (br ≈ ambient 0.20) are unaffected.                        */
  const _gTOD   = S.mission?.timeOfDay ?? 12;
  const _gH     = _gTOD < 1 ? _gTOD * 24 : _gTOD;
  const _gSun   = Math.sin((_gH - 6) / 12 * Math.PI);
  const _gDay   = Math.max(0, Math.min(1, (_gSun + 0.15) / 0.25));   // 0=night 1=day
  const _gGold  = Math.max(0, 1 - Math.abs(_gSun) / 0.18);           // 1 at horizon, 0 at >10° up
  const _goldStr = _gDay * _gGold;   // >0 only during golden hours with daylight

  /* Returns an rgb() string with warm sun-color applied to brightness bv */
  const _wCol = (col, bv) => {
    const k = _goldStr * Math.max(0, bv - 0.20);
    return `rgb(${col[0]*bv|0},${Math.min(255,col[1]*bv*(1-0.70*k))|0},${Math.max(0,col[2]*bv*(1-1.30*k))|0})`;
  };
  rc.wCol = _wCol;   // golden-hour shader — born here, shared via the render context

  /* Fill shaded faces */
  for (const f of faces) {
    if (f.draw) { f.draw(); continue; }
    const { ps, br, spec, col, grad } = f;
    if (grad) {
      const { pL, pR, brL, brR } = grad;
      const gl = ctx.createLinearGradient(pL.x, pL.y, pR.x, pR.y);
      gl.addColorStop(0, _wCol(col, brL));
      gl.addColorStop(1, _wCol(col, brR));
      ctx.fillStyle = gl;
    } else {
      ctx.fillStyle = _wCol(col, br);
    }
    ctx.beginPath();
    ctx.moveTo(ps[0].x, ps[0].y);
    for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
    ctx.closePath();
    ctx.fill();

    /* Specular highlight — additive white sheen on faces oriented toward camera+sun */
    if (spec > 0.04) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${(spec * 0.30).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(ps[0].x, ps[0].y);
      for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  if (_prof.on) {
    _prof.buildMs = _pfSort0 - _prof.buildT0;
    _prof.sortMs  = _pfFill0 - _pfSort0;
    _prof.fillMs  = performance.now() - _pfFill0;
    _prof.faces   = faces.length;
    let d = 0; for (const f of faces) if (f.draw) d++; _prof.drawFaces = d;
  }

  /* (Cockpit bandit mask is now a real depth-sorted face — see the pre-sort block.) */

  /* Cockpit glazing — livery bands, window frames, front glass, windshield
     outline (outside-livery.js) */
  drawCockpitGlazing(rc);

  /* Saturn V stage-separation tumble (outside-rocket-draw.js) */
  drawSVStageSepTumble(rc);

  /* Swiss cross, winglet logo, MiG markings, livery decals, registration,
     rudder gap, near-wing re-stamp (outside-livery.js) */
  drawMarkingsAndLivery(rc);

  /* Cowl air intake — black oval at the spinner face plane (outside-engines-draw.js) */
  drawCowlIntake(rc);

  /* Prop — static blades or blur disk (outside-engines-draw.js) */
  drawPropDisk(rc, _propAngle);

  /* PP cabin structural edges + vertex debug labels (outside-livery.js) */
  drawCabinEdges(rc);

  /* Turbofan fan faces — WB inlets (outside-engines-draw.js) */
  drawFanFaces(rc);

  /* MiG-15 intake — compressor disk + splitter vane (outside-engines-draw.js) */
  drawMigIntake(rc);

  /* S2 MVac glow + F9 S1 Merlin cluster (outside-rocket-draw.js) */
  drawF9Nozzles(rc);

  /* Cabin + cockpit windows and doors — 2D fillRect removed; 3D _quad3d handles WB windows below */

  /* Edge backface culling — hide edges where both endpoints' normals face away from camera.
     Returns the camera-depth derivative of the vertex normal: negative = faces toward camera. */
  function edgeCamDir(vi) {
    const [nF, nR, nU] = VN_[vi];
    let fP, rW, uW;
    if (isBodyRoll) {
      const nR2 = nR * cosR - nU * sinR;
      const nU2 = nR * sinR + nU * cosR;
      fP = nF * cosP - nU2 * sinP;
      rW = nR2;
      uW = nF * sinP + nU2 * cosP;
    } else {
      fP = nF * cosP - nU * sinP;
      const uP = nF * sinP + nU * cosP;
      rW = nR * cosR + uP * sinR;
      uW = -nR * sinR + uP * cosR;
    }
    if (orbitElDeg !== 0 && camSide > 0) {
      const rW2 = rW * cosEl + uW * sinEl;
      uW = -rW * sinEl + uW * cosEl;
      rW = rW2;
    }
    return camSide > 0 ? -rW : fP;
  }

  /* Radome seam edges — accent line (per-aircraft colour; default bright red) */
  if (SE_.length > 0) {
    ctx.save();
    ctx.strokeStyle = S.aircraft?.nose?.radomeSeamCol ?? 'rgba(220,60,60,0.90)';
    ctx.lineWidth   = Math.max(1.5, devicePixelRatio * 1.5);
    ctx.beginPath();
    for (const [sa, sb] of SE_) {
      if (edgeCamDir(sa) > 0 && edgeCamDir(sb) > 0) continue;
      const pa = pts[sa], pb = pts[sb];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* Nose panel seam lines — blue longitudinals + kink (no culling) */
  if (SL_.length > 0) {
ctx.save();
    ctx.strokeStyle = 'rgba(80,150,255,0.90)';
    ctx.lineWidth   = Math.max(1.5, devicePixelRatio * 1.5);
    ctx.beginPath();
    for (const [sa, sb] of SL_) {
      const pa = pts[sa], pb = pts[sb];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* Cockpit window bounding rings — red highlight (fwd + aft ring) */
  if (_wbGeo?.rb && _wbGeo.winFwdRi != null && _wbGeo.winAftRi != null) {
    ctx.save();
    ctx.strokeStyle = 'rgba(220,60,60,0.90)';
    ctx.lineWidth   = Math.max(1.5, devicePixelRatio * 1.5);
    for (const ri of [_wbGeo.winFwdRi, _wbGeo.winAftRi]) {
      if (!_wbGeo.rb[ri]) continue;
      const rBase = _wbGeo.rb[ri];
      ctx.beginPath();
      for (let si = 0; si < 16; si++) {
        const va = rBase + si, vb = rBase + (si + 1) % 16;
        if (edgeCamDir(va) > 0 && edgeCamDir(vb) > 0) continue;
        const pa = pts[va], pb = pts[vb];
        if (!pa || !pb) continue;
        ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Nose ring + vertex labels — ring ri+1 at si=0, then si index at every vertex */
  if (false && _wbGeo?.rb) {
    const nRings = _wbGeo.rb.length;
    const fsRing = Math.round(13 * devicePixelRatio);
    const fsSi   = Math.round( 9 * devicePixelRatio);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* si labels — only on camera-facing vertices */
    ctx.font = `${fsSi}px monospace`;
    for (let ri = 0; ri < nRings; ri++) {
      for (let si = 0; si < 16; si++) {
        const vi = _wbGeo.rb[ri] + si;
        if (edgeCamDir(vi) > 0) continue;
        const p = pts[vi];
        if (!p) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(p.x - fsSi * 0.65, p.y - fsSi * 0.6, fsSi * 1.3, fsSi * 1.2);
        ctx.fillStyle = 'rgba(80,220,255,0.95)';
        ctx.fillText(String(si), p.x, p.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y - fsSi, 1.5 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,220,255,0.9)';
        ctx.fill();
      }
    }
    /* ring number labels at si=0 */
    ctx.font = `bold ${fsRing}px monospace`;
    for (let ri = 0; ri < nRings; ri++) {
      const vi = _wbGeo.rb[ri];
      if (edgeCamDir(vi) > 0) continue;
      const p = pts[vi];
      if (!p) continue;
      const label = String(ri + 1);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(p.x - fsRing * 0.7, p.y - fsRing * 0.65, fsRing * 1.4, fsRing * 1.3);
      ctx.fillStyle = 'rgba(255,255,80,0.95)';
      ctx.fillText(label, p.x, p.y);
    }
    ctx.restore();
  }

  /* SL_ seam-line vertex labels — drawn last so nothing covers them */
  if (false && SL_.length > 0 && _wbGeo?.rb) {
    const N16 = 16;
    const _slSeen = new Set();
    const fsL = Math.round(9 * devicePixelRatio);
    ctx.save();
    ctx.font = `${fsL}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [sa, sb] of SL_) {
      for (const vi of [sa, sb]) {
        if (_slSeen.has(vi)) continue;
        _slSeen.add(vi);
        const p = pts[vi];
        if (!p) continue;
        let riLabel = '?', siLabel = '?';
        for (let ri = 0; ri < _wbGeo.rb.length; ri++) {
          const offset = vi - _wbGeo.rb[ri];
          if (offset >= 0 && offset < N16) { riLabel = ri; siLabel = offset; break; }
        }
        const txt = `${riLabel}:${siLabel}`;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(p.x - fsL * 1.1, p.y + 3, fsL * 2.2, fsL * 1.2);
        ctx.fillStyle = 'rgba(255,200,60,0.95)';
        ctx.fillText(txt, p.x, p.y + 3 + fsL * 0.6);
      }
    }
    ctx.restore();
  }

  /* LM wireframe edges */
  if (lmPts) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 192, 168, 0.72)';
    ctx.lineWidth   = Math.max(1, devicePixelRatio);
    ctx.beginPath();
    for (const [a, b] of _E_lm) {
      const pa = lmPts[a], pb = lmPts[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* F9 booster edges, plume, nozzles, landing legs (outside-rocket-draw.js) */
  drawBoosterEdges(rc);

  /* Passenger windows + doors + cheatline (outside-livery.js) */
  drawPassengerWindows(rc);

  /* Aircraft lights — WB tip positions derived from wing geometry */
  const _lightList = isC172 ? (S.masterBat ? _LIGHTS_c172 : null)
    : isPP ? (S.masterBat ? (_ppGeo?.LIGHTS_ ?? null) : null)
    : (!isF9 && !isSS && !isBf109 && !isF4U && !isMig15 && !isSV) ? (() => {
        if (!_wbGeo) return _LIGHTS_wb;
        const _lwg = S.aircraft?.wing ?? _WB_WING_DEFAULT;
        const _ltY = _lwg.span;
        /* Nav lights sit at the wing tip (the winglet root), not up at the winglet tip:
           the old preset winglet height floated them above the now data-driven winglet. */
        const _ltZ = _lwg.dihedral;
        const _ltX = (_lwg.tipLE + _lwg.tipTE) / 2;
        /* Wingtip lights: the forward colour (R green / L red) with the white rear
           position light just AFT of it — so you can read approach vs. departure. */
        const _ltD  = Math.abs(_lwg.tipLE - _lwg.tipTE) * 0.15;
        const _ltXf = _ltX + _ltD;   // colour, forward
        const _ltXa = _ltX - _ltD;   // white, aft
        return [
          { pos: [_ltXf,  _ltY, _ltZ], col: [  0, 210,  80], key: 'nav'     },  // R green (fwd)
          { pos: [_ltXf, -_ltY, _ltZ], col: [220,  40,  40], key: 'nav'     },  // L red (fwd)
          { pos: [_ltXa,  _ltY, _ltZ], col: [255, 255, 255], key: 'nav'     },  // R white (aft)
          { pos: [_ltXa, -_ltY, _ltZ], col: [255, 255, 255], key: 'nav'     },  // L white (aft)
          { pos: [ 0.001,  0, _wbGeo.r], col: [220, 50, 50], key: 'beacon' },
          { pos: [_ltXa,  _ltY, _ltZ], col: [255, 255, 255], key: 'strobe'  },  // strobe co-located with aft white
          { pos: [_ltXa, -_ltY, _ltZ], col: [255, 255, 255], key: 'strobe'  },
          { pos: [ 0.013,  0,  0    ], col: [255, 248, 220], key: 'landing' },
        ];
      })() : null;
  if (_lightList) {
    const li  = S.lights ?? {};
    const now = Date.now();
    const strobeFlash  = (now % 857)  < 65;
    const beaconFlash  = (now % 1200) < 600;
    const dpr = devicePixelRatio;

    for (const { pos, col, key } of _lightList) {
      if (!li[key]) continue;
      if (key === 'strobe'  && !strobeFlash) continue;
      if (key === 'beacon'  && !beaconFlash) continue;

      const pt = project(pos);
      if (!pt) continue;

      /* Depth cull: skip if light is on the far side of the fuselage from the camera */
      const ptCtr = project([pos[0], 0, 0]);
      if (ptCtr && pt.d > ptCtr.d + 0.0008) continue;

      const [r, g, b] = col;
      const glowR = key === 'strobe' ? 14 * dpr : key === 'landing' ? 20 * dpr : 10 * dpr;

      ctx.save();
      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, glowR);
      grad.addColorStop(0,   `rgba(${r},${g},${b},0.95)`);
      grad.addColorStop(0.25,`rgba(${r},${g},${b},0.50)`);
      grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, glowR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 2 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /* Launch pads — LC-39A + Starbase (outside-rocket-draw.js) */
  drawLaunchPads(rc);

  /* ── CSM orbit-mode detail: windows, seams, RCS, soot ── */
  if (isSV && S.rocketOrbit && !_inTDSep) _drawCSMOrbitDetail(ctx, pts, project, dpr, camSide);

  /* ── XYZ axis indicator (bottom-left corner) ────────────────────── */
  {
    const δ  = 0.003;
    const p0 = project([0, 0, 0]);
    const px = project([δ, 0, 0]);
    const py = project([0, δ, 0]);
    const pz = project([0, 0, δ]);
    if (p0 && px && py && pz) {
      const margin = 52 * dpr;
      const len    = 36 * dpr;
      const ox = margin, oy = H - margin;

      ctx.save();
      ctx.font         = `bold ${Math.round(11 * dpr)}px monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'center';

      for (const [p, color, label] of [
        [px, '#ff5555', 'X'],
        [py, '#55dd55', 'Y'],
        [pz, '#5599ff', 'Z'],
      ]) {
        const dx = p.x - p0.x, dy = p.y - p0.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        const nx = dx / d, ny = dy / d;
        const ex = ox + nx * len, ey = oy + ny * len;

        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.fillText(label, ex + nx * 9 * dpr, ey + ny * 9 * dpr);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(ox, oy, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

}

/* ── Rocket cam — interstage looking aft/down at engine cluster ──
   Camera sits inside S1 near the top (body x = CAM_X), looking aft.
   Terrain rendered pitch=-90 for background; body rings frame the view. */
const _RCAM_X = 0.002;   // camera body-x position (inside S1 near top)

function _renderPlumeCam(canvas) {
  /* Background: terrain straight down from rocket position */
  const sP = S.pitch, sR = S.roll;
  S.pitch = -90;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true });
  S.pitch = sP; S.roll = sR;

  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio;
  const _mapPx = getMapReservedRight() * dpr;
  const cx = (W - _mapPx) / 2, cy = H / 2;
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG);

  /* Projection: camera at [_RCAM_X, 0, 0] looking aft (-body_x).
     body_y → screen right, body_z → screen up.                    */
  const projDown = ([vF, vR, vU]) => {
    const d = _RCAM_X - vF;
    if (d < 0.0001) return null;
    return { x: cx + vR / d * focal, y: cy - vU / d * focal, d };
  };

  /* ── Vignette: dark edges simulate the interstage ring frame ── */
  const vig = ctx.createRadialGradient(cx, cy, W * 0.28, cx, cy, W * 0.62);
  vig.addColorStop(0,   'rgba(0,0,0,0)');
  vig.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  vig.addColorStop(1,   'rgba(0,0,0,0.90)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  /* ── S1 body rings — two rings create tube perspective ── */
  for (const [vis, alpha] of [[[8,9,10,11,12,13,14,15], 0.55], [[0,1,2,3,4,5,6,7], 0.35]]) {
    const pts = vis.map(i => projDown(_V_f9[i]));
    if (pts.every(Boolean)) {
      ctx.save();
      ctx.strokeStyle = `rgba(195,210,228,${alpha})`;
      ctx.lineWidth = Math.max(1, 1.5 * dpr);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ── Engine nozzles (octaweb + centre Merlin) ── */
  const nozzleVI = [65,66,67,68,69,70,71,72,73];
  const nPts = nozzleVI.map(vi => projDown(_V_f9[vi]));
  const nCtr = nPts[0], nEdge = nPts[1];
  if (nCtr && nEdge) {
    const nR = Math.hypot(nEdge.x - nCtr.x, nEdge.y - nCtr.y) * 0.46;
    ctx.save();
    ctx.fillStyle = 'rgba(12,14,20,0.95)';
    ctx.beginPath();
    ctx.arc(nCtr.x, nCtr.y, Math.hypot(nEdge.x - nCtr.x, nEdge.y - nCtr.y) + nR * 1.4, 0, Math.PI*2);
    ctx.fill();
    for (let k = 0; k < nPts.length; k++) {
      const pt = nPts[k];
      if (!pt) continue;
      const r = k === 0 ? nR * 1.15 : nR;
      const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
      g.addColorStop(0,    'rgba(255,225,130,0.92)');
      g.addColorStop(0.45, 'rgba(220,130, 55,0.65)');
      g.addColorStop(1,    'rgba( 35, 38, 48,0.96)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  /* ── Engine exhaust plume (contained radius) ── */
  const pC = projDown([-0.018, 0, 0]);
  if (pC) {
    const plumeR = W * 0.20;
    const grad = ctx.createRadialGradient(pC.x, pC.y, 0, pC.x, pC.y, plumeR);
    grad.addColorStop(0,    'rgba(255,210,90,0.50)');
    grad.addColorStop(0.20, 'rgba(255,120,35,0.28)');
    grad.addColorStop(0.55, 'rgba(160, 55,12,0.10)');
    grad.addColorStop(1,    'rgba(  0,  0, 0,0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  _drawLabel(canvas, 'ROCKET CAM');
}

/* ── Booster cam — close side view of the returning Stage 1 ───── */
const BCAM_SIDE = 0.13;   // NM lateral separation from booster body
const BCAM_UP   = 50 * FT_NM;  // slight elevation above booster mid-body

/* ── Starship body cam — leeward fore body flap, looking sideways ──
   Terrain rendered looking starboard (+90°) with slight downward pitch.
   Earth fills the right portion; hull strip is drawn on the left. */
function _renderSSBodyCam(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;

  /* Terrain: camera on fore body flap, looking starboard + slightly down.
     Ship body appears on the left; Earth/clouds fill the right of frame. */
  const sL=S.lat, sLo=S.lon, sA=S.alt, sH=S.hdg, sP=S.pitch, sR=S.roll;
  S.hdg   = ((S.hdg ?? 0) + 90 + 360) % 360;
  S.pitch = -20;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true, focalScale: _bodyCamZoom });
  S.lat=sL; S.lon=sLo; S.alt=sA; S.hdg=sH; S.pitch=sP; S.roll=sR;

  /* ── Orbital cloud patches — world-space, drift with Earth motion ── */
  _drawOrbitalClouds(ctx, W, H, -20, S.alt ?? 0,
    S.lat ?? 0, S.lon ?? 0, ((S.hdg ?? 0) + 90 + 360) % 360, _bodyCamZoom);

  /* ── Hull wireframe: same parameters as chase cam — actual pitch/roll, user orbit ── */
  const _bcP = S.rocketSECO ? (S.starshipBodyPitch ?? S.pitch ?? 0) : (S.pitch ?? 0);
  const _bcR = S.rocketRoll ?? 0;
  _drawWireframe(canvas, _bcP, _bcR, CHASE_BACK, CHASE_UP, 0, false, _orbitAz, _orbitEl, _orbitPanX);

  const _zoomLabel = _bodyCamZoom !== 1 ? `BODY CAM  ${_bodyCamZoom.toFixed(1)}×` : 'BODY CAM';
  _drawLabel(canvas, _zoomLabel);
}

function _renderBoosterCam(canvas) {
  const b = S.booster;
  const bLat = b?.lat ?? S.lat ?? 0;
  const bLon = b?.lon ?? S.lon ?? 0;
  const bAlt = b?.alt ?? S.alt ?? 0;
  const bHdg = b?.hdg ?? S.hdg ?? 0;
  const cosLat  = Math.cos(bLat * DEG);
  const rightRad = bHdg * DEG + Math.PI / 2;
  const dN = Math.cos(rightRad) * BCAM_SIDE;
  const dE = Math.sin(rightRad) * BCAM_SIDE;

  /* Terrain: render from booster position + side offset */
  const sL=S.lat, sLo=S.lon, sA=S.alt, sH=S.hdg, sP=S.pitch, sR=S.roll;
  S.lat   = bLat + dN / 60;
  S.lon   = bLon + dE / (60 * cosLat);
  S.alt   = bAlt + BCAM_UP / FT_NM;
  S.hdg   = (bHdg - 90 + 360) % 360;
  S.pitch = Math.atan2(-BCAM_UP, BCAM_SIDE) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true });
  S.lat=sL; S.lon=sLo; S.alt=sA; S.hdg=sH; S.pitch=sP; S.roll=sR;

  if (!b?.active) { _drawLabel(canvas, 'BOOSTER CAM'); return; }

  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const cx = W / 2, cy = H / 2;
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG);
  const dpr = devicePixelRatio;

  /* Projection: camera at body-y = +BCAM_SIDE, looking left (-y).
     Screen horizontal = body-z, screen vertical = body-x (rocket long axis).
     Engine end (x<0) appears at screen bottom; Dragon stub (x>0) at top. */
  const S1_FOCUS = -0.006;  // centre view on S1 mid-body
  function projB([vF, vR, vU]) {
    const cf = BCAM_SIDE - vR;
    if (cf < 0.0004) return null;
    return { x: cx + vU / cf * focal, y: cy - (vF - S1_FOCUS) / cf * focal, d: cf };
  }

  const pts = _V_f9.map(projB);

  /* Shaded faces — S1 body (0–23) + grid fins (48–55) */
  const s1Idx = [...Array.from({length:24},(_,k)=>k), ...Array.from({length:8},(_,k)=>48+k)];
  const faces = [];
  for (const i of s1Idx) {
    const fi = _F_f9[i];
    const ps = fi.map(vi => pts[vi]);
    if (ps.some(p => !p)) continue;
    const p0=ps[0], p1=ps[1], p2=ps[2];
    if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
    const [nF, nR, nU] = _FN_f9[i];
    const dot = Math.max(0, nF*_LD[0] + nR*_LD[1] + nU*_LD[2]);
    const amb = (_FC_f9[i] === 4) ? 0.55 : 0.28;
    const br  = amb + (1-amb)*dot;
    faces.push({ ps, br, avgD: ps.reduce((s,p)=>s+p.d,0)/ps.length, col: _COLORS_f9[_FC_f9[i]] });
  }
  faces.sort((a, b2) => b2.avgD - a.avgD);

  /* Plume — before faces so body renders on top */
  const boosterFiring = ['boostback','entry','landing'].includes(b.phase);
  if (boosterFiring) {
    const pN = pts[65], pEdge = pts[66];
    const pEnd = projB([-0.018 - 0.030, 0, 0]);
    if (pN && pEnd) {
      const dx = pEnd.x - pN.x, dy = pEnd.y - pN.y;
      const pLen = Math.hypot(dx, dy);
      if (pLen > 2) {
        const px = -dy/pLen, py = dx/pLen;
        const nozR2 = (pN && pEdge)
          ? Math.hypot(pEdge.x-pN.x, pEdge.y-pN.y) * 2.8
          : 9 * dpr;
        ctx.save();
        const grad = ctx.createLinearGradient(pN.x, pN.y, pEnd.x, pEnd.y);
        grad.addColorStop(0,    'rgba(255,240,160,0.80)');
        grad.addColorStop(0.08, 'rgba(255,165, 60,0.65)');
        grad.addColorStop(0.25, 'rgba(210, 80, 18,0.38)');
        grad.addColorStop(0.55, 'rgba(130, 28,  5,0.15)');
        grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
        ctx.fillStyle = grad;
        const mx = (pN.x+pEnd.x)/2, my = (pN.y+pEnd.y)/2;
        ctx.beginPath();
        ctx.moveTo(pN.x+px*nozR2, pN.y+py*nozR2);
        ctx.quadraticCurveTo(mx+px*nozR2*2.2, my+py*nozR2*2.2,
                             pEnd.x+px*nozR2*3.8, pEnd.y+py*nozR2*3.8);
        ctx.lineTo(pEnd.x-px*nozR2*3.8, pEnd.y-py*nozR2*3.8);
        ctx.quadraticCurveTo(mx-px*nozR2*2.2, my-py*nozR2*2.2,
                             pN.x-px*nozR2, pN.y-py*nozR2);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
  }

  /* Fill faces */
  for (const { ps, br, col } of faces) {
    ctx.fillStyle = `rgb(${Math.round(col[0]*br)},${Math.round(col[1]*br)},${Math.round(col[2]*br)})`;
    ctx.beginPath();
    ctx.moveTo(ps[0].x, ps[0].y);
    for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
    ctx.closePath(); ctx.fill();
  }

  /* Wireframe edges — S1 body + nozzle ring */
  ctx.save();
  ctx.strokeStyle = 'rgba(175,195,215,0.65)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  for (const [ea, eb] of _E_f9) {
    const inS1 = v => v <= 23 || (v >= 49 && v <= 73);
    if (!inS1(ea) || !inS1(eb)) continue;
    const pa = pts[ea], pb = pts[eb];
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke(); ctx.restore();

  /* Engine nozzle cluster */
  const pC = pts[65], pEdgeN = pts[66];
  if (pC && pEdgeN) {
    const nR = Math.hypot(pEdgeN.x-pC.x, pEdgeN.y-pC.y) * 0.46;
    ctx.save();
    ctx.fillStyle = 'rgba(20,22,28,0.95)';
    const pRing = [66,67,68,69,70,71,72,73].map(vi => pts[vi]).filter(Boolean);
    if (pRing.length === 8) {
      ctx.beginPath();
      ctx.arc(pC.x, pC.y, Math.hypot(pRing[0].x-pC.x, pRing[0].y-pC.y)+nR*1.2, 0, Math.PI*2);
      ctx.fill();
    }
    for (const vi of [65,66,67,68,69,70,71,72,73]) {
      const pt = pts[vi]; if (!pt) continue;
      const r = vi === 65 ? nR*1.15 : nR;
      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
      if (boosterFiring) {
        grad.addColorStop(0,   'rgba(255,210,100,0.70)');
        grad.addColorStop(0.5, 'rgba(180,130, 60,0.40)');
        grad.addColorStop(1,   'rgba( 40, 40, 48,0.95)');
      } else {
        grad.addColorStop(0,   'rgba(60,65,80,0.80)');
        grad.addColorStop(1,   'rgba(22,25,32,0.95)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(140,150,165,0.80)';
      ctx.lineWidth = Math.max(0.5, 0.7*dpr);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  /* Landing legs — deploy over 5 s from start of 'landing' phase */
  const legP = b.phase === 'landing'
    ? Math.min(1, ((S.time ?? 0) - (b.phaseStartT ?? 0)) / 5)
    : 0;
  if (legP > 0.001) {
    const footXStow = -0.015, footRStow = 0.0024;
    const footXDep  = -0.022, footRDep  = 0.0070;
    const fX   = footXStow + (footXDep - footXStow) * legP;
    const fRad = footRStow + (footRDep - footRStow) * legP;
    const strutRad = _nzO * 1.8;
    ctx.save();
    ctx.strokeStyle = 'rgba(195,210,225,0.82)';
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.beginPath();
    for (const [nR2, nU2] of [[0,1],[1,0],[0,-1],[-1,0]]) {
      const pShoulder = projB([-0.016, nR2 * _rf9,   nU2 * _rf9]);
      const pFoot     = projB([fX,     nR2 * fRad,   nU2 * fRad]);
      const pStrut    = projB([-0.018, nR2 * strutRad, nU2 * strutRad]);
      if (pShoulder && pFoot) { ctx.moveTo(pShoulder.x, pShoulder.y); ctx.lineTo(pFoot.x, pFoot.y); }
      if (pStrut    && pFoot) { ctx.moveTo(pStrut.x,    pStrut.y);    ctx.lineTo(pFoot.x, pFoot.y); }
    }
    ctx.stroke(); ctx.restore();
  }

  _drawLabel(canvas, 'BOOSTER CAM');
}

/* ── Ship cam — fixed recovery-vessel camera at splashdown target ─
   Renders terrain from the Indian Ocean surface, draws cloud layers
   at realistic altitudes, and projects the approaching Starship as a
   plasma streak that cools into a visible silhouette.               */
const SCAM_HFT = 20;  // camera eye-height above sea level (feet)

/* Cloud layers: altFt / cover fraction / rgb / max alpha */
const _SCAM_CLOUDS = [
  { altFt:  2500, cover: 0.65, rgb: [228, 238, 248], a: 0.50 },  // stratocumulus
  { altFt:  9000, cover: 0.42, rgb: [242, 248, 255], a: 0.36 },  // altocumulus
  { altFt: 26000, cover: 0.28, rgb: [252, 255, 255], a: 0.22 },  // cirrus
];

function _renderShipCam(canvas) {
  const rg = S.mission?.reentryGuidance;
  if (!rg) { renderTerrain(canvas, { outsideView: true }); _drawLabel(canvas, 'SHIP CAM'); return; }

  const cLat   = rg.targetLat ?? -22;
  const cLon   = rg.targetLon ?? 115;
  const cosLat = Math.cos(cLat * DEG);

  /* Ship vector from camera (NM) */
  const dN       = ((S.lat ?? cLat) - cLat) * 60;
  const dE       = ((S.lon ?? cLon) - cLon) * 60 * cosLat;
  const shipAltNm = (S.alt ?? 0) * FT_NM;
  const camAltNm  = SCAM_HFT * FT_NM;
  const horizDist  = Math.hypot(dN, dE) || 0.001;
  const bearingToShip = (Math.atan2(dE, dN) / DEG + 360) % 360;
  const elevToShip    = Math.atan2(shipAltNm - camAltNm, horizDist) / DEG;
  const camPitch      = Math.max(2, elevToShip);

  /* Render ocean terrain — force water=true so fallback color is blue, not green */
  const _savedWater = S.mission?.water;
  if (S.mission) S.mission.water = true;
  const sL=S.lat, sLo=S.lon, sA=S.alt, sH=S.hdg, sP=S.pitch, sR=S.roll;
  S.lat = cLat; S.lon = cLon; S.alt = SCAM_HFT;
  S.hdg = bearingToShip; S.pitch = camPitch; S.roll = 0;
  renderTerrain(canvas, { outsideView: true });
  S.lat=sL; S.lon=sLo; S.alt=sA; S.hdg=sH; S.pitch=sP; S.roll=sR;
  if (S.mission) S.mission.water = _savedWater;

  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const dpr   = devicePixelRatio;
  /* _orbitZoom used as optical zoom — scroll to zoom in on the approaching ship */
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG) * _orbitZoom;
  const cx = W / 2, cy = H / 2;

  /* ── Cloud layers ── drawn before ship so ship shows through them
     when it descends into a layer, the semi-transparent band dims it. */
  for (const cl of _SCAM_CLOUDS) {
    const clAltNm = cl.altFt * FT_NM;
    const clElev  = Math.atan2(clAltNm - camAltNm, horizDist) / DEG;
    const clY     = cy - Math.tan((clElev - camPitch) * DEG) * focal;
    const bandH   = H * 0.045 * cl.cover;
    if (clY < -bandH * 2 || clY > H + bandH * 2) continue;

    /* Soft gradient band spanning full width */
    const [r, g, b] = cl.rgb;
    const a = cl.a * cl.cover;
    const grad = ctx.createLinearGradient(0, clY - bandH, 0, clY + bandH);
    grad.addColorStop(0,   `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.28,`rgba(${r},${g},${b},${a.toFixed(2)})`);
    grad.addColorStop(0.72,`rgba(${r},${g},${b},${a.toFixed(2)})`);
    grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, clY - bandH, W, bandH * 2);

    /* Irregular puffs — deterministic hash per slot, kept small */
    const step = 55 * dpr;
    const n    = Math.ceil(W / step) + 2;
    for (let i = 0; i < n; i++) {
      const h  = ((i * 2654435761) ^ 0xABCD1234) >>> 0;
      const px = (i - 0.5) * step + ((h & 0xFF) / 255 - 0.5) * step * 0.9;
      const py = clY + (((h >> 8) & 0xFF) / 255 - 0.5) * bandH * 0.65;
      const pr = (5 + ((h >> 16) & 0xFF) / 255 * 12) * dpr;
      const pa = (a * 0.5 * ((h >> 24) & 0xFF) / 255).toFixed(2);
      ctx.fillStyle = `rgba(${r},${g},${b},${pa})`;
      ctx.beginPath();
      ctx.ellipse(px, py, pr * 2.5, pr, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── Approaching Starship ── */
  const rangeNm  = Math.hypot(horizDist, shipAltNm);
  const rangeKm  = rangeNm * 1.852;
  const shipAltKm = shipAltNm * 1.852;

  if (rangeKm < 12000 && shipAltNm > 0) {
    const shipY = cy - Math.tan((elevToShip - camPitch) * DEG) * focal;
    const shipX = cx;

    /* Apparent pixel radius of 52-m body */
    const bodyLenNm   = 0.028;
    const screenR     = Math.max(1.5 * dpr, bodyLenNm / rangeNm * focal);

    /* Phase: hot reentry 80→10 km, post-reentry below 10 km, otherwise faint */
    const hotReentry  = S.rocketSECO && shipAltKm > 10 && shipAltKm < 80;
    const subsonic    = S.rocketSECO && shipAltKm <= 10;

    if (hotReentry) {
      /* Plasma fireball — colours cool with altitude */
      const heat = Math.min(1, (shipAltKm - 10) / 50);  // 1 = peak at 60 km, 0 at 10 km
      const g1 = ctx.createRadialGradient(shipX, shipY, 0, shipX, shipY, screenR * 5.5);
      g1.addColorStop(0,    `rgba(255,${Math.round(240 - heat*80)},${Math.round(180 - heat*140)},0.95)`);
      g1.addColorStop(0.18, `rgba(255,${Math.round(160 - heat*60)}, 30,0.72)`);
      g1.addColorStop(0.42, `rgba(${Math.round(230 - heat*30)}, 60,  5,0.38)`);
      g1.addColorStop(0.70, `rgba(180, 25,  0,0.14)`);
      g1.addColorStop(1,    'rgba(140,  0,  0,0)');
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(shipX, shipY, screenR * 5.5, 0, Math.PI * 2); ctx.fill();
      /* Bright core */
      ctx.fillStyle = 'rgba(255,255,245,0.98)';
      ctx.beginPath(); ctx.arc(shipX, shipY, screenR, 0, Math.PI * 2); ctx.fill();
    } else if (subsonic) {
      /* Post-reentry: heat is bleeding off — faint amber glow + visible body */
      const heatCool = Math.max(0, shipAltKm / 10);   // 1 at 10 km, 0 at sea level
      const g2 = ctx.createRadialGradient(shipX, shipY, 0, shipX, shipY, screenR * 3.5);
      g2.addColorStop(0,   `rgba(255,210,150,${(0.35 * heatCool).toFixed(2)})`);
      g2.addColorStop(0.4, `rgba(180,210,240,${(0.28 * (1 - heatCool * 0.5)).toFixed(2)})`);
      g2.addColorStop(1,   'rgba(140,180,220,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(shipX, shipY, screenR * 3.5, 0, Math.PI * 2); ctx.fill();
      /* Elongated body silhouette — 3:1 aspect ratio, belly toward camera */
      ctx.save();
      ctx.translate(shipX, shipY);
      const bodyAngle = Math.atan2(dE, dN);   // bearing angle → body axis on screen
      ctx.rotate(bodyAngle + Math.PI / 2);
      ctx.scale(1, 0.35);
      ctx.fillStyle = 'rgba(105,115,130,0.92)';
      ctx.beginPath(); ctx.arc(0, 0, screenR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      /* Suborbital coast — faint star-like point */
      const g3 = ctx.createRadialGradient(shipX, shipY, 0, shipX, shipY, screenR * 2);
      g3.addColorStop(0, 'rgba(210,235,255,0.60)');
      g3.addColorStop(1, 'rgba(190,220,255,0)');
      ctx.fillStyle = g3;
      ctx.beginPath(); ctx.arc(shipX, shipY, screenR * 2, 0, Math.PI * 2); ctx.fill();
    }

    /* Data tag */
    ctx.save();
    ctx.font      = `${Math.round(10 * dpr)}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(140,195,225,0.88)';
    ctx.textAlign = 'left';
    const tagX = shipX + screenR * 6 + 4 * dpr;
    const tagY = shipY + 4 * dpr;
    ctx.fillText(`S39  ALT ${Math.round(shipAltKm)} km  RNG ${Math.round(rangeKm)} km`, tagX, tagY);
    ctx.restore();
  }

  _drawLabel(canvas, 'SHIP CAM');
}

/* ── Label ────────────────────────────────────────────────────── */
function _drawPauseOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio;
  const W = canvas.width, H = canvas.height;
  ctx.save();

  /* ⏸ top-right */
  ctx.font      = `bold ${12 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(255,210,60,0.92)';
  ctx.textAlign = 'right';
  ctx.fillText('⏸  PAUSED', W - 14 * dpr, 22 * dpr);

  /* orbit + hints — bottom-left */
  ctx.textAlign = 'left';
  ctx.font      = `${10 * dpr}px "IBM Plex Mono", monospace`;
  const pad   = 14 * dpr;
  const lineH = 15 * dpr;

  /* normalise to −180…+180 */
  const az = ((_orbitAz + 180) % 360 + 360) % 360 - 180;
  const el = _orbitEl;
  const lines = [
    `AZ ${az >= 0 ? '+' : ''}${az.toFixed(0)}°  EL ${el >= 0 ? '+' : ''}${el.toFixed(0)}°  Z ${_orbitZoom.toFixed(2)}x   drag · pinch zoom · 0 reset · P resume`,
  ];
  if (_dir.shot) {
    const sh = _DIR_SHOTS[_dir.shot];
    lines.unshift(`shot: ${_dir.shot}   zoom ${sh.zoom}   lF ${sh.lF}   orbitAz ${sh.orbitAz ?? 0}`);
  }

  const boxH = lines.length * lineH + 10 * dpr;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(pad - 6 * dpr, H - pad - boxH + 4 * dpr, 480 * dpr, boxH);

  ctx.fillStyle = 'rgba(180,220,255,0.90)';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, H - pad - (lines.length - 1 - i) * lineH);
  });

  ctx.restore();
}

function _drawLabel(canvas, text) {
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio;
  ctx.save();
  ctx.font      = `${11 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(77,197,220,0.82)';
  ctx.textAlign = 'left';
  ctx.fillText(text, 14 * dpr, 22 * dpr);
  ctx.restore();
}
