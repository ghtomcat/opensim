/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view: cockpit forward · chase cam · side cam.
   Aircraft = flat-shaded 3-D wireframe (painter's algorithm).
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { renderTerrain } from './terrain.js';
import { getMapReservedRight } from './map.js';
import { moonECI } from '../core/rocket.js';
import { buildWingSurface, computeFaceNormals, _buildRocket, animHinge } from './outside-shared.js';
import { _buildPP, _acPropFromJson } from './outside-pp.js';
import {
  _r, _nr1, _nr2, _nr3, _hs, _ey, _ez, _pz, _er, _e7, _efr, _ef7, _erc, _e7c, _wr, _dh,
  _WB_WING_DEFAULT, _WB_NP, _buildWB, _acGeoFromJson, _wbCache,
  _V, _F, _FC, _E, _FN, _GV, _GE, _LIGHTS_wb, _DOOR
} from './outside-wb.js';
import {
  _cr, _xr, _abr, _tr, _hs172, _dh172, _hst172, _hst_th, _vst_th, _pr172, _sp172,
  _C172_WING, _COLORS_c172,
  _V_c172, _F_c172, _FC_c172, _E_c172, _anim_c172, _FN_c172, _LIGHTS_c172, _GV_c172,
  animSurfaces_c172, _PROP_c172
} from './outside-c172.js';
import {
  _spb,
  _bcR, _bfRy, _bfRz, _baRy, _baRz, _btRy, _btRz,
  _b9hs, _b9dh, _b9vH, _b9hw, _b9pr, _bCzH, _bCyW,
  _COLORS_b109, _V_b109, _F_b109, _FC_b109, _E_b109, _anim_b109, _FN_b109, _GV_b109,
  animSurfaces_b109, _PROP_b109
} from './outside-b109.js';
import {
  _f4uCowlR, _f4uFRy, _f4uFRz, _f4uARy, _f4uARz, _f4uTRy, _f4uTRz,
  _f4uHS, _f4uVH, _f4uHW, _f4uPropR, _f4uSpb, _f4uCzH, _f4uCyW,
  _COLORS_f4u, _V_f4u, _F_f4u, _FC_f4u, _E_f4u, _anim_f4u, _FN_f4u, _GV_f4u,
  animSurfaces_f4u, _PROP_f4u
} from './outside-f4u.js';
import {
  _m15r, _m15ir,
  _COLORS_mig15, _V_mig15, _F_mig15, _FC_mig15, _E_mig15, _anim_mig15, _FN_mig15, _GV_mig15,
  animSurfaces_mig15
} from './outside-mig15.js';
import {
  _sv1r, _sv3r, _svcr, _svFS, _svLT,
  _COLORS_sv, _V_sv, _F_sv, _FC_sv, _E_sv, _FN_sv,
  _lmO, _lmAR, _lmAH, _lmDR, _lmDH, _lmLR, _lmNR, _lmNH,
  _COLORS_lm, _V_lm, _F_lm, _FC_lm, _E_lm, _FN_lm,
  _svSepAnims, _dir, _DIR_SHOTS, _dirBlend,
  _rf9, _gfS, _nzO, _nzO7, _nzVac, _nzVac7, _nzSk, _nzSk7,
  _COLORS_f9, _V_f9, _F_f9, _FC_f9, _E_f9, _FN_f9
} from './outside-space.js';
import {
  _ssRocketCache_mut,
  _drawSSReentryPlasma, _drawCSMOrbitDetail, _drawOrbitalClouds, _drawSSBodyHull
} from './outside-rocket.js';

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
      _orbitEl = Math.max(-85, Math.min(85, _orbitEl - (e.clientY - _orbitDragY) * 0.3));  // clamp: tilt elevation, never flip over the top
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
function _groundOffsetFt() {
  if (!S.wow) return 0;
  const id = S.aircraft?.id ?? '';
  if (S.aircraft?.vehicleType === 'rocket') return 0;
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
  else                     renderTerrain(_canvas);
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
  renderTerrain(canvas, { outsideView: true, cxOverride: _cxC });
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
  const sideDist = (isRocket ? Math.max(SIDE_SIDE, altNm * 0.25) : SIDE_SIDE) * _orbitZoom;
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
  renderTerrain(canvas, { outsideView: true, cxOverride: _cxS });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  const W = canvas.width, H = canvas.height;
  _drawOrbitalClouds(canvas.getContext('2d'), W, H, _sidePitch, _tcSAlt, _tcSLat, _tcSLon, _tcSHdg);

  /* Wireframe: rockets: _orbitAz rolls body; aircraft: _orbitAz orbits camera via sideOrbitAz.
     El: aircraft with chaseCamOrbit use fixed 12° so chase-calibrated El doesn't bleed here. */
  const _useWowPitch = S.wow && S.aircraft?.vehicleType !== 'rocket';
  const _scEl = (isRocket && S.aircraft?.chaseCamOrbit) ? 12 : _orbitEl;   // wireframe El tracks the terrain El
  _drawWireframe(canvas, _useWowPitch ? 0 : acP, (_useWowPitch ? 0 : acR) + renderOrbit, 0, sideUp, sideDist, false, sideOrbitAz, _scEl);
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
  renderTerrain(canvas, { outsideView: true });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  _drawWireframe(canvas, acP, acR, 0, WING_UP, WING_SIDE, true);
  _drawLabel(canvas, 'WING VIEW');
}

/* Draw a volumetric tire (far face + tread band + near face + hub).
   wc: world-space axle centre [x,y,z]. tR: tire radius. */
function drawVolumetricTire(ctx, wc, tR, project, hubR) {
  const M   = 24, H = M / 2;
  const tW  = tR * 0.40;
  const tRs = tR * 0.86;   // sidewall (face) radius — inset so the shoulders round into the tread
  const yS  = wc[1] === 0 ? 1 : Math.sign(wc[1]);
  const wO  = [wc[0], wc[1] + yS * tW, wc[2]];  // outboard face
  const wI  = [wc[0], wc[1] - yS * tW, wc[2]];  // inboard face
  /* Ring of M+1 screen points around the tyre at world centre w, radius r; .pC = projected centre */
  const ringAt = (w, r) => {
    const pC = project(w), pU = project([w[0], w[1], w[2]+r]), pF = project([w[0]+r, w[1], w[2]]);
    if (!pC || !pU || !pF) return null;
    const out = Array.from({length: M+1}, (_, i) => {
      const t = i / M * Math.PI * 2;
      return [pC.x + Math.cos(t)*(pU.x-pC.x) + Math.sin(t)*(pF.x-pC.x),
              pC.y + Math.cos(t)*(pU.y-pC.y) + Math.sin(t)*(pF.y-pC.y)];
    });
    out.pC = pC; return out;
  };
  const ptO = ringAt(wO, tRs), ptI = ringAt(wI, tRs), ptM = ringAt(wc, tR);
  if (!ptO || !ptI || !ptM) return;

  const fill = (pts, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    pts.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath(); ctx.fill();
  };
  /* Side band between two rings, split top/bottom so it reads as a curved surface */
  const band = (ptA, ptB, col) => {
    ctx.fillStyle = col;
    for (const [s, e] of [[0, H], [H, M]]) {
      ctx.beginPath();
      ptA.slice(s, e+1).forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
      [...ptB.slice(s, e+1)].reverse().forEach(([x,y]) => ctx.lineTo(x,y));
      ctx.closePath(); ctx.fill();
    }
  };

  /* Near face = smaller depth. Profile: far sidewall → bulged tread crown (ptM) → near
     sidewall, so the shoulders round instead of meeting the tread at a sharp edge. */
  const outerIsNear = ptO.pC.d <= ptI.pC.d;
  const [ptFar, ptNear, pCNear, wNear] = outerIsNear
    ? [ptI, ptO, ptO.pC, wO]
    : [ptO, ptI, ptI.pC, wI];

  fill(ptFar, 'rgba(28,32,40,0.95)');
  band(ptFar, ptM,    'rgba(34,39,49,0.97)');   // far shoulder → tread crown
  band(ptM,   ptNear, 'rgba(45,51,62,0.97)');   // tread crown → near shoulder (lighter)
  fill(ptNear, 'rgba(35,40,50,0.96)');

  /* Hub on near face — silver, sized from the measured hub diameter (fallback 0.20·tR) */
  const hR  = hubR ?? tR * 0.20;
  const pH1 = project([wNear[0], wNear[1], wNear[2]+hR]);
  const pH2 = project([wNear[0]+hR, wNear[1], wNear[2]]);
  if (pH1 && pH2) {
    ctx.fillStyle = 'rgba(176,183,196,0.92)';
    ctx.beginPath();
    for (let i = 0; i <= M; i++) {
      const t = i / M * Math.PI * 2;
      const x = pCNear.x + Math.cos(t)*(pH1.x-pCNear.x) + Math.sin(t)*(pH2.x-pCNear.x);
      const y = pCNear.y + Math.cos(t)*(pH1.y-pCNear.y) + Math.sin(t)*(pH2.y-pCNear.y);
      i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  }

  ctx.strokeStyle = 'rgba(190,200,215,0.70)';
  ctx.beginPath();
  ptNear.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  ctx.closePath(); ctx.stroke();
}

/* Draw a pair of tires (1 pair = 2 tires) on a short axle centred at wc.
   The axle runs along Y; each tire is offset ±axH from wc.
   An axle tube connects the inner faces of both tires. */
function drawTirePair(ctx, wc, tR, project, dpr, hubR) {
  const tW  = tR * 0.40;   // half-width of one tire (matches drawVolumetricTire)
  const axH = tR * 0.55;   // half-span: center → each tire center
  const yS  = wc[1] === 0 ? 1 : Math.sign(wc[1]);
  const wcO = [wc[0], wc[1] + yS * axH, wc[2]];  // outboard tire center
  const wcI = [wc[0], wc[1] - yS * axH, wc[2]];  // inboard  tire center
  drawVolumetricTire(ctx, wcO, tR, project, hubR);
  drawVolumetricTire(ctx, wcI, tR, project, hubR);
  // Axle tube between inner faces
  const pO = project([wcO[0], wcO[1] - yS * tW, wcO[2]]);
  const pI = project([wcI[0], wcI[1] + yS * tW, wcI[2]]);
  if (pO && pI) drawStrutTube(ctx, pO, pI, dpr);
}

/* Orthonormal frame around an axle direction: returns [axle, u, v] with u,v ⊥ axle
   spanning the wheel-disc plane. Default Y axle reproduces the old X-Z disc. */
function _tireFrame(axis) {
  const crs = (p, q) => [p[1]*q[2]-p[2]*q[1], p[2]*q[0]-p[0]*q[2], p[0]*q[1]-p[1]*q[0]];
  const na = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const a = [axis[0]/na, axis[1]/na, axis[2]/na];
  const ref = Math.abs(a[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  let u = crs(ref, a); const mu = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0]/mu, u[1]/mu, u[2]/mu];
  const v = crs(a, u);
  return [a, u, v];
}

/* Real-3-D tyre — revolves the rounded cross-section (sidewall tRs → bulged tread tR
   → sidewall tRs, plus a silver hub disc) around the axle into actual lit faces, so
   it holds up from any angle / in WebXR. `axis` is the axle direction (default Y); the
   main gear passes a tilted axle so the wheel swings with the retracting leg. Pushes
   faces into the painter's `faces` list rather than painting ellipses on the canvas. */
function pushTire(faces, wc, tR, hubR, tW, project, rotateNormal, litBr, axis, N) {
  N = N || 14; const tRs = tR * 0.86, hR = hubR ?? tR * 0.20;
  const [a, u, v] = _tireFrame(axis || [0, 1, 0]);
  const off  = (d) => [wc[0]+a[0]*d, wc[1]+a[1]*d, wc[2]+a[2]*d];
  const ring = (d, r) => { const c = off(d); return Array.from({ length: N }, (_, k) => {
    const t = k / N * Math.PI * 2, cu = Math.cos(t) * r, sv = Math.sin(t) * r;
    return [c[0]+u[0]*cu+v[0]*sv, c[1]+u[1]*cu+v[1]*sv, c[2]+u[2]*cu+v[2]*sv];
  }); };
  const rO = ring(tW, tRs), rI = ring(-tW, tRs), rM = ring(0, tR);
  const hO = ring(tW, hR),  hI = ring(-tW, hR);
  const cO = off(tW), cI = off(-tW);
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const crs = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const TYRE = [40, 45, 55], HUB = [176, 183, 196];
  const face = (v3, col, amb) => {
    const ps = v3.map(project);
    if (ps.some(p => !p)) return;
    const c = v3.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]).map(x => x / v3.length);
    let n = crs(sub(v3[1], v3[0]), sub(v3[2], v3[0]));
    const m = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0]/m, n[1]/m, n[2]/m];
    if (dot(n, sub(c, wc)) < 0) n = [-n[0], -n[1], -n[2]];   // outward normal for lighting
    const [nF, nR, nU] = rotateNormal(n);
    faces.push({ ps, br: litBr(nF, nR, nU, amb), avgD: ps.reduce((s, p) => s + p.d, 0) / ps.length, col });
  };
  for (let k = 0; k < N; k++) {
    const j = (k + 1) % N;
    face([rO[k], rO[j], rM[j], rM[k]], TYRE, 0.16);   // tread: outer shoulder → crown
    face([rM[k], rM[j], rI[j], rI[k]], TYRE, 0.16);   // tread: crown → inner shoulder
    face([hO[k], hO[j], rO[j], rO[k]], TYRE, 0.20);   // outer sidewall annulus
    face([hI[k], hI[j], rI[j], rI[k]], TYRE, 0.20);   // inner sidewall annulus
    face([cO, hO[k], hO[j]], HUB, 0.30);              // outer hub disc (silver)
    face([cI, hI[k], hI[j]], HUB, 0.30);              // inner hub disc
  }
}

/* A pair of tyres on a short axle, centred at wc (real-3-D). `axis` is the axle
   direction (default Y); both tyres + the axle stub follow it, so the pair tilts
   together when the leg swings. */
function pushTirePair(faces, wc, tR, hubR, project, rotateNormal, litBr, axis) {
  const tW = tR * 0.40, axH = tR * 0.55;
  /* LOD: tyre segment count from the wheel's projected size — full 14 up close,
     down to a hexagon when small (the chase/side-cam framing, where a widebody has
     a dozen+ wheels). Cuts face count + per-frame allocations where it isn't seen. */
  const _pc = project(wc), _pe = project([wc[0], wc[1], wc[2] - tR]);
  let N = 14;
  if (_pc && _pe) N = Math.max(6, Math.min(14, Math.round(Math.hypot(_pe.x - _pc.x, _pe.y - _pc.y) / 7)));
  const [a, u, v] = _tireFrame(axis || [0, 1, 0]);
  const off = (d) => [wc[0]+a[0]*d, wc[1]+a[1]*d, wc[2]+a[2]*d];
  pushTire(faces, off( axH), tR, hubR, tW, project, rotateNormal, litBr, a, N);
  pushTire(faces, off(-axH), tR, hubR, tW, project, rotateNormal, litBr, a, N);
  /* axle stub between the inner faces */
  const aN = 8, axR = tR * 0.16;
  const sub = (p,q) => [p[0]-q[0],p[1]-q[1],p[2]-q[2]], dot = (p,q) => p[0]*q[0]+p[1]*q[1]+p[2]*q[2],
        crs = (p,q) => [p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
  const stub = (d) => { const c = off(d); return Array.from({ length: aN }, (_, k) => {
    const t = k/aN*Math.PI*2, cu = Math.cos(t)*axR, sv = Math.sin(t)*axR;
    return [c[0]+u[0]*cu+v[0]*sv, c[1]+u[1]*cu+v[1]*sv, c[2]+u[2]*cu+v[2]*sv]; }); };
  const r1 = stub(axH - tW), r2 = stub(-(axH - tW));
  for (let k = 0; k < aN; k++) { const j = (k+1)%aN, v3 = [r1[k], r1[j], r2[j], r2[k]];
    const ps = v3.map(project); if (ps.some(p => !p)) continue;
    const cc = v3.reduce((a,p)=>[a[0]+p[0],a[1]+p[1],a[2]+p[2]],[0,0,0]).map(x=>x/4);
    let n = crs(sub(v3[1],v3[0]), sub(v3[2],v3[0])); const m = Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/m,n[1]/m,n[2]/m];
    if (dot(n, sub(cc, wc)) < 0) n = [-n[0],-n[1],-n[2]];
    const [nF, nR, nU] = rotateNormal(n);
    faces.push({ ps, br: litBr(nF,nR,nU,0.20), avgD: ps.reduce((s,p)=>s+p.d,0)/4, col: [92, 98, 110] }); }
}

/* Real-3-D tube between two model points pa→pb (radii rA→rB), N sides, lit per face.
   `col` is [r,g,b]; `amb` the shadow floor; `cap` closes both ends with a fan (for
   bosses / oleo collars). The whole gear leg is built from these instead of 2-D lines,
   so it holds up close-in and in WebXR. */
function pushTube3D(faces, pa, pb, rA, rB, col, project, rotateNormal, litBr, N, amb, cap) {
  N = N || 8; amb = amb ?? 0.18;
  const sub = (p,q) => [p[0]-q[0],p[1]-q[1],p[2]-q[2]], dot = (p,q) => p[0]*q[0]+p[1]*q[1]+p[2]*q[2],
        crs = (p,q) => [p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
  const [a, u, v] = _tireFrame(sub(pb, pa));
  const mid = [(pa[0]+pb[0])/2, (pa[1]+pb[1])/2, (pa[2]+pb[2])/2];
  const ring = (c, r) => Array.from({ length: N }, (_, k) => {
    const t = k/N*Math.PI*2, cu = Math.cos(t)*r, sv = Math.sin(t)*r;
    return [c[0]+u[0]*cu+v[0]*sv, c[1]+u[1]*cu+v[1]*sv, c[2]+u[2]*cu+v[2]*sv]; });
  const RA = ring(pa, rA), RB = ring(pb, rB);
  const face = (v3, am) => {
    const ps = v3.map(project); if (ps.some(p => !p)) return;
    const c = v3.reduce((s,p)=>[s[0]+p[0],s[1]+p[1],s[2]+p[2]],[0,0,0]).map(x=>x/v3.length);
    let n = crs(sub(v3[1],v3[0]), sub(v3[2],v3[0])); const m = Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/m,n[1]/m,n[2]/m];
    if (dot(n, sub(c, mid)) < 0) n = [-n[0],-n[1],-n[2]];
    const [nF, nR, nU] = rotateNormal(n);
    faces.push({ ps, br: litBr(nF,nR,nU,am), avgD: ps.reduce((s,p)=>s+p.d,0)/ps.length, col });
  };
  for (let k = 0; k < N; k++) { const j = (k+1)%N; face([RA[k],RA[j],RB[j],RB[k]], amb); }
  if (cap) for (let k = 0; k < N; k++) { const j = (k+1)%N;
    face([pa, RA[j], RA[k]], amb*1.3); face([pb, RB[k], RB[j]], amb*1.3); }
}

/* Draw a cylindrical gear strut between two projected screen points. */
function drawStrutTube(ctx, pa, pb, dpr) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 1) return;
  const hw  = Math.max(1.5 * dpr, strutPx * 0.06);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);

  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(110,125,145,0.88)';  ctx.fill();
  ctx.strokeStyle = 'rgba(200,210,220,0.90)';  ctx.stroke();
}

function drawStrutTubeCol(ctx, pa, pb, dpr, fill, stroke) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 1) return;
  const hw  = Math.max(1.5 * dpr, strutPx * 0.06);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.stroke();
}

/* Thinner actuator / side-brace rod — same style, ~half the width of drawStrutTube */
function drawActuatorRod(ctx, pa, pb, dpr) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 0.5) return;
  const hw  = Math.max(0.7 * dpr, strutPx * 0.032);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(90,105,125,0.85)';  ctx.fill();
  ctx.strokeStyle = 'rgba(185,200,215,0.80)';  ctx.stroke();
}

function drawActuatorRodCol(ctx, pa, pb, dpr, fill, stroke) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 0.5) return;
  const hw  = Math.max(0.7 * dpr, strutPx * 0.032);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.stroke();
}

/* ── Nacelle inlet lip ring — polished metal leading edge at intake face ─────
   Drawn as a thick silver stroke at the outer rim of the fan face projection.
   Uses the same hub/rim as the fan disk so it's always co-centred with the fan. */
function _drawIntakeLip(ctx, hubPt, rimPt, dpr, foreshorten = 1, fsAngle = 0) {
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  ctx.save();
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));   // ellipse off-axis, sliver edge-on
  ctx.strokeStyle = 'rgba(218, 224, 232, 0.90)';
  ctx.lineWidth = Math.max(2.5, r * 0.11);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* Black strip just inside the intake lip — the dark annular band between
   the silver lip and the fan blade area visible on real turbofan engines. */
function _drawIntakeBlackStrip(ctx, hubPt, rimPt, dpr, foreshorten = 1, fsAngle = 0) {
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const stripW = Math.max(1.5, r * 0.13);
  const rInner = r - stripW * 0.5;
  ctx.save();
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.88)';
  ctx.lineWidth = stripW;
  ctx.beginPath();
  ctx.arc(0, 0, rInner, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ── Generic turbofan fan-face renderer (screen-space) ───────────────────────
   hubPt  projected center of fan disk  {x, y, d}
   rimPt  projected rim vertex (sets disk radius in pixels)
   power  enginePower 0→1 (0=static blades, <0.30=slow, ≥0.30=blur disk)
   nBlades  fan blade count (22 typical CFM56 / LEAP)                        */
let _fanAngle  = 0;
let _propAngle = Math.PI * 0.5;
/* Stage separation state — reassigned from _drawWireframe; kept here (not in outside-space.js)
   because ES module exports cannot be reassigned by importers. */
let _svSepLastAcId = null;
let _svSepPrevStage = 1;
let _rktSepLastAcId = null;
let _rktSepPrevStage = 1;

function _drawTurbofanFace(ctx, hubPt, rimPt, power, dpr, nBlades = 22, foreshorten = 1, fsAngle = 0) {
  if (!hubPt || !rimPt) return;
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const hubR = r * 0.28, tipR = r * 0.94;
  ctx.save();
  /* Draw the disk in an origin-centred frame, then squash it along the engine
     axis so the fan reads as a foreshortened ellipse from oblique views (and
     collapses to a sliver edge-on) rather than a billboard always facing us. */
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));

  if (power < 0.05) {
    /* Static — N tapered blade quads */
    ctx.fillStyle = 'rgba(96,110,126,0.92)';
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.085, aR = a + 0.085;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(aL), hubR * Math.sin(aL));
      ctx.lineTo(tipR * Math.cos(aL - 0.10), tipR * Math.sin(aL - 0.10));
      ctx.lineTo(tipR * Math.cos(aR - 0.14), tipR * Math.sin(aR - 0.14));
      ctx.lineTo(hubR * Math.cos(aR), hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
  } else if (power < 0.30) {
    /* Slow rotation — blades + translucent blur overlay */
    const t     = power / 0.30;
    const alpha = (0.72 - t * 0.48).toFixed(2);
    ctx.fillStyle = `rgba(90,104,120,${alpha})`;
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.10, aR = a + 0.10;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(aL), hubR * Math.sin(aL));
      ctx.lineTo(tipR * Math.cos(aL - 0.12), tipR * Math.sin(aL - 0.12));
      ctx.lineTo(tipR * Math.cos(aR - 0.16), tipR * Math.sin(aR - 0.16));
      ctx.lineTo(hubR * Math.cos(aR), hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
    /* Blur wash */
    const bGrad = ctx.createRadialGradient(0, 0, hubR, 0, 0, tipR);
    bGrad.addColorStop(0, `rgba(138,152,168,${(t * 0.32).toFixed(2)})`);
    bGrad.addColorStop(1, `rgba(78,90,106,${(t * 0.20).toFixed(2)})`);
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(0, 0, tipR, 0, Math.PI*2); ctx.fill();
  } else {
    /* Running — solid blur disk + faint streaks */
    const bGrad = ctx.createRadialGradient(0, 0, hubR, 0, 0, tipR);
    bGrad.addColorStop(0,   'rgba(152,165,180,0.58)');
    bGrad.addColorStop(0.5, 'rgba(112,124,140,0.44)');
    bGrad.addColorStop(1,   'rgba(72,84,100,0.32)');
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(0, 0, tipR, 0, Math.PI*2); ctx.fill();
    /* Radial streaks */
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = 'rgba(210,222,235,1)';
    ctx.lineWidth   = Math.max(0.5, dpr * 0.4);
    for (let i = 0; i < 9; i++) {
      const a = _fanAngle + i / 9 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(a), hubR * Math.sin(a));
      ctx.lineTo(tipR * Math.cos(a), tipR * Math.sin(a));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* Spinner cone — radial highlight reads as a 3-D nose cone, plus the spinning
     warning swirl you see on turbofan spinners (rotates with the fan). */
  const _spG = ctx.createRadialGradient(-hubR*0.32, -hubR*0.32, hubR*0.08, 0, 0, hubR);
  _spG.addColorStop(0, 'rgba(120,128,140,0.98)');
  _spG.addColorStop(1, 'rgba(36,42,54,0.98)');
  ctx.fillStyle = _spG;
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(232,236,242,0.80)';
  ctx.lineWidth   = Math.max(0.5, dpr * 0.45);
  ctx.beginPath();
  for (let t = 0; t <= 1.001; t += 0.06) {
    const a = _fanAngle + t * Math.PI * 2.2, rr = hubR * 0.88 * t;
    const x = rr * Math.cos(a), y = rr * Math.sin(a);
    t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  /* Outer cowl ring */
  ctx.strokeStyle = 'rgba(158,172,188,0.78)';
  ctx.lineWidth   = Math.max(0.8, dpr * 0.7);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();

  ctx.restore();
}

/* Fit an ellipse to a circular ring's projected vertices (perspective image of
   a circle ≈ ellipse). Returns centroid, major/minor screen radii and the
   major-axis angle — used to draw the recessed fan foreshortened. */
function _fanEllipse(ringPts) {
  let cx = 0, cy = 0;
  for (const p of ringPts) { cx += p.x; cy += p.y; }
  cx /= ringPts.length; cy /= ringPts.length;
  let majorR = 0, angle = 0, minorR = Infinity;
  for (const p of ringPts) {
    const dx = p.x - cx, dy = p.y - cy, rr = Math.hypot(dx, dy);
    if (rr > majorR) { majorR = rr; angle = Math.atan2(dy, dx); }
    if (rr < minorR) minorR = rr;
  }
  return { cx, cy, majorR, minorR, angle };
}


/* ── Core wireframe + shading renderer ───────────────────────── */
function _drawWireframe(canvas, acPitchDeg, acRollDeg, camBack, camUp, camSide, wingView = false, orbitAzDeg = 0, orbitElDeg = 0, panX = 0) {
  /* Advance fan rotation angle — capped so it doesn't spin during static frames */
  _fanAngle  = (_fanAngle  + ((S.engineState === 'off' || S.engineState === 'shutdown')
                 ? 0 : Math.min(0.06, (S.enginePower ?? 0) * 0.35))) % (Math.PI * 2);
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
    const pivotCR = isFinite(minCR) ? (minCR + maxCR) / 2 : 0;
    const pivotCU = isFinite(minCU) ? (minCU + maxCU) / 2 : 0;
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
      camSide = d * _orbitZoom;
      /* Keep elevation angle constant through auto-fit: if camUp >> camSide (e.g.
         rocket at high altitude), the camera pitch goes nearly vertical and the
         body cross-section compresses to sub-pixel height.  Scale camUp with the
         same factor so the wireframe elevation stays at the intended angle. */
      camUp = camUp * (camSide / _origCamSide);
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
       Side cam (camSide>0): camera is right of ship → rotate in rR-uR plane.
       Chase cam (camSide=0): camera is behind ship → rotate in fP-uR plane. */
    if (orbitElDeg !== 0 && camSide > 0) {
      const rR2 = rR * cosEl + uR * sinEl;
      uR = -rR * sinEl + uR * cosEl;
      rR = rR2;
    } else if (orbitElDeg !== 0) {
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
  if (alt_nm < 0.082) {
    const silVI  = (isC172 || isPP)
      ? [80, 84, 85, 81, 89, 88]                   // C172/PP: nose(80), R tip, tail(81), L tip
      : isF9
      ? [96, 100, 0, 8, 108]                       // F9: nose, fin dorsal, aft top/bot, fin ventral
      : isBf109
      ? [96, 100, 101, 97, 105, 104]               // Bf109: spinner(96), R tip LE/TE, tail(97), L tip
      : isF4U
      ? [96, 104, 105, 97, 112, 113]               // F4U: noseTip(96), R tip LE/TE, tailTip(97), L tip LE/TE
      : isMig15
      ? [96, 108, 109, 97, 130, 131]               // MiG-15: noseTip(96), R tip upper LE/TE(108/109), tailTip(97), L tip upper LE/TE(130/131)
      : isSV
      ? [160, 0, 4, 8, 12]                         // Saturn V: tip, aft base cardinal points
      : isSS
      ? [_ssGeo?.tipVIdx ?? 0, 0, 4, 8, 12]        // Starship: noseTip, aft base cardinal points
      : [_b-2, _b+118, _b+147, _b-1, _b+122, _b+151];  // WB: noseTip, R tip upper LE/ail-hinge, tailTip, L tip upper LE/ail-hinge

    /* Rotate each silhouette vertex into world-aligned frame (same as project()) */
    const rotated = silVI.map(vi => {
      const [vF, vR, vU] = verts[vi];
      let fR, rR, uR;
      if (isBodyRoll) {
        const vR2 =  vR * cosR - vU * sinR;
        const vU2 =  vR * sinR + vU * cosR;
        fR = vF * cosP - vU2 * sinP; rR = vR2; uR = vF * sinP + vU2 * cosP;
      } else {
        const fP =  vF * cosP - vU * sinP;
        const uP =  vF * sinP + vU * cosP;
        fR = fP; rR = vR * cosR + uP * sinR; uR = -vR * sinR + uP * cosR;
      }
      return { fR, rR, uR };
    });

    /* Ground level: rockets use the lowest vertex (vertical body); a parked aircraft
       sits at its wheel-contact level (ride height), not its MSL altitude — using
       alt_nm here drops the shadow to sea level and the aircraft looks like it floats.
       Airborne, fall back to MSL (terrain ≈ sea level for the shadow fade). */
    const groundUR = (isSV || isF9)
      ? Math.min(...rotated.map(v => v.uR))
      : S.wow
      ? -_groundOffsetFt() * FT_NM
      : -alt_nm;

    /* Project each vertex along light direction to ground plane, then to screen */
    const shadowPts = rotated.map(({ fR, rR, uR }) => {
      const t   = _LD[2] > 0 ? (uR - groundUR) / _LD[2] : 0;
      const sfR = fR - t * _LD[0];
      const srR = rR - t * _LD[1];
      const suR = groundUR;
      const cfW = camSide > 0 ? camSide - srR : camBack + sfR;
      const crW = camSide > 0 ? sfR           : srR;
      const cuW = suR - camUp;
      const cf  = cfW * cosCP + cuW * sinCP;
      const cu  = cuW * cosCP - cfW * sinCP;
      if (cf < 0.002) return null;
      return { x: cx + crW / cf * focal, y: cy - cu / cf * focal };
    }).filter(Boolean);

    if (shadowPts.length >= 3) {
      const t       = alt_nm / 0.082;
      const opacity = (1 - t) * 0.38;
      const blur    = Math.round(2 + t * 8);
      ctx.save();
      ctx.filter    = `blur(${blur}px)`;
      ctx.fillStyle = `rgba(0,0,0,${opacity.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(shadowPts[0].x, shadowPts[0].y);
      for (let k = 1; k < shadowPts.length; k++) ctx.lineTo(shadowPts[k].x, shadowPts[k].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* Rotate body-frame normal by aircraft pitch + roll → world frame */
  function rotateNormal([nF, nR, nU]) {
    const fP =  nF * cosP - nU * sinP;
    const uP =  nF * sinP + nU * cosP;
    const rW =  nR * cosR + uP * sinR;
    const uW = -nR * sinR + uP * cosR;
    return [fP, rW, uW];
  }

  /* Two-light brightness: key + fill + ambient. Result in [0,1]. */
  function litBr(nF, nR, nU, amb) {
    const d1 = Math.max(0, nF*_LD[0]  + nR*_LD[1]  + nU*_LD[2]);
    const d2 = Math.max(0, nF*_LD2[0] + nR*_LD2[1] + nU*_LD2[2]);
    return Math.min(1, amb + (1 - amb) * (d1 + _LD2S * d2));
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
  const _DBG_PANELS = false;  // ← set true to label cockpitPanel corners with coords

  const _trActive = !isF9 && !isSS && !isSV && !isC172 && !isPP && !isBf109 && !isF4U && !isMig15 && !!(S.thrustReverser);

  /* Build shaded face list with average depth */
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
    const br   = litBr(nF, nR, nU, amb);
    const spec = Math.pow(Math.max(0, nF*_Hac[0] + nR*_Hac[1] + nU*_Hac[2]), 28);
    const avgD = ps.reduce((s, p) => s + p.d, 0) / ps.length;

    /* Smooth shading: gradient across quad using per-vertex radial normals */
    let grad = null;
    if (fi.length === 4) {
      const rnL = rotateNormal(VN_[fi[0]]);
      const rnR = rotateNormal(VN_[fi[1]]);
      const brL = litBr(rnL[0], rnL[1], rnL[2], amb);
      const brR = litBr(rnR[0], rnR[1], rnR[2], amb);
      if (Math.abs(brL - brR) > 0.015) {
        const pL = { x: (ps[0].x + ps[3].x) * 0.5, y: (ps[0].y + ps[3].y) * 0.5 };
        const pR = { x: (ps[1].x + ps[2].x) * 0.5, y: (ps[1].y + ps[2].y) * 0.5 };
        grad = { pL, pR, brL, brR };
      }
    }

    return { ps, br, spec, avgD, col: COL_[FC_[i]], grad, fc: FC_[i] };
  }).filter(Boolean);

  /* Starship stage sep: fill open bottom ring of Ship with a disc cap */
  if (isSS && rStage >= 2 && _ssGeo) {
    const _ssRg = S.aircraft?.rocketGeometry;
    const _sepRi = (_ssRg?.stageSep ?? [])[0] ?? 5;
    const _ssRb  = _ssGeo.rb;
    const _ssV   = _ssGeo.V_;
    const _ssN   = _ssRg?.nSides ?? 16;
    if (_ssRb && _ssV && _sepRi < _ssRb.length) {
      const _capPts = [];
      for (let si = 0; si < _ssN; si++) _capPts.push(project(_ssV[_ssRb[_sepRi] + si]));
      if (!_capPts.some(p => !p)) {
        const _capD = _capPts.reduce((s,p)=>s+p.d,0)/_ssN;
        faces.push({ ps: _capPts, br: 0.10, avgD: _capD, col: _ssGeo.COLORS_[1] ?? [200,205,210] });
      }
    }
  }

  /* Booster faces — Stage 1 body + grid fins */
  if (bPts) {
    const s1Idx = [...Array.from({length:48},(_,k)=>k), ...Array.from({length:8},(_,k)=>96+k)];
    for (const i of s1Idx) {
      const fi = _F_f9[i];
      const ps = fi.map(vi => bPts[vi]);
      if (ps.some(p => !p)) continue;
      const p0=ps[0],p1=ps[1],p2=ps[2];
      const cross=(p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x);
      if (cross < 0) continue;
      const [nF,nR,nU] = _FN_f9[i];
      const rnF = nF*cosdP - nU*sindP;
      const rnU = nF*sindP + nU*cosdP;
      const [wF,wR,wU] = rotateNormal([rnF, nR, rnU]);
      const amb = (_FC_f9[i] === 4) ? 0.55 : 0.18;
      const br  = litBr(wF, wR, wU, amb);
      const avgD = ps.reduce((s,p)=>s+p.d,0)/ps.length;
      faces.push({ ps, br, avgD, col: _COLORS_f9[_FC_f9[i]] });
    }
  }

  /* Starship Super Heavy booster faces — SH body + grid fins + end caps */
  if (ssBPts && _ssGeo) {
    const sr0  = _ssGeo.stageRanges?.[0];
    const fEnd = sr0?.faceEnd          ?? 0;
    const gfS  = sr0?.gridFinFaceStart ?? fEnd;
    const gfE  = sr0?.gridFinFaceEnd   ?? fEnd;
    const _ssRg   = S.aircraft?.rocketGeometry;
    const _nSidesB = _ssRg?.nSides ?? 16;
    const _sepRiB  = (_ssRg?.stageSep ?? [])[0] ?? 5;
    /* Top cap — sep plane ring, covers the open top where Ship pulled away */
    if (_ssGeo.rb && _sepRiB < _ssGeo.rb.length) {
      const _topPts = [];
      for (let si = 0; si < _nSidesB; si++) _topPts.push(ssBPts[_ssGeo.rb[_sepRiB] + si]);
      if (!_topPts.some(p => !p)) {
        const _topD = _topPts.reduce((s,p)=>s+p.d,0)/_nSidesB;
        faces.push({ ps: _topPts, br: 0.10, avgD: _topD, col: _ssGeo.COLORS_[1] ?? [200,205,210] });
      }
    }
    for (let i = 0; i < _ssGeo.F_.length; i++) {
      if (i >= fEnd && !(i >= gfS && i < gfE)) continue;
      const fi = _ssGeo.F_[i];
      const ps = fi.map(vi => ssBPts[vi]);
      if (ps.some(p => !p)) continue;
      const p0=ps[0], p1=ps[1], p2=ps[2];
      if ((p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
      const [nF, nR, nU] = _ssGeo.FN_[i];
      const rnF = nF * ssCosdP - nU * ssSindP;
      const rnU = nF * ssSindP + nU * ssCosdP;
      const [wF, wR, wU] = rotateNormal([rnF, nR, rnU]);
      const br   = litBr(wF, wR, wU, 0.18);
      const avgD = ps.reduce((s,p) => s+p.d, 0) / ps.length;
      const col  = _ssGeo.COLORS_[_ssGeo.FC_[i]];
      if (col) faces.push({ ps, br, avgD, col });
    }
    /* Aft disc cap (engine side, ring 0) — plugs the open base when booster flips */
    const _ssN0 = _ssGeo.rb?.[0];
    if (_ssN0 != null) {
      const _aftPts = [];
      for (let si = 0; si < _nSidesB; si++) _aftPts.push(ssBPts[_ssN0 + si]);
      if (!_aftPts.some(p => !p)) {
        const _aftD = _aftPts.reduce((s,p)=>s+p.d,0)/_nSidesB;
        faces.push({ ps: _aftPts, br: 0.12, avgD: _aftD, col: _ssGeo.COLORS_[0] ?? [130,135,145] });
      }
    }
  }

  /* Cryogenic effects — LOX vent + tank vapor (ground gas closeout phase).
     Venting represents strongback/GSE line disconnects before ignition.   */
  if (isF9 && (S.spd ?? 0) < 5) {
    const now = Date.now() * 0.001;
    const dpr = devicePixelRatio;
    ctx.save();

    /* Animated vapor cloud emitter — puffs expand, drift upward, fade out */
    function _vCloud(px, py, n, period, maxR, drift, rgb, aMax) {
      for (let i = 0; i < n; i++) {
        const t    = ((now / period + i / n) % 1);
        const ease = 1 - Math.pow(1 - t, 2.2);
        const a    = Math.pow(1 - t, 1.5) * aMax;
        if (a < 0.008) continue;
        const r  = (4 + ease * maxR) * dpr;
        const dx = Math.sin(i * 2.3 + now * 0.35) * ease * drift * dpr;
        const dy = -ease * drift * 1.6 * dpr;
        ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(px + dx, py + dy, r * 1.25, r * 0.68,
                    Math.atan2(dy, dx || 0.001), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* S1 LOX vent — dense cloud from Ring 2 (top of S1 tank, interstage level) */
    if (pts[36]) _vCloud(pts[36].x, pts[36].y, 10, 1.7, 32, 26, '212,228,255', 0.65);
    if (pts[44]) _vCloud(pts[44].x, pts[44].y,  8, 2.0, 24, 20, '212,228,255', 0.50);

    /* S1 tank body wisps — cryo boil-off from Ring 1 and Ring 0 */
    for (const vi of [16, 17, 18, 22, 23, 0, 2, 6]) {
      if (!pts[vi]) continue;
      _vCloud(pts[vi].x, pts[vi].y, 4, 2.6 + vi * 0.13, 11, 11, '222,235,255', 0.24);
    }

    /* S2 LOX vent — from Ring 4 (top of S2 body, Dragon base level) */
    if (pts[68]) _vCloud(pts[68].x, pts[68].y, 7, 2.2, 20, 18, '208,226,255', 0.50);
    if (pts[76]) _vCloud(pts[76].x, pts[76].y, 5, 2.5, 15, 14, '208,226,255', 0.38);

    /* S2 body wisps */
    for (const vi of [48, 52, 60]) {
      if (!pts[vi]) continue;
      _vCloud(pts[vi].x, pts[vi].y, 3, 3.1 + vi * 0.05, 8, 9, '218,232,255', 0.20);
    }

    ctx.restore();
  }

  /* Moon — visible from orbit onward; drawn before rocket body so spacecraft occludes it */
  if (S.rocketOrbit && S.orbitVec) {
    const { rx, ry, rz, vx, vy, vz } = S.orbitVec;
    const { mx, my } = moonECI(S.time ?? 0);

    const dx = mx - rx, dy = my - ry, dz = 0;  // Moon in XY plane; rz is inclination artifact
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 1) {
      /* Orbital frame basis — fixed in ECI (no body pitch/roll, Moon is sky background) */
      const spd = Math.sqrt(vx*vx + vy*vy + vz*vz);
      const rr  = Math.sqrt(rx*rx + ry*ry + rz*rz);
      const pF = spd > 0 ? vx/spd : 1, pR = spd > 0 ? vy/spd : 0, pU = spd > 0 ? vz/spd : 0; // prograde = body +F
      const rF = rr  > 0 ? rx/rr  : 0, rR = rr  > 0 ? ry/rr  : 0, rU = rr  > 0 ? rz/rr  : 1; // radial-out = body +U
      /* right = prograde × radial-out (body +R) */
      const bF = pR*rU - pU*rR, bR = pU*rF - pF*rU, bU = pF*rR - pR*rF;

      const ndx = dx/dist, ndy = dy/dist, ndz = dz/dist;
      let mF = ndx*pF + ndy*pR + ndz*pU;  // forward component
      let mR = ndx*bF + ndy*bR + ndz*bU;  // right component
      let mU = ndx*rF + ndy*rR + ndz*rU;  // up component

      /* Apply orbit elevation rotation (same as project()) */
      if (orbitElDeg !== 0 && camSide > 0) {
        const mR2 = mR * cosEl + mU * sinEl;
        mU = -mR * sinEl + mU * cosEl;
        mR = mR2;
      }

      /* Camera-space depth and horizontal for a direction vector at infinity */
      const cfW = camSide > 0 ? -mR : mF;
      const crW = camSide > 0 ?  mF : mR;
      const cuW = mU;
      const cf  = cfW * cosCP + cuW * sinCP;
      const cu  = cuW * cosCP - cfW * sinCP;

      if (cf > 0) {
        const mpx = cx + crW / cf * focal;
        const mpy = cy - cu  / cf * focal;

        /* Angular radius: Moon r = 1737 km */
        const moonPx = Math.max(3 * dpr, (1_737_000 / dist) * focal);

        const g = ctx.createRadialGradient(mpx - moonPx*0.3, mpy - moonPx*0.3, 0, mpx, mpy, moonPx);
        g.addColorStop(0,   'rgba(228, 226, 218, 0.98)');
        g.addColorStop(0.5, 'rgba(172, 170, 162, 0.95)');
        g.addColorStop(1,   'rgba(72,  70,  65,  0.85)');
        ctx.beginPath();
        ctx.arc(mpx, mpy, moonPx, 0, 2 * Math.PI);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  /* Engine plumes — drawn before faces so body renders on top.
     S1: active until MECO.  S2: active after coast, until SECO. */
  const t0 = S.aircraft?.ignitionTime ?? 0;
  const pastIgnition = (S.time ?? 0) >= t0;

  /* Plume colours — shared by exit discs so they stay in sync with the plume.
     ROOT = gradient stop 0 (outer root), HOT = stop 0.08 (inner glow / disc face) */
  const _PLUME_ROOT = { rp1: [255, 240, 160], lh2: [215, 240, 255], ch4: [255, 252, 235] };
  const _PLUME_HOT  = { rp1: [255, 165,  60], lh2: [170, 215, 255], ch4: [255, 230, 170] };
  const _PLUME_OFF  = { rp1: [ 22,  18,  15], lh2: [ 15,  18,  24], ch4: [ 20,  18,  14] };

  /* style: 'rp1' = RP-1/LOX yellow-white (F-1, Merlin)
            'lh2' = LH2/LOX blue-white (J-2)            */
  function _drawPlume(pN, bodyR, originVec, baseLen, widthScale, style = 'rp1') {
    const altM  = (S.alt ?? 0) * 0.3048;
    const altT  = Math.min(1, altM / 65000);          /* 0 = pad, 1 = 65 km */
    const len   = baseLen * (1 + altT * 2.8);         /* plume lengthens in vacuum */
    const flick = 1 + 0.04 * Math.sin(Date.now() * 0.047)
                    + 0.025 * Math.sin(Date.now() * 0.083);

    const plumeEnd = project(originVec.map((v, i) => i === 0 ? v - len : v));
    if (!pN || !plumeEnd) return;
    const dx = plumeEnd.x - pN.x, dy = plumeEnd.y - pN.y;
    const pxLen = Math.hypot(dx, dy);
    if (pxLen < 2) return;
    const px = -dy / pxLen, py = dx / pxLen;
    /* Billboard: project nozzle radius in both transverse body axes, take max.
       Prevents plume collapsing to a sliver in side/front/any-angle views. */
    const pEy = project([originVec[0], originVec[1] + bodyR, originVec[2]]);
    const pEz = project([originVec[0], originVec[1], originVec[2] + bodyR]);
    const ry = pEy ? Math.hypot(pEy.x - pN.x, pEy.y - pN.y) : 0;
    const rz = pEz ? Math.hypot(pEz.x - pN.x, pEz.y - pN.y) : 0;
    const nozR = Math.max(ry, rz, 4 * devicePixelRatio) * widthScale * flick;

    /* Tip flares wider at altitude (vacuum expansion) */
    const tipS = 2.8 + altT * 5.0;
    const midS = 1.6 + altT * 2.2;
    const mx   = (pN.x + plumeEnd.x) / 2, my = (pN.y + plumeEnd.y) / 2;

    ctx.save();
    const grad = ctx.createLinearGradient(pN.x, pN.y, plumeEnd.x, plumeEnd.y);
    if (style === 'lh2') {
      grad.addColorStop(0,    `rgba(215,240,255,${(0.90 * flick).toFixed(2)})`);
      grad.addColorStop(0.10, 'rgba(170,215,255,0.68)');
      grad.addColorStop(0.30, 'rgba( 90,155,245,0.36)');
      grad.addColorStop(0.60, 'rgba( 50, 90,210,0.12)');
      grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    } else if (style === 'ch4') {
      /* Methane/LOX (Raptor) — near-white, no orange/soot; cool grey fade */
      grad.addColorStop(0,    `rgba(255,255,248,${(0.92 * flick).toFixed(2)})`);
      grad.addColorStop(0.08, 'rgba(255,250,225,0.65)');
      grad.addColorStop(0.25, 'rgba(220,228,225,0.28)');
      grad.addColorStop(0.55, 'rgba(160,178,185,0.09)');
      grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    } else {
      grad.addColorStop(0,    `rgba(255,240,160,${(0.88 * flick).toFixed(2)})`);
      grad.addColorStop(0.08, 'rgba(255,165, 60,0.72)');
      grad.addColorStop(0.25, 'rgba(210, 80, 18,0.42)');
      grad.addColorStop(0.55, 'rgba(130, 28,  5,0.18)');
      grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pN.x + px * nozR,       pN.y + py * nozR);
    ctx.quadraticCurveTo(mx + px * nozR * midS, my + py * nozR * midS,
                         plumeEnd.x + px * nozR * tipS, plumeEnd.y + py * nozR * tipS);
    ctx.lineTo(plumeEnd.x - px * nozR * tipS,   plumeEnd.y - py * nozR * tipS);
    ctx.quadraticCurveTo(mx - px * nozR * midS, my - py * nozR * midS,
                         pN.x - px * nozR,       pN.y - py * nozR);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /* Engine fraction — scales plume width by √(active/total) so a partial
     engine cluster (CECO, engine-out) produces a visibly smaller plume. */
  const _plumeStgIdx  = (S.rocketStage ?? 1) - 1;
  const _plumeStg     = (S.aircraft?.performance?.stages ?? [])[_plumeStgIdx] ?? {};
  const _plumeTotalEng = _plumeStg.engineCount ?? 1;
  const _plumeActEng   = S.rocketActiveEngines ?? _plumeTotalEng;
  const _engFrac       = Math.sqrt(_plumeTotalEng > 0 ? _plumeActEng / _plumeTotalEng : 1);

  if (isF9) {
    /* S1 plume: ignition → MECO */
    if (pastIgnition && rStage < 2 && !S.rocketCoast && !S.rocketMECO)
      _drawPlume(pts[113], _nzO, [-0.018, 0, 0], 0.030, 2.8 * _engFrac);

    /* S2 plume: coast ends → SECO */
    if (rStage >= 2 && !S.rocketCoast && !S.rocketSECO)
      _drawPlume(pts[138], _nzVac, [0.003, 0, 0], 0.032, 3.2 * _engFrac);
  }

  if (isSS && _ssGeo && pastIgnition && !S.rocketCoast && !S.rocketSECO) {
    const ssClusters = _ssGeo.engineClusters ?? [];
    const activeClusters = ssClusters.filter(c => c.stage === rStage);
    for (const cluster of activeClusters) {
      /* Plume origin at engine plane, scaled by cluster's outermost ring radius */
      const outerR = cluster.rings[cluster.rings.length - 1]?.radius ?? 0.002;
      const pNoz = project([cluster.vF, 0, 0]);
      if (pNoz) _drawPlume(pNoz, outerR, [cluster.vF, 0, 0], 0.014, 1.8 * _engFrac, 'ch4');
    }
  }

  if (isSV && pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO) {
    const svStage = S.rocketStage ?? 1;
    /* S-IC — 5× F-1, RP-1/LOX orange plume, emits from nozzle exit plane */
    if (svStage === 1) {
      const _nzExit = -0.030 - _sv1r * 0.58;
      const pNoz = project([_nzExit, 0, 0]);
      _drawPlume(pNoz, _sv1r, [_nzExit, 0, 0], 0.030, 1.4 * _engFrac);
    }
    /* S-II — 5× J-2, LH2/LOX blue-white, emits from nozzle exit plane */
    else if (svStage === 2) {
      const _s2Exit = -0.006 - _sv1r * 0.36;
      const pNoz = project([_s2Exit, 0, 0]);
      _drawPlume(pNoz, _sv1r, [_s2Exit, 0, 0], 0.022, 0.45 * _engFrac, 'lh2');
    }
    /* S-IVB — 1× J-2, LH2/LOX, emits from nozzle exit plane */
    else if (svStage >= 3) {
      const _sivbExit = 0.010 - _sv3r * 0.36;
      const pNoz = project([_sivbExit, 0, 0]);
      _drawPlume(pNoz, _sv3r, [_sivbExit, 0, 0], 0.018, 0.28 * _engFrac, 'lh2');
    }
  }

  /* S-IVB plume during TLI re-ignition (orbit mode) */
  if (isSV && S.rocketOrbit && S.rocketTLI && (S.time ?? 0) <= (S.rocketTLIBurnEnd ?? 0)) {
    const _sivbExit = 0.010 - _sv3r * 0.36;
    const pNoz = project([_sivbExit, 0, 0]);
    _drawPlume(pNoz, _sv3r, [_sivbExit, 0, 0], 0.018, 0.28, 'lh2');
  }

  /* ── F1 engine nozzles — Saturn V S-IC, 5× truncated bell frustums ─
     Hidden while inside MLP slab (riseNm < nozzle length ≈ 0.0016 NM).  */
  if (isSV && rStage === 1 && _svRise > _sv1r * 0.58) {
    const nNoz  = 8;              // octagon cross-section
    const nzVF  = -0.030;         // S-IC aft base
    const nzLen = _sv1r * 0.58;   // nozzle length aft of base  (F1 ≈ 2.9 m)
    const nzRt  = _sv1r * 0.20;   // radius at attachment
    const nzRx  = _sv1r * 0.38;   // radius at exit  (F1 exit dia ≈ 3.76 m)
    const nzE   = _sv1r * 0.68;   // outer engine radial offset  (≈ 3.4 m)
    const f1On  = pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO;

    for (const [cR, cU] of [[0,0],[nzE,0],[-nzE,0],[0,nzE],[0,-nzE]]) {
      const topR = [], botR = [];
      for (let i = 0; i < nNoz; i++) {
        const a = (i / nNoz) * Math.PI * 2;
        topR.push(project([nzVF,         cR + nzRt * Math.cos(a), cU + nzRt * Math.sin(a)]));
        botR.push(project([nzVF - nzLen, cR + nzRx * Math.cos(a), cU + nzRx * Math.sin(a)]));
      }

      /* Lateral bell faces — side cam only (chase cam depth-sorting fails for
         faces inside the body cylinder; exit discs cover the chase-cam view) */
      if (camSide > 0) for (let i = 0; i < nNoz; i++) {
        const j  = (i + 1) % nNoz;
        const ps = [topR[i], botR[i], botR[j], topR[j]];
        if (ps.some(p => !p)) continue;
        const p0 = ps[0], p1 = ps[1], p2 = ps[2];
        if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
        const aMid = ((i + 0.5) / nNoz) * Math.PI * 2;
        const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
        const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.14) + 0.4 * spec), avgD, col: [44, 38, 32] });
      }

      /* Exit disc — inner glow color matches plume stop 0.08 */
      if (!botR.some(p => !p)) {
        const p0 = botR[0], p1 = botR[1], p2 = botR[2];
        if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
          const avgD = botR.reduce((s,p)=>s+p.d,0)/nNoz;
          faces.push({ ps: botR, br: f1On ? 1.0 : 0.07, avgD,
                       col: f1On ? _PLUME_HOT.rp1 : _PLUME_OFF.rp1 });
        }
      }

      /* Top attachment cap — dark backing plate inside bell */
      if (!topR.some(p => !p)) {
        const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: topR, br: 0.06, avgD, col: _PLUME_OFF.rp1 });
      }
    }
  }

  /* ── S-IC aft end cap — flat floor
     2D cross-product is unreliable for this face (sign flips with view angle,
     same problem as cylinder quads). 3D normal [-1,0,0] is always toward rear/side
     camera at any normal viewing angle → never back-facing → always render.     */
  if (isSV) {
    /* Aft base cap for each exposed stage bottom:
       stage 1 → ring 0, base  0 (vF=-0.030, S-IC)
       stage 2 → ring 3, base 48 (vF=-0.006, S-II)
       stage 3+ → ring 5, base 80 (vF=+0.010, S-IVB)  */
    const sivbSepDone = S.sivbSep ?? false;
    const capBase = rStage === 1 ? 0 : rStage === 2 ? 48 : sivbSepDone ? 112 : 80;
    const capPts = [];
    for (let si = 0; si < 16; si++) { if (pts[capBase + si]) capPts.push(pts[capBase + si]); }
    if (capPts.length >= 3) {
      const avgD = capPts.reduce((s, p) => s + p.d, 0) / capPts.length;
      if (_DBG_CULL) {
        faces.push({ ps: capPts, br: 1, avgD, col: [0, 80, 200] });
      } else {
        faces.push({ ps: capPts, br: 1.0, avgD, col: [42, 36, 30] });
      }
    }
  }

  /* ── J-2 nozzle helper — shared by S-II (5×) and S-IVB (1×) ─────
     baseVF      vF of the aft base ring where nozzles attach
     bodyR       body radius at that ring (scales nozzle proportions)
     engCenters  array of [cR, cU] radial offsets for each engine centre
     j2On        true while engines are burning (gates glow colours)
     Renders: lateral bell faces (side cam only), exit disc + top cap.
     Colours coupled to _PLUME_HOT/OFF.lh2 — LH2/LOX blue-white.      */
  const _drawJ2Nozzles = (baseVF, bodyR, engCenters, j2On, style = 'lh2') => {
    const nNoz  = 8;
    const nzLen = bodyR * 0.36;   // J-2 nozzle length  (≈ 1.78 m)
    const nzRt  = bodyR * 0.12;   // radius at attachment
    const nzRx  = bodyR * 0.28;   // radius at exit  (J-2 exit dia ≈ 2.74 m)
    for (const [cR, cU] of engCenters) {
      const topR = [], botR = [];
      for (let i = 0; i < nNoz; i++) {
        const a = (i / nNoz) * Math.PI * 2;
        topR.push(project([baseVF,         cR + nzRt * Math.cos(a), cU + nzRt * Math.sin(a)]));
        botR.push(project([baseVF - nzLen, cR + nzRx * Math.cos(a), cU + nzRx * Math.sin(a)]));
      }
      if (camSide > 0) for (let i = 0; i < nNoz; i++) {
        const j  = (i + 1) % nNoz;
        const ps = [topR[i], botR[i], botR[j], topR[j]];
        if (ps.some(p => !p)) continue;
        const p0 = ps[0], p1 = ps[1], p2 = ps[2];
        if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
        const aMid = ((i + 0.5) / nNoz) * Math.PI * 2;
        const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
        const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.18) + 0.4 * spec), avgD, col: [52, 50, 48] });
      }
      if (!botR.some(p => !p)) {
        const p0 = botR[0], p1 = botR[1], p2 = botR[2];
        if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
          const avgD = botR.reduce((s,p)=>s+p.d,0)/nNoz;
          faces.push({ ps: botR, br: j2On ? 1.0 : 0.07, avgD,
                       col: j2On ? _PLUME_HOT[style] : _PLUME_OFF[style] });
        }
      }
      if (!topR.some(p => !p)) {
        const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: topR, br: 0.06, avgD, col: _PLUME_OFF[style] });
      }
    }
  };

  const j2On = pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO;

  /* S-II — 5× J-2, visible from stage 2 onward */
  if (isSV && rStage === 2) {
    const nzE = _sv1r * 0.55;   // outer engine radial offset  (≈ 2.75 m)
    _drawJ2Nozzles(-0.006, _sv1r, [[0,0],[nzE,0],[-nzE,0],[0,nzE],[0,-nzE]], j2On);
  }

  /* S-IVB — 1× J-2, centered, visible from stage 3 onward (not after sivbSep) */
  if (isSV && rStage >= 3 && !(S.sivbSep ?? false)) {
    _drawJ2Nozzles(0.010, _sv3r, [[0, 0]], j2On);
  }

  /* SM SPS engine bell — visible after sivbSep and during T&D (rotated CSM) */
  if (isSV && ((S.sivbSep ?? false) || _inTDSep)) {
    const nNoz  = 8;
    const sMvF  = 0.024;          // SM aft ring vF (Ring 7)
    const spsL  = _svcr * 1.60;  // nozzle length
    const spsRt = _svcr * 0.08;  // throat radius
    const spsRx = _svcr * 0.53;  // exit radius (≈ 54 % of SM radius)
    const spsTopR = [], spsBotR = [];
    for (let i = 0; i < nNoz; i++) {
      const a = (i / nNoz) * Math.PI * 2;
      spsTopR.push(_projectCSM(sMvF,         spsRt * Math.cos(a), spsRt * Math.sin(a)));
      spsBotR.push(_projectCSM(sMvF - spsL,  spsRx * Math.cos(a), spsRx * Math.sin(a)));
    }
    if (camSide > 0) for (let i = 0; i < nNoz; i++) {
      const j  = (i + 1) % nNoz;
      const ps = [spsTopR[i], spsBotR[i], spsBotR[j], spsTopR[j]];
      if (ps.some(p => !p)) continue;
      const p0 = ps[0], p1 = ps[1], p2 = ps[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
      const aMid = ((i + 0.5) / nNoz) * Math.PI * 2;
      const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
      const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
      const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
      faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.18) + 0.4 * spec), avgD, col: [52, 50, 48] });
    }
    if (!spsBotR.some(p => !p)) {
      const p0 = spsBotR[0], p1 = spsBotR[1], p2 = spsBotR[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
        const avgD = spsBotR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: spsBotR, br: 0.07, avgD, col: _PLUME_OFF.lh2 });
      }
    }
    if (!spsTopR.some(p => !p)) {
      const avgD = spsTopR.reduce((s,p)=>s+p.d,0)/nNoz;
      faces.push({ ps: spsTopR, br: 0.06, avgD, col: [52, 50, 48] });
    }
  }

  /* ── Raptor nozzle bells — Starship / Super Heavy ─────────────────
     Iterates over engineClusters from aircraft.rocketGeometry.
     Each cluster has rings of engines; each ring defines count, radius,
     nozzleR (exit radius), nozzleLen.  Renders 6-sided frustum per bell. */
  if (isSS && _ssGeo) {
    const nNoz = 6;  // hexagon cross-section — lighter than 8
    const raptorOn = pastIgnition && !S.rocketCoast && (!S.rocketSECO || !!S.starshipFlipStartT);
    for (const cluster of (_ssGeo.engineClusters ?? [])) {
      if (rStage >= 2 && cluster.stage < 2) continue;  // SH cluster hidden after sep
      for (const ring of cluster.rings) {
        const { count, radius, nozzleR, nozzleLen } = ring;
        const nzRt  = nozzleR * 0.45;  // throat (attachment end)
        const isVac = ring.type === 'Vac';
        for (let ei = 0; ei < count; ei++) {
          const ea = (ei / count) * Math.PI * 2;
          const cR = radius * Math.sin(ea), cU = radius * Math.cos(ea);
          const topR = [], botR = [];
          for (let si = 0; si < nNoz; si++) {
            const a = (si / nNoz) * Math.PI * 2;
            topR.push(project([cluster.vF,              cR + nzRt * Math.cos(a), cU + nzRt * Math.sin(a)]));
            botR.push(project([cluster.vF - nozzleLen,  cR + nozzleR * Math.cos(a), cU + nozzleR * Math.sin(a)]));
          }
          if (camSide > 0) for (let si = 0; si < nNoz; si++) {
            const sj = (si + 1) % nNoz;
            const ps = [topR[si], botR[si], botR[sj], topR[sj]];
            if (ps.some(p => !p)) continue;
            const p0 = ps[0], p1 = ps[1], p2 = ps[2];
            if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
            const aMid = ((si + 0.5) / nNoz) * Math.PI * 2;
            const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
            const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
            const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
            faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.14) + 0.4 * spec), avgD, col: [30, 28, 28] });
          }
          if (!botR.some(p => !p)) {
            const p0 = botR[0], p1 = botR[1], p2 = botR[2];
            if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
              const avgD = botR.reduce((s,p)=>s+p.d,0)/nNoz;
              const pStyle = isVac ? 'lh2' : (isSS ? 'ch4' : 'rp1');
              faces.push({ ps: botR, br: raptorOn ? 1.0 : 0.07, avgD,
                           col: raptorOn ? _PLUME_HOT[pStyle] : _PLUME_OFF[pStyle] });
            }
          }
          if (!topR.some(p => !p)) {
            const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
            faces.push({ ps: topR, br: 0.06, avgD, col: [28, 26, 26] });
          }
        }
      }
    }
  }

  /* Engine overlays: thrust-reverser cascade + chevrons */
  if (!isF9 && !isSS && !isSV && !isC172 && !isPP && !isBf109 && !isF4U && !isMig15) _engineOverlays(pts, faces, S.aircraft?.engine, _b);

  /* Outer engine nacelles — 4-engine WB aircraft (A340 etc.) with ey2 defined */
  const _oey2 = _wbGeo?.ey2;
  /* Pre-compute outer engine X offset: base exOff + LE sweep delta from inner to outer span station.
     Pre-compute outer engine Z: same approach — walk wing Z-centre at both span stations.
     Both values are shared by the nacelle AND fan-face sections below. */
  const _oXOffForOuter = (() => {
    if (!_oey2 || !_wbGeo) return _wbGeo?.exOff ?? 0;
    const base   = _wbGeo.exOff ?? 0;
    const _oWD2  = _wbGeo.wing ?? _WB_WING_DEFAULT;       // actual wing, not the generic default
    const _oEyI2 = _wbGeo.ey ?? _ey;
    const _oR2   = _wbGeo.r ?? _r;
    const _oDen  = Math.max((_oWD2.span ?? 0.0267) - _oR2 * 0.7071, 1e-9);
    return base + (_oey2 - _oEyI2) / _oDen * ((_oWD2.tipLE ?? -0.015) - (_oWD2.rootLE ?? 0));
  })();
  const _oEzForOuter = (() => {
    if (!_oey2 || !_wbGeo) return _wbGeo?.ez ?? _ez;
    const _oWD  = _wbGeo.wing ?? _WB_WING_DEFAULT;        // actual wing, not the generic default
    const _oR   = _wbGeo.r  ?? _r;
    const _oWR  = _oR * 0.7071;
    const _oSpn = _oWD.span ?? 0.0267;
    const _oFB  = _oWD.flapBreak ?? 0.58;
    const _oWH  = _oWR + (_oSpn - _oWR) * _oFB;
    const _oDih = _oWD.dihedral ?? 0;
    const _oSh  = _wbGeo.wzShift ?? 0;                    // wing vertical shift (wing.rootZ)
    const _oWzR = -_oWR + _oSh;
    const _oWzB = -_oWR + _oFB * (_oDih + _oWR) + _oSh;
    const _oWzT = _oDih + _oSh;
    const wCz   = (y) => y <= _oWH
      ? _oWzR + (y - _oWR) / Math.max(_oWH - _oWR, 1e-9) * (_oWzB - _oWzR)
      : _oWzB + (y - _oWH) / Math.max(_oSpn - _oWH, 1e-9) * (_oWzT - _oWzB);
    const _oEzI = _wbGeo.ez ?? _ez;
    const _oEyI = _wbGeo.ey ?? _ey;
    return wCz(_oey2) + (_oEzI - wCz(_oEyI));
  })();

  if (_oey2) {
    const _oer  = _wbGeo?.er  ?? _er;
    const _oerc = _wbGeo?.erc ?? _erc;
    const _oe7  = _oer  * 0.7071;
    const _oefr = _oer  * 1.20;
    const _oef7 = _oefr * 0.7071;
    const _oe7c = _oerc * 0.7071;
    const _oEngCol = COL_[4];
    const _oTRCol  = COL_[7];
    const _oIntCol = COL_[10];
    const _oXOff = _oXOffForOuter;
    const _oeA = 0.005 + _oXOff, _oeB = 0.001 + _oXOff;
    const _oeC = -0.001 + _oXOff, _oeD = -0.002 + _oXOff, _oeE = -0.003 + _oXOff;
    const _oePF = 0.003 + _oXOff;

    const _oez   = _oEzForOuter;
    const _oEzI  = _wbGeo?.ez ?? _ez;
    const _oer_  = _oer;
    const _oPylH = (_wbGeo?.pz ?? _pz) - (_oEzI + _oer_);
    const _opz2  = _oez + _oer_ + _oPylH;

    /* Build 8-point ring at given forward position, lateral centre yo, radius r, diagonal r7 */
    const _oe8 = (vf, yo, r, r7) => [
      project([vf, yo,    _oez+r ]),
      project([vf, yo+r7, _oez+r7]),
      project([vf, yo+r,  _oez   ]),
      project([vf, yo+r7, _oez-r7]),
      project([vf, yo,    _oez-r ]),
      project([vf, yo-r7, _oez-r7]),
      project([vf, yo-r,  _oez   ]),
      project([vf, yo-r7, _oez+r7]),
    ];

    const _oRing = (rF, rA, col) => {
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        for (const ps of [
          [rF[i], rF[j], rA[j], rA[i]].filter(Boolean),
          [rF[i], rA[i], rA[j], rF[j]].filter(Boolean),
        ]) {
          if (ps.length < 3) continue;
          const cr = (ps[1].x-ps[0].x)*(ps[2].y-ps[0].y)-(ps[1].y-ps[0].y)*(ps[2].x-ps[0].x);
          if (cr < 0) continue;
          faces.push({ ps, br: 0.82, avgD: ps.reduce((s,p)=>s+p.d,0)/ps.length, col });
        }
      }
    };

    for (const yo of [_oey2, -_oey2]) {
      const rA = _oe8(_oeA, yo, _oer,  _oe7 );
      const rB = _oe8(_oeB, yo, _oefr, _oef7);
      const rC = _oe8(_oeC, yo, _oer,  _oe7 );
      const rD = _oe8(_oeD, yo, _oer,  _oe7 );
      const rE = _oe8(_oeE, yo, _oerc, _oe7c);
      _oRing(rA, rB, _oEngCol);
      _oRing(rB, rC, _oEngCol);
      _oRing(rC, rD, _oTRCol);
      _oRing(rD, rE, _oEngCol);
      for (const cap of [rA, [...rA].reverse()]) {
        const f = cap.filter(Boolean);
        if (f.length < 3) continue;
        const cr = (f[1].x-f[0].x)*(f[2].y-f[0].y)-(f[1].y-f[0].y)*(f[2].x-f[0].x);
        if (cr < 0) continue;
        faces.push({ ps: f, br: 0.22, avgD: f.reduce((s,p)=>s+p.d,0)/f.length - 0.0002, col: _oIntCol });
      }
      /* (pylon drawn parametrically below, unified for inner + outer engines) */
    }
  }

  /* ── Engine pylons — parametric streamlined struts (all 4 engines) ───────────
     Bottom edge saddles onto the nacelle top (ez + nacelle radius along the chord),
     top edge fairs into the wing underside; forward of the wing LE the strut tapers
     down to a nose on the cowl. Thin thickness in y. Debug-blue for now. */
  if (_wbGeo && !wingView) {
    const _pR   = _wbGeo.r ?? _r;
    const _pWR  = _pR * 0.7071;
    const _pW   = _wbGeo.wing ?? _WB_WING_DEFAULT;
    const _pSh  = _wbGeo.wzShift ?? 0;
    const _pSpn = _pW.span ?? 0.0267, _pFB = _pW.flapBreak ?? 0.58, _pDih = _pW.dihedral ?? 0;
    const _pWH  = _pWR + (_pSpn - _pWR) * _pFB;
    const _pZ0  = -_pWR + _pSh, _pZB = -_pWR + _pFB*(_pDih+_pWR) + _pSh, _pZT = _pDih + _pSh;
    const _wingLowZ = (y) => { const a = Math.abs(y);
      return a <= _pWH ? _pZ0 + (a-_pWR)/Math.max(_pWH-_pWR,1e-9)*(_pZB-_pZ0)
                       : _pZB + (a-_pWH)/Math.max(_pSpn-_pWH,1e-9)*(_pZT-_pZB); };
    const _wingLE = (y) => { const ts = Math.abs(y) / Math.max(_pSpn,1e-9);
      return (_pW.rootLE ?? 0) + ((_pW.tipLE ?? -0.015) - (_pW.rootLE ?? 0)) * ts; };
    const _wingTE = (y) => { const ts = Math.abs(y) / Math.max(_pSpn,1e-9);
      return (_pW.rootTE ?? -0.009) + ((_pW.tipTE ?? -0.019) - (_pW.rootTE ?? -0.009)) * ts; };

    const _pushTri = (a,b,c,col) => {
      if (!a||!b||!c) return;
      const cr = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      if (cr < 0) return;
      faces.push({ ps:[a,b,c], br:0.66, avgD:(a.d+b.d+c.d)/3, col });
    };
    const _pushQuad = (a,b,c,d,col) => { _pushTri(a,b,c,col); _pushTri(a,c,d,col); };

    // engine configs: inner (ey) + outer (ey2 if present)
    const _engs = [{
      ey: _wbGeo.ey ?? _ey, ez: _wbGeo.ez ?? _ez, er: _wbGeo.er ?? _er, efr: _wbGeo.efr ?? (_wbGeo.er ?? _er)*1.2,
      eA: _wbGeo.eApos, eB: _wbGeo.eBpos, eC: _wbGeo.eCpos, eE: _wbGeo.eEpos, cn: _wbGeo.coreNozzle,
    }];
    if (_oey2) _engs.push({
      ey: _oey2, ez: _oEzForOuter, er: _wbGeo.er ?? _er, efr: (_wbGeo.er ?? _er)*1.2,
      eA: 0.005 + _oXOffForOuter, eB: 0.001 + _oXOffForOuter, eC: -0.001 + _oXOffForOuter, eE: -0.003 + _oXOffForOuter,
    });
    const _ilerp = (x,x0,y0,x1,y1) => y0 + (x-x0)/((x1-x0)||1e-9)*(y1-y0);

    for (const e of _engs) {
      if (e.eA == null || e.eB == null || e.eC == null || e.eE == null) continue;
      const halfT = e.er * 0.22, M = 10;
      // nacelle radius along x: intake→fan bulge (efr@eB) → core (er@eC) → core aft
      const nacR = (x) => x >= e.eB ? _ilerp(x, e.eA, e.er, e.eB, e.efr)
                        : x >= e.eC ? _ilerp(x, e.eB, e.efr, e.eC, e.er) : e.er;
      for (const sgn of [1, -1]) {
        const yc = sgn * e.ey, wz = _wingLowZ(yc), le = _wingLE(yc), te = _wingTE(yc);
        const xFwd = le + 0.75 * (e.eA - le);      // nose: forward 75% of the engine's forward section
        const xAft = te;                            // covers the whole wing chord, out to the TE
        const noseZ = e.ez + nacR(xFwd);
        // top edge: wing underside under the wing (x ≤ LE), tapering down to the nose forward of it
        const topZ = (x) => x <= le ? wz : _ilerp(x, le, wz, xFwd, noseZ);
        // bottom edge: rides the fan cowl top, drops onto the silver core-nozzle section 1 and rides
        // it, then fairs up to the wing TE aft of section 1. (No core nozzle → cowl saddle + fair-up.)
        const _cn = e.cn;
        const s1x1 = _cn ? e.eA - _cn[1][0] : e.eE;            // section 1 aft end (silver)
        const coreR1 = (x) => _ilerp(x, e.eE, _cn[0][1], s1x1, _cn[1][1]);   // section 1 top radius
        const botZ = (x) =>
            x >= e.eE       ? e.ez + nacR(x)                                      // fan cowl top
          : _cn && x >= s1x1 ? e.ez + coreR1(x)                                   // section 1 top
          :                   _ilerp(x, s1x1, e.ez + (_cn ? coreR1(s1x1) : nacR(e.eE)), te, wz);  // → wing TE
        const bN=[], bF=[], tN=[], tF=[];
        for (let i=0;i<=M;i++){
          const x = xFwd + (xAft - xFwd)*i/M;
          const zb = botZ(x), zt = topZ(x);
          bN.push(project([x, yc-halfT, zb])); bF.push(project([x, yc+halfT, zb]));
          tN.push(project([x, yc-halfT, zt])); tF.push(project([x, yc+halfT, zt]));
        }
        const col = COL_[0];
        for (let i=0;i<M;i++){
          _pushQuad(bN[i], tN[i], tN[i+1], bN[i+1], col);   // near side
          _pushQuad(bF[i], bF[i+1], tF[i+1], tF[i], col);   // far side
          _pushQuad(tN[i], tF[i], tF[i+1], tN[i+1], col);   // top (wing fair)
          _pushQuad(bN[i], bN[i+1], bF[i+1], bF[i], col);   // bottom (nacelle saddle)
        }
        _pushQuad(bN[0], bF[0], tF[0], tN[0], col);         // front nose cap
        _pushQuad(bN[M], tN[M], tF[M], bF[M], col);         // aft face (at wing LE)
      }
    }
  }

  /* Flap track fairings — 3D teardrop pods, depth-sorted with fuselage */
  if (_wbGeo && (S.aircraft?.flapTracks ?? 0) > 0) {
    const _ftN   = S.aircraft.flapTracks;
    const _ftPS  = Math.round(_ftN / 2);
    /* Use the aircraft's actual wing (same source the wing surface is built from)
       so the pods sit on the real trailing edge — _wbGeo doesn't carry .wing, so
       the old _wbGeo.wing silently fell back to the generic default. */
    const _ftwg  = S.aircraft?.wing ?? _wbGeo.wing ?? _WB_WING_DEFAULT;
    const _ftSpan = _ftwg.span;
    const _ftFB   = _ftwg.flapBreak ?? 0.72;
    const _ftFH   = _ftwg.flapHinge ?? 0.70;
    const _ftRootY = _wbGeo.r;
    const _ftBrkY  = _ftSpan * _ftFB;
    /* Pod dimensions — width and depth relative to fuselage radius */
    const ftW = _wbGeo.r * 0.26;    // half-width of pod at widest point
    const ftD = _wbGeo.r * 0.24;    // max depth below wing lower surface
    /* Correct wing lower surface Z — linear interpolation root→break→tip */
    const ftWR   = _wbGeo.r * 0.7071;
    const _ftSh  = (_ftwg.rootZ ?? -ftWR) + ftWR;   // wing vertical shift (wing.rootZ)
    const ftzR   = -ftWR + _ftSh;
    const ftzB   = -ftWR + _ftFB * (_ftwg.dihedral + ftWR) + _ftSh;
    const ftzT   = _ftwg.dihedral + _ftSh;
    const wLowerZ = (yAbs) => {
      if (yAbs <= _ftBrkY)
        return ftzR + (yAbs - ftWR) / Math.max(_ftBrkY - ftWR, 1e-9) * (ftzB - ftzR);
      return ftzB + (yAbs - _ftBrkY) / Math.max(_ftSpan - _ftBrkY, 1e-9) * (ftzT - ftzB);
    };

    for (const side of [1, -1]) {
      for (let ti = 0; ti < _ftPS; ti++) {
        const t     = (ti + 0.5) / _ftPS;
        const fY    = side * (_ftRootY + (_ftBrkY - _ftRootY) * t);
        const yAbs  = Math.abs(fY);
        const ts2   = yAbs / _ftSpan;
        const fxLE  = _ftwg.rootLE + (_ftwg.tipLE - _ftwg.rootLE) * ts2;
        const fxTE  = _ftwg.rootTE + (_ftwg.tipTE - _ftwg.rootTE) * ts2;
        const fChord = fxLE - fxTE;
        const fxH   = fxLE - fChord * _ftFH;          // hinge — never moves
        const fZtop  = wLowerZ(yAbs);                  // wing lower surface z at this station
        /* Spine runs forward→aft.  TE is at fxH - fChord*(1-_ftFH) = fxH - 0.30·fChord.
           Hinge (fxH) is the aft end of the fixed fairing and the pivot for the movable can. */
        const fxFwdTip = fxH + fChord * 0.22;  // deep into wing structure (22% fwd of hinge)
        const fxBelly  = fxH + fChord * 0.03;  // belly/max-depth just ahead of hinge
        const fxAft1   = fxH - fChord * 0.12;  // aft body — folds with flap
        const fxAft2   = fxH - fChord * 0.33;  // aft tip  — 3% past TE (folds)

        /* Spine: monotonically forward→aft; hinge is back of fixed section */
        const spine = [
          { x: fxFwdTip, zt: fZtop, dp: ftD*0.05, hw: 0,          fixed: true  },  // fwd tip (into wing)
          { x: fxBelly,  zt: fZtop, dp: ftD,       hw: ftW,        fixed: true  },  // belly max
          { x: fxH,      zt: fZtop, dp: ftD*0.80,  hw: ftW*0.88,   fixed: true  },  // hinge — back of fixed
          { x: fxAft1,   zt: fZtop, dp: ftD*0.42,  hw: ftW*0.46,   fixed: false },  // aft body — folds
          { x: fxAft2,   zt: fZtop, dp: ftD*0.05,  hw: 0,          fixed: false },  // aft tip
        ];

        /* Flap fold angle + Fowler aft-slide for aft fairing section */
        const _ftFa     = (S.flaps ?? 0) * 15 * DEG;
        const _cosFa    = Math.cos(_ftFa), _sinFa = Math.sin(_ftFa);
        const _ftFowler = _ftFa * fChord * (1 - _ftFH) * 1.5;  // matches flap anim fowlerShift

        /* Cross-section at each station: TL, TR, BL, BR
           Aft (non-fixed) points rotate + Fowler-slide to match flap motion */
        const csAt = ({ x, zt, dp, hw, fixed }) => {
          let x0 = x, zt0 = zt, ztB = zt - dp;
          if (!fixed && _ftFa > 0) {
            const dx = x - fxH;
            x0  = fxH + dx * _cosFa - _ftFowler;  // rotate + aft slide
            zt0 = fZtop + dx * _sinFa;
            ztB = fZtop + dx * _sinFa - dp * _cosFa;
          }
          return [
            project([x0, fY + hw,      zt0]),   // TL
            project([x0, fY - hw,      zt0]),   // TR
            project([x0, fY + hw*0.26, ztB]),   // BL
            project([x0, fY - hw*0.26, ztB]),   // BR
          ];
        };

        const cs = spine.map(csAt);

        for (let si = 0; si < spine.length - 1; si++) {
          const A = cs[si], B = cs[si + 1];
          /* 4 lateral face quads per segment */
          const quads = [
            [A[0], A[1], B[1], B[0]],   // top   (flush with wing)
            [A[0], A[2], B[2], B[0]],   // +Y side
            [A[2], A[3], B[3], B[2]],   // belly (most visible)
            [A[1], A[3], B[3], B[1]],   // -Y side
          ];
          for (const q of quads) {
            if (q.some(p => !p)) continue;
            const avgD = (q[0].d + q[1].d + q[2].d + q[3].d) / 4;
            faces.push({ avgD, draw: () => {
              ctx.beginPath();
              ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y);
              ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y);
              ctx.closePath();
              ctx.fillStyle = COL_[0]; ctx.fill();
              ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.stroke();
            }});
          }
        }
      }
    }
  }

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

  /* Gear struts and tires — pushed into face list so they depth-sort with fuselage.
     Gear behaviour is data-driven from the aircraft JSON "gear" block:
       gear.fixed  — never retracts, always drawn, no bay doors (C172/Bf109/F4U)
       gear.tires  — explicit [gearVertexIndex, radius] list; static gear positions
                     (fixed-gear aircraft + the MiG-15, whose gear retracts but
                     whose tires sit at fixed model vertices).
     Aircraft with neither (airliners) use the procedural retractable-gear path. */
  const _gearFixed = !!S.aircraft?.gear?.fixed;
  const _gearTires = S.aircraft?.gear?.tires;
  const _gearP  = _gearFixed ? 1 : (S.gearAnim ?? (S.gear ? 1 : 0));
  const _lerpV3 = (up, dn, t) => [up[0]+(dn[0]-up[0])*t, up[1]+(dn[1]-up[1])*t, up[2]+(dn[2]-up[2])*t];
  /* WB landing-gear geometry — data-driven from the aircraft JSON "gear" block,
     with defaults matching the legacy hardcoded positions so the other widebodies
     render unchanged:
       gear.main: { x (station), y (half-track), len (belly→axle), tireR, axles }
       gear.nose: { x (station), len, tireR }                                     */
  const _gC   = S.aircraft?.gear ?? {};
  const _gwR  = _wbGeo?.r ?? _r;
  const _gNx  = _gC.nose?.x   ?? 0.009;
  const _gNl  = _gC.nose?.len ?? 0.0022;
  const _gMx  = _gC.main?.x   ?? -0.001;
  const _gMy  = _gC.main?.y   ?? 0.0020;
  const _gMl  = _gC.main?.len ?? 0.0032;
  const _nTR  = _gC.nose?.tireR ?? _gwR * 0.12;
  const _mTR  = _gC.main?.tireR ?? _gwR * 0.16;
  const _nHR  = _gC.nose?.hubR;   // measured hub radius (silver), undefined → 0.20·tireR fallback
  const _mHR  = _gC.main?.hubR;
  const _bogPitch  = _mTR * 0.85;   // fore/aft axle spacing in the bogie
  const _gAx  = _gC.main?.axles ?? (_gC.main?.type === 'bogie' ? 2 : 1);
  const _mBay = _gC.main?.bayDoors !== false;   // 737 retracts main wheels exposed → no big bay doors
  /* Oleo-strut radii (shared by the left/right main legs and the centre leg):
     upper-cylinder radius from measured strutR else ≈0.266·tyreR (A350 main is a
     substantial 388 mm ⌀); collar / piston / pivot bosses all scale off it. */
  const _mrU   = _gC.main?.strutR ?? _mTR * 0.266;
  const _mrL   = _mrU * 0.676;   // polished lower piston (slides inside the cylinder)
  const _mrC   = _mrU * 1.41;    // gland-nut collar (fatter band)
  const _bossR = _mrU * 1.765, _bossH = _mrU * 1.294;   // side-stay pivot lugs
  /* Lower body-surface z at station x, lateral y — the belly-fairing super-ellipse
     lobe where x falls inside the fairing span, else the bare fuselage circle.
     Mirrors the fairing math in outside-wb.js so the gear bay doors hug the skin. */
  const _bfG = S.aircraft?.bellyFairing;
  const _bodyLowerZ = (x, y) => {
    const rr = _gwR;
    let z = -Math.sqrt(Math.max(0, rr*rr - y*y));      // bare fuselage circle
    if (_bfG && _bfG.fromX != null && x <= _bfG.fromX && x >= _bfG.toX) {
      const prog = (_bfG.fromX - x) / (_bfG.fromX - _bfG.toX), ramp = 0.26;
      let t = prog < ramp ? prog/ramp : prog > 1-ramp ? (1-prog)/ramp : 1;
      t = t < 1 ? t*t*(3-2*t) : 1;
      const maxHW = _bfG.maxWidth ?? rr, depth = _bfG.maxDepth ?? 0;
      const halfW = rr + t*(maxHW - rr);
      const ztop = rr*(1 - 0.78*t), zbot = -(rr + t*depth);
      const Vz = (ztop-zbot)*0.5, czf = (ztop+zbot)*0.5, nExp = 2 + t*1.1;
      const yn = Math.min(1, Math.abs(y)/halfW);
      const zf = czf - Vz * Math.pow(Math.max(0, 1 - Math.pow(yn, nExp)), 1/nExp);
      if (zf < z) z = zf;
    }
    return z;
  };
  /* A bay door = a curved panel flush with the lower skin, sampled along x so it
     follows the fairing/fuselage curvature. Nudged a hair proud to avoid z-fight. */
  const _drawBayDoor = (xF, xA, y0, y1, col, tag) => {
    const M = 5, ring = [];
    const add = (x, y) => {
      const z = _bodyLowerZ(x, y), rho = Math.hypot(y, z) || 1, e = 0.00004;
      ring.push([x, y + (y/rho)*e, z + (z/rho)*e]);
    };
    for (let k=0;k<=M;k++) add(xF, y0 + (y1-y0)*k/M);
    for (let k=0;k<=M;k++) add(xA, y1 + (y0-y1)*k/M);
    const pj = ring.map(project);
    if (pj.some(p=>!p)) return;
    const avgD = pj.reduce((s,p)=>s+p.d,0)/pj.length;
    faces.push({ avgD, draw: () => {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(pj[0].x, pj[0].y);
      for (let i=1;i<pj.length;i++) ctx.lineTo(pj[i].x, pj[i].y);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(10,12,16,0.92)'; ctx.lineWidth = Math.max(1, dpr*0.9); ctx.stroke();
      /* Reg tag — last two chars of the registration, as on the real nose-gear door */
      if (tag) {
        let cx=0, cy=0; for (const p of pj) { cx+=p.x; cy+=p.y; } cx/=pj.length; cy/=pj.length;
        const h = Math.hypot(pj[0].x-pj[M].x, pj[0].y-pj[M].y);   // across-door span
        const fs = Math.max(5, h * 0.42);
        ctx.fillStyle = 'rgba(40,44,52,0.95)';
        ctx.font = `700 ${fs}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(tag, cx, cy);
      }
      ctx.restore();
    }});
  };
  /* Down (extended) positions; struts retract toward the belly as gearP → 0. */
  const _mStrZ =  _bodyLowerZ(_gMx,  _gMy);
  const _mStrZn = _bodyLowerZ(_gMx, -_gMy);
  const _gvDn = [
    [_gNx, 0,     -_gwR],    [_gNx, 0,     -_gwR - _gNl],
    [_gMx,  _gMy, _mStrZ],   [_gMx,  _gMy, _mStrZ  - _gMl],
    [_gMx, -_gMy, _mStrZn],  [_gMx, -_gMy, _mStrZn - _gMl],
  ];
  const _animGV = _gearTires ? GV_ : [
    _gvDn[0],
    _lerpV3([_gNx + _gNl * 0.75, 0, -_gwR * 0.5], _gvDn[1], _gearP),
    _gvDn[2],
    _lerpV3([_gMx,  _gMy * 0.08, -_gwR * 0.4], _gvDn[3], _gearP),
    _gvDn[4],
    _lerpV3([_gMx, -_gMy * 0.08, -_gwR * 0.4], _gvDn[5], _gearP),
  ];
  /* Closed bay-door panel seams — drawn when the gear is retracted so the door
     outlines stay visible on the belly (flush panels + dark border). When the gear
     is out, the animated bay below (cutout + opening doors) draws instead. */
  if (!isF9 && !isSS && !isSV && !_gearFixed && _gearP <= 0.01) {
    const _dCol = 'rgba(228,230,234,0.96)';
    if (_mBay) {
      const _wL = _mTR * 2.8, _yIn = _gwR * 0.16, _yStr = _gwR * 0.90;
      _drawBayDoor(_gMx + _wL, _gMx - _wL,  _yIn,  _yStr, _dCol);
      _drawBayDoor(_gMx + _wL, _gMx - _wL, -_yIn, -_yStr, _dCol);
    }
    const _rt = (S.aircraft?.registration ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();
    const _nF = _gNx + _nTR * 1.9, _nA = _gNx - _nTR * 1.9;
    _drawBayDoor(_nF, _nA,  0,  _gwR * 0.46, _dCol, _rt);
    _drawBayDoor(_nF, _nA,  0, -_gwR * 0.46, _dCol);
  }
  if (!isF9 && !isSS && !isSV && (_gearFixed || _gearP > 0.01)) {
    const _wbR   = _wbGeo?.r ?? _r;
    const _midV3 = (a, b) => [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
    for (const [a, b] of _GE) {
      if (isPP && _ppGeo?.gearTubes) continue;  // drawn as 3D faces in F_
      if (!_gearTires && a === 0) continue;  // nose strut drawn as two-tone below
      if (!_gearTires && (a === 2 || a === 4)) continue;  // main struts drawn as two-tone below
      const pa = project(_animGV[a]), pb = project(_animGV[b]);
      if (!pa || !pb) continue;
      faces.push({ avgD: (pa.d+pb.d)/2, draw: () => { ctx.save(); drawStrutTube(ctx, pa, pb, dpr); ctx.restore(); } });
    }
    /* Landing-gear bay doors — retractable-gear aircraft only. */
    if (!_gearFixed) {
      const _dCol = 'rgba(228,230,234,0.96)';
      const _nz   = (v, e) => { const y=v[1], z=v[2], rho=Math.hypot(y,z)||1; return [v[0], y+(y/rho)*e, z+(z/rho)*e]; };
      /* Curved door panel: sampled M×2 along (x, param s) so it follows the fairing
         cross-section instead of being a flat quad. ptFn(x, s) → 3D point. */
      const _curvedPanel = (xF, xA, s0, s1, ptFn, fill, stroke, bias=0) => {
        const M = 4, fwd = [], aft = [];
        for (let k=0;k<=M;k++){ const s=s0+(s1-s0)*k/M; fwd.push(ptFn(xF,s)); aft.push(ptFn(xA,s)); }
        const p = [...fwd, ...aft.reverse()].map(project);
        if (p.some(q=>!q)) return;
        faces.push({ avgD: p.reduce((s,q)=>s+q.d,0)/p.length + bias, draw: () => {
          ctx.save(); ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y);
          for (let i=1;i<p.length;i++) ctx.lineTo(p[i].x,p[i].y);
          ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
          ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, dpr*0.9); ctx.stroke();
          ctx.restore();
        }});
      };
      /* Main gear: dark wheel-well cutout + big bay doors that open mid-cycle and
         close again once the gear is down/up (a tent function of _gearP), leaving
         only the strut-width leg door open. All panels follow the fairing curve. */
      const _bigOpen = Math.max(0, Math.min(1, (0.5 - Math.abs(_gearP - 0.5)) / 0.42));
      const _bθ = _bigOpen * Math.PI * 0.5;
      for (const [sign, top, axle] of [[1, 2, 3], [-1, 4, 5]]) {
        const _wL   = _mTR * 2.8;                       // well fore/aft half-length
        const _yIn  = sign * _gwR * 0.16;               // inboard well edge
        const _yStr = sign * _gwR * 0.90;               // fairing edge — big door stays on the fairing
        const _yLeg = sign * _gMy;                      // strut (leg door reaches out to here)
        const _aIn  = Math.abs(_yIn);
        /* (a) dark well cutout — the full well opening, centreline out to the strut */
        _curvedPanel(_gMx+_wL, _gMx-_wL, _yIn, _yLeg,
          (x,y) => _nz([x, y, _bodyLowerZ(x,y)], 0.00002),
          'rgba(10,12,16,0.96)', 'rgba(0,0,0,0.80)', 1e-6);
        /* (b) big bay door — curved panel hinged at _yIn; conforms to the fairing
           when closed (_bθ=0) and rotates rigidly down about the hinge when open.
           Suppressed when gear.main.bayDoors === false (737: exposed main wheels). */
        if (_mBay) _curvedPanel(_gMx+_wL, _gMx-_wL, _yIn, _yStr, (x,y) => {
          const zH = _bodyLowerZ(x, _yIn), zc = _bodyLowerZ(x, y);
          const ay = Math.abs(y) - _aIn, dz = zc - zH;
          const L = Math.hypot(ay, dz), φ = Math.atan2(dz, ay);
          return _nz([x, sign*(_aIn + L*Math.cos(φ-_bθ)), zH + L*Math.sin(φ-_bθ)], 0.00006);
        }, _dCol, 'rgba(10,12,16,0.92)');
        /* (c) strut leg door — inboard edge rides the fairing curve, outboard edge is
           pinned to the leg (follows the strut, stays open when the gear is down) */
        const _hl=_mTR*1.3, _stT=_animGV[top], _stA=_animGV[axle];
        const _fZ=_stT[2]+(_stA[2]-_stT[2])*0.42;
        _curvedPanel(_gMx+_hl, _gMx-_hl, 0, 1, (x,u) => {
          const y = _yStr + (_yLeg - _yStr)*u;
          const z = _bodyLowerZ(x, y)*(1-u) + _fZ*u;     // fairing curve → leg
          return _nz([x, y, z], 0.00006);
        }, _dCol, 'rgba(10,12,16,0.92)');
      }
      /* Nose bay — the starboard leaf carries the reg tag (last two chars), as on
         many real airliners (e.g. "ME" of HB-JME on the nose-gear door). */
      const _regTag = (S.aircraft?.registration ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();
      const _nF = _gNx + _nTR * 1.9, _nA = _gNx - _nTR * 1.9;
      _drawBayDoor(_nF, _nA,  0.0003,  _gwR * 0.46, _dCol, _regTag);
      _drawBayDoor(_nF, _nA, -0.0003, -_gwR * 0.46, _dCol);
    }
    if (!_gearTires) {
      /* Nose strut — upper barrel (dark metal) + lower polished piston, real 3-D */
      const _nTop = _animGV[0], _nBot = _animGV[1];
      const _nJunc  = _lerpV3(_nTop, _nBot, 0.75);   // cylinder 75% / piston 25%
      const _nHinge = _lerpV3(_nTop, _nBot, 0.50);   // retraction-rod hinge (mid cylinder)
      const pNMid = project(_nHinge);
      const _nrU = _gC.nose?.strutR ?? _nTR * 0.18;   // measured (A350 nose 216 mm ⌀) or ratio
      const _nrL = _nrU * 0.667;                        // polished lower piston
      pushTube3D(faces, _nTop,  _nJunc, _nrU, _nrU, [70, 80, 96],    project, rotateNormal, litBr, 8, 0.16);
      pushTube3D(faces, _nJunc, _nBot,  _nrL, _nrL, [200, 212, 226], project, rotateNormal, litBr, 8, 0.20);
      /* Retraction rod — hinge on forward face of upper barrel, rod to forward well structure */
      const _nFwdAtt = [_gNx + 0.0015, 0, -_wbR + 0.0004];
      const pNFwd = project(_nFwdAtt);
      if (pNFwd && pNMid) faces.push({ avgD: (pNFwd.d+pNMid.d)/2, draw: () => {
        ctx.save(); drawActuatorRod(ctx, pNFwd, pNMid, dpr); ctx.restore();
      }});
      /* Nose-strut attachment boss — real 3-D lateral pivot lug at the rod hinge
         (lighter than the main-gear lugs, same treatment). */
      pushTube3D(faces, [_nHinge[0], _nHinge[1]+_nrU*1.15, _nHinge[2]], [_nHinge[0], _nHinge[1]-_nrU*1.15, _nHinge[2]],
                 _nrU*1.5, _nrU*1.5, [120, 132, 150], project, rotateNormal, litBr, 8, 0.24, true);
      /* Main struts — real 3-D oleo shock: dark upper cylinder, gland-nut collar at
         its base where the polished silver lower piston slides out, plus the two
         load-bearing side-stay attachment bosses (big lateral pivot lugs). */
      for (const [gv2, gv3] of [[2, 3], [4, 5]]) {
        const _mTop = _animGV[gv2], _mBot = _animGV[gv3];
        const _mMid  = _lerpV3(_mTop, _mBot, 0.75);   // cylinder 75% / piston 25%
        const _mColT = _lerpV3(_mTop, _mBot, 0.67);   // gland collar at the cylinder base
        pushTube3D(faces, _mTop,  _mMid, _mrU, _mrU, [70, 80, 96],    project, rotateNormal, litBr, 10, 0.16);
        pushTube3D(faces, _mMid,  _mBot, _mrL, _mrL, [200, 212, 226], project, rotateNormal, litBr, 10, 0.20);
        pushTube3D(faces, _mColT, _mMid, _mrC, _mrC, [50, 58, 72],    project, rotateNormal, litBr, 10, 0.14, true);  // gland-nut collar
        /* Side-stay attachment bosses — prominent pivot lugs. Pin axis follows the
           leg as it swings inboard (axle = X × legDir), same as the wheel axle, so the
           lugs rotate with the strut instead of staying lateral. */
        let _bax = [0, -(_mBot[2] - _mTop[2]), _mBot[1] - _mTop[1]];
        const _bm = Math.hypot(_bax[1], _bax[2]) || 1; _bax = [0, _bax[1]/_bm, _bax[2]/_bm];
        for (const f of [0.502, 0.192]) { const c = _lerpV3(_mTop, _mBot, f);
          pushTube3D(faces, [c[0]+_bax[0]*_bossH, c[1]+_bax[1]*_bossH, c[2]+_bax[2]*_bossH],
                            [c[0]-_bax[0]*_bossH, c[1]-_bax[1]*_bossH, c[2]-_bax[2]*_bossH],
                     _bossR, _bossR, [120, 132, 150], project, rotateNormal, litBr, 8, 0.24, true); }
      }

      /* Main gear side stays — fore + aft folding braces, real 3-D tubes. The mid
         knuckles get small pivot-joint bosses (the real brace folds there on a pin;
         the actual rack-and-pinion is sub-visible at this scale, so we read it as a
         pin joint). pushTube3D builds from the live points, so the braces flex as the
         leg swings inboard. */
      const _srR = _mrU * 0.42;                     // brace rod radius
      const _jR  = _mrU * 0.72, _jH = _mrU * 0.50;  // pivot-joint boss
      const _ROD = [120, 132, 150], _JNT = [142, 152, 168];
      for (const [sign, gv2, gv3] of [[+1, 2, 3], [-1, 4, 5]]) {
        const strBkt  = _lerpV3(_animGV[gv2], _animGV[gv3], 0.502);
        const strBkt2 = _lerpV3(_animGV[gv2], _animGV[gv3], 0.192);
        const frTop = [_gMx + 0.003, sign * 0.0004, -_gwR * 0.88];
        const arTop = [_gMx - 0.002, sign * 0.0004, -_gwR * 0.88];
        const frMid    = _midV3(frTop, strBkt);
        const arMid    = _midV3(arTop, strBkt);
        const redFrMid = _midV3(strBkt2, frMid);
        const redArMid = _midV3(strBkt2, arMid);
        /* fore + aft braces: belly attachment → lower strut bracket */
        pushTube3D(faces, frTop, strBkt, _srR, _srR, _ROD, project, rotateNormal, litBr, 7, 0.20);
        pushTube3D(faces, arTop, strBkt, _srR, _srR, _ROD, project, rotateNormal, litBr, 7, 0.20);
        /* secondary lock links: upper bracket → mid knuckle */
        pushTube3D(faces, strBkt2, frMid, _srR*0.85, _srR*0.85, _ROD, project, rotateNormal, litBr, 7, 0.20);
        pushTube3D(faces, strBkt2, arMid, _srR*0.85, _srR*0.85, _ROD, project, rotateNormal, litBr, 7, 0.20);
        /* pivot-joint bosses at the folding knuckles (short fore-aft pin) */
        for (const c of [frMid, arMid, redFrMid, redArMid])
          pushTube3D(faces, [c[0]+_jH, c[1], c[2]], [c[0]-_jH, c[1], c[2]], _jR, _jR, _JNT,
                     project, rotateNormal, litBr, 8, 0.26, true);

        /* Outboard gear-leg door (gear.main.door) — the side-stays fold the leg
           inboard, and this door closes the wheel well; when extended it hangs on
           the outboard side of the leg. A flat body-coloured panel. */
        if (_gC.main?.door) {
          const _dHW = _mTR * 1.6;                       // door half-length (fore/aft)
          const _dYo = sign * (_gMy + _mTR * 0.85);      // outboard of the bogie
          const _dZt = -_wbR + 0.0002;                   // top at the belly
          const _dZb = _animGV[gv3][2] + _mTR * 0.8;     // bottom above the axle
          const _dPts = [
            [_gMx + _dHW, _dYo, _dZt], [_gMx - _dHW, _dYo, _dZt],
            [_gMx - _dHW, _dYo, _dZb], [_gMx + _dHW, _dYo, _dZb],
          ].map(project);
          if (_dPts.every(Boolean)) {
            const _dD = _dPts.reduce((s, p) => s + p.d, 0) / 4;
            faces.push({ avgD: _dD, draw: () => {
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(_dPts[0].x, _dPts[0].y);
              for (let i = 1; i < 4; i++) ctx.lineTo(_dPts[i].x, _dPts[i].y);
              ctx.closePath();
              ctx.fillStyle   = 'rgba(228,230,234,0.97)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(120,130,145,0.85)';
              ctx.lineWidth   = dpr * 0.9;
              ctx.stroke();
              ctx.restore();
            }});
          }
        }
      }
    }
    if (_gearTires) {
      for (const [vi, tR, hubR] of _gearTires) {
        const wc = GV_[vi], pt = project(wc);
        if (pt) faces.push({ avgD: pt.d, draw: () => { ctx.save(); drawVolumetricTire(ctx, wc, tR, project, hubR); ctx.restore(); } });
      }
    } else {
      const _gearCfg   = S.aircraft?.gear ?? {};

      /* Nose gear — steerable: deflect the wheel with the ground steering command
         (heading error hdgT−hdg) while on the ground, centred in the air. The strut is
         a symmetric cylinder so only the wheel turns, about the vertical (Z) axis. */
      { const wc = _animGV[1], pt = project(wc);
        let _steerAx;
        if (S.wow) {
          let _sa;
          if (S.aircraft?.manualControl) {
            _sa = (S.steer ?? 0) * 70 * Math.PI / 180;                    // tiller, up to ±70°
          } else {
            const _he = (((S.hdgT ?? S.hdg) - S.hdg + 540) % 360) - 180;  // AP: signed heading error
            _sa = Math.max(-45, Math.min(45, _he * 4)) * Math.PI / 180;
          }
          _steerAx = [-Math.sin(_sa), Math.cos(_sa), 0];
        }
        if (pt) pushTirePair(faces, wc, _nTR, _nHR, project, rotateNormal, litBr, _steerAx); }

      /* Main gear — N-axle bogie (fore/aft) or a single pair (gear.main.axles).
         The leg swings inboard about the fore-aft (X) axis, so the wheel axle tilts
         with it: axle = X × legDir = [0, -legZ, legY]. Extended → [0,1,0] (lateral). */
      for (const vi of [3, 5]) {
        const wc = _animGV[vi], top = _animGV[vi - 1], pt = project(wc);
        if (!pt) continue;
        let _ax = [0, -(wc[2] - top[2]), wc[1] - top[1]];
        const _am = Math.hypot(_ax[1], _ax[2]) || 1; _ax = [0, _ax[1]/_am, _ax[2]/_am];
        if (_gAx >= 2) {
          const ends = [];
          for (let k = 0; k < _gAx; k++) {
            const off = (k - (_gAx - 1) / 2) * 2 * _bogPitch;
            const wck = [wc[0] + off, wc[1], wc[2]];
            pushTirePair(faces, wck, _mTR, _mHR, project, rotateNormal, litBr, _ax);
            const pk = project(wck); if (pk) ends.push(pk);
          }
          if (ends.length >= 2) { const e0 = ends[0], e1 = ends[ends.length - 1];
            faces.push({ avgD: (e0.d + e1.d) / 2, draw: () => { ctx.save(); drawStrutTube(ctx, e0, e1, dpr); ctx.restore(); } }); }
        } else {
          pushTirePair(faces, wc, _mTR, _mHR, project, rotateNormal, litBr, _ax);
        }
      }

      /* Center gear — bogie on centerline (A340 etc.); same 3-D oleo as the main legs:
         dark cylinder (75%) + gland collar + silver piston (25%), down the centerline. */
      if (_gearCfg.center && _gearP > 0.01) {
        const _cgX   = _gearCfg.center?.x ?? (_gMx - _mTR * 4);  // a bit aft of the mains (or measured)
        const _cgLen = _gearCfg.center?.len ?? 0.0032;           // fuselage→axle (measured or default)
        const _cgTop = [_cgX, 0, -_wbR];                          // belly attachment (pivot hinge)
        /* Retracts forward + up like the nose leg: the wheel swings forward about the
           belly hinge (forward throw ≈ leg length, so the leg length stays ~constant). */
        const _cgFwd = _cgLen * 0.94, _cgUp = _cgLen * 0.31;
        const _cgWhl = _lerpV3([_cgX + _cgFwd, 0, -_wbR + _cgUp], [_cgX, 0, -_wbR - _cgLen], _gearP);
        const _cgMid  = _lerpV3(_cgTop, _cgWhl, 0.75);
        const _cgColT = _lerpV3(_cgTop, _cgWhl, 0.67);
        pushTube3D(faces, _cgTop,  _cgMid, _mrU, _mrU, [70, 80, 96],    project, rotateNormal, litBr, 10, 0.16);
        pushTube3D(faces, _cgMid,  _cgWhl, _mrL, _mrL, [200, 212, 226], project, rotateNormal, litBr, 10, 0.20);
        pushTube3D(faces, _cgColT, _cgMid, _mrC, _mrC, [50, 58, 72],    project, rotateNormal, litBr, 10, 0.14, true);
        /* diagonal drag brace — kept 2-D for now, like the main side-stays */
        const cgPivotA = project([_cgX, 0, -_wbR * 0.50]);
        const cgPivotM = project(_midV3(_cgTop, _cgWhl));
        if (cgPivotA && cgPivotM)
          faces.push({ avgD: (cgPivotA.d+cgPivotM.d)/2, draw: () => { ctx.save(); drawStrutTube(ctx, cgPivotA, cgPivotM, dpr); ctx.restore(); } });
        /* center bogie tires + axle-beam cross tube */
        const _cbp = _bogPitch;
        const wcF = [_cgWhl[0]+_cbp, _cgWhl[1], _cgWhl[2]], wcA = [_cgWhl[0]-_cbp, _cgWhl[1], _cgWhl[2]];
        pushTirePair(faces, wcF, _mTR, _mHR, project, rotateNormal, litBr);
        pushTirePair(faces, wcA, _mTR, _mHR, project, rotateNormal, litBr);
        const pF = project(wcF), pA = project(wcA);
        if (pF && pA) faces.push({ avgD: (pF.d+pA.d)/2, draw: () => { ctx.save(); drawStrutTube(ctx, pF, pA, dpr); ctx.restore(); } });
      }
    }
  }

  /* (Legacy belly-hinged gear bay doors removed — superseded by the data-driven,
     fairing-conforming bay doors drawn in the gear block above.) */

  /* Starship reentry plasma — project the actual body midpoint (vF=0.027 =
     centre of stage-2 span 0.013→0.041) rather than cx/cy, because cx is the
     perspective-projection origin and can differ from the on-screen position
     of the rocket centre (especially in side cam after stage sep).           */
  if (isSS) {
    const _pSSMid = project([0.027, 0, 0]);
    const _pCx = _pSSMid?.x ?? cx;
    const _pCy = _pSSMid?.y ?? cy;
    if (camSide > 0) _drawSSReentryPlasma(canvas, _pCx, _pCy, camSide, true);
    else             _drawSSReentryPlasma(canvas, _pCx, _pCy, camBack, false);
  }

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

  /* ── Cockpit window frames — silver stroke + rounded corners, drawn on top of the
        glass faces (the dark glass itself is now a real depth-sorted face). ──────
     Post-painter pass, bypasses depth sort ──
     Painter's algorithm can't reliably order window faces against the tube faces they
     sit on (the outermost tube sectors sort closer than the window centroid).
     Project and fill each panel directly here, after all fuselage faces are done.
     Shared edges between adjacent panels are detected and suppressed so they don't
     draw a silver divider line through what should look like a single window.         */
  if (_wbGeo?.cockpitPanels) {
    /* Rounded-corner path for a projected polygon — arcTo rounds each corner by its
       own radius rs[i] (0 = sharp). */
    const _rPoly = (pts, rs) => {
      const n = pts.length;
      ctx.moveTo((pts[n-1].x + pts[0].x) * 0.5, (pts[n-1].y + pts[0].y) * 0.5);
      for (let i = 0; i < n; i++) {
        const p = pts[(i-1+n) % n], c = pts[i], e = pts[(i+1) % n];
        const d1 = Math.hypot(c.x - p.x, c.y - p.y) * 0.5;
        const d2 = Math.hypot(e.x - c.x, e.y - c.y) * 0.5;
        ctx.arcTo(c.x, c.y, (c.x + e.x) * 0.5, (c.y + e.y) * 0.5, Math.min(rs[i], d1, d2));
      }
    };
    const rr = (_wbGeo.cockpitPanelR ?? 12) * dpr;
    /* A corner shared with another panel rounds sharp (0) so adjacent windows meet
       cleanly instead of each arcing away from the vertex and leaving a notch. */
    const _vKey = (x,y,z) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    const _vCount = {};
    for (const panel of _wbGeo.cockpitPanels)
      for (const [x,y,z] of panel) { const k = _vKey(x,y,z); _vCount[k] = (_vCount[k]||0) + 1; }
    for (const ySign of [+1, -1]) {
      const projPanels = _wbGeo.cockpitPanels.map(corners => {
        /* 3D face normal backface cull — 2D cross-product is unreliable at orbit
           elevations (sign flips, wrong-side panel bleeds through fuselage). */
        const [ax, ay, az] = corners[0];
        const [bx, by, bz] = corners[3];
        const [cx, cy, cz] = corners[2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        /* Far-side guard: never draw the panel on the opposite side of the fuselage.
           The 3D normal cull alone fails at high elevation — the nz*_cpCamU term can
           carry the far-side panel into positive territory even when the camera is clearly
           on the opposite side.  ySign*_cpCamR < 0 means "camera is on the wrong side." */
        if (ySign * _cpCamR < -0.15) return null;
        /* Mirror for port side: correct normal is [nx, -ny, nz], so negate _cpCamR. */
        if (nx * _cpCamF + ny * (ySign * _cpCamR) + nz * _cpCamU <= 0) return null;
        /* Reverse winding for the fill, for any corner count (was hardcoded to 4). */
        const order = [corners[0], ...corners.slice(1).reverse()];
        const vs = order.map(([x, y, z]) => project([x, ySign * y, z]));
        if (vs.some(v => !v)) return null;
        /* Skip degenerate sliver projections — a window that wraps the nose collapses
           to a near-line at grazing angles (tiny area for a long perimeter). */
        let area = 0, perim = 0;
        for (let i = 0; i < vs.length; i++) {
          const a = vs[i], b = vs[(i + 1) % vs.length];
          area  += a.x * b.y - b.x * a.y;
          perim += Math.hypot(b.x - a.x, b.y - a.y);
        }
        if (perim < 1e-3 || Math.abs(area) * 0.5 / (perim * perim) < 0.003) return null;
        const rs = order.map(([x,y,z]) => _vCount[_vKey(x,y,z)] >= 2 ? 0 : rr);
        return { vs, rs };
      });
      ctx.save();
      ctx.strokeStyle = 'rgb(168,173,180)';   // silver window frame (glass is a real face)
      ctx.lineWidth   = 2.5 * dpr;
      for (const pp of projPanels) {
        if (!pp) continue;
        ctx.beginPath(); _rPoly(pp.vs, pp.rs); ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ── cockpitPanels vertex debug overlay ───────────────────────────────────── */
  if (_DBG_PANELS && _wbGeo?.cockpitPanels) {
    const _pCols = ['#00ffff','#ffff00','#ff66ff','#66ff66'];
    ctx.save();
    ctx.font = `bold ${Math.round(9 * dpr)}px monospace`;
    ctx.textAlign = 'left';
    for (const ySign of [+1, -1]) {
      for (let pi = 0; pi < _wbGeo.cockpitPanels.length; pi++) {
        const panel = _wbGeo.cockpitPanels[pi];
        const col   = _pCols[pi % _pCols.length];
        for (let ci = 0; ci < panel.length; ci++) {
          const [cx, cy, cz] = panel[ci];
          const sp = project([cx, ySign * cy, cz]);
          if (!sp) continue;
          /* dot */
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
          /* label — show JSON coords × 10000 as integers */
          const label = `p${pi}c${ci}`;
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          const tw = ctx.measureText(label).width;
          ctx.fillRect(sp.x + 6 * dpr, sp.y - 9 * dpr, tw + 4 * dpr, 12 * dpr);
          ctx.fillStyle = col;
          ctx.fillText(label, sp.x + 8 * dpr, sp.y);
        }
      }
    }
    ctx.restore();
  }

  /* Front glass windows — post-painter fill + silver outline, side view only.
     These panels face outward-starboard/port so they are only visible from the side
     camera (camSide > 0).  The winding gives cross>0 from the near side, <0 from far. */
  if (_wbGeo?.frontWin && camSide > 0 && !_wbGeo.cockpitPanels) {
    ctx.save();
    for (const [vA, vB, vC, vD] of _wbGeo.frontWin) {
      const vs = [pts[vA], pts[vB], pts[vC], pts[vD]];
      if (vs.some(v => !v)) continue;
      const cross = (vs[1].x - vs[0].x) * (vs[2].y - vs[0].y)
                  - (vs[1].y - vs[0].y) * (vs[2].x - vs[0].x);
      if (cross < 0) continue;   // back-facing — cull
      ctx.beginPath();
      ctx.moveTo(vs[0].x, vs[0].y);
      for (let k = 1; k < vs.length; k++) ctx.lineTo(vs[k].x, vs[k].y);
      ctx.closePath();
      ctx.fillStyle   = 'rgba(8,18,35,0.62)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,195,208,0.88)';
      ctx.lineWidth   = Math.max(1.2, dpr * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Cockpit windshield — rectangle from sI (inner) to sO (outer) ── */
  if (_wbGeo?.rb && _wbGeo.winFwdRi != null && _wbGeo.winAftRi != null && !_wbGeo.cockpitPanels) {
    const _rb = _wbGeo.rb;
    const _fR = _wbGeo.winFwdRi, _aR = _wbGeo.winAftRi;
    const _sI = _wbGeo.winSiInner ?? 2, _sO = _wbGeo.winSiOuter ?? 4;
    const _drawCW = (siA, siB) => {
      const vs = [
        pts[_rb[_fR] + siA],  // fwd inner
        pts[_rb[_fR] + siB],  // fwd outer
        pts[_rb[_aR] + siB],  // aft outer
        pts[_rb[_aR] + siA],  // aft inner
      ];
      if (vs.some(v => !v)) return;
      /* cull only if ALL four ring-vertex normals face away from camera */
      const vis = [_rb[_fR]+siA, _rb[_fR]+siB, _rb[_aR]+siB, _rb[_aR]+siA];
      if (vis.every(vi => edgeCamDir(vi) > 0)) return;
      ctx.save();
      ctx.lineWidth = Math.max(1.4, devicePixelRatio * 1.4);
      ctx.strokeStyle = 'rgba(180,80,220,0.95)';
      ctx.beginPath();
      ctx.moveTo(vs[0].x, vs[0].y);
      for (let k = 1; k < vs.length; k++) ctx.lineTo(vs[k].x, vs[k].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };
    _drawCW(_sI,        _sO       );  // R: starboard inner → outer
    _drawCW(16 - _sO,  16 - _sI  );  // L: port outer → inner (mirror)
  }

  /* ── Stage separation tumble animations (Saturn V) ─────────────── */
  if (isSV && _svSepAnims.length > 0) {
    const ANIM_DUR = 14;   // seconds until fully faded
    const now = Date.now();

    for (let ai = _svSepAnims.length - 1; ai >= 0; ai--) {
      const anim  = _svSepAnims[ai];
      const elapsed = (now - anim.t0) / 1000;
      if (elapsed > ANIM_DUR) { _svSepAnims.splice(ai, 1); continue; }

      const alpha = Math.pow(Math.max(0, 1 - elapsed / ANIM_DUR), 0.55);
      if (alpha < 0.01) continue;

      /* Drift aft (rocket accelerates away) + end-over-end tumble */
      const drift = Math.pow(elapsed, 1.7) * 0.060;   // NM behind rocket
      const θ     = elapsed * Math.PI * 0.80;          // ~144 deg/sec tumble

      /* Which faces to animate, and the stage's centre of mass in vF */
      let fMin, fMax, finFaces, pivotVF;
      if (anim.stage === 1) {
        fMin = 0; fMax = 31; finFaces = true; pivotVF = -0.018;
      } else {
        fMin = 32; fMax = 63; finFaces = false; pivotVF = 0.0005;
      }

      /* Pre-transform: tumble around vR axis + drift in -vF */
      const sepProj = ([vF, vR_, vU_]) => {
        const dF = vF - pivotVF;
        const rF = dF * Math.cos(θ) - vU_ * Math.sin(θ) + pivotVF - drift;
        const rU = dF * Math.sin(θ) + vU_ * Math.cos(θ);
        return project([rF, vR_, rU]);
      };

      const sPts = _V_sv.map(v => sepProj(v));

      const drawRange = (start, end) => {
        const sf = [];
        for (let fi = start; fi <= end; fi++) {
          const ps = _F_sv[fi].map(vi => sPts[vi]);
          if (ps.some(p => !p)) continue;
          const p0=ps[0], p1=ps[1], p2=ps[2];
          if ((p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
          const avgD = ps.reduce((s,p)=>s+p.d,0)/ps.length;
          sf.push({ ps, avgD, col: _COLORS_sv[_FC_sv[fi]] });
        }
        sf.sort((a,b) => b.avgD - a.avgD);
        for (const { ps, col } of sf) {
          ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          ctx.beginPath();
          ctx.moveTo(ps[0].x, ps[0].y);
          for (let k=1; k<ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
          ctx.closePath(); ctx.fill();
        }
      };

      ctx.save();
      ctx.globalAlpha = alpha;
      drawRange(fMin, fMax);
      if (finFaces) drawRange(160, 167);
      ctx.restore();
    }
  }

  /* Swiss cross — winglets always; vtail only when no livery decal covers it.
     Winglet outer-face normals are ±rR: show R cross when camera is starboard (_cpCamR > 0),
     L cross when camera is port (_cpCamR < 0).  V-stab is on the centreline — show from
     either side using the 2D cross-product of its projected face. */
  if (S.aircraft?.livery?.swissCross) {
    const _hasVtailDecal = S.aircraft?.livery?.decals?.some(d => d.surface === 'vtail');
    const _crossV = S.aircraft.livery.swissCrossV ?? 0.5;
    const _vsFront = (a, b, c) => a && b && c &&
      Math.abs((b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)) > 0;
    if (!_hasVtailDecal && _vsFront(pts[_b+8], pts[_b+9], pts[_b+11]))
      _drawSwissCross(ctx, pts[_b+8], pts[_b+9], pts[_b+11], pts[_b+10], _crossV);   // v-stab
    if (_cpCamR > 0)
      _drawSwissCross(ctx, pts[_b+118], pts[_b+147], pts[_b+101], pts[_b+100]);  // R winglet
    if (_cpCamR < 0)
      _drawSwissCross(ctx, pts[_b+122], pts[_b+151], pts[_b+103], pts[_b+102]);  // L winglet
  }

  /* Winglet logo (e.g. Edelweiss flower) — billboards the vtail decal's flower onto
     the near-side winglet. Enable with livery.wingletLogo. */
  if (S.aircraft?.livery?.wingletLogo && _wbGeo) {
    const _wlDec = S.aircraft.livery.decals?.find(d => d.surface === 'vtail');
    if (_wlDec?.elements) {
      const _wlVb = (_wlDec.viewBox ?? '0 0 50 50').split(' ').map(Number);
      if (_cpCamR > 0) _drawWingletLogo(ctx, pts[_b+118], pts[_b+147], pts[_b+101], pts[_b+100], _wlDec.elements, _wlVb);
      if (_cpCamR < 0) _drawWingletLogo(ctx, pts[_b+122], pts[_b+151], pts[_b+103], pts[_b+102], _wlDec.elements, _wlVb);
    }
  }

  /* MiG-15 Polish markings: szachownica on V-stab + "602" painted on port fuselage */
  if (isMig15) {
    _drawPolishRoundel(ctx, pts[142], pts[143], pts[145], pts[144]);

    /* Fuselage szachownica — port side, aft of cockpit */
    const _rfBL = project([-0.001, -_m15r, -_m15r * 0.20]);
    const _rfBR = project([-0.004, -_m15r, -_m15r * 0.20]);
    const _rfTR = project([-0.004, -_m15r,  _m15r * 0.90]);
    const _rfTL = project([-0.001, -_m15r,  _m15r * 0.90]);
    const _rfSt = project([-0.002,  _m15r,  _m15r * 0.20]);
    if (_rfBL && _rfBR && _rfTR && _rfTL && _rfSt &&
        (_rfBL.d + _rfTL.d) * 0.5 < _rfSt.d) {
      _drawPolishRoundel(ctx, _rfBL, _rfBR, _rfTR, _rfTL);
    }

    /* "602" — fixed to port fuselage surface.
       Project fore and aft anchor points on port side; use their screen-space
       direction and foreshortening to rotate/scale the text so it lies on the hull. */
    const _pFwd  = project([0.008, -_m15r, _m15r * 0.08]);   // forward anchor
    const _pAft  = project([0.003, -_m15r, _m15r * 0.08]);   // aft anchor
    const _pTop2 = project([0.006, -_m15r, _m15r * 0.55]);   // vertical top ref
    const _pBot2 = project([0.006, -_m15r, -_m15r * 0.20]);  // vertical bot ref
    const _pStb2 = project([0.006,  _m15r, _m15r * 0.08]);   // starboard depth ref
    if (_pFwd && _pAft && _pTop2 && _pBot2 && _pStb2 &&
        (_pFwd.d + _pAft.d) * 0.5 < _pStb2.d) {
      const _fdx  = _pAft.x - _pFwd.x, _fdy = _pAft.y - _pFwd.y;  // aft direction
      const _fLen = Math.hypot(_fdx, _fdy);                          // fore-aft screen length
      const _hLen = Math.hypot(_pTop2.x - _pBot2.x, _pTop2.y - _pBot2.y); // vert screen height
      if (_fLen > 1 && _hLen > 3) {
        const _angle  = Math.atan2(_fdy, _fdx);
        const _textH  = _hLen * 0.68;
        /* xScale: normalise fore-aft foreshortening.
           Body span sampled: fwd=0.008, aft=0.003 → 5 mm.  Vert span: 2×_m15r ≈ 4.2 mm.
           At full side-on both map equally; ratio deviates as azimuth changes. */
        const _xScale = (_fLen / _hLen) / (0.005 / (_m15r * 2));
        const _cx = (_pFwd.x + _pAft.x) * 0.5, _cy = (_pFwd.y + _pAft.y) * 0.5;
        ctx.save();
        ctx.translate(_cx, _cy);
        ctx.rotate(_angle);
        ctx.scale(_xScale, 1);
        ctx.font         = `900 ${Math.max(5, _textH)}px sans-serif`;
        ctx.fillStyle    = 'rgba(192,24,24,0.95)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('602', 0, 0);
        ctx.restore();
      }
    }
  }

  /* Livery decals — SVG paths mapped onto named surfaces */
  const _livDecals = S.aircraft?.livery?.decals;
  if (_livDecals?.length) _drawLiveryDecals(ctx, _livDecals, pts, verts, FC_, F_, project, camSide);

  /* Aircraft registration — small text on the aft fuselage, placed from the
     fuselage geometry so it works for any WB/NB. European-style registrations
     ride below the window line; US (N-prefix) registrations sit above it. */
  if (S.aircraft?.registration && _wbGeo) {
    const _rgR = _wbGeo.r, _rgReg = S.aircraft.registration;
    const _rgVbW = Math.max(48, _rgReg.length * 12);
    const _rgUS  = /^N/i.test(_rgReg);                    // US registration → above windows
    const _rgZT  = _rgUS ?  _rgR * 0.44 :  -_rgR * 0.10;  // band edges, above or below windows
    const _rgZB  = _rgUS ?  _rgR * 0.10 :  -_rgR * 0.44;
    const _rgU  = (_rgZT - _rgZB) * (_rgVbW / 20);        // x-width matched to text aspect
    /* Scale the position with the actual fuselage length (tailX lives in geometry)
       so the registration always sits in the back, just ahead of the tailcone,
       on any aircraft from the short 737 to the long 777. */
    const _rgTailX = S.aircraft?.geometry?.tailX ?? S.aircraft?.tailX ?? -0.021;
    const _rgXF = _rgTailX * 0.55;                        // front edge, well aft on the fuselage
    _drawLiveryDecals(ctx, [{
      surface: 'fuselage',
      viewBox: `0 0 ${_rgVbW} 20`,
      placement: [[_rgXF, _rgR, _rgZT], [_rgXF - _rgU, _rgR, _rgZT],
                  [_rgXF - _rgU, _rgR, _rgZB], [_rgXF, _rgR, _rgZB]],
      elements: [{ text: _rgReg, fill: 'rgb(45,48,56)', x: _rgVbW / 2, y: 11, size: 15 }],
    }], pts, verts, FC_, F_, project, camSide);
  }

  /* Re-stamp near-side wing + winglet faces after livery to prevent livery bleeding over them.
     Near-side faces have avgD < camSide (they're between camera and fuselage centre).
     Far-side faces have avgD > camSide and must stay behind the fuselage — skip them. */
  if (_wbGeo && !wingView && camSide > 0) {
    for (const f of faces) {
      if (f.draw || (f.fc !== 1 && f.fc !== 9)) continue;
      if (f.avgD >= camSide) continue;
      const { ps, br, col, grad, spec } = f;
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
  }

  /* Cowl air intake — black oval at the spinner face plane */
  if (isPP && _ppGeo?.cabinVerts?.intakeCtr != null) {
    const cv = _ppGeo.cabinVerts;
    const pCtr = pts[cv.intakeCtr], pPY = pts[cv.intakeCtr + 1], pPZ = pts[cv.intakeCtr + 2];
    if (pCtr && pPY && pPZ) {
      faces.push({ avgD: pCtr.d, draw: () => {
        const dyx = pPY.x - pCtr.x, dyy = pPY.y - pCtr.y;
        const dzx = pPZ.x - pCtr.x, dzy = pPZ.y - pCtr.y;
        ctx.save(); ctx.beginPath();
        for (let i = 0; i <= 32; i++) {
          const θ = i * Math.PI * 2 / 32;
          const px = pCtr.x + dyx * Math.cos(θ) + dzx * Math.sin(θ);
          const py = pCtr.y + dyy * Math.cos(θ) + dzy * Math.sin(θ);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(10,12,16,0.97)'; ctx.fill();
        ctx.restore();
      }});
    }
  }

  /* Prop — static blades (engine off) or blur disk (engine running).
     Hub/tip/ztip anchors come from the geometry module. */
  const _propAnchors = _reg?.prop ?? _ppGeo?.prop ?? null;
  if (_propAnchors) {
    const p0    = pts[_propAnchors.hub];
    const pTip  = pts[_propAnchors.tip];
    const pZtip = _propAnchors.ztip != null ? pts[_propAnchors.ztip] : null;
    if (p0 && pTip) {
      const r = Math.hypot(pTip.x - p0.x, pTip.y - p0.y);
      if (r > 2) {
        const ePow    = S.enginePower ?? 0;
        const running = S.engineState === 'running' || S.engineState === 'starting';
        const blur    = running && ePow >= 0.3;

        // Y and Z axes of the prop disk in screen space, scaled by r
        const dyx = pTip.x - p0.x, dyy = pTip.y - p0.y;
        const dzx = pZtip ? pZtip.x - p0.x : -dyy;
        const dzy = pZtip ? pZtip.y - p0.y :  dyx;

        ctx.save();
        if (blur) {
          ctx.fillStyle   = 'rgba(200,210,220,0.22)';
          ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(200,215,225,0.70)';
          ctx.lineWidth   = Math.max(1, devicePixelRatio);
          ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2); ctx.stroke();
        } else if (!isPP) {
          // PP blades are 3D geometry in V_/F_ — skip canvas drawing; only non-PP gets 2D blades + cap
          const nBlades  = S.aircraft?.propplane?.nBlades ?? 2;
          const _ppSpec  = S.aircraft?.propplane;
          const hubFrac  = (_ppSpec?.spinner?.radius && _ppSpec?.propDiskRadius)
            ? _ppSpec.spinner.radius / _ppSpec.propDiskRadius : 0.13;
          const inset    = hubFrac * 0.8;
          ctx.fillStyle   = 'rgba(45,47,52,0.95)';
          ctx.strokeStyle = 'rgba(25,27,30,0.85)';
          ctx.lineWidth   = Math.max(0.8, devicePixelRatio * 0.7);
          for (let i = 0; i < nBlades; i++) {
            const θ    = _propAngle + i * Math.PI * 2 / nBlades;
            const cosθ = Math.cos(θ), sinθ = Math.sin(θ);
            const tx   = p0.x + dyx * cosθ + dzx * sinθ;
            const ty   = p0.y + dyy * cosθ + dzy * sinθ;
            const ix   = p0.x - (dyx * cosθ + dzx * sinθ) * inset;
            const iy   = p0.y - (dyy * cosθ + dzy * sinθ) * inset;
            const cpx  = -dyx * sinθ + dzx * cosθ;
            const cpy  = -dyy * sinθ + dzy * cosθ;
            const cl   = Math.hypot(cpx, cpy) || 1;
            const cux  = cpx / cl, cuy = cpy / cl;
            const rw   = r * 0.09, tw = r * 0.04;
            ctx.beginPath();
            ctx.moveTo(ix + cux * rw, iy + cuy * rw);
            ctx.lineTo(tx + cux * tw, ty + cuy * tw);
            ctx.lineTo(tx - cux * tw, ty - cuy * tw);
            ctx.lineTo(ix - cux * rw, iy - cuy * rw);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          const hubPx = r * hubFrac;
          ctx.beginPath(); ctx.arc(p0.x, p0.y, hubPx, 0, Math.PI * 2);
          ctx.fillStyle   = 'rgba(215,218,222,0.97)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(130,138,150,0.85)';
          ctx.lineWidth   = Math.max(0.8, devicePixelRatio * 0.6);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* Rear window vertex debug labels */
  if (isPP && _ppGeo?.cabinVerts?.rwR != null) {
    const rw = _ppGeo.cabinVerts.rwR;
    const _rwLabels = [[rw,'r0TL'],[rw+1,'r1TR'],[rw+2,'r2BL'],[rw+3,'r3BR'],[rw+4,'r4TC'],[rw+5,'r5BC']];
    const lfs2 = Math.round(8 * devicePixelRatio);
    ctx.save();
    ctx.font = `bold ${lfs2}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [vi, label] of _rwLabels) {
      const p = pts[vi]; if (!p) continue;
      const tw = label.length * lfs2 * 0.62;
      ctx.fillStyle = 'rgba(0,0,0,0.80)';
      ctx.fillRect(p.x - tw*0.5, p.y - lfs2*0.7, tw, lfs2*1.4);
      ctx.fillStyle = 'rgba(255,220,80,1)';
      ctx.fillText(label, p.x, p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5*devicePixelRatio, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,80,40,1)'; ctx.fill();
    }
    ctx.restore();
  }

  /* Windshield vertex debug labels */
  if (isPP && _ppGeo?.cabinVerts?.wsBL != null) {
    const bL = _ppGeo.cabinVerts.wsBL;
    const _wsLabels = [[bL,'BL'],[bL+1,'BR'],[bL+2,'TR'],[bL+3,'TL'],[bL+4,'IBL'],[bL+5,'IBR']];
    const lfs = Math.round(8 * devicePixelRatio);
    ctx.save();
    ctx.font = `bold ${lfs}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [vi, label] of _wsLabels) {
      const p = pts[vi]; if (!p) continue;
      const tw = label.length * lfs * 0.62;
      ctx.fillStyle = 'rgba(0,0,0,0.80)';
      ctx.fillRect(p.x - tw*0.5, p.y - lfs*0.7, tw, lfs*1.4);
      ctx.fillStyle = 'rgba(80,220,255,1)';
      ctx.fillText(label, p.x, p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5*devicePixelRatio, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,80,40,1)'; ctx.fill();
    }
    ctx.restore();
  }

  /* PP aircraft: cabin structural edges — windshield, pillars, roofline, windows, door detail */
  if (isPP && _ppGeo) {
    const cv = _ppGeo.cabinVerts;
    const firstCabin = cv?.wsBL;
    if (firstCabin != null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.90)';
      ctx.lineWidth = Math.max(1.4, devicePixelRatio * 1.2);
      ctx.beginPath();
      const V0 = _ppGeo.V_;
      for (const [ea, eb] of _ppGeo.E_) {
        if (ea < firstCabin && eb < firstCabin) continue;
        const pa = pts[ea], pb = pts[eb];
        if (!pa || !pb) continue;
        // Back-face cull: skip edges on the side facing away from camera
        const avgY = (V0[ea][1] + V0[eb][1]) * 0.5;
        if (avgY < -0.000001 && camSide > 0) continue;
        if (avgY >  0.000001 && camSide < 0) continue;
        ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /* Turbofan fan face — wide-body (WB) aircraft only */
  if (!isC172 && !isPP && !isF9 && !isSS && !isBf109 && !isF4U && !isMig15 && !isSV) {
    const ePow = (S.engineState === 'off' || S.engineState === 'shutdown') ? 0 : (S.enginePower ?? 0);
    {   // always draw the inlet — static blades when off (ePow 0), spinning when running
      /* Draw one engine inlet: dark bore + black strip + recessed fan (fitted to
         the fan-plane ring's projected ellipse, so it sets back into the inlet and
         foreshortens off-axis) + front lip ring. Shared by the inner pair and the
         A340 outer pair. Gating per engine: hub.d < fan.d → intake faces us;
         hub.d < fusCenter → not behind the body; _cpCamF > 0.35 → camera has a
         forward component (not a pure side view). */
      const _drawEngineInlet = (lipHub, lipR, fanRing, fanScale) => {
        if (!lipHub || lipR < 3) return;
        /* One foreshorten ellipse for the whole inlet, taken from the fan-plane
           ring: fs = minor/major (1 head-on → ~0 edge-on), ang = major axis.
           The lip ring, black strip, dark bore and fan all share it so the inlet
           reads as a single oval from the side rather than a circle + ellipse. */
        const e   = fanRing.length >= 4 ? _fanEllipse(fanRing) : null;
        const fs  = e ? Math.max(0.04, e.minorR / e.majorR) : 1;
        const ang = e ? e.angle : 0;
        const rim = { x: lipHub.x, y: lipHub.y - lipR };
        /* dark inlet bore — foreshortened disc at the lip */
        ctx.save();
        ctx.translate(lipHub.x, lipHub.y); ctx.rotate(ang); ctx.scale(1, fs);
        ctx.fillStyle = COL_[4]; ctx.globalAlpha = 0.32;
        ctx.beginPath(); ctx.arc(0, 0, lipR * 0.82, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        _drawIntakeBlackStrip(ctx, lipHub, rim, dpr, fs, ang);
        /* Fan blades only when looking into the intake — hidden edge-on/side-on
           (you can't see down a turbofan inlet from abeam). */
        if (e && fs >= 0.25) {
          const maj = e.majorR * fanScale;
          if (maj > 3) _drawTurbofanFace(ctx, { x: e.cx, y: e.cy },
            { x: e.cx + maj, y: e.cy }, ePow, dpr, 22, fs, ang);
        }
        _drawIntakeLip(ctx, lipHub, rim, dpr, fs, ang);
      };
      /* Mean screen radius from a hub to ring vertices (all same x → same depth). */
      const _ringRad = (hub, idxs) => {
        const rs = idxs.map(i => pts[_b+i]).filter(Boolean)
          .map(p => Math.hypot(p.x - hub.x, p.y - hub.y));
        return rs.length ? rs.reduce((a, b) => a + b) / rs.length : 0;
      };
      /* Project 8 points around a circle in the y-z plane (engine disc face). */
      const _projRing = (x, yc, zc, rad) => {
        const ring = [];
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2;
          const p = project([x, yc + Math.cos(a) * rad, zc + Math.sin(a) * rad]);
          if (p) ring.push(p); }
        return ring;
      };

      const _eXpos  = _wbGeo?.eApos ?? (0.005 + (_wbGeo?.exOff ?? 0));
      const _fusCtr = project([_eXpos, 0, 0]);
      const _fusCullD = _fusCtr ? _fusCtr.d + 0.0005 : Infinity;

      /* Inner engines — geometry carries explicit intake (eA) + fan (eB) rings.
         Fan ring is the fan cowl (≈1.2× bore), so scale 0.83 → bore-sized fan. */
      const _rHub = pts[_b+158], _rFan = pts[_b+28];
      const _lHub = pts[_b+159], _lFan = pts[_b+68];
      if (_rHub && _rFan && _rHub.d < _rFan.d && _rHub.d < _fusCullD && _cpCamF > 0.10)
        _drawEngineInlet(_rHub, _ringRad(_rHub, [20,21,22,23,24,25,26,27]),
          [28,29,30,31,32,33,34,35].map(i=>pts[_b+i]).filter(Boolean), 0.83);
      if (_lHub && _lFan && _lHub.d < _lFan.d && _lHub.d < _fusCullD && _cpCamF > 0.10)
        _drawEngineInlet(_lHub, _ringRad(_lHub, [60,61,62,63,64,65,66,67]),
          [68,69,70,71,72,73,74,75].map(i=>pts[_b+i]).filter(Boolean), 0.83);

      /* Outer engines (A340) — no ring vertices; project the lip hub/rim and a
         fan-plane ring (radius _er2 = bore) at the same nacelle position. */
      const _ey2 = _wbGeo?.ey2;
      if (_ey2) {
        const _ez2 = _oEzForOuter, _er2 = _wbGeo.er ?? _er, _ex2 = _oXOffForOuter;
        const _outerInlet = (ySign) => {
          const lipHub = project([0.005 + _ex2, ySign * _ey2, _ez2]);
          const lipRim = project([0.005 + _ex2, ySign * _ey2, _ez2 + _er2]);
          const fanHub = project([0.001 + _ex2, ySign * _ey2, _ez2]);
          if (!lipHub || !lipRim || !fanHub) return;
          if (!(lipHub.d < fanHub.d && lipHub.d < _fusCullD && _cpCamF > 0.10)) return;
          _drawEngineInlet(lipHub, Math.hypot(lipRim.x - lipHub.x, lipRim.y - lipHub.y),
            _projRing(0.001 + _ex2, ySign * _ey2, _ez2, _er2), 0.82);
        };
        _outerInlet(+1); _outerInlet(-1);
      }
    }
  }

  /* MiG-15 intake — centrifugal compressor disk (10 impeller vanes) + splitter vane */
  if (isMig15) {
    const ePow = S.engineState === 'off' || S.engineState === 'shutdown'
                 ? 0 : (S.enginePower ?? 0);
    const pHub = project([0.013, 0, 0]);   // centre of intake ring plane
    const pRim = pts[0];                    // ring A vertex 0 — sets disc radius
    /* Draw only when intake faces camera: noseTip closer than intake ring vertex */
    if (pHub && pRim && pts[96] && pts[96].d < pts[0].d) {
      _drawTurbofanFace(ctx, pHub, pRim, ePow, dpr, 10);
      /* Splitter vane — vertical diameter across intake face */
      const pTop = project([0.013, 0,  _m15ir]);
      const pBot = project([0.013, 0, -_m15ir]);
      if (pTop && pBot) {
        ctx.save();
        ctx.strokeStyle = 'rgba(155,168,182,0.80)';
        ctx.lineWidth   = Math.max(1, dpr * 0.8);
        ctx.beginPath(); ctx.moveTo(pTop.x, pTop.y); ctx.lineTo(pBot.x, pBot.y); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* S2 Merlin Vacuum nozzle glow — after stage separation */
  if (isF9 && rStage >= 2) {
    const pNvac  = pts[138];
    const pEvac  = pts[130];
    if (pNvac && pEvac) {
      const bellR = Math.hypot(pEvac.x - pNvac.x, pEvac.y - pNvac.y);
      const firing = !S.rocketCoast && !S.rocketSECO;
      ctx.save();
      ctx.fillStyle = 'rgba(16,18,24,0.96)';
      ctx.beginPath(); ctx.arc(pNvac.x, pNvac.y, bellR * 1.15, 0, Math.PI * 2); ctx.fill();
      const nR = bellR * 0.9;
      const grad = ctx.createRadialGradient(pNvac.x, pNvac.y, 0, pNvac.x, pNvac.y, nR);
      if (firing) {
        grad.addColorStop(0,   'rgba(255,220,130,0.95)');
        grad.addColorStop(0.4, 'rgba(200,140, 60,0.60)');
        grad.addColorStop(1,   'rgba( 35, 35, 42,0.95)');
      } else {
        grad.addColorStop(0,   'rgba(60,65,80,0.90)');
        grad.addColorStop(1,   'rgba(22,24,30,0.95)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(pNvac.x, pNvac.y, nR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(130,142,160,0.70)';
      ctx.lineWidth = Math.max(0.8, devicePixelRatio);
      ctx.beginPath(); ctx.arc(pNvac.x, pNvac.y, bellR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  /* Engine nozzle cluster — Falcon 9 Stage 1: 9× Merlin (RP-1/LOX) */
  if (isF9 && rStage < 2) {
    const merlinOn = pastIgnition && !(S.rocketCoast ?? false) && !S.rocketMECO;
    const _mCenters = [
      [0, 0],
      [_nzO, 0], [_nzO7, _nzO7], [0, _nzO], [-_nzO7, _nzO7],
      [-_nzO, 0], [-_nzO7, -_nzO7], [0, -_nzO], [_nzO7, -_nzO7],
    ];
    _drawJ2Nozzles(-0.016, _rf9, _mCenters, merlinOn, 'rp1');
  }

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

  /* Booster wireframe edges + dark nozzles after stage separation */
  if (bPts) {
    ctx.save();
    ctx.strokeStyle = 'rgba(175,195,215,0.55)';
    ctx.lineWidth   = Math.max(1, devicePixelRatio);
    ctx.beginPath();
    for (const [a, b] of _E_f9) {
      const inB = v => v <= 47 || (v >= 97 && v <= 121);
      if (!inB(a) || !inB(b)) continue;
      const pa = bPts[a], pb = bPts[b];
      if (!pa || !pb) continue;
      if (edgeCamDir(a) > 0 && edgeCamDir(b) > 0) continue;
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke(); ctx.restore();

    /* Booster plume when powered (boostback / entry burn / landing burn) */
    const boosterFiring = ['boostback','entry','landing'].includes(S.booster?.phase);
    if (boosterFiring) {
      const bpN = bPts[113];
      const bpEdge = bPts[114];
      const boostNozzleWorld = (() => {
        const vF = -0.018, vR = 0, vU = 0;
        const rvF = vF * cosdP - vU * sindP;
        const rvU = vF * sindP + vU * cosdP;
        return project([rvF + bOffF, vR + bOffR, rvU + bOffU]);
      })();
      const boostPlumeTip = (() => {
        const vF = -0.018 - 0.025, vR = 0, vU = 0;
        const rvF = vF * cosdP - vU * sindP;
        const rvU = vF * sindP + vU * cosdP;
        return project([rvF + bOffF, vR + bOffR, rvU + bOffU]);
      })();
      if (boostNozzleWorld && boostPlumeTip) {
        const dx = boostPlumeTip.x - boostNozzleWorld.x;
        const dy = boostPlumeTip.y - boostNozzleWorld.y;
        const len = Math.hypot(dx, dy);
        if (len > 2) {
          const px = -dy/len, py = dx/len;
          const nozR2 = bpN && bpEdge
            ? Math.hypot(bpEdge.x-bpN.x, bpEdge.y-bpN.y) * 2.8
            : 7 * devicePixelRatio;
          ctx.save();
          const g2 = ctx.createLinearGradient(
            boostNozzleWorld.x, boostNozzleWorld.y, boostPlumeTip.x, boostPlumeTip.y);
          g2.addColorStop(0,    'rgba(255,240,160,0.75)');
          g2.addColorStop(0.10, 'rgba(255,165, 60,0.55)');
          g2.addColorStop(0.35, 'rgba(200, 70, 15,0.28)');
          g2.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
          ctx.fillStyle = g2;
          const mx2 = (boostNozzleWorld.x+boostPlumeTip.x)/2;
          const my2 = (boostNozzleWorld.y+boostPlumeTip.y)/2;
          ctx.beginPath();
          ctx.moveTo(boostNozzleWorld.x+px*nozR2, boostNozzleWorld.y+py*nozR2);
          ctx.quadraticCurveTo(mx2+px*nozR2*2, my2+py*nozR2*2,
                               boostPlumeTip.x+px*nozR2*3.5, boostPlumeTip.y+py*nozR2*3.5);
          ctx.lineTo(boostPlumeTip.x-px*nozR2*3.5, boostPlumeTip.y-py*nozR2*3.5);
          ctx.quadraticCurveTo(mx2-px*nozR2*2, my2-py*nozR2*2,
                               boostNozzleWorld.x-px*nozR2, boostNozzleWorld.y-py*nozR2);
          ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
    }

    const bC = bPts[113], bEdge = bPts[114];
    if (bC && bEdge) {
      const nR = Math.hypot(bEdge.x-bC.x, bEdge.y-bC.y) * 0.46;
      ctx.save();
      ctx.fillStyle = 'rgba(20,22,28,0.95)';
      ctx.beginPath();
      ctx.arc(bC.x, bC.y, Math.hypot(bEdge.x-bC.x, bEdge.y-bC.y) + nR*1.2, 0, Math.PI*2);
      ctx.fill();
      for (const vi of [113,114,115,116,117,118,119,120,121]) {
        const pt = bPts[vi]; if (!pt) continue;
        const r = vi === 65 ? nR*1.15 : nR;
        ctx.fillStyle = 'rgb(22,25,32)';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(90,100,115,0.65)';
        ctx.lineWidth = Math.max(0.5, 0.6*devicePixelRatio);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }

    /* Landing legs — deploy during 'landing' phase */
    const bLegP = S.booster?.phase === 'landing'
      ? Math.min(1, ((S.time ?? 0) - (S.booster?.phaseStartT ?? 0)) / 5)
      : 0;
    if (bLegP > 0.001) {
      const footXStow = -0.015, footRStow = 0.0024;
      const footXDep  = -0.022, footRDep  = 0.0070;
      const fX   = footXStow + (footXDep - footXStow) * bLegP;
      const fRad = footRStow + (footRDep - footRStow) * bLegP;
      const strutRad = _nzO * 1.8;
      ctx.save();
      ctx.strokeStyle = 'rgba(190,205,220,0.78)';
      ctx.lineWidth = Math.max(1, devicePixelRatio);
      ctx.beginPath();
      for (const [nR2, nU2] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const bxf = (vF, vRv, vUv) => {
          const rvF = vF * cosdP - vUv * sindP;
          const rvU = vF * sindP + vUv * cosdP;
          return project([rvF + bOffF, vRv + bOffR, rvU + bOffU]);
        };
        const pShoulder = bxf(-0.016, nR2 * _rf9,   nU2 * _rf9);
        const pFoot     = bxf(fX,     nR2 * fRad,   nU2 * fRad);
        const pStrut    = bxf(-0.018, nR2 * strutRad, nU2 * strutRad);
        if (pShoulder && pFoot) { ctx.moveTo(pShoulder.x, pShoulder.y); ctx.lineTo(pFoot.x, pFoot.y); }
        if (pStrut    && pFoot) { ctx.moveTo(pStrut.x,    pStrut.y);    ctx.lineTo(pFoot.x, pFoot.y); }
      }
      ctx.stroke(); ctx.restore();
    }
  }


  /* Passenger windows + door outlines — wide-body only, properly perspective-projected */
  if (!isF9 && !isSV && !isSS && !isC172 && !isPP && !isBf109 && !isF4U && !isMig15) {
    const _fr = _wbGeo?.r ?? _r;
    /* Wing occlusion (no depth buffer): the windows/doors are a post-painter pass, so
       the near wing can't hide the fuselage rows behind it. Collect the visible
       (front-facing) wing-surface polygons (col 1) once; _quad3d then skips any decal
       whose centre falls behind a closer wing face. */
    const _ptInPoly = (px, py, ps) => {
      let inside = false;
      for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
        const yi = ps[i].y, yj = ps[j].y;
        if ((yi > py) !== (yj > py) &&
            px < (ps[j].x - ps[i].x) * (py - yi) / (yj - yi) + ps[i].x) inside = !inside;
      }
      return inside;
    };
    const _wingOcc = [];
    for (let i = 0; i < F_.length; i++) {
      if (FC_[i] !== 1) continue;                       // wing surfaces only
      const wp = F_[i].map(vi => pts[vi]);
      if (wp.some(p => !p)) continue;
      const cr = (wp[1].x - wp[0].x) * (wp[2].y - wp[0].y) - (wp[1].y - wp[0].y) * (wp[2].x - wp[0].x);
      if (cr < 0) continue;                             // back-facing → not drawn → can't occlude
      _wingOcc.push({ ps: wp, d: wp.reduce((s, p) => s + p.d, 0) / wp.length });
    }
    /* Draw a quad from 4 body-space corners. Cull unless the decal's outward
       radial normal faces the camera: push the centre outward along the body
       radius and require it to come closer. This hides the far-side rows AND
       the near-edge-on rows in a head-on/axial view, where the round fuselage
       occludes them. */
    const _quad3d = (x, y, z, hw, hh, fill, stroke, round = false, rFrac = 0.30) => {
      const pw = project([x, y, z]);
      if (!pw) return;
      const rn  = Math.hypot(y, z) || 1;
      const eps = _fr * 0.6;
      const po  = project([x, y + (y / rn) * eps, z + (z / rn) * eps]);
      /* Require the outward point to come meaningfully closer (normal faces the
         camera by a margin); edge-on rows in a head-on view are culled. */
      if (!po || po.d > pw.d - eps * 0.35) return;
      /* Behind the near wing? A closer wing face covering the centre hides this decal. */
      for (const wo of _wingOcc) if (wo.d < pw.d - _fr * 0.15 && _ptInPoly(pw.x, pw.y, wo.ps)) return;
      const p0 = project([x + hw, y, z + hh]);
      const p1 = project([x - hw, y, z + hh]);
      const p2 = project([x - hw, y, z - hh]);
      const p3 = project([x + hw, y, z - hh]);
      if (!p0 || !p1 || !p2 || !p3) return;
      if (round && ctx.roundRect) {
        const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
        const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
        /* Use edge midpoints so orientation is stable across all camera azimuths.
           sw = fore-aft screen extent, sh = up-down screen extent.
           angle derived from Z-axis projection (always portrait, never flips). */
        const topCx = (p0.x+p1.x)*0.5, topCy = (p0.y+p1.y)*0.5;
        const botCx = (p2.x+p3.x)*0.5, botCy = (p2.y+p3.y)*0.5;
        const fwdCx = (p0.x+p3.x)*0.5, fwdCy = (p0.y+p3.y)*0.5;
        const aftCx = (p1.x+p2.x)*0.5, aftCy = (p1.y+p2.y)*0.5;
        const sh = Math.hypot(topCx-botCx, topCy-botCy);
        const sw = Math.hypot(fwdCx-aftCx, fwdCy-aftCy);
        const angle = Math.atan2(topCy - botCy, topCx - botCx) + Math.PI * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.roundRect(-sw / 2, -sh / 2, sw, sh, Math.min(sw, sh) * rFrac);
        if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
      }
    };

    ctx.save();
    ctx.lineWidth = Math.max(0.75, devicePixelRatio * 0.75);

    /* Use per-aircraft fuselage radius so narrow-body windows sit on the body surface */
    const _wbR = _wbGeo?.r ?? _r;

    /* Cheatline — coloured band(s) along the window line that sweep up toward the
       tail (Singapore Airlines style). Tiled strips on both sides so the band hugs
       the fuselage; drawn before the windows so the glazing sits on top of it.
         cheatline.lines[] : { z (band centre), h (half-height), col }
         fromX→toX along the fuselage; aft of sweepFromX the band rises by sweepRise. */
    const _chl = S.aircraft?.cheatline;
    if (_chl?.lines?.length) {
      const _cF = _chl.fromX, _cT = _chl.toX;
      const _cSwF = _chl.sweepFromX ?? _cT;
      const _cSwA = (_chl.sweepAngle ?? 70) * Math.PI / 180;   // angle swept up the side at the tail
      const _cN  = Math.max(12, Math.round(Math.abs(_cF - _cT) / (_wbR * 0.20)));
      const _cDx = (_cF - _cT) / _cN;
      for (const _ln of _chl.lines) {
        /* Base angle on the cross-section so the straight run sits at the line's z;
           aft of sweepFromX the band climbs the rounded side (y shrinks as z rises). */
        const _a0 = Math.asin(Math.max(-0.99, Math.min(0.99, _ln.z / _wbR)));
        for (let i = 0; i < _cN; i++) {
          const _cx = _cF - (i + 0.5) * _cDx;
          const _t  = _cx < _cSwF ? (_cSwF - _cx) / (_cSwF - _cT) : 0;
          const _a  = _a0 + _cSwA * _t;
          const _cy = _wbR * Math.cos(_a), _cz = _wbR * Math.sin(_a);
          _quad3d(_cx,  _cy, _cz, _cDx * 0.55, _ln.h, _ln.col, null, false);
          _quad3d(_cx, -_cy, _cz, _cDx * 0.55, _ln.h, _ln.col, null, false);
        }
      }
    }

    /* Window row — count and range from aircraft JSON when available */
    const hw = _wbR * 0.088;
    const hh = _wbR * 0.128;
    const wZ = _wbR * 0.05;
    const wFill   = 'rgba(48,72,110,0.88)';
    const wStroke = 'rgba(110,140,175,0.50)';
    const _nCabW = S.aircraft?.cabinWindows;
    const nW  = _nCabW ? Math.round(_nCabW / 2) : 12;
    /* Window row begins just aft of the forward door (forward-most door entry),
       so the cabin windows start right after it rather than leaving a gap. */
    const _doorXsW  = S.aircraft?.doors;
    const _fwdDoorX = _doorXsW?.length ? Math.max(..._doorXsW) : null;
    const xA  = _fwdDoorX != null ? _fwdDoorX - _wbR * 0.33
              : (_nCabW ? 0.008 : 0.011);
    /* Window pitch can be anchored to a reference: "windowsToEngineLip" gives the
       number of windows counted from the first window (just aft of the fwd door)
       to the engine inlet lip (x == wing.rootLE). That fixes a realistic pitch
       instead of a guessed aft end. */
    const _winToLip = S.aircraft?.windowsToEngineLip;
    const _engLipX  = S.aircraft?.wing?.rootLE;
    const _winEndX = S.aircraft?.windowEndX ?? (_nCabW ? -0.025 : -0.008);
    /* DWG anchor: N windows between door 1 and door 2 → pitch = doorGap/(N+1). */
    const _wbd = S.aircraft?.dimensions?.windowsBetweenDoor1and2;
    const _wPitch = (_wbd > 0 && _doorXsW?.length >= 2)
      ? Math.abs(_doorXsW[0] - _doorXsW[1]) / (_wbd + 1)
      : (_winToLip > 1 && _engLipX != null && _fwdDoorX != null)
        ? (xA - _engLipX) / (_winToLip - 1)
        : (nW > 1 ? (xA - _winEndX) / (nW - 1) : 0);
    /* Extra spacing over the wing box: "windowGaps" lists 1-based window numbers
       after which an additional gap (windowGapSize, in pitch units) is inserted,
       shifting every following window aft — this reproduces the 737's uneven
       spacing at the centre-section frames (e.g. after windows 14 and 15). */
    const _wGaps  = S.aircraft?.windowGaps;
    const _wGapSz = S.aircraft?.windowGapSize ?? 1;
    const winXs = [];
    for (let i = 0, _acc = 0; i < nW; i++) {
      if (_wGaps?.includes(i)) _acc += _wPitch * _wGapSz;  // gap after window i (1-based)
      winXs.push(nW > 1 ? xA - _wPitch * i - _acc : xA - _wPitch / 2);
    }
    /* Skip any window the doors would cover: a window is hidden when its glass
       overlaps a door in x (door half-width dhw=_wbR*0.190 + window half-width hw).
       winXs keeps all entries (overwing-exit indices stay valid) — we just don't
       draw the covered ones, reproducing the real frame-for-door substitution. */
    const _winDoorClear = _wbR * 0.190 + hw;
    const _winUnderDoor = wx => _doorXsW?.some(dx => Math.abs(wx - dx) < _winDoorClear);
    for (let i = 0; i < nW; i++) {
      if (_winUnderDoor(winXs[i])) continue;
      _quad3d(winXs[i],  _wbR, wZ, hw, hh, wFill, wStroke, true);
      _quad3d(winXs[i], -_wbR, wZ, hw, hh, wFill, wStroke, true);
    }

    /* Doors — positions from aircraft JSON or default pairs. Each door: black
       border, silver inner outline, a small window in the upper part, and a
       handle at mid-height. */
    const _doorXs3 = S.aircraft?.doors ?? [0.009, -0.006];
    const dhw = _wbR * 0.190;
    const dhh = _wbR * 0.360;
    const dZ  = _wbR * 0.08;
    const _dBlk    = 'rgba(16,20,26,0.90)';     // outer black border
    const _dSilver = 'rgba(198,204,213,0.80)';  // inner silver outline
    const _dGlass  = 'rgba(38,54,80,0.88)';     // door-window glass
    const _dHandle = 'rgba(70,76,88,0.95)';     // handle
    for (const dx of _doorXs3) {
      for (const yS of [_wbR, -_wbR]) {
        _quad3d(dx, yS, dZ,              dhw,        dhh,        null,    _dBlk,    true);  // black border
        _quad3d(dx, yS, dZ,              dhw * 0.84, dhh * 0.90, null,    _dSilver, true);  // silver inner
        _quad3d(dx, yS, dZ + dhh * 0.50, dhw * 0.34, dhw * 0.34, _dGlass, _dSilver, true, 0.5); // upper circular window
        _quad3d(dx, yS, dZ,              dhw * 0.34, dhh * 0.05, _dHandle, null,     true);       // mid handle
      }
    }

    /* Overwing emergency exits — rounded near-black frame around specific cabin
       windows, given by 1-based window index in the JSON ("overwingExits":
       [19, 20]). Drawn on both sides; N entries = N exits per side. */
    const _owExits = S.aircraft?.overwingExits;
    if (_owExits) {
      const ohw = hw * 1.18, ohh = hh * 1.55;
      const oStroke = 'rgba(14,16,22,0.92)';
      for (const wi of _owExits) {
        const ox = winXs[wi - 1] ?? winXs[0];
        _quad3d(ox,  _wbR, wZ, ohw, ohh, null, oStroke, true);
        _quad3d(ox, -_wbR, wZ, ohw, ohh, null, oStroke, true);
      }
    }

    ctx.restore();
  }

  /* Aircraft lights — WB tip positions derived from wing geometry */
  const _lightList = isC172 ? (S.masterBat ? _LIGHTS_c172 : null)
    : isPP ? (S.masterBat ? (_ppGeo?.LIGHTS_ ?? null) : null)
    : (!isF9 && !isSS && !isBf109 && !isF4U && !isMig15 && !isSV) ? (() => {
        if (!_wbGeo) return _LIGHTS_wb;
        const _lwg = S.aircraft?.wing ?? _WB_WING_DEFAULT;
        const _ltY = _lwg.span;
        /* tip-light height tracks the winglet type (0 for raked/none, so the lights
           sit on the bare wingtip instead of floating where a winglet would be) */
        const _wlHt = ({ classic: 0.0030, sharklet: 0.0065, blended: 0.0055, raked: 0.0015, none: 0 })[S.aircraft?.winglet ?? 'classic'] ?? 0.0030;
        const _ltZ = _lwg.dihedral + _wlHt;
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

  /* ── Launch pad — MLP box + LUT lattice tower (LC-39A) ─────────── */
  if (isSV || isF9) {
    const riseNm  = _svRise;
  if (riseNm < 0.150) {
    const padAlpha = Math.min(1, Math.max(0, (0.150 - riseNm) / 0.100));
    const _r      = isSV ? 0.0028 : 0.0020;
    const _vFbase = isSV ? -0.030 : -0.016;
    const _vFtop  = isSV ?  0.038 :  0.024;
    /* tvF0: MLP top in body-frame. As rocket rises by riseNm, MLP slides down
       by the same amount — keeping it world-anchored to the pad elevation. */
    const tvF0    = _vFbase - riseNm;

    /* Orbit: camera rotates around the rocket's longitudinal axis.
       Applied to pad geometry (which has no body roll) so it moves with
       the rocket body when the user drags to orbit.                     */
    const cosO = Math.cos(orbitAzDeg * DEG), sinO = Math.sin(orbitAzDeg * DEG);

    /* Pitch-only project: tower is fixed in world space, doesn't roll with rocket.
       Orbit rotation applied to vR/vU so pad tracks camera just like the body. */
    const pw = ([vF, vR_, vU_]) => {
      const vR2 = vR_ * cosO - vU_ * sinO;
      const vU2 = vR_ * sinO + vU_ * cosO;
      let   fP  = vF * cosP - vU2 * sinP;
      let   uR  = vF * sinP + vU2 * cosP;
      let   vR3 = vR2;
      if (orbitElDeg !== 0) {
        const vR4 = vR3 * cosEl + uR * sinEl;
        uR  = -vR3 * sinEl + uR * cosEl;
        vR3 = vR4;
      }
      const cfW = camSide > 0 ? camSide - vR3 : camBack + fP;
      const crW = camSide > 0 ? fP : vR3;
      const cuW = uR - camUp;
      const cf  = cfW * cosCP + cuW * sinCP;
      const cu  = cuW * cosCP - cfW * sinCP;
      if (cf < 0.002) return null;
      return { x: cx + crW / cf * focal, y: cy - cu / cf * focal, d: cfW };
    };

    const _drawPadSegs = (segs, color, lw) => {
      ctx.save();
      ctx.globalAlpha = padAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.beginPath();
      for (const [a, b] of segs) {
        const pa = pw(a), pb = pw(b);
        if (!pa || !pb) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.restore();
    };

    /* MLP (Mobile Launcher Platform) — two solid slabs with flame trench between.
       Real LC-39A MLP: ~160ft × 135ft footprint, ~43ft tall.
       mlpSvR is the half-depth in the vR (camera depth) axis.                    */
    const mlpH      = isSV ? 0.0070 : 0.0045;  // ~43ft SV / ~27ft F9
    const mlpSvU    = _r * 4.8;    // +vU extent (away from LUT)
    const mlpSvUlut = _r * 13.0;   // -vU extent (toward LUT, covers wider tapered base)
    const mlpSvR    = isSV ? _r * 4.0 : _r * 3.0;  // half-depth front-to-back (~68ft SV)
    const mlpT = tvF0, mlpB = tvF0 - mlpH;

    /* Flame trench: rectangular gap centred on the rocket, running vU direction.
       Width ≈ 4.4r  ≈ 12.3 m — matches LC-39A trench opening.                   */
    const trenchH = isSV ? _r * 2.2 : _r * 1.6;   // half-width in vU

    const _drawMlpSlice = (vUlo, vUhi) => {
      const mc = [
        [mlpT,-mlpSvR,vUlo],[mlpT,+mlpSvR,vUlo],[mlpT,+mlpSvR,vUhi],[mlpT,-mlpSvR,vUhi],
        [mlpB,-mlpSvR,vUlo],[mlpB,+mlpSvR,vUlo],[mlpB,+mlpSvR,vUhi],[mlpB,-mlpSvR,vUhi],
      ];
      const mcpd = mc.map(pw);
      const mFaces = [
        { idx: [0,3,2,1], col: '#707580' },  // top
        { idx: [7,6,5,4], col: '#1e2230' },  // bottom
        { idx: [0,4,7,3], col: '#404855' },  // -vR side (far)
        { idx: [0,1,5,4], col: '#4a5260' },  // vUlo end
        { idx: [3,7,6,2], col: '#4a5260' },  // vUhi end
        { idx: [1,2,6,5], col: '#5a6270' },  // +vR side (near cam)
      ];
      mFaces.sort((a, b) => {
        const da = a.idx.reduce((s, i) => s + (mcpd[i]?.d ?? 0), 0) / 4;
        const db = b.idx.reduce((s, i) => s + (mcpd[i]?.d ?? 0), 0) / 4;
        return db - da;
      });
      for (const { idx, col } of mFaces) {
        const ps = idx.map(i => mcpd[i]);
        if (ps.some(p => !p)) continue;
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.fillStyle   = col;
        ctx.strokeStyle = 'rgba(130,140,155,0.5)';
        ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    };

    _drawMlpSlice(-mlpSvUlut, -trenchH);   // LUT side
    _drawMlpSlice(+trenchH, +mlpSvU);      // away-from-LUT side

    /* Trench interior — three dark faces that make the hole read as a deep shaft:
       near wall (+vR), far wall (-vR), and floor (mlpB).
       Drawn after the slabs so they overdraw rocket pixels inside the gap.       */
    {
      const _trenchFace = (pts, color) => {
        const ps = pts.map(pw);
        if (!ps.every(Boolean)) return;
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.fillStyle   = color;
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        ps.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      // near wall — camera-facing vertical face at +mlpSvR
      _trenchFace([
        [mlpT, +mlpSvR, -trenchH], [mlpT, +mlpSvR, +trenchH],
        [mlpB, +mlpSvR, +trenchH], [mlpB, +mlpSvR, -trenchH],
      ], '#0c0f18');
      // far wall — back vertical face at -mlpSvR
      _trenchFace([
        [mlpT, -mlpSvR, -trenchH], [mlpT, -mlpSvR, +trenchH],
        [mlpB, -mlpSvR, +trenchH], [mlpB, -mlpSvR, -trenchH],
      ], '#080b15');
      // floor — horizontal face at mlpB (bottom of MLP, inside trench)
      _trenchFace([
        [mlpB, -mlpSvR, -trenchH], [mlpB, +mlpSvR, -trenchH],
        [mlpB, +mlpSvR, +trenchH], [mlpB, -mlpSvR, +trenchH],
      ], '#060810');
    }

    /* Tail Service Arms — 4 tapered lattice towers at fin positions (Saturn V only).
       Each tower is fixed to the MLP. The swing arm at the top releases outward
       as the rocket lifts off.
       Bug guard: riseNm counts from departure.elevation (6ft) but the rocket starts
       at 46ft on top of the MLP — use lift from initial pad altitude instead.      */
    if (isSV) {
      const initialAlt_nm = (S.mission?.initialState?.alt ?? 0) * FT_NM;
      const liftRise  = Math.max(0, alt_nm - initialAlt_nm);
      const swingAng  = Math.min(Math.PI / 2, (liftRise / (_r * 0.6)) * (Math.PI / 2));
      const cosSw = Math.cos(swingAng), sinSw = Math.sin(swingAng);

      const twrH  = _r * 2.6;
      const twrWB = _r * 0.42;
      const twrWT = _r * 0.20;
      const armL  = _r * 1.5;
      const armHW = _r * 0.16;

      /* Solid tapered box section — 4 depth-sorted side faces */
      const _drawTsmSection = (lo, hi, cLo, cHi) => {
        const faces = [
          { k0: 0, k1: 1, col: '#353d48' },   // inner (toward rocket)
          { k0: 2, k1: 3, col: '#505b68' },   // outer
          { k0: 3, k1: 0, col: '#424e5a' },   // -pR side
          { k0: 1, k1: 2, col: '#424e5a' },   // +pR side
        ].map(({ k0, k1, col }) => {
          const pts = [
            pw([lo, cLo[k0][0], cLo[k0][1]]),
            pw([lo, cLo[k1][0], cLo[k1][1]]),
            pw([hi, cHi[k1][0], cHi[k1][1]]),
            pw([hi, cHi[k0][0], cHi[k0][1]]),
          ];
          const d = pts.reduce((s, p) => s + (p?.d ?? 0), 0) / 4;
          return { pts, col, d };
        });
        faces.sort((a, b) => b.d - a.d);
        for (const { pts, col } of faces) {
          if (pts.some(p => !p)) continue;
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = col;
          ctx.strokeStyle = 'rgba(90,105,120,0.35)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      };

      for (const [aR, aU] of [[0,_sv1r],[0,-_sv1r],[_sv1r,0],[-_sv1r,0]]) {
        const mag = Math.hypot(aR, aU) || 1;
        const oR = aR / mag, oU = aU / mag;
        const pR = oU, pU = -oR;
        const cR = aR * 1.55, cU = aU * 1.55;

        const lBot = mlpT, lTop = mlpT + twrH;
        const lMid = (lBot + lTop) * 0.5;

        const corners = (w) => [
          [cR - w * pR - w * oR, cU - w * pU - w * oU],
          [cR + w * pR - w * oR, cU + w * pU - w * oU],
          [cR + w * pR + w * oR, cU + w * pU + w * oU],
          [cR - w * pR + w * oR, cU - w * pU + w * oU],
        ];
        const cB = corners(twrWB), cM = corners((twrWB + twrWT) * 0.5), cT = corners(twrWT);

        _drawTsmSection(lBot, lMid, cB, cM);
        _drawTsmSection(lMid, lTop, cM, cT);

        /* Top cap */
        const topPts = cT.map(c => pw([lTop, c[0], c[1]]));
        if (topPts.every(Boolean)) {
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = '#5a6875';
          ctx.beginPath();
          ctx.moveTo(topPts[0].x, topPts[0].y);
          for (let k = 1; k < topPts.length; k++) ctx.lineTo(topPts[k].x, topPts[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        /* Swing arm — solid quad, pivots outward as rocket lifts */
        const tipF = lTop + armL * cosSw;
        const tipR = cR   + armL * sinSw * oR;
        const tipU = cU   + armL * sinSw * oU;
        const arm = [
          [tipF, tipR - armHW * pR, tipU - armHW * pU],
          [tipF, tipR + armHW * pR, tipU + armHW * pU],
          [lTop, cR   + armHW * pR, cU   + armHW * pU],
          [lTop, cR   - armHW * pR, cU   - armHW * pU],
        ].map(pw);
        if (arm.every(Boolean)) {
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = '#5a6875';
          ctx.strokeStyle = 'rgba(120,140,155,0.4)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(arm[0].x, arm[0].y);
          arm.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* LUT (Launch Umbilical Tower) — rust-orange lattice to rocket's right.
       The tower tapers: base section is wider in both vU and vR, narrowing
       over the bottom two bays to give the A-frame look in the reference photos. */
    const vUi = -_r * 4.5, vUo = -_r * 9.8;   // top dimensions
    const vUiB = -_r * 2.8, vUoB = -_r * 12.5; // base dimensions (wider spread)
    const vRh = _r, vRhB = _r * 1.8;            // base also wider in vR
    const lutTop = tvF0 + (_vFtop - _vFbase) + _r * 2;
    const nLev = 7;
    const lvs = Array.from({ length: nLev }, (_, i) =>
      tvF0 + (i / (nLev - 1)) * (lutTop - tvF0));
    /* Taper: 1.0 at MLP level, 0.0 at lvs[2] and above */
    const _taperAt = lv => Math.max(0, 1 - (lv - tvF0) / (lvs[2] - tvF0));
    const _lc = lv => {
      const t = _taperAt(lv);
      return { ui: vUi + t * (vUiB - vUi), uo: vUo + t * (vUoB - vUo), rh: vRh + t * (vRhB - vRh) };
    };
    const lutSegs = [];
    /* Legs — four vertical corners, each tapering with height */
    for (let i = 0; i < nLev - 1; i++) {
      const l0 = lvs[i], l1 = lvs[i + 1];
      const c0 = _lc(l0), c1 = _lc(l1);
      lutSegs.push(
        [[l0,-c0.rh,c0.ui],[l1,-c1.rh,c1.ui]], [[l0,+c0.rh,c0.ui],[l1,+c1.rh,c1.ui]],
        [[l0,-c0.rh,c0.uo],[l1,-c1.rh,c1.uo]], [[l0,+c0.rh,c0.uo],[l1,+c1.rh,c1.uo]],
      );
    }
    /* Level rings at each floor */
    for (const lv of lvs) {
      const { ui, uo, rh } = _lc(lv);
      lutSegs.push(
        [[lv,-rh,ui],[lv,+rh,ui]], [[lv,-rh,uo],[lv,+rh,uo]],
        [[lv,-rh,ui],[lv,-rh,uo]], [[lv,+rh,ui],[lv,+rh,uo]],
      );
    }
    /* Diagonals per bay */
    for (let i = 0; i < nLev - 1; i++) {
      const l0 = lvs[i], l1 = lvs[i + 1];
      const c0 = _lc(l0), c1 = _lc(l1);
      lutSegs.push([[l0,-c0.rh,c0.ui],[l1,+c1.rh,c1.ui]], [[l0,+c0.rh,c0.ui],[l1,-c1.rh,c1.ui]]);
      const [vU0, vU1] = i % 2 === 0 ? [c0.ui, c1.uo] : [c0.uo, c1.ui];
      lutSegs.push([[l0,-c0.rh,vU0],[l1,-c1.rh,vU1]], [[l0,+c0.rh,vU0],[l1,+c1.rh,vU1]]);
    }
    _drawPadSegs(lutSegs, '#b06830', Math.max(1.5, 1.5 * dpr));

    /* Exhaust / steam clouds — start at engine ignition, grow for ~8 s
       (F-1 spin-up / hold-down period), then fade as rocket climbs. */
    if (isSV) {
      const ignT        = S.aircraft?.ignitionTime ?? 0;
      const sinceIgn    = Math.max(0, (S.time ?? 0) - ignT);
      const growFactor  = Math.min(1, sinceIgn / 8.0);   // 0→1 over first 8 s
      const steamFade   = Math.max(0, 1 - riseNm / 0.040);
      const steamAlpha  = padAlpha * steamFade * growFactor;

      if (steamAlpha > 0.01) {
        const steamSides = [
          { vU: -(trenchH + _r * 0.5) },   // LUT side
          { vU: +(trenchH + _r * 0.5) },   // far side
        ];
        const steamR = growFactor * (_r * 6 + riseNm * 4) * focal / Math.max(0.01, camSide);
        for (const { vU: sU } of steamSides) {
          const cPt = pw([mlpT, 0, sU]);
          if (!cPt) continue;
          /* Outer white steam cloud */
          const g1 = ctx.createRadialGradient(cPt.x, cPt.y, 0, cPt.x, cPt.y, steamR);
          g1.addColorStop(0,   `rgba(240,240,235,${(steamAlpha * 0.70).toFixed(3)})`);
          g1.addColorStop(0.5, `rgba(230,230,225,${(steamAlpha * 0.35).toFixed(3)})`);
          g1.addColorStop(1,   `rgba(210,215,220,0)`);
          ctx.save();
          ctx.fillStyle = g1;
          ctx.beginPath();
          ctx.arc(cPt.x, cPt.y, steamR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          /* Inner amber exhaust glow at trench level */
          const hotPt = pw([mlpT - _r * 0.5, 0, sU * 0.5]);
          if (hotPt) {
            const hotR = steamR * 0.45;
            const g2 = ctx.createRadialGradient(hotPt.x, hotPt.y, 0, hotPt.x, hotPt.y, hotR);
            g2.addColorStop(0,   `rgba(255,200,80,${(steamAlpha * 0.55).toFixed(3)})`);
            g2.addColorStop(0.6, `rgba(220,120,40,${(steamAlpha * 0.20).toFixed(3)})`);
            g2.addColorStop(1,   `rgba(180,90,20,0)`);
            ctx.save();
            ctx.fillStyle = g2;
            ctx.beginPath();
            ctx.arc(hotPt.x, hotPt.y, hotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  } // riseNm < 0.150
  } // isSV || isF9

  /* ── Starbase OLP + Mechazilla tower + catch arms ──────────────── */
  if (isSS) {
    const riseNm   = _svRise;
    if (riseNm < 0.150 && !S.rocketSECO) {
      const padAlpha = Math.min(1, Math.max(0, (0.150 - riseNm) / 0.100));
      const _r       = 0.00243;
      const _vFbase  = -0.025;
      const _vFtop   =  0.040;
      const tvF0     = _vFbase - riseNm;   // world-anchored platform top

      const cosO = Math.cos(orbitAzDeg * DEG), sinO = Math.sin(orbitAzDeg * DEG);
      const pw = ([vF, vR_, vU_]) => {
        const vR2 = vR_ * cosO - vU_ * sinO;
        const vU2 = vR_ * sinO + vU_ * cosO;
        let   fP  = vF * cosP - vU2 * sinP;
        let   uR  = vF * sinP + vU2 * cosP;
        let   vR3 = vR2;
        if (orbitElDeg !== 0) {
          const vR4 = vR3 * cosEl + uR * sinEl;
          uR  = -vR3 * sinEl + uR * cosEl;
          vR3 = vR4;
        }
        const cfW = camSide > 0 ? camSide - vR3 : camBack + fP;
        const crW = camSide > 0 ? fP : vR3;
        const cuW = uR - camUp;
        const cf  = cfW * cosCP + cuW * sinCP;
        const cu  = cuW * cosCP - cfW * sinCP;
        if (cf < 0.002) return null;
        return { x: cx + crW / cf * focal, y: cy - cu / cf * focal, d: cfW };
      };

      const _drawPadSegs = (segs, color, lw) => {
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth   = lw;
        ctx.beginPath();
        for (const [a, b] of segs) {
          const pa = pw(a), pb = pw(b);
          if (!pa || !pb) continue;
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
        }
        ctx.stroke();
        ctx.restore();
      };

      /* ── OLP (permanent launch platform) — solid slab + flame trench ── */
      const olpH    = _r * 3.0;    // ~27 m tall
      const trenchH = _r * 2.0;    // flame trench half-width (~18 m)
      const olpSvU  = _r * 4.5;    // away from tower
      const olpSvUt = _r * 12.5;   // toward tower
      const olpSvR  = _r * 4.2;    // half-depth front-to-back
      const olpT = tvF0, olpB = tvF0 - olpH;

      const _drawOlpSlice = (vUlo, vUhi) => {
        const mc = [
          [olpT,-olpSvR,vUlo],[olpT,+olpSvR,vUlo],[olpT,+olpSvR,vUhi],[olpT,-olpSvR,vUhi],
          [olpB,-olpSvR,vUlo],[olpB,+olpSvR,vUlo],[olpB,+olpSvR,vUhi],[olpB,-olpSvR,vUhi],
        ];
        const mcpd = mc.map(pw);
        const mFaces = [
          { idx:[0,3,2,1], col:'#606570' },
          { idx:[7,6,5,4], col:'#1a1e28' },
          { idx:[0,4,7,3], col:'#3a4050' },
          { idx:[0,1,5,4], col:'#454c5c' },
          { idx:[3,7,6,2], col:'#454c5c' },
          { idx:[1,2,6,5], col:'#525a68' },
        ];
        mFaces.sort((a,b) => {
          const da = a.idx.reduce((s,i)=>s+(mcpd[i]?.d??0),0)/4;
          const db = b.idx.reduce((s,i)=>s+(mcpd[i]?.d??0),0)/4;
          return db - da;
        });
        for (const {idx,col} of mFaces) {
          const ps = idx.map(i => mcpd[i]);
          if (ps.some(p=>!p)) continue;
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = col;
          ctx.strokeStyle = 'rgba(120,130,145,0.4)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(ps[0].x, ps[0].y);
          for (let k=1;k<ps.length;k++) ctx.lineTo(ps[k].x, ps[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      };
      _drawOlpSlice(-olpSvUt, -trenchH);
      _drawOlpSlice(+trenchH, +olpSvU);

      /* Flame trench interior */
      const _trF = (pts, col) => {
        const ps = pts.map(pw);
        if (!ps.every(Boolean)) return;
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.fillStyle   = col;
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        ps.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      _trF([[olpT,+olpSvR,-trenchH],[olpT,+olpSvR,+trenchH],[olpB,+olpSvR,+trenchH],[olpB,+olpSvR,-trenchH]], '#0c0f18');
      _trF([[olpT,-olpSvR,-trenchH],[olpT,-olpSvR,+trenchH],[olpB,-olpSvR,+trenchH],[olpB,-olpSvR,-trenchH]], '#08090e');
      _trF([[olpB,-olpSvR,-trenchH],[olpB,+olpSvR,-trenchH],[olpB,+olpSvR,+trenchH],[olpB,-olpSvR,+trenchH]], '#06070c');

      /* ── Mechazilla tower — heavy steel lattice, close to rocket ── */
      const towerTop = tvF0 + (_vFtop - _vFbase) + _r * 3.5;
      const vUi  = -_r * 2.2;    // inner face — just outside the rocket body
      const vUo  = -_r * 6.8;    // outer face — ~20 m wide tower
      const vRh  = _r * 1.25;    // half-depth front-to-back
      const nLev = 10;
      const lvs  = Array.from({length:nLev}, (_,i) => tvF0 + (i/(nLev-1)) * (towerTop - tvF0));
      const twrSegs = [];
      for (let i = 0; i < nLev - 1; i++) {
        const l0 = lvs[i], l1 = lvs[i+1];
        twrSegs.push(
          [[l0,-vRh,vUi],[l1,-vRh,vUi]], [[l0,+vRh,vUi],[l1,+vRh,vUi]],
          [[l0,-vRh,vUo],[l1,-vRh,vUo]], [[l0,+vRh,vUo],[l1,+vRh,vUo]],
        );
      }
      for (const lv of lvs) {
        twrSegs.push(
          [[lv,-vRh,vUi],[lv,+vRh,vUi]], [[lv,-vRh,vUo],[lv,+vRh,vUo]],
          [[lv,-vRh,vUi],[lv,-vRh,vUo]], [[lv,+vRh,vUi],[lv,+vRh,vUo]],
        );
      }
      for (let i = 0; i < nLev - 1; i++) {
        const l0 = lvs[i], l1 = lvs[i+1];
        twrSegs.push([[l0,-vRh,vUi],[l1,+vRh,vUi]], [[l0,+vRh,vUi],[l1,-vRh,vUi]]);
        const [vU0,vU1] = i%2===0 ? [vUi,vUo] : [vUo,vUi];
        twrSegs.push([[l0,-vRh,vU0],[l1,-vRh,vU1]], [[l0,+vRh,vU0],[l1,+vRh,vU1]]);
      }
      _drawPadSegs(twrSegs, '#7a8898', Math.max(1.5, 1.5 * dpr));

      /* ── Mechazilla catch arms — slide up/down the tower ──
         armVF drives arm height. Pre-launch: at grid-fin level.
         S.mechazillaArmVF can override for assembly / animated catch. */
      const _gridFinWorldVF = tvF0 + (0.013 - _vFbase);   // grid-fin height in world frame
      const armVF    = S.mechazillaArmVF != null
                       ? (tvF0 + S.mechazillaArmVF)        // mission-driven position
                       : _gridFinWorldVF;                   // default: catch-ready
      const armHT    = _r * 0.22;   // half-thickness (vF axis)
      const armHW    = _r * 0.32;   // half-width (vR axis)
      const armTip   = +_r * 1.6;   // tip reaches past rocket to far side
      const armRoot  = vUi;         // root attached to tower inner face

      const _drawArm = (vRc) => {
        const ac = [
          [armVF+armHT, vRc-armHW, armTip],  [armVF+armHT, vRc+armHW, armTip],
          [armVF+armHT, vRc+armHW, armRoot], [armVF+armHT, vRc-armHW, armRoot],
          [armVF-armHT, vRc-armHW, armTip],  [armVF-armHT, vRc+armHW, armTip],
          [armVF-armHT, vRc+armHW, armRoot], [armVF-armHT, vRc-armHW, armRoot],
        ].map(pw);
        const aFaces = [
          {idx:[0,3,2,1], col:'#909aa8'},   // top
          {idx:[7,6,5,4], col:'#404850'},   // bottom
          {idx:[0,4,7,3], col:'#686e7a'},   // -vR side
          {idx:[1,2,6,5], col:'#787e8a'},   // +vR side
          {idx:[0,1,5,4], col:'#585f6a'},   // tip
          {idx:[2,3,7,6], col:'#585f6a'},   // root
        ];
        aFaces.sort((a,b) => {
          const da = a.idx.reduce((s,i)=>s+(ac[i]?.d??0),0)/4;
          const db = b.idx.reduce((s,i)=>s+(ac[i]?.d??0),0)/4;
          return db - da;
        });
        for (const {idx,col} of aFaces) {
          const ps = idx.map(i => ac[i]);
          if (ps.some(p=>!p)) continue;
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = col;
          ctx.strokeStyle = 'rgba(160,170,185,0.3)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(ps[0].x, ps[0].y);
          for (let k=1;k<ps.length;k++) ctx.lineTo(ps[k].x, ps[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        /* Truss X-bracing along arm length (5 panels, seen from side) */
        const span = armTip - armRoot;
        const nPan = 5;
        const pW   = span / nPan;
        const tSegs = [];
        for (let i = 0; i <= nPan; i++) {
          const u = armRoot + i * pW;
          tSegs.push([[armVF+armHT, vRc, u], [armVF-armHT, vRc, u]]);   // vertical divider
          if (i < nPan) {
            tSegs.push([[armVF+armHT, vRc, u],    [armVF-armHT, vRc, u+pW]]);  // \ diagonal
            tSegs.push([[armVF-armHT, vRc, u],    [armVF+armHT, vRc, u+pW]]);  // / diagonal
          }
        }
        _drawPadSegs(tSegs, 'rgba(140,158,175,0.28)', Math.max(0.6, 0.7 * dpr));
        /* Fan of diagonal support struts from carriage lower mount to arm underside
           (matches the radiating support structure visible in the reference) */
        const mountF = armVF - _r * 0.9;   // carriage attachment below arm
        const supportSegs = [
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.18]],
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.36]],
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.52]],
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.65]],
        ];
        _drawPadSegs(supportSegs, '#6a7a8a', Math.max(1, 1.2 * dpr));
      };
      _drawArm(+_r * 0.7);
      _drawArm(-_r * 0.7);

      /* ── Steam / exhaust cloud — 33 Raptors, water deluge ── */
      {
        const ignT       = S.aircraft?.ignitionTime ?? 0;
        const sinceIgn   = Math.max(0, (S.time ?? 0) - ignT);
        const growFactor = Math.min(1, sinceIgn / 4.0);   // grows over ~4 s
        const steamFade  = Math.max(0, 1 - riseNm / 0.040);
        const steamAlpha = padAlpha * steamFade * growFactor;

        if (steamAlpha > 0.01) {
          /* Two emission points flanking the trench, same as SV */
          const steamSides = [
            { vU: -(trenchH + _r * 0.5) },   // tower side
            { vU: +(trenchH + _r * 0.5) },   // far side
          ];
          /* 33 engines → larger cloud than Saturn V */
          const steamR = growFactor * (_r * 9 + riseNm * 5) * focal / Math.max(0.01, camSide);
          for (const { vU: sU } of steamSides) {
            const cPt = pw([olpT, 0, sU]);
            if (!cPt) continue;
            const g1 = ctx.createRadialGradient(cPt.x, cPt.y, 0, cPt.x, cPt.y, steamR);
            g1.addColorStop(0,   `rgba(240,242,245,${(steamAlpha * 0.75).toFixed(3)})`);
            g1.addColorStop(0.5, `rgba(225,228,232,${(steamAlpha * 0.38).toFixed(3)})`);
            g1.addColorStop(1,   `rgba(200,210,220,0)`);
            ctx.save();
            ctx.fillStyle = g1;
            ctx.beginPath();
            ctx.arc(cPt.x, cPt.y, steamR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            /* Inner exhaust glow — methane burns clean, less amber than RP-1 */
            const hotPt = pw([olpT - _r * 0.4, 0, sU * 0.4]);
            if (hotPt) {
              const hotR = steamR * 0.40;
              const g2 = ctx.createRadialGradient(hotPt.x, hotPt.y, 0, hotPt.x, hotPt.y, hotR);
              g2.addColorStop(0,   `rgba(240,220,140,${(steamAlpha * 0.45).toFixed(3)})`);
              g2.addColorStop(0.6, `rgba(180,140, 60,${(steamAlpha * 0.18).toFixed(3)})`);
              g2.addColorStop(1,   `rgba(120, 80, 20,0)`);
              ctx.save();
              ctx.fillStyle = g2;
              ctx.beginPath();
              ctx.arc(hotPt.x, hotPt.y, hotR, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }
    } // riseNm < 0.150

    /* ── Landing steam — Raptor plume hits water, reuses liftoff cloud style ── */
    if (S.starshipFlipStartT && !S.starshipSplashdown && rStage >= 2) {
      const sinceFlip  = Math.max(0, (S.time ?? 0) - S.starshipFlipStartT);
      const growFactor = Math.min(1, sinceFlip / 3.5);
      const steamAlpha = growFactor * 0.72;
      if (steamAlpha > 0.01) {
        const _r    = 0.00243;
        const engPt = project([0.013, 0, 0]);   // ship Raptor cluster — bottom after flip
        if (engPt) {
          const dist  = camSide > 0 ? camSide : camBack;
          const steamR = growFactor * _r * 10 * focal / Math.max(0.01, dist);
          /* Two puffs flanking the engine cluster (left/right), same as liftoff trench sides */
          for (const off of [-1, +1]) {
            const pPt = project([0.013, off * _r * 1.5, 0]) ?? engPt;
            const g1 = ctx.createRadialGradient(pPt.x, pPt.y, 0, pPt.x, pPt.y, steamR);
            g1.addColorStop(0,   `rgba(240,242,245,${(steamAlpha * 0.70).toFixed(3)})`);
            g1.addColorStop(0.5, `rgba(225,228,232,${(steamAlpha * 0.35).toFixed(3)})`);
            g1.addColorStop(1,   'rgba(200,210,220,0)');
            ctx.save();
            ctx.fillStyle = g1;
            ctx.beginPath();
            ctx.arc(pPt.x, pPt.y, steamR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          /* Inner methane exhaust glow — same tint as liftoff */
          const hotR = steamR * 0.42;
          const g2 = ctx.createRadialGradient(engPt.x, engPt.y, 0, engPt.x, engPt.y, hotR);
          g2.addColorStop(0,   `rgba(240,220,140,${(steamAlpha * 0.50).toFixed(3)})`);
          g2.addColorStop(0.6, `rgba(180,140, 60,${(steamAlpha * 0.20).toFixed(3)})`);
          g2.addColorStop(1,   'rgba(120,80,20,0)');
          ctx.save();
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.arc(engPt.x, engPt.y, hotR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  } // isSS

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

/* ── Engine overlays: thrust-reverser cascade + nozzle chevrons ── */
function _engineOverlays(pts, faces, acEng, _b = 162) {
  const trOn  = !!(S.thrustReverser);
  const chev  = !!(acEng?.chevrons);

  /* R/L nozzle exit rings and TR zone ring indices (b-relative: R TR_fwd=b+36, TR_aft=b+44, noz=b+52) */
  const engines = [
    { trFwd: _b+36, trAft: _b+44, noz: _b+52, sign:  1 },  // R engine
    { trFwd: _b+76, trAft: _b+84, noz: _b+92, sign: -1 },  // L engine
  ];

  for (const { trFwd, trAft, noz, sign } of engines) {
    /* Collect projected ring points — bail if any missing */
    const pFwd  = Array.from({length: 8}, (_, i) => pts[trFwd + i]);
    const pAft  = Array.from({length: 8}, (_, i) => pts[trAft + i]);
    const pNoz  = Array.from({length: 8}, (_, i) => pts[noz   + i]);
    if (pFwd.some(p => !p) || pAft.some(p => !p) || pNoz.some(p => !p)) continue;

    /* Thrust-reverser cascade: replace C→D faces with lighter cascade panels */
    if (trOn) {
      const cascadeCol = [130, 120, 110];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const ps = [pFwd[i], pFwd[j], pAft[j], pAft[i]];
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: 0.85, avgD: avgD + 0.0001, col: cascadeCol });
      }
      /* Blocker door: partial cap at nozzle exit (blocks ~40% of flow) */
      const nozPts = pNoz.filter(Boolean);
      if (nozPts.length >= 3) {
        const cx = nozPts.reduce((s, p) => s + p.x, 0) / nozPts.length;
        const cy = nozPts.reduce((s, p) => s + p.y, 0) / nozPts.length;
        const avgD = nozPts.reduce((s, p) => s + p.d, 0) / nozPts.length;
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 8;
          const half = { x: cx, y: cy, d: avgD };
          faces.push({ ps: [pNoz[i*2], pNoz[j*2], half], br: 0.6, avgD: avgD + 0.0002, col: cascadeCol });
        }
      }
    }

    /* Chevron tabs at nozzle exit — each tab is a triangle pointing inward */
    if (chev) {
      const chevCol = [30, 32, 38];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const pA = pNoz[i], pB = pNoz[j];
        /* Tip: midpoint pushed slightly toward engine center (inward) */
        const mx = (pA.x + pB.x) * 0.5, my = (pA.y + pB.y) * 0.5;
        /* Engine center in screen is midpoint of all nozzle pts */
        const ex = pNoz.reduce((s, p) => s + p.x, 0) / 8;
        const ey = pNoz.reduce((s, p) => s + p.y, 0) / 8;
        const tip = { x: mx + (ex - mx) * 0.28, y: my + (ey - my) * 0.28, d: (pA.d + pB.d) * 0.5 };
        const avgD = (pA.d + pB.d + tip.d) / 3;
        faces.push({ ps: [pA, pB, tip], br: 0.55, avgD: avgD + 0.00005, col: chevCol });
      }
    }
  }
}

/* ── Livery decals — SVG paths projected onto named surface group ─
   Per-face affine mapping: each visible face gets its own SVG→screen
   transform derived from UV coordinates, eliminating cylinder distortion.
   Fallback to bounding-box for decals without placement.               */
function _drawLiveryDecals(ctx, decals, pts, verts, FC_, F_, project, camSide = 0) {
  /* engine maps to both regular nacelle (4) and TR zone (7) so the logo is uninterrupted */
  const SURF = { vtail: 2, nose: 6, fuselage: 0, engine: [4, 7], winglet: 9 };
  for (const decal of decals) {
    const cIdxVal = SURF[decal.surface];
    if (cIdxVal === undefined) continue;
    const cIdxList = Array.isArray(cIdxVal) ? cIdxVal : [cIdxVal];
    const vb = (decal.viewBox ?? '0 0 100 100').split(' ').map(Number);
    const [vbX, vbY, vbW, vbH] = vb;
    const elems = decal.elements ?? [];
    if (!elems.length) continue;

    function drawElems() {
      for (const el of elems) {
        ctx.save();
        if (el.rotate) {
          const rcx = el.rcx ?? (vbX + vbW / 2);
          const rcy = el.rcy ?? (vbY + vbH / 2);
          ctx.translate(rcx, rcy);
          ctx.rotate(el.rotate * Math.PI / 180);
          ctx.translate(-rcx, -rcy);
        }
        ctx.fillStyle = el.fill ?? '#ffffff';
        ctx.globalAlpha = el.opacity ?? 1;
        if (el.text != null) {
          /* Text element (registrations, simple titles) — drawn in the same
             SVG→surface affine, so it wraps/perspectives like a path decal. */
          ctx.font = `${el.weight ?? '700'} ${el.size ?? 16}px ${el.font ?? 'Arial, Helvetica, sans-serif'}`;
          ctx.textAlign = el.align ?? 'center';
          ctx.textBaseline = el.baseline ?? 'middle';
          ctx.fillText(el.text, el.x ?? 0, el.y ?? 0);
        } else {
          const _path = new Path2D(el.d);
          if (el.fill !== 'none') ctx.fill(_path);
          if (el.stroke) {                         // optional outline (e.g. logo blue edging)
            ctx.strokeStyle = el.stroke;
            ctx.lineWidth   = el.strokeWidth ?? 1;
            ctx.lineJoin    = 'round';
            ctx.stroke(_path);
          }
        }
        ctx.restore();
      }
    }

    if (decal.placement && verts) {
      /* Per-face affine: placement[0..3] defines a UV quad in 3D world space.
         U = placement[0]→placement[1], V = placement[0]→placement[3].        */
      const pl = decal.placement;
      const P0 = pl[0], P1 = pl[1], P3 = pl[3];
      const Ux = P1[0]-P0[0], Uy = P1[1]-P0[1], Uz = P1[2]-P0[2];
      const Vx = P3[0]-P0[0], Vy = P3[1]-P0[1], Vz = P3[2]-P0[2];
      const lenU2 = Ux*Ux + Uy*Uy + Uz*Uz;
      const lenV2 = Vx*Vx + Vy*Vy + Vz*Vz;
      if (lenU2 < 1e-20 || lenV2 < 1e-20) continue;

      for (let fi = 0; fi < F_.length; fi++) {
        if (!cIdxList.includes(FC_[fi])) continue;
        const fv = F_[fi];
        const fp = fv.map(vi => pts[vi]);
        if (fp.some(p => !p)) continue;
        /* Front-face cull */
        const cross = (fp[1].x-fp[0].x)*(fp[2].y-fp[0].y)
                    - (fp[1].y-fp[0].y)*(fp[2].x-fp[0].x);
        if (cross < 0) continue;

        /* Engine decals: only render on the near-side engine (prevents far engine bleeding through) */
        if (decal.surface === 'engine' && camSide !== 0 && verts) {
          const avgY = fv.reduce((s, vi) => s + verts[vi][1], 0) / fv.length;
          if (camSide > 0 && avgY < 0) continue;
          if (camSide < 0 && avgY > 0) continue;
        }

        /* Vtail LE-nose round faces have mixed UV chirality — skip them.
           Identified by having a vertex on the y=0 centreline. */
        if (FC_[fi] === 2 && verts && fv.some(vi => Math.abs(verts[vi][1]) < 0.00005)) continue;

        /* Project each vertex onto placement plane → UV ∈ [0,1]×[0,1] */
        const uvs = fv.map(vi => {
          const W = verts[vi];
          const dx = W[0]-P0[0], dy = W[1]-P0[1], dz = W[2]-P0[2];
          return { u: (dx*Ux+dy*Uy+dz*Uz)/lenU2,
                   v: (dx*Vx+dy*Vy+dz*Vz)/lenV2 };
        });

        /* Skip faces entirely outside the placement quad */
        if (uvs.every(uv => uv.u < -0.05) || uvs.every(uv => uv.u > 1.05) ||
            uvs.every(uv => uv.v < -0.05) || uvs.every(uv => uv.v > 1.05)) continue;

        /* Map UV → SVG coordinate space with automatic chirality detection.
           The screen triangle (d0,d1,d2) is always CCW (passed cull test).
           If the UV triangle in SVG space is CW (detUV < 0), flip u so the
           affine is orientation-preserving rather than mirroring the decal.
           Different surface types (tube vs flat panel) have opposite winding,
           so the flip must be detected per-face rather than hardcoded.           */
        const li = fv.length - 1;
        const svgsRaw = uvs.map(uv => ({ x: vbX + uv.u*vbW, y: vbY + uv.v*vbH }));
        const detUV = (svgsRaw[1].x-svgsRaw[0].x)*(svgsRaw[li].y-svgsRaw[0].y)
                    - (svgsRaw[1].y-svgsRaw[0].y)*(svgsRaw[li].x-svgsRaw[0].x);
        const autoFlip = detUV < 0;
        const doFlip = decal.flipU ? !autoFlip : autoFlip;
        const svgs = doFlip
          ? uvs.map(uv => ({ x: vbX + (1 - uv.u)*vbW, y: vbY + uv.v*vbH }))
          : svgsRaw;

        /* Solve affine SVG→screen from 3 vertices (0, 1, last) */
        const s0=svgs[0], s1=svgs[1], s2=svgs[li];
        const d0=fp[0],   d1=fp[1],   d2=fp[li];
        const ds1x=s1.x-s0.x, ds1y=s1.y-s0.y;
        const ds3x=s2.x-s0.x, ds3y=s2.y-s0.y;
        const dd1x=d1.x-d0.x, dd1y=d1.y-d0.y;
        const dd3x=d2.x-d0.x, dd3y=d2.y-d0.y;
        const det = ds1x*ds3y - ds1y*ds3x;
        if (Math.abs(det) < 0.01) continue;
        const ma = (dd1x*ds3y - dd3x*ds1y) / det;
        const mc = (ds1x*dd3x - ds3x*dd1x) / det;
        const mb = (dd1y*ds3y - dd3y*ds1y) / det;
        const md = (ds1x*dd3y - ds3x*dd1y) / det;
        const me = d0.x - ma*s0.x - mc*s0.y;
        const mf = d0.y - mb*s0.x - md*s0.y;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fp[0].x, fp[0].y);
        for (let i = 1; i < fp.length; i++) ctx.lineTo(fp[i].x, fp[i].y);
        ctx.closePath();
        ctx.clip();
        ctx.transform(ma, mb, mc, md, me, mf);
        drawElems();
        ctx.restore();
      }

      /* Debug: project placement quad to screen and draw colored outline */
      if (decal.debug) {
        const sp = [pl[0], pl[1], pl[2] ?? [P1[0]+P3[0]-P0[0], P1[1]+P3[1]-P0[1], P1[2]+P3[2]-P0[2]], pl[3]].map(c => project(c));
        if (sp.every(p => p)) {
          ctx.save();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ff3300';
          ctx.beginPath();
          ctx.moveTo(sp[0].x, sp[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(sp[i].x, sp[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.strokeStyle = '#0088ff';  // U: P0→P1
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y); ctx.lineTo(sp[1].x, sp[1].y); ctx.stroke();
          ctx.strokeStyle = '#00cc44';  // V: P0→P3
          ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y); ctx.lineTo(sp[3].x, sp[3].y); ctx.stroke();
          ctx.fillStyle = '#ff3300';
          ctx.font = 'bold 11px monospace';
          ['P0','P1','P2','P3'].forEach((lbl, i) => ctx.fillText(lbl, sp[i].x+3, sp[i].y-4));
          ctx.restore();
        }
      }
    } else {
      /* Fallback: fit SVG into screen bounding box of all visible surface faces */
      const sPts = [];
      for (let fi = 0; fi < F_.length; fi++) {
        if (!cIdxList.includes(FC_[fi])) continue;
        const fv = F_[fi], fp = fv.map(vi => pts[vi]);
        if (fp.some(p => !p)) continue;
        const cross = (fp[1].x-fp[0].x)*(fp[2].y-fp[0].y)
                    - (fp[1].y-fp[0].y)*(fp[2].x-fp[0].x);
        if (cross < 0) continue;
        for (const p of fp) sPts.push(p);
      }
      if (sPts.length < 3) continue;
      let bx0=Infinity, bx1=-Infinity, by0=Infinity, by1=-Infinity;
      for (const p of sPts) {
        if (p.x<bx0) bx0=p.x; if (p.x>bx1) bx1=p.x;
        if (p.y<by0) by0=p.y; if (p.y>by1) by1=p.y;
      }
      const sw=bx1-bx0, sh=by1-by0;
      if (sw<4 || sh<4) continue;
      const sx=sw/vbW, sy=sh/vbH;
      ctx.save();
      ctx.beginPath();
      for (let fi2 = 0; fi2 < F_.length; fi2++) {
        if (!cIdxList.includes(FC_[fi2])) continue;
        const fv2 = F_[fi2].map(vi => pts[vi]);
        if (fv2.some(p => !p)) continue;
        const cr2 = (fv2[1].x-fv2[0].x)*(fv2[2].y-fv2[0].y)
                  - (fv2[1].y-fv2[0].y)*(fv2[2].x-fv2[0].x);
        if (cr2 < 0) continue;
        ctx.moveTo(fv2[0].x, fv2[0].y);
        for (let i2 = 1; i2 < fv2.length; i2++) ctx.lineTo(fv2[i2].x, fv2[i2].y);
        ctx.closePath();
      }
      ctx.clip();
      ctx.transform(sx, 0, 0, sy, bx0 - vbX*sx, by0 - vbY*sy);
      drawElems();
      ctx.restore();
    }
  }
}

/* ── Swiss cross on V-stab tail fin ──────────────────────────── */
function _drawSwissCross(ctx, p0, p1, p2, p3, vFrac = 0.5) {
  if (!p0 || !p1 || !p2 || !p3) return;
  // p0=fwd_base, p1=aft_base, p2=aft_top, p3=fwd_top
  const bmx = (p0.x + p1.x) * 0.5, bmy = (p0.y + p1.y) * 0.5;
  const tmx = (p2.x + p3.x) * 0.5, tmy = (p2.y + p3.y) * 0.5;
  const fcx = bmx*(1-vFrac) + tmx*vFrac, fcy = bmy*(1-vFrac) + tmy*vFrac;
  const upLen = Math.hypot(tmx - bmx, tmy - bmy);
  if (upLen < 4) return;
  const uux = 0, uuy = -1;                // screen up (fixed vertical)
  const urx = 1, ury =  0;               // screen right (fixed horizontal)
  const sc  = upLen * 0.38;               // cross fits ~76% of fin height

  /* plus-sign polygon — 12 vertices in local (right, up) space */
  function pt(r, u) {
    return [fcx + r*urx*sc + u*uux*sc, fcy + r*ury*sc + u*uuy*sc];
  }
  const [x0,y0]=pt(-0.2, 0.6), [x1,y1]=pt( 0.2, 0.6);
  const [x2,y2]=pt( 0.2, 0.2), [x3,y3]=pt( 0.6, 0.2);
  const [x4,y4]=pt( 0.6,-0.2), [x5,y5]=pt( 0.2,-0.2);
  const [x6,y6]=pt( 0.2,-0.6), [x7,y7]=pt(-0.2,-0.6);
  const [x8,y8]=pt(-0.2,-0.2), [x9,y9]=pt(-0.6,-0.2);
  const [xA,yA]=pt(-0.6, 0.2), [xB,yB]=pt(-0.2, 0.2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y);
  ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.beginPath();
  ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.lineTo(x3,y3); ctx.lineTo(x4,y4); ctx.lineTo(x5,y5);
  ctx.lineTo(x6,y6); ctx.lineTo(x7,y7); ctx.lineTo(x8,y8);
  ctx.lineTo(x9,y9); ctx.lineTo(xA,yA); ctx.lineTo(xB,yB);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ── Winglet logo — billboard an SVG decal (e.g. the Edelweiss flower) onto the
   winglet quad, centred and scaled to it, clipped to the quad. Reuses the same
   path elements as the surface decal (fill + optional stroke).                */
function _drawWingletLogo(ctx, p0, p1, p2, p3, els, vb) {
  if (!p0 || !p1 || !p2 || !p3 || !els) return;
  const bmx = (p0.x + p1.x) * 0.5, bmy = (p0.y + p1.y) * 0.5;
  const tmx = (p2.x + p3.x) * 0.5, tmy = (p2.y + p3.y) * 0.5;
  const upLen = Math.hypot(tmx - bmx, tmy - bmy);
  if (upLen < 5) return;
  const cx = (bmx + tmx) * 0.5, cy = (bmy + tmy) * 0.5;
  const [vbx, vby, vbw, vbh] = vb;
  const sc = upLen * 0.85 / vbh;                       // fit ~85% of the winglet height
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
  ctx.closePath(); ctx.clip();                         // clip to the winglet (screen space)
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.translate(-(vbx + vbw / 2), -(vby + vbh / 2));   // centre the viewBox on the quad
  for (const el of els) {
    if (el.d == null) continue;
    const path = new Path2D(el.d);
    if (el.fill && el.fill !== 'none') { ctx.fillStyle = el.fill; ctx.fill(path); }
    if (el.stroke) { ctx.strokeStyle = el.stroke; ctx.lineWidth = (el.strokeWidth ?? 1); ctx.lineJoin = 'round'; ctx.stroke(path); }
  }
  ctx.restore();
}

/* ── Polish szachownica roundel (2×2 red/white checkerboard) ───────────────
   pBL = base LE, pBR = base TE, pTR = tip TE, pTL = tip LE                 */
function _drawPolishRoundel(ctx, pBL, pBR, pTR, pTL) {
  if (!pBL || !pBR || !pTR || !pTL) return;
  const bx = (pBL.x + pBR.x) * 0.5, by = (pBL.y + pBR.y) * 0.5;
  const tx = (pTR.x + pTL.x) * 0.5, ty = (pTR.y + pTL.y) * 0.5;
  const hLen = Math.hypot(tx - bx, ty - by);
  if (hLen < 6) return;
  const uux = (tx - bx) / hLen, uuy = (ty - by) / hLen;   // "up" unit vec
  const chLen = Math.hypot(pBR.x - pBL.x, pBR.y - pBL.y);
  const urx = chLen > 0.5 ? (pBR.x - pBL.x) / chLen : uuy;  // "right" unit vec
  const ury = chLen > 0.5 ? (pBR.y - pBL.y) / chLen : -uux;
  /* Centre at 65% up, mid-chord */
  const cx = bx + uux * hLen * 0.65, cy = by + uuy * hLen * 0.65;
  const sz  = hLen * 0.12;  // half-side of checkerboard square
  const pt  = (r, u) => [cx + r*urx*sz + u*uux*sz, cy + r*ury*sz + u*uuy*sz];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pBL.x, pBL.y); ctx.lineTo(pBR.x, pBR.y);
  ctx.lineTo(pTR.x, pTR.y); ctx.lineTo(pTL.x, pTL.y);
  ctx.closePath(); ctx.clip();
  /* White background */
  ctx.fillStyle = 'rgba(240,240,240,0.93)';
  const [c0x,c0y]=pt(-1,-1),[c1x,c1y]=pt(1,-1),[c2x,c2y]=pt(1,1),[c3x,c3y]=pt(-1,1);
  ctx.beginPath(); ctx.moveTo(c0x,c0y); ctx.lineTo(c1x,c1y); ctx.lineTo(c2x,c2y); ctx.lineTo(c3x,c3y); ctx.closePath(); ctx.fill();
  /* Red quadrants: top-left and bottom-right */
  ctx.fillStyle = 'rgba(192,24,24,0.93)';
  const [tl0x,tl0y]=pt(-1,0),[tl1x,tl1y]=pt(0,0),[tl2x,tl2y]=pt(0,1),[tl3x,tl3y]=pt(-1,1);
  ctx.beginPath(); ctx.moveTo(tl0x,tl0y); ctx.lineTo(tl1x,tl1y); ctx.lineTo(tl2x,tl2y); ctx.lineTo(tl3x,tl3y); ctx.closePath(); ctx.fill();
  const [br0x,br0y]=pt(0,-1),[br1x,br1y]=pt(1,-1),[br2x,br2y]=pt(1,0),[br3x,br3y]=pt(0,0);
  ctx.beginPath(); ctx.moveTo(br0x,br0y); ctx.lineTo(br1x,br1y); ctx.lineTo(br2x,br2y); ctx.lineTo(br3x,br3y); ctx.closePath(); ctx.fill();
  ctx.restore();
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
