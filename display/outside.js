/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view: cockpit forward · chase cam · side cam.
   Aircraft = flat-shaded 3-D wireframe (painter's algorithm).
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { renderTerrain } from './terrain.js';
import { getMapReservedRight } from './map.js';
import { moonECI } from '../core/rocket.js';

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
const _LD2S = 0.22;   // fill light strength
/* Blinn-Phong half-vector for side cam (view = +R direction → [0,1,0]) */
const _H   = (v => v.map(x => x / Math.hypot(...v)))([_LD[0], _LD[1]+1, _LD[2]]);

/* ── Procedural tube geometry ──────────────────────────────────────
   buildTube(nSides, rings) → { V_, F_, FC_, E_, rb }
   rings: [{ vF, r | ry/rz, col, cy?, cz? }]
     vF  forward position; r = circular radius (or ry/rz for ellipse)
     col = face color index for the segment from ring i → ring i+1
     cy/cz = centre offset (default 0; use for off-axis pods/engines)
   Angle convention: si=0 → top (+z), si=N/4 → right (+y), etc.
   E_ contains ring perimeter edges only; callers add longerons.
   ─────────────────────────────────────────────────────────────── */
function buildTube(nSides, rings) {
  const V_ = [], F_ = [], FC_ = [], E_ = [], rb = [];
  for (const ring of rings) {
    rb.push(V_.length);
    const ry = ring.r ?? ring.ry, rz = ring.r ?? ring.rz;
    const cy = ring.cy ?? 0, cz = ring.cz ?? 0;
    for (let si = 0; si < nSides; si++) {
      const a = Math.PI * 0.5 - (si / nSides) * Math.PI * 2;
      V_.push([ring.vF, cy + ry * Math.cos(a), cz + rz * Math.sin(a)]);
    }
  }
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let si = 0; si < nSides; si++) {
      const sj = (si + 1) % nSides;
      F_.push([rb[ri]+si, rb[ri]+sj, rb[ri+1]+sj, rb[ri+1]+si]);
      FC_.push(rings[ri].col ?? 0);
    }
  }
  for (let ri = 0; ri < rings.length; ri++) {
    for (let si = 0; si < nSides; si++)
      E_.push([rb[ri]+si, rb[ri]+(si+1)%nSides]);
  }
  return { V_, F_, FC_, E_, rb };
}

/**
 * Build a symmetric wing panel with flap + aileron split.
 * spec: { root, brk, tip: {y, z, LE, TE, thick}, flapHinge, ailHinge, color? }
 * Returns { verts[44], faces[20], edges[74], faceColors[20], anim }
 * anim: { r_fl, r_flb, r_ail, flapRoot, flapBrk, ailR, ailL }
 * All indices are 0-based local; caller offsets by V_.length before appending.
 */
function buildWingSurface({ root, brk, tip, flapHinge, ailHinge, color = 1 }) {
  const fhxR = root.LE + flapHinge * (root.TE - root.LE);
  const fhxB = brk.LE  + flapHinge * (brk.TE  - brk.LE);
  const ahxB = brk.LE  + ailHinge  * (brk.TE  - brk.LE);
  const ahxT = tip.LE  + ailHinge  * (tip.TE  - tip.LE);
  const r_fl  = fhxR - root.TE;
  const r_flb = fhxB - brk.TE;
  const r_ail = ahxB - brk.TE;
  const flUh  = 1 - flapHinge  * 0.85;
  const ailUh = 1 - ailHinge   * 0.85;

  function half(yS) {
    const ry = root.y * yS, by = brk.y * yS, ty = tip.y * yS;
    return [
      [root.LE, ry, root.z                        ],  //  0 root  lower LE
      [root.TE, ry, root.z                        ],  //  1 root  lower TE  (flap)
      [brk.LE,  by, brk.z                         ],  //  2 break lower LE
      [brk.TE,  by, brk.z                         ],  //  3 break lower TE  (flap)
      [tip.LE,  ty, tip.z                         ],  //  4 tip   lower LE
      [tip.TE,  ty, tip.z                         ],  //  5 tip   lower TE  (aileron)
      [root.LE, ry, root.z + root.thick           ],  //  6 root  upper LE
      [root.TE, ry, root.z + root.thick * 0.15    ],  //  7 root  upper TE  (flap)
      [brk.LE,  by, brk.z  + brk.thick            ],  //  8 break upper LE
      [brk.TE,  by, brk.z  + brk.thick  * 0.15    ],  //  9 break upper TE  (flap)
      [tip.LE,  ty, tip.z  + tip.thick             ],  // 10 tip   upper LE
      [tip.TE,  ty, tip.z  + tip.thick   * 0.15    ],  // 11 tip   upper TE  (aileron)
      [fhxR, ry, root.z                            ],  // 12 root  lower flap hinge
      [fhxB, by, brk.z                             ],  // 13 break lower flap hinge
      [fhxR, ry, root.z + root.thick * flUh        ],  // 14 root  upper flap hinge
      [fhxB, by, brk.z  + brk.thick  * flUh        ],  // 15 break upper flap hinge
      [ahxB, by, brk.z                             ],  // 16 break lower aileron hinge
      [ahxT, ty, tip.z                             ],  // 17 tip   lower aileron hinge
      [ahxB, by, brk.z + brk.thick * ailUh         ],  // 18 break upper aileron hinge
      [ahxT, ty, tip.z + tip.thick * ailUh         ],  // 19 tip   upper aileron hinge
      [brk.TE, by, brk.z                           ],  // 20 break lower TE (aileron, decoupled)
      [brk.TE, by, brk.z + brk.thick * 0.15        ],  // 21 break upper TE (aileron, decoupled)
    ];
  }

  const o = 22;
  const verts = [...half(1), ...half(-1)];

  const rF = [
    [0,12,13,2],[12,1,3,13],[2,16,17,4],[16,20,5,17],    // R lower
    [6,8,15,14],[14,15,9,7],[8,10,19,18],[18,19,11,21],  // R upper
    [4,17,19,10],[17,5,11,19],                            // R tip cap
  ];
  const faces = [
    ...rF,
    ...rF.map(([a,b,c,d]) => [a+o, d+o, c+o, b+o]),      // L (reversed winding)
  ];
  const faceColors = faces.map(() => color);

  const edges = [];
  function halfEdges(ofs) {
    for (const [a, b] of [
      [0,2],[2,4],[1,3],
      [0,12],[12,1],[2,13],[13,16],[16,20],[20,5],[4,17],[17,5],[12,13],[16,17],
      [6,8],[8,10],[7,9],[21,11],
      [6,14],[14,7],[8,15],[15,18],[18,21],[10,19],[19,11],[14,15],[18,19],
      [0,6],[1,7],[2,8],[3,9],[20,21],[4,10],[5,11],[12,14],[13,15],[16,18],[17,19],
    ]) edges.push([a + ofs, b + ofs]);
  }
  halfEdges(0); halfEdges(o);

  return {
    verts, faces, edges, faceColors,
    anim: {
      r_fl, r_flb, r_ail,
      flapRoot: [1,  7,  o+1,  o+7 ],
      flapBrk:  [3,  9,  o+3,  o+9 ],
      ailR:     [20, 5,  21,   11  ],
      ailL:     [o+20, o+5, o+21, o+11],
    },
  };
}

/* Shared face-normal computation — call once after all geometry is appended */
function computeFaceNormals(V_, F_) {
  return F_.map(fi => {
    const a = V_[fi[0]], b = V_[fi[1]], c = V_[fi[2]];
    const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n  = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
    const len = Math.hypot(...n);
    return len > 1e-10 ? n.map(x => x/len) : [0, 0, 1];
  });
}

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
  [ 25,  45,  75], // 8 cockpit windows — dark glass
  [195, 205, 215], // 9 winglets        — default = wing color; override via livery index 9
  [ 15,  15,  18], // 10 engine interior — near-black for intake/nozzle cap faces
];

let _canvas    = null;
let _camMode   = 0;
let _finAngle  = 0;   // grid fin fold: 0 = stowed aft, Math.PI/2 = deployed

let _orbitAz    = 0;     // side-cam orbit azimuth (degrees, 0 = starboard)
let _orbitEl    = 12;    // elevation above horizontal (degrees, +12 = slightly above)
let _orbitZoom  = 1.0;   // side-cam zoom multiplier (1 = auto-fit; >1 = farther out)
let _orbitDragX = null;  // non-null while drag is active
let _orbitDragY = null;

export function initOutside() {
  _canvas = document.getElementById('outside-canvas');

  /* Drag-to-orbit: active in side cam (2) and chase cam (1). */
  window.addEventListener('mousedown', e => {
    if (_camMode === 1 || _camMode === 2) { _orbitDragX = e.clientX; _orbitDragY = e.clientY; }
  });
  window.addEventListener('mousemove', e => {
    if (_orbitDragX !== null) {
      _orbitAz = ((_orbitAz + (e.clientX - _orbitDragX) * 0.4) % 360 + 360) % 360;
      _orbitEl = Math.max(-85, Math.min(85, _orbitEl - (e.clientY - _orbitDragY) * 0.3));
      _orbitDragX = e.clientX; _orbitDragY = e.clientY;
    }
  });
  window.addEventListener('mouseup', () => { _orbitDragX = null; _orbitDragY = null; });

  /* Wheel / trackpad gestures in side cam and chase cam. */
  window.addEventListener('wheel', e => {
    if (_camMode !== 1 && _camMode !== 2) return;
    e.preventDefault();
    if (e.ctrlKey) {
      _orbitZoom = Math.max(0.1, Math.min(10, _orbitZoom * Math.exp(e.deltaY * 0.01)));
      return;
    }
    if (S.paused) {
      /* Paused: full orbit control — deltaX orbits, deltaY elevates */
      _orbitAz = ((_orbitAz - e.deltaX * 0.35) % 360 + 360) % 360;
      _orbitEl = Math.max(-85, Math.min(85, _orbitEl - e.deltaY * 0.25));
    } else {
      /* Live: zoom only — spacecraft stays centered on screen */
      _orbitZoom = Math.max(0.1, Math.min(10, _orbitZoom * Math.exp(e.deltaY * 0.015)));
    }
  }, { passive: false });

  /* 0 key: reset orbit + zoom to default while paused */
  window.addEventListener('keydown', e => {
    if (e.key === '0' && S.paused && (_camMode === 1 || _camMode === 2)) {
      _orbitAz = 0; _orbitEl = 12; _orbitZoom = 1;
    }
  });
}
export function setOutsideCamMode(m) { _camMode = m; }
export function outsideInvalidate()  { /* redraws every frame */ }

export function tickOutside() {
  if (!_canvas || !_canvas.offsetWidth || !_canvas.offsetHeight) return;
  if      (_camMode === 1) _renderChaseCam(_canvas);
  else if (_camMode === 2) _renderSideCam(_canvas);
  else if (_camMode === 3) _renderWingView(_canvas);
  else if (_camMode === 4) _renderPlumeCam(_canvas);
  else if (_camMode === 5) _renderBoosterCam(_canvas);
  else                     renderTerrain(_canvas);
}

/* ── Chase cam ────────────────────────────────────────────────── */
function _renderChaseCam(canvas) {
  const hdgRad = (S.hdg  ?? 0) * DEG;
  const acP    =  S.pitch ?? 0;
  const acR    = S.aircraft?.vehicleType === 'rocket' ? (S.rocketRoll ?? 0) : (S.roll ?? 0);
  const cosLat = Math.cos((S.lat ?? 47) * DEG);

  /* Orbit elevation: adjust camera back/up keeping total distance constant */
  const baseDist = Math.hypot(CHASE_BACK, CHASE_UP);
  const baseEl   = Math.atan2(CHASE_UP, CHASE_BACK);
  const totalEl  = baseEl + _orbitEl * DEG;
  const camBack  = baseDist * Math.cos(totalEl);
  const camUp    = baseDist * Math.sin(totalEl);

  /* Orbit azimuth: rotate camera position around rocket; scale by zoom */
  const orbitRad = hdgRad - Math.PI + _orbitAz * DEG;
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
  S.alt   = (S.alt??3000) + camUpZ / FT_NM;
  S.hdg   = ((_orbitAz + 180) % 360 + 360) % 360;
  S.pitch = Math.atan2(-camUpZ, camBackZ) / DEG;  /* angle unchanged, zoom cancels */
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true, cxOverride: _cxC });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.pitch=sP;S.roll=sR;S.hdg=sH;

  _drawWireframe(canvas, acP, acR + _orbitAz, camBack, camUp, 0);
  _drawLabel(canvas, 'CHASE CAM');
}

/* ── Side cam (starboard) ─────────────────────────────────────── */
function _renderSideCam(canvas) {
  const hdgRad   = (S.hdg  ?? 0) * DEG;
  const acP      =  S.pitch ?? 0;
  const acR      = S.aircraft?.vehicleType === 'rocket' ? (S.rocketRoll ?? 0) : (S.roll ?? 0);
  const cosLat   = Math.cos((S.lat ?? 47) * DEG);
  const rightRad = hdgRad + Math.PI / 2;

  /* For rockets, scale camera distance with altitude so the globe stays
     in frame — at 175 km orbit this gives ~24 nm side / ~5 nm up.     */
  const isRocket = S.aircraft?.vehicleType === 'rocket';
  const altNm    = (S.alt ?? 0) * FT_NM;
  const sideDist = (isRocket ? Math.max(SIDE_SIDE, altNm * 0.25) : SIDE_SIDE) * _orbitZoom;
  const sideUp   = (isRocket ? Math.max(SIDE_UP,   altNm * 0.05) : SIDE_UP)   * _orbitZoom;

  /* Apply orbit: user manual + director shot contribution.
     Computed here so the terrain camera also uses the orbit angle. */
  let renderOrbit = _orbitAz;
  {
    const db = _dirBlend();
    if (db > 0 && _dir.shot) renderOrbit += (_DIR_SHOTS[_dir.shot].orbitAz ?? 0) * db;
  }

  /* True camera orbit: move the terrain camera around the rocket sphere.
     This makes the background terrain rotate with the orbit, not just the
     wireframe model — so it looks like the camera orbiting, not the rocket. */
  const orbitRad = rightRad + renderOrbit * DEG;
  const elRad    = _orbitEl * DEG;
  const hDist    = sideDist * Math.cos(elRad);
  const vElev    = sideDist * Math.sin(elRad);
  const dN = Math.cos(orbitRad) * hDist;
  const dE = Math.sin(orbitRad) * hDist;

  const dpr    = devicePixelRatio || 1;
  const _mapPxS = getMapReservedRight() * dpr;
  const _cxS    = (canvas.offsetWidth * dpr - _mapPxS) / 2;

  const sL=S.lat,sLo=S.lon,sA=S.alt,sH=S.hdg,sP=S.pitch,sR=S.roll;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + (sideUp + vElev) / FT_NM;
  S.hdg   = ((S.hdg??0) - 90 - renderOrbit + 360) % 360;
  S.pitch = Math.atan2(-(sideUp + vElev), hDist) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true, cxOverride: _cxS });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  _drawWireframe(canvas, acP, acR + renderOrbit, 0, sideUp, sideDist, false, renderOrbit, _orbitEl);
  _drawLabel(canvas, 'SIDE CAM');
  if (S.paused) _drawPauseOverlay(canvas);
}

/* ── Wing view — close-up from cockpit level, left wing ───────── */
const WING_SIDE = 0.009;   // NM — just outside fuselage, cockpit-window distance
const WING_UP   = 0.0025;  // NM — slightly above wing plane

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
  S.alt   = (S.alt??3000) + WING_UP / FT_NM;
  S.hdg   = ((S.hdg??0) - 90 + 360) % 360;
  S.pitch = Math.atan2(-WING_UP, WING_SIDE) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  _drawWireframe(canvas, acP, acR, 0, WING_UP, WING_SIDE, true);
  _drawLabel(canvas, 'WING VIEW');
}

/* ══════════════════════════════════════════════════════════════
   Aircraft geometry — wide-body twin jet (A350-class)
   Body frame: fwd = nose (+x), right = starboard, up = +z
   Units: NM. Origin ≈ centre of mass.
   ══════════════════════════════════════════════════════════════ */

const _r   = 0.0025;        // fuselage radius
const _nr1 = _r * 0.3827;  // nose/tail ring radii (sin π/8, π/4, 3π/8)
const _nr2 = _r * 0.7071;
const _nr3 = _r * 0.9239;
const _hs  = 0.0165;
const _ey  = 0.0068;
const _ez  = -0.0028;
const _pz  = -0.0008;  // pylon top — wing underside at engine span station
const _er  = 0.0013;
const _e7  = _er  * 0.7071;
const _efr = _er  * 1.20;   // fan cowl ring — 20% wider (turbofan bulge)
const _ef7 = _efr * 0.7071;
const _erc = 0.0008;
const _e7c = _erc * 0.7071;
const _wr  = _r * 0.7071;   // wing-root offset: on fuselage surface, lower-diagonal (45° from bottom)
const _dh  = 0.0012;

/* ── Wing spec — defines planform, thickness, and surface-break fractions ──
   root/fuselage attachment position is NOT part of the spec (fuselage join is
   a separate element). All x values = body-frame forward (+x = nose).         */
const _WB_WING_DEFAULT = {
  span:      0.0165,   // half-span (NM)
  rootLE:    0.005,    // root leading-edge x
  rootTE:   -0.004,    // root trailing-edge x
  tipLE:    -0.003,    // tip leading-edge x
  tipTE:    -0.006,    // tip trailing-edge x
  dihedral:  0.0012,   // z offset at tip (positive = up)
  rootThick: 0.00090,  // root thickness (z), ≈10% of root chord
  tipThick:  0.00022,  // tip thickness  (z), ≈7%  of tip chord
  flapBreak: 0.60,     // span fraction where flap zone ends / aileron begins
  flapHinge: 0.70,     // chord fraction of the flap hinge line from LE
};

/* ── Per-aircraft wide-body nose profiles ─────────────────────── */
const _WB_NP = {
  default: {
    tipX: 0.021, tipCz: 0,
    noseRings: [
      { vF: 0.020, r: _nr1*0.55, col: 6 },
      { vF: 0.019, r: _nr1,      col: 0 },
      { vF: 0.017, r: _nr2,      col: 0 },
      { vF: 0.015, r: _nr3,      col: 5 },
      { vF: 0.013, r: _r,        col: 0 },
    ],
    windows: [
      [ 0.019,  0.0002,  0.0010],[ 0.015,  0.0004,  0.0020],
      [ 0.015,  0.0013,  0.0015],[ 0.019,  0.0007,  0.0007],
      [ 0.019, -0.0002,  0.0010],[ 0.015, -0.0004,  0.0020],
      [ 0.015, -0.0013,  0.0015],[ 0.019, -0.0007,  0.0007],
    ],
    wing: _WB_WING_DEFAULT,
  },
  a350: {
    tipX: 0.023, tipCz: -0.0002,
    noseRings: [
      { vF: 0.022, r: _nr1*0.22, col: 6 },  // very pointed radome tip
      { vF: 0.021, r: _nr1*0.55, col: 6 },  // second radome ring
      { vF: 0.020, r: _nr1*0.85, col: 0 },  // begin fuselage taper
      { vF: 0.018, r: _nr2*0.85, col: 0 },
      { vF: 0.016, r: _nr2*0.98, col: 0 },
      { vF: 0.015, r: _nr3,      col: 5 },  // cockpit band
      { vF: 0.013, r: _r,        col: 0 },  // full fuselage diameter
    ],
    windows: [
      [ 0.020,  0.0002,  0.0013],[ 0.015,  0.0003,  0.0022],  // R: high, large panels
      [ 0.015,  0.0014,  0.0016],[ 0.020,  0.0008,  0.0008],
      [ 0.020, -0.0002,  0.0013],[ 0.015, -0.0003,  0.0022],
      [ 0.015, -0.0014,  0.0016],[ 0.020, -0.0008,  0.0008],
    ],
    wing: _WB_WING_DEFAULT,
  },
  a220: {
    tipX: 0.021, tipCz: 0.0001,
    noseRings: [
      { vF: 0.020, r: _nr1*0.45, col: 6 },
      { vF: 0.018, r: _nr1,      col: 0 },
      { vF: 0.016, r: _nr2*0.95, col: 0 },
      { vF: 0.015, r: _nr3,      col: 5 },
      { vF: 0.013, r: _r,        col: 0 },
    ],
    windows: [
      [ 0.019,  0.0002,  0.0009],[ 0.015,  0.0004,  0.0018],  // R: compact, angular
      [ 0.015,  0.0012,  0.0014],[ 0.019,  0.0006,  0.0006],
      [ 0.019, -0.0002,  0.0009],[ 0.015, -0.0004,  0.0018],
      [ 0.015, -0.0012,  0.0014],[ 0.019, -0.0006,  0.0006],
    ],
    wing: _WB_WING_DEFAULT,
  },
  e190: {
    tipX: 0.020, tipCz: 0.0001,
    noseRings: [
      { vF: 0.019, r: _nr1*0.65, col: 6 },  // rounder, blunter tip
      { vF: 0.017, r: _nr1,      col: 0 },
      { vF: 0.016, r: _nr2,      col: 0 },
      { vF: 0.014, r: _nr3,      col: 5 },
      { vF: 0.013, r: _r,        col: 0 },
    ],
    windows: [
      [ 0.018,  0.0002,  0.0008],[ 0.014,  0.0004,  0.0016],  // R: small, rectangular
      [ 0.014,  0.0011,  0.0012],[ 0.018,  0.0006,  0.0005],
      [ 0.018, -0.0002,  0.0008],[ 0.014, -0.0004,  0.0016],
      [ 0.014, -0.0011,  0.0012],[ 0.018, -0.0006,  0.0005],
    ],
    wing: _WB_WING_DEFAULT,
  },
  /* A340-313: same Airbus nose family as A220; wide span + 4 engines (inner ey, outer ey2).
     The nacelle mesh renders at ey (inner pair); ey2 drives the outer engine fan pass. */
  a340: {
    ey: 0.0058, ey2: 0.0100, ez: -0.00230, er: 0.00108, erc: 0.00075, pz: -0.00068,
    tipX: 0.021, tipCz: 0.0001,
    noseRings: [
      { vF: 0.020, r: _nr1*0.45, col: 6 },
      { vF: 0.018, r: _nr1,      col: 0 },
      { vF: 0.016, r: _nr2*0.95, col: 0 },
      { vF: 0.015, r: _nr3,      col: 5 },
      { vF: 0.013, r: _r,        col: 0 },
    ],
    windows: [
      [ 0.019,  0.0002,  0.0009],[ 0.015,  0.0004,  0.0018],
      [ 0.015,  0.0012,  0.0014],[ 0.019,  0.0006,  0.0006],
      [ 0.019, -0.0002,  0.0009],[ 0.015, -0.0004,  0.0018],
      [ 0.015, -0.0012,  0.0014],[ 0.019, -0.0006,  0.0006],
    ],
    wing: {
      span:      0.0200,
      rootLE:    0.005,  rootTE:   -0.004,
      tipLE:    -0.004,  tipTE:    -0.007,
      dihedral:  0.0014,
      rootThick: 0.00105, tipThick: 0.00022,
      flapBreak: 0.58,   flapHinge: 0.72,
    },
  },
  /* 737-800: narrowbody r=0.00195; CFM56-7 closer inboard + lower; shorter swept wing */
  b737: {
    r: 0.00195, ey: 0.00380, ez: -0.00190, er: 0.00096, erc: 0.00063, pz: -0.00062,
    tipX: 0.018, tipCz: 0.0,
    noseRings: [
      /* 737 has a blunt, rounded nose — expands quickly to full diameter */
      { vF: 0.017, r: 0.000746, col: 6 },   // nr1 full — broad rounded tip
      { vF: 0.016, r: 0.001379, col: 0 },   // nr2 — rapid expansion
      { vF: 0.014, r: 0.001802, col: 5 },   // nr3 cockpit band
      { vF: 0.013, r: 0.00195,  col: 0 },   // full width
    ],
    windows: [
      [ 0.016,  0.0002,  0.0010],[ 0.013,  0.0003,  0.0016],  // R cockpit glass
      [ 0.013,  0.0011,  0.0012],[ 0.016,  0.0006,  0.0006],
      [ 0.016, -0.0002,  0.0010],[ 0.013, -0.0003,  0.0016],
      [ 0.013, -0.0011,  0.0012],[ 0.016, -0.0006,  0.0006],
    ],
    wing: {
      span:      0.01320,
      rootLE:    0.0055,  rootTE:   -0.0028,
      tipLE:    -0.0010,  tipTE:    -0.0055,
      dihedral:  0.0018,
      rootThick: 0.00065, tipThick:  0.00015,
      flapBreak: 0.55,    flapHinge: 0.72,
    },
  },
};

function _buildWB(np) {
  const N = 16, N4 = 4, N2 = 8, N3 = 12;
  const nNose  = np.noseRings.length;  // variable: 5 (default/a220/e190) or 7 (a350)
  /* Per-aircraft overrides fall back to module globals so existing profiles are unchanged */
  const r   = np.r   ?? _r;
  const nr2 = r * 0.7071;
  const nr3 = r * 0.9239;
  const wr  = r * 0.7071;
  const ey  = np.ey  ?? _ey;
  const ez  = np.ez  ?? _ez;
  const er  = np.er  ?? _er;
  const efr = er * 1.20;
  const ef7 = efr * 0.7071;
  const e7  = er  * 0.7071;
  const erc = np.erc ?? _erc;
  const e7c = erc * 0.7071;
  const pz  = np.pz  ?? _pz;

  /* Derive all wing constants from the per-aircraft wing spec */
  const w    = np.wing;
  const hs   = w.span,     dh  = w.dihedral;
  const wtr  = w.rootThick, wtt = w.tipThick;
  const rLE  = w.rootLE,   rTE = w.rootTE;
  const tLE  = w.tipLE,    tTE = w.tipTE;
  const fb   = w.flapBreak, fh  = w.flapHinge;
  const wh   = wr + (hs - wr) * fb;             // Y at span-break station
  const wxhL = rLE + fb * (tLE - rLE);          // LE x at span-break
  const wxhT = rTE + fb * (tTE - rTE);          // TE x at span-break
  const wzh  = -wr + fb * (dh + wr);            // lower-surface z at span-break
  const wth  = wtr + fb * (wtt - wtr);          // thickness at span-break
  const wfxR = rLE + fh * (rTE - rLE);          // x at root flap-hinge line
  const wfxH = wxhL + fh * (wxhT - wxhL);       // x at span-break flap-hinge
  const r_rt = -(rTE - wfxR);                   // root: dist from flap-hinge to TE
  const r_hs = -(wxhT - wfxH);                  // span-break: dist from flap-hinge to TE

  /* Derive aileron hinge positions and r_ail from buildWingSurface */
  const _ws = buildWingSurface({
    root: { y: wr,  z: -wr,  LE: rLE, TE: rTE, thick: wtr },
    brk:  { y: wh,  z: wzh,  LE: wxhL, TE: wxhT, thick: wth },
    tip:  { y: hs,  z: dh,   LE: tLE,  TE: tTE,  thick: wtt },
    flapHinge: fh,
    ailHinge: 0.70,
  });
  const WV = _ws.verts;
  const r_ail = _ws.anim.r_ail;

  const wy   = hs;                               // winglet y = tip span
  const wz   = dh + 0.0040;                     // winglet z
  const nTotal = nNose + 5;            // + 5 fixed tail rings
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    ...np.noseRings,                               // rings 0…nNose-1: aircraft-specific nose
    { vF:  0.001, r: r,          col: 0 },          // ring nNose+0: wing-stn
    { vF: -0.010, r: r,          col: 0 },          // ring nNose+1: rear
    { vF: -0.014, r: nr3,        col: 0 },          // ring nNose+2: tail fwd (begin taper)
    { vF: -0.017, r: nr3        },                  // ring nNose+3: tail sweep (no cz)
    { vF: -0.019, r: nr2        },                  // ring nNose+4: APU (no cz)
  ]);

  const noseTip = V_.length;  V_.push([np.tipX, 0, np.tipCz ?? 0]);
  const tailTip = V_.length;  V_.push([-0.021, 0, 0]);

  V_.push(  /* non-tube vertices — b+0..b+151 */
    WV[0], WV[1], WV[4], WV[5],    // b+0..3:  R root lower LE/TE, R tip lower LE/TE
    WV[22], WV[23], WV[26], WV[27], // b+4..7:  L root lower LE/TE, L tip lower LE/TE
    [-0.013,  0,        r       ],  //  170 V-stab base fwd
    [-0.019,  0,        r       ],  //  171 V-stab base aft
    [-0.015,  0,        0.008   ],  //  172 V-stab top fwd
    [-0.020,  0,        0.007   ],  //  173 V-stab top aft
    [-0.017,  nr3,      0.0     ],  //  174 R h-stab root fwd  (on fuselage surface)
    [-0.020,  nr2,      0.0     ],  //  175 R h-stab root aft
    [-0.018,  0.008,    0.001   ],  //  176 R h-stab tip fwd
    [-0.021,  0.008,    0.001   ],  //  177 R h-stab tip aft
    [-0.017, -nr3,      0.0     ],  //  178 L h-stab root fwd
    [-0.020, -nr2,      0.0     ],  //  179 L h-stab root aft
    [-0.018, -0.008,    0.001   ],  //  180 L h-stab tip fwd
    [-0.021, -0.008,    0.001   ],  //  181 L h-stab tip aft
    /* R engine — intake(182-189), fan(190-197), TR_fwd(198-205), TR_aft(206-213), nozzle(214-221) */
    [ 0.005, ey,      ez+er   ],[ 0.005, ey+e7,   ez+e7   ],
    [ 0.005, ey+er,   ez      ],[ 0.005, ey+e7,   ez-e7   ],
    [ 0.005, ey,      ez-er   ],[ 0.005, ey-e7,   ez-e7   ],
    [ 0.005, ey-er,   ez      ],[ 0.005, ey-e7,   ez+e7   ],
    [ 0.001, ey,      ez+efr  ],[ 0.001, ey+ef7,  ez+ef7  ],
    [ 0.001, ey+efr,  ez      ],[ 0.001, ey+ef7,  ez-ef7  ],
    [ 0.001, ey,      ez-efr  ],[ 0.001, ey-ef7,  ez-ef7  ],
    [ 0.001, ey-efr,  ez      ],[ 0.001, ey-ef7,  ez+ef7  ],
    [-0.001, ey,      ez+er   ],[-0.001, ey+e7,   ez+e7   ],
    [-0.001, ey+er,   ez      ],[-0.001, ey+e7,   ez-e7   ],
    [-0.001, ey,      ez-er   ],[-0.001, ey-e7,   ez-e7   ],
    [-0.001, ey-er,   ez      ],[-0.001, ey-e7,   ez+e7   ],
    [-0.002, ey,      ez+er   ],[-0.002, ey+e7,   ez+e7   ],
    [-0.002, ey+er,   ez      ],[-0.002, ey+e7,   ez-e7   ],
    [-0.002, ey,      ez-er   ],[-0.002, ey-e7,   ez-e7   ],
    [-0.002, ey-er,   ez      ],[-0.002, ey-e7,   ez+e7   ],
    [-0.003, ey,      ez+erc  ],[-0.003, ey+e7c,  ez+e7c  ],
    [-0.003, ey+erc,  ez      ],[-0.003, ey+e7c,  ez-e7c  ],
    [-0.003, ey,      ez-erc  ],[-0.003, ey-e7c,  ez-e7c  ],
    [-0.003, ey-erc,  ez      ],[-0.003, ey-e7c,  ez+e7c  ],
    /* L engine — intake(222-229), fan(230-237), TR_fwd(238-245), TR_aft(246-253), nozzle(254-261) */
    [ 0.005, -ey,      ez+er   ],[ 0.005, -ey-e7,   ez+e7   ],
    [ 0.005, -ey-er,   ez      ],[ 0.005, -ey-e7,   ez-e7   ],
    [ 0.005, -ey,      ez-er   ],[ 0.005, -ey+e7,   ez-e7   ],
    [ 0.005, -ey+er,   ez      ],[ 0.005, -ey+e7,   ez+e7   ],
    [ 0.001, -ey,      ez+efr  ],[ 0.001, -ey-ef7,  ez+ef7  ],
    [ 0.001, -ey-efr,  ez      ],[ 0.001, -ey-ef7,  ez-ef7  ],
    [ 0.001, -ey,      ez-efr  ],[ 0.001, -ey+ef7,  ez-ef7  ],
    [ 0.001, -ey+efr,  ez      ],[ 0.001, -ey+ef7,  ez+ef7  ],
    [-0.001, -ey,      ez+er   ],[-0.001, -ey-e7,   ez+e7   ],
    [-0.001, -ey-er,   ez      ],[-0.001, -ey-e7,   ez-e7   ],
    [-0.001, -ey,      ez-er   ],[-0.001, -ey+e7,   ez-e7   ],
    [-0.001, -ey+er,   ez      ],[-0.001, -ey+e7,   ez+e7   ],
    [-0.002, -ey,      ez+er   ],[-0.002, -ey-e7,   ez+e7   ],
    [-0.002, -ey-er,   ez      ],[-0.002, -ey-e7,   ez-e7   ],
    [-0.002, -ey,      ez-er   ],[-0.002, -ey+e7,   ez-e7   ],
    [-0.002, -ey+er,   ez      ],[-0.002, -ey+e7,   ez+e7   ],
    [-0.003, -ey,      ez+erc  ],[-0.003, -ey-e7c,  ez+e7c  ],
    [-0.003, -ey-erc,  ez      ],[-0.003, -ey-e7c,  ez-e7c  ],
    [-0.003, -ey,      ez-erc  ],[-0.003, -ey+e7c,  ez-e7c  ],
    [-0.003, -ey+erc,  ez      ],[-0.003, -ey+e7c,  ez+e7c  ],
    /* Winglets (262-265) */
    [-0.007,  wy, wz],[-0.009,  wy, wz],
    [-0.007, -wy, wz],[-0.009, -wy, wz],
    /* Cockpit windows (266-273) — R and L main windshield panels (from nose profile) */
    ...np.windows,  // 8 vertices: R[fwd-in,aft-in,aft-out,fwd-out] + L[fwd-in,aft-in,aft-out,fwd-out]
    /* Engine pylons — top attach on wing underside at span station y=_ey (274-277) */
    [ 0.003,  ey, pz],[-0.001,  ey, pz],                    // 274 R pylon top fwd, 275 R pylon top aft
    [ 0.003, -ey, pz],[-0.001, -ey, pz],                    // 276 L pylon top fwd, 277 L pylon top aft
    /* Wing upper surface (b+116…b+123) */
    WV[6],  WV[7],  WV[10], WV[11],  // b+116..119: R root upper LE/TE, R tip upper LE/TE
    WV[28], WV[29], WV[32], WV[33],  // b+120..123: L root upper LE/TE, L tip upper LE/TE
    /* Break station (b+124…b+131) */
    WV[2],  WV[3],  WV[8],  WV[9],   // b+124..127: R break lower LE/TE, upper LE/TE
    WV[24], WV[25], WV[30], WV[31],  // b+128..131: L break lower LE/TE, upper LE/TE
    /* Aileron decoupled TE (b+132…b+135) */
    WV[20], WV[21], WV[42], WV[43],  // b+132..135: R/L break lower/upper TE (aileron, decoupled)
    /* Flap hinge line (b+136…b+143) */
    WV[12], WV[14], WV[13], WV[15],  // b+136..139: R root lower/upper, break lower/upper flap hinge
    WV[34], WV[36], WV[35], WV[37],  // b+140..143: L root lower/upper, break lower/upper flap hinge
    /* Aileron hinge line (b+144…b+151) — new; animates via animHinge with r_ail */
    WV[16], WV[18], WV[17], WV[19],  // b+144..147: R break lower/upper, tip lower/upper ail hinge
    WV[38], WV[40], WV[39], WV[41],  // b+148..151: L break lower/upper, tip lower/upper ail hinge
  );
  /* Wing LE nose vertices (b+152..b+157) — midpoint of lower/upper LE, offset fwd by half-thickness */
  const _leN = (lo, hi) => [lo[0] + (hi[2]-lo[2])*0.5, lo[1], (lo[2]+hi[2])*0.5];
  V_.push(
    _leN(WV[0],  WV[6]),   // b+152 R root  LE nose
    _leN(WV[2],  WV[8]),   // b+153 R break LE nose
    _leN(WV[4],  WV[10]),  // b+154 R tip   LE nose
    _leN(WV[22], WV[28]),  // b+155 L root  LE nose
    _leN(WV[24], WV[30]),  // b+156 L break LE nose
    _leN(WV[26], WV[32]),  // b+157 L tip   LE nose
  );
  /* Fan face centers at intake plane — projected in _drawWireframe for _drawTurbofanFace */
  V_.push(
    [0.005,  ey, ez],  // b+158 R intake center
    [0.005, -ey, ez],  // b+159 L intake center
  );

  /* Nose tris: noseTip → ring0 (outward normals) */
  for (let si = 0; si < N; si++) { F_.push([noseTip, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(6); }
  /* Tail tris: last ring → tailTip (outward normals) */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[nTotal-1]+si, rb[nTotal-1]+(si+1)%N]); FC_.push(0); }
  /* b = base index of the non-tube vertex block (was hardcoded 162 when nNose=5) */
  const b = nTotal * N + 2;  // nTotal*16 tube verts + noseTip(+0) + tailTip(+1) → non-tube at +2

  /* Engine interior caps: b+20..27=R intake, b+52..59=R nozzle, b+60..67=L intake, b+92..99=L nozzle */
  F_.push(
    [b+27,b+26,b+25,b+24,b+23,b+22,b+21,b+20],  // R intake cap — +x normal
    [b+52,b+53,b+54,b+55,b+56,b+57,b+58,b+59],  // R nozzle exit — -x normal
    [b+60,b+61,b+62,b+63,b+64,b+65,b+66,b+67],  // L intake cap — +x normal
    [b+92,b+99,b+98,b+97,b+96,b+95,b+94,b+93],  // L nozzle exit — -x normal
  );

  /* Non-tube faces — indices expressed as b+offset (b=162 for nNose=5, b=194 for nNose=7) */
  F_.push(
    [b+104,b+105,b+106,b+107],[b+104,b+107,b+106,b+105],  // R cockpit window
    [b+108,b+109,b+110,b+111],[b+108,b+111,b+110,b+109],  // L cockpit window
    /* R wing: inner split into fixed fwd + flap surface; outer (aileron); tip cap */
    [b+116,b+126,b+139,b+137],                   // R inner fixed upper  (LE→flap hinge)
    [b+137,b+139,b+127,b+117],                   // R flap upper         (hinge→TE)
    [b+0,b+136,b+138,b+124],                     // R inner fixed lower
    [b+136,b+1,b+125,b+138],                     // R flap lower
    [b+126,b+118,b+147,b+145],                   // R outer fixed upper (break LE→tip LE→ail hinge)
    [b+145,b+147,b+119,b+133],                   // R aileron upper
    [b+124,b+144,b+146,b+2],                     // R outer fixed lower
    [b+144,b+132,b+3,b+146],                     // R aileron lower
    [b+2,b+146,b+147,b+118],                     // R tip LE cap (fixed)
    [b+146,b+3,b+119,b+147],                     // R aileron tip
    /* L wing */
    [b+120,b+141,b+143,b+130],                   // L inner fixed upper
    [b+141,b+121,b+131,b+143],                   // L flap upper
    [b+4,b+128,b+142,b+140],                     // L inner fixed lower
    [b+140,b+142,b+129,b+5],                     // L flap lower
    [b+130,b+149,b+151,b+122],                   // L outer fixed upper
    [b+149,b+135,b+123,b+151],                   // L aileron upper
    [b+128,b+6,b+150,b+148],                     // L outer fixed lower
    [b+148,b+150,b+7,b+134],                     // L aileron lower
    [b+6,b+122,b+151,b+150],                     // L tip LE cap (fixed)
    [b+150,b+151,b+123,b+7],                     // L aileron tip
    /* LE rounds: lower half + upper half, inner (root→break) + outer (break→tip) per side */
    [b+0,b+124,b+153,b+152],[b+152,b+153,b+126,b+116],    // R inner lower + upper
    [b+124,b+2,b+154,b+153],[b+153,b+154,b+118,b+126],    // R outer lower + upper
    [b+4,b+155,b+156,b+128],[b+155,b+120,b+130,b+156],    // L inner lower + upper
    [b+128,b+156,b+157,b+6],[b+156,b+130,b+122,b+157],    // L outer lower + upper
    [b+118,b+147,b+101,b+100],[b+118,b+100,b+101,b+147],  // R winglet (anchored to ail hinge, not TE)
    [b+122,b+151,b+103,b+102],[b+122,b+102,b+103,b+151],  // L winglet (anchored to ail hinge, not TE)
    [b+8,b+9,b+11,b+10],[b+8,b+10,b+11,b+9],    // V-stab (×2 sides)
    [b+12,b+13,b+15,b+14],[b+12,b+14,b+15,b+13],  // R h-stab
    [b+16,b+17,b+19,b+18],[b+16,b+18,b+19,b+17],  // L h-stab
    /* R engine A→B (intake→fan) */
    [b+20,b+21,b+29,b+28],[b+21,b+22,b+30,b+29],[b+22,b+23,b+31,b+30],[b+23,b+24,b+32,b+31],
    [b+24,b+25,b+33,b+32],[b+25,b+26,b+34,b+33],[b+26,b+27,b+35,b+34],[b+27,b+20,b+28,b+35],
    /* R engine B→C (fan→TR_fwd) */
    [b+28,b+29,b+37,b+36],[b+29,b+30,b+38,b+37],[b+30,b+31,b+39,b+38],[b+31,b+32,b+40,b+39],
    [b+32,b+33,b+41,b+40],[b+33,b+34,b+42,b+41],[b+34,b+35,b+43,b+42],[b+35,b+28,b+36,b+43],
    /* R engine C→D (TR zone — col 7, skipped when TR deployed) */
    [b+36,b+37,b+45,b+44],[b+37,b+38,b+46,b+45],[b+38,b+39,b+47,b+46],[b+39,b+40,b+48,b+47],
    [b+40,b+41,b+49,b+48],[b+41,b+42,b+50,b+49],[b+42,b+43,b+51,b+50],[b+43,b+36,b+44,b+51],
    /* R engine D→E (TR_aft→nozzle) */
    [b+44,b+45,b+53,b+52],[b+45,b+46,b+54,b+53],[b+46,b+47,b+55,b+54],[b+47,b+48,b+56,b+55],
    [b+48,b+49,b+57,b+56],[b+49,b+50,b+58,b+57],[b+50,b+51,b+59,b+58],[b+51,b+44,b+52,b+59],
    /* L engine A→B */
    [b+60,b+68,b+69,b+61],[b+61,b+69,b+70,b+62],[b+62,b+70,b+71,b+63],[b+63,b+71,b+72,b+64],
    [b+64,b+72,b+73,b+65],[b+65,b+73,b+74,b+66],[b+66,b+74,b+75,b+67],[b+67,b+75,b+68,b+60],
    /* L engine B→C */
    [b+68,b+76,b+77,b+69],[b+69,b+77,b+78,b+70],[b+70,b+78,b+79,b+71],[b+71,b+79,b+80,b+72],
    [b+72,b+80,b+81,b+73],[b+73,b+81,b+82,b+74],[b+74,b+82,b+83,b+75],[b+75,b+83,b+76,b+68],
    /* L engine C→D (TR zone — col 7) */
    [b+76,b+84,b+85,b+77],[b+77,b+85,b+86,b+78],[b+78,b+86,b+87,b+79],[b+79,b+87,b+88,b+80],
    [b+80,b+88,b+89,b+81],[b+81,b+89,b+90,b+82],[b+82,b+90,b+91,b+83],[b+83,b+91,b+84,b+76],
    /* L engine D→E */
    [b+84,b+92,b+93,b+85],[b+85,b+93,b+94,b+86],[b+86,b+94,b+95,b+87],[b+87,b+95,b+96,b+88],
    [b+88,b+96,b+97,b+89],[b+89,b+97,b+98,b+90],[b+90,b+98,b+99,b+91],[b+91,b+99,b+92,b+84],
  );
  /* FC_ order must match F_ push order: engine caps, then non-tube faces */
  FC_.push(
    10,10,10,10,                          // engine interior caps (R intake, R nozzle, L intake, L nozzle)
    8,8, 8,8,                             // cockpit windows R+L (4)
    1,1,1,1, 1,1,1,1,                          // LE rounds R+L (8)
    1,1,1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1,1,1, 9,9,9,9,  // R wing (10) + L wing (10) + winglets (4)
    2,2, 3,3,3,3,                         // v-stab + h-stabs (6)
    4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4,   // R engine A→B + B→C (16)
    7,7,7,7,7,7,7,7,                      // R engine C→D TR zone (8)
    4,4,4,4,4,4,4,4,                      // R engine D→E (8)
    4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4,   // L engine A→B + B→C (16)
    7,7,7,7,7,7,7,7,                      // L engine C→D TR zone (8)
    4,4,4,4,4,4,4,4,                      // L engine D→E (8)
  );

  /* Longerons: noseTip ↔ all rings ↔ tailTip at 4 cardinal si */
  for (const si of [0, N4, N2, N3]) {
    E_.push([noseTip, rb[0]+si]);
    for (let ri = 0; ri < nTotal-1; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[nTotal-1]+si, tailTip]);
  }
  /* Fuselage ↔ non-tube connections */
  const wStn = rb[nNose], tail = rb[nNose+2];
  E_.push(
    [wStn+6, b+0],[wStn+6, b+1],[wStn+10, b+4],[wStn+10, b+5],   // fuselage → lower wing root
    [wStn+6, b+116],[wStn+6, b+117],[wStn+10, b+120],[wStn+10, b+121],  // fuselage → upper wing root
    [tail,    b+8],[tail,    b+9],
    [tail+N4, b+12],[tail+N3, b+16],
  );
  /* Non-tube edges */
  E_.push(
    // R wing lower: LE spanwise + TE spanwise (flap / aileron) + chords
    [b+0,b+124],[b+124,b+2], [b+1,b+125],[b+132,b+3],
    [b+0,b+136],[b+136,b+1], [b+124,b+138],[b+138,b+144],[b+144,b+132],
    [b+2,b+146],[b+146,b+3], [b+136,b+138],[b+144,b+146],
    // R wing upper
    [b+116,b+126],[b+126,b+118], [b+117,b+127],[b+133,b+119],
    [b+116,b+137],[b+137,b+117], [b+126,b+139],[b+139,b+145],[b+145,b+133],
    [b+118,b+147],[b+147,b+119], [b+137,b+139],[b+145,b+147],
    // R wing LE+hinge thickness (LE routed through nose vertex)
    [b+116,b+152],[b+152,b+0],[b+126,b+153],[b+153,b+124],[b+118,b+154],[b+154,b+2],
    [b+152,b+153],[b+153,b+154],                           // R LE nose span
    [b+136,b+137],[b+138,b+139],[b+144,b+145],[b+146,b+147],
    [b+136,b+138],[b+137,b+139],
    // L wing lower
    [b+4,b+128],[b+128,b+6], [b+5,b+129],[b+134,b+7],
    [b+4,b+140],[b+140,b+5], [b+128,b+142],[b+142,b+148],[b+148,b+134],
    [b+6,b+150],[b+150,b+7], [b+142,b+143],[b+148,b+150],
    // L wing upper
    [b+120,b+130],[b+130,b+122], [b+121,b+131],[b+135,b+123],
    [b+120,b+141],[b+141,b+121], [b+130,b+143],[b+143,b+149],[b+149,b+135],
    [b+122,b+151],[b+151,b+123], [b+141,b+143],[b+149,b+151],
    // L wing LE+hinge thickness (LE routed through nose vertex)
    [b+120,b+155],[b+155,b+4],[b+130,b+156],[b+156,b+128],[b+122,b+157],[b+157,b+6],
    [b+155,b+156],[b+156,b+157],                           // L LE nose span
    [b+140,b+141],[b+142,b+143],[b+148,b+149],[b+150,b+151],
    [b+140,b+142],[b+141,b+143],
    [b+8,b+10],[b+9,b+11],[b+10,b+11],[b+8,b+9],  // V-stab
    [b+12,b+14],[b+13,b+15],[b+12,b+13],[b+14,b+15],  // R h-stab
    [b+16,b+18],[b+17,b+19],[b+16,b+17],[b+18,b+19],  // L h-stab
    [b+118,b+100],[b+147,b+101],[b+100,b+101],        // R winglet (from upper tip)
    [b+122,b+102],[b+151,b+103],[b+102,b+103],        // L winglet (from upper tip)
    /* R engine rings A-E */
    [b+20,b+21],[b+21,b+22],[b+22,b+23],[b+23,b+24],[b+24,b+25],[b+25,b+26],[b+26,b+27],[b+27,b+20],
    [b+28,b+29],[b+29,b+30],[b+30,b+31],[b+31,b+32],[b+32,b+33],[b+33,b+34],[b+34,b+35],[b+35,b+28],
    [b+36,b+37],[b+37,b+38],[b+38,b+39],[b+39,b+40],[b+40,b+41],[b+41,b+42],[b+42,b+43],[b+43,b+36],
    [b+44,b+45],[b+45,b+46],[b+46,b+47],[b+47,b+48],[b+48,b+49],[b+49,b+50],[b+50,b+51],[b+51,b+44],
    [b+52,b+53],[b+53,b+54],[b+54,b+55],[b+55,b+56],[b+56,b+57],[b+57,b+58],[b+58,b+59],[b+59,b+52],
    /* R engine longerons A→B→C→D→E */
    [b+20,b+28],[b+22,b+30],[b+24,b+32],[b+26,b+34],
    [b+28,b+36],[b+30,b+38],[b+32,b+40],[b+34,b+42],
    [b+36,b+44],[b+38,b+46],[b+40,b+48],[b+42,b+50],
    [b+44,b+52],[b+46,b+54],[b+48,b+56],[b+50,b+58],
    /* R engine pylon: fan cowl → pylon top fwd/aft + chord */
    [b+28,b+112],[b+28,b+113],[b+112,b+113],
    /* L engine rings A-E */
    [b+60,b+61],[b+61,b+62],[b+62,b+63],[b+63,b+64],[b+64,b+65],[b+65,b+66],[b+66,b+67],[b+67,b+60],
    [b+68,b+69],[b+69,b+70],[b+70,b+71],[b+71,b+72],[b+72,b+73],[b+73,b+74],[b+74,b+75],[b+75,b+68],
    [b+76,b+77],[b+77,b+78],[b+78,b+79],[b+79,b+80],[b+80,b+81],[b+81,b+82],[b+82,b+83],[b+83,b+76],
    [b+84,b+85],[b+85,b+86],[b+86,b+87],[b+87,b+88],[b+88,b+89],[b+89,b+90],[b+90,b+91],[b+91,b+84],
    [b+92,b+93],[b+93,b+94],[b+94,b+95],[b+95,b+96],[b+96,b+97],[b+97,b+98],[b+98,b+99],[b+99,b+92],
    /* L engine longerons */
    [b+60,b+68],[b+62,b+70],[b+64,b+72],[b+66,b+74],
    [b+68,b+76],[b+70,b+78],[b+72,b+80],[b+74,b+82],
    [b+76,b+84],[b+78,b+86],[b+80,b+88],[b+82,b+90],
    [b+84,b+92],[b+86,b+94],[b+88,b+96],[b+90,b+98],
    /* L engine pylon: fan cowl → pylon top fwd/aft + chord */
    [b+68,b+114],[b+68,b+115],[b+114,b+115],
  );

  return { V_, F_, FC_, E_, b, r, anim: { r_rt, r_hs, r_ail } };
}

/* Build + cache geometry per aircraft nose profile */
const _wbCache = {};
for (const id of ['default','a350','a220','e190','b737','a340']) {
  const geo = _buildWB(_WB_NP[id]);
  geo.FN_ = computeFaceNormals(geo.V_, geo.F_);
  _wbCache[id] = geo;
}

/* Static aliases for the default profile (used as fallbacks + for non-WB aircraft selector) */
const { V_: _V, F_: _F, FC_: _FC, E_: _E } = _wbCache.default;
const _FN = _wbCache.default.FN_;

/* ── Landing gear (body frame, NM) — struts only ─────────────── */
const _GV = [
  /* 0 */ [ 0.009,  0,      -_r         ],  // nose strut top
  /* 1 */ [ 0.009,  0,      -_r - 0.0022],  // nose wheel
  /* 2 */ [-0.001,  0.0028, -_r         ],  // R main top
  /* 3 */ [-0.001,  0.0028, -_r - 0.0032],  // R main wheel
  /* 4 */ [-0.001, -0.0028, -_r         ],  // L main top
  /* 5 */ [-0.001, -0.0028, -_r - 0.0032],  // L main wheel
];
const _GE = [[0,1],[2,3],[4,5]];

/* ══════════════════════════════════════════════════════════════
   C172 geometry — high-wing piston single
   ══════════════════════════════════════════════════════════════ */

const _cr  = 0.0018;   // cowl ring radius
const _xr  = 0.0021;   // cabin ring radius
const _abr = 0.0016;   // aft-cabin ring radius
const _tr  = 0.0009;   // tail-boom ring radius
const _hs172  = 0.0110;   // C172 half-span
const _dh172  = 0.0004;   // C172 wing-tip dihedral offset
const _hst172 = 0.0050;   // C172 h-stab half-span
const _hst_th = 0.00025;  // h-stab thickness (z)
const _vst_th = 0.00022;  // v-stab half-thickness (y)
const _pr172  = 0.0014;   // prop disk radius (for arc rendering)
const _sp172  = 0.00050;  // C172 spinner base radius (small cone at prop plane)
const _spb    = 0.00044;  // Bf 109 spinner base radius (tighter — longer pointy spinner)

/* ── C172 wing spec ───────────────────────────────────────────── */
const _C172_WING = {
  span:      0.0110,          // half-span (NM)
  rootY:     0.0002,          // root Y — slight offset from centerline (high-wing symmetric)
  rootZ:     _xr,             // root lower-surface Z = top of cabin ring
  tipZ:      _xr + _dh172,    // tip lower-surface Z  (small upward dihedral)
  rootLE:    0.005,           // root leading-edge x
  rootTE:   -0.002,           // root trailing-edge x
  tipLE:     0.003,           // tip leading-edge x
  tipTE:    -0.004,           // tip trailing-edge x
  rootThick: 0.00042,         // root wing thickness (z) ≈ 9% of chord
  tipThick:  0.00028,         // tip wing thickness (z)
  flapBreak: 0.65,            // 65% span = flap / aileron boundary
  flapHinge: 0.65,            // chord fraction of flap hinge line
};

const _COLORS_c172 = [
  [240, 240, 240],  // 0 fuselage/tail — white
  [230, 235, 238],  // 1 wings / h-stabs — slightly darker
  [ 85,  90, 100],  // 2 cowl — dark gray
];

/* buildTube: 16-sided, 5 rings → rb=[0,16,32,48,64], noseTip=80, tailTip=81, extra=82+ */
const { V_: _V_c172, F_: _F_c172, FC_: _FC_c172, E_: _E_c172, anim: _anim_c172 } = (() => {
  const N = 16;
  /* ── Wing derivation from spec ── */
  const w    = _C172_WING;
  const wry  = w.rootY,    wrz = w.rootZ,   whs = w.span,  wtz = w.tipZ;
  const wrLE = w.rootLE,   wrTE = w.rootTE,  wtLE = w.tipLE, wtTE = w.tipTE;
  const wtr  = w.rootThick, wtt = w.tipThick, wfb  = w.flapBreak;
  const whY  = wry + (whs - wry) * wfb;
  const whLE = wrLE + wfb * (wtLE - wrLE);
  const whTE = wrTE + wfb * (wtTE - wrTE);
  const whZ  = wrz + wfb * (wtz - wrz);
  const whT  = wtr + wfb * (wtt - wtr);
  const wfh  = w.flapHinge;
  const wfxR = wrLE + wfh * (wrTE - wrLE);   // root hinge x
  const wfxH = whLE + wfh * (whTE - whLE);   // break hinge x
  const r_fl = wfxR - wrTE;                   // dist hinge→TE (constant chord)
  const wuh  = 1 - wfh * 0.85;               // upper surface z-fraction at hinge
  /* ── Aileron hinge (70% chord of outboard panel) ── */
  const wafh  = 0.70;
  const waxH  = whLE + wafh * (whTE - whLE);  // break aileron hinge x = -0.0012
  const waxT  = wtLE + wafh * (wtTE - wtLE);  // tip   aileron hinge x = -0.0019
  const r_ail = waxH - whTE;                   // hinge→TE arm = 0.0021
  const wAuh  = 1 - wafh * 0.85;              // upper z-fraction at aileron hinge
  /* ── H-stab elevator hinge (60% chord) ── */
  const hFwd = -0.009, hAft = -0.012;         // root LE/TE x
  const hTFwd = -0.010, hTAft = -0.013;       // tip  LE/TE x
  const hEH  = 0.60;
  const hRHx = hFwd  + hEH * (hAft  - hFwd); // root hinge x = -0.0108
  const hTHx = hTFwd + hEH * (hTAft - hTFwd);// tip  hinge x = -0.0118
  const r_el = hRHx - hAft;                   // dist hinge→TE = 0.0012
  const huh  = 1 - hEH * 0.85;               // upper z-fraction at hinge = 0.49
  /* ── V-stab rudder hinge (62% chord) ── */
  const vBFwd = -0.007, vBAft = -0.012;       // base LE/TE x
  const vTFwd = -0.008, vTAft = -0.013;       // top  LE/TE x
  const vRH  = 0.62;
  const vBHx = vBFwd + vRH * (vBAft - vBFwd);// base hinge x = -0.0101
  const vTHx = vTFwd + vRH * (vTAft - vTFwd);// top  hinge x = -0.0111
  const vTHz = 0.008 + vRH * (0.007 - 0.008);// top  hinge z = 0.00738
  const r_ru = vBHx - vBAft;                  // dist hinge→TE = 0.0019
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF:  0.009, r: _cr,  col: 2 },  // cowl  → cabin-fwd (dark)
    { vF:  0.004, r: _xr,  col: 0 },  // cabin-fwd → wing-stn
    { vF:  0.000, r: _xr,  col: 0 },  // wing-stn → aft-cabin
    { vF: -0.004, r: _abr, col: 0 },  // aft-cabin → tail-boom
    { vF: -0.009, r: _tr          },  // tail-boom (terminal)
  ]);

  const noseTip = V_.length;  V_.push([ 0.013, 0, 0]);
  const tailTip = V_.length;  V_.push([-0.013, 0, 0]);

  V_.push(  /* non-tube vertices 82-110 */
    [ wrLE,  wry,   wrz  ],  // 82 R wing root LE
    [ wrTE,  wry,   wrz  ],  // 83 R wing root TE
    [ wtLE,  whs,   wtz  ],  // 84 R wing tip LE
    [ wtTE,  whs,   wtz  ],  // 85 R wing tip TE
    [ wrLE, -wry,   wrz  ],  // 86 L wing root LE
    [ wrTE, -wry,   wrz  ],  // 87 L wing root TE
    [ wtLE, -whs,   wtz  ],  // 88 L wing tip LE
    [ wtTE, -whs,   wtz  ],  // 89 L wing tip TE
    [-0.007,  0,               _tr                ],  // 90 V-stab base fwd
    [-0.012,  0,               _tr                ],  // 91 V-stab base aft
    [-0.008,  0,               0.008              ],  // 92 V-stab top fwd
    [-0.013,  0,               0.007              ],  // 93 V-stab top aft
    [-0.009,  _tr+0.0003,      0                  ],  // 94 R h-stab root fwd
    [-0.012,  _tr+0.0003,      0                  ],  // 95 R h-stab root aft
    [-0.010,  _hst172,        0.001              ],  // 96 R h-stab tip fwd
    [-0.013,  _hst172,        0.001              ],  // 97 R h-stab tip aft
    [-0.009, -_tr-0.0003,      0                  ],  // 98 L h-stab root fwd
    [-0.012, -_tr-0.0003,      0                  ],  // 99 L h-stab root aft
    [-0.010, -_hst172,        0.001              ],  // 100 L h-stab tip fwd
    [-0.013, -_hst172,        0.001              ],  // 101 L h-stab tip aft
    [ 0.001,  _hs172*0.95,     _xr                ],  // 102 R strut top
    [ 0.001,  _xr*1.5,        -_xr*0.4            ],  // 103 R strut bottom
    [ 0.001, -_hs172*0.95,     _xr                ],  // 104 L strut top
    [ 0.001, -_xr*1.5,        -_xr*0.4            ],  // 105 L strut bottom
    [ 0.013,  _pr172,          0                  ],  // 106 prop tip (arc ref)
    [ whLE,  whY,   whZ  ],  // 107 R break LE
    [ whTE,  whY,   whZ  ],  // 108 R break TE
    [ whLE, -whY,   whZ  ],  // 109 L break LE
    [ whTE, -whY,   whZ  ],  // 110 L break TE
    /* Spinner base ring — 16 verts at prop plane, r=_sp172 (indices 111-126) */
    ...Array.from({length: N}, (_, si) => {
      const a = Math.PI * 0.5 - si / N * Math.PI * 2;
      return [0.011, _sp172 * Math.cos(a), _sp172 * Math.sin(a)];
    }),
  );
  /* Upper wing surface vertices 127-138 */
  V_.push(
    [ wrLE,  wry,   wrz + wtr        ],  // 127 R root upper LE
    [ wrTE,  wry,   wrz + wtr * 0.15 ],  // 128 R root upper TE  (flap)
    [ wtLE,  whs,   wtz + wtt        ],  // 129 R tip  upper LE
    [ wtTE,  whs,   wtz + wtt * 0.15 ],  // 130 R tip  upper TE  (aileron)
    [ whLE,  whY,   whZ + whT        ],  // 131 R break upper LE
    [ whTE,  whY,   whZ + whT * 0.15 ],  // 132 R break upper TE (flap/aileron pivot)
    [ wrLE, -wry,   wrz + wtr        ],  // 133 L root upper LE
    [ wrTE, -wry,   wrz + wtr * 0.15 ],  // 134 L root upper TE  (flap)
    [ wtLE, -whs,   wtz + wtt        ],  // 135 L tip  upper LE
    [ wtTE, -whs,   wtz + wtt * 0.15 ],  // 136 L tip  upper TE  (aileron)
    [ whLE, -whY,   whZ + whT        ],  // 137 L break upper LE
    [ whTE, -whY,   whZ + whT * 0.15 ],  // 138 L break upper TE (flap/aileron pivot)
  );
  /* Flap hinge vertices 139-146 */
  V_.push(
    [ wfxR,  wry,   wrz              ],  // 139 R root lower hinge
    [ wfxH,  whY,   whZ              ],  // 140 R break lower hinge
    [ wfxR, -wry,   wrz              ],  // 141 L root lower hinge
    [ wfxH, -whY,   whZ              ],  // 142 L break lower hinge
    [ wfxR,  wry,   wrz + wtr * wuh  ],  // 143 R root upper hinge
    [ wfxH,  whY,   whZ + whT * wuh  ],  // 144 R break upper hinge
    [ wfxR, -wry,   wrz + wtr * wuh  ],  // 145 L root upper hinge
    [ wfxH, -whY,   whZ + whT * wuh  ],  // 146 L break upper hinge
  );
  /* H-stab: upper surface + elevator hinges — R side 147-154, L side 155-162 */
  const hRY = _tr + 0.0003;  // root Y (same as vertex 94/98)
  V_.push(
    [ hFwd,  hRY,    _hst_th              ],  // 147 R root upper LE
    [ hAft,  hRY,    _hst_th * 0.15       ],  // 148 R root upper TE  (elevator)
    [ hTFwd, _hst172, 0.001 + _hst_th     ],  // 149 R tip  upper LE
    [ hTAft, _hst172, 0.001 + _hst_th*0.15],  // 150 R tip  upper TE  (elevator)
    [ hRHx,  hRY,    0                    ],  // 151 R root lower hinge
    [ hRHx,  hRY,    _hst_th * huh        ],  // 152 R root upper hinge
    [ hTHx,  _hst172, 0.001               ],  // 153 R tip  lower hinge
    [ hTHx,  _hst172, 0.001 + _hst_th*huh ],  // 154 R tip  upper hinge
    [ hFwd, -hRY,    _hst_th              ],  // 155 L root upper LE
    [ hAft, -hRY,    _hst_th * 0.15       ],  // 156 L root upper TE  (elevator)
    [ hTFwd,-_hst172, 0.001 + _hst_th     ],  // 157 L tip  upper LE
    [ hTAft,-_hst172, 0.001 + _hst_th*0.15],  // 158 L tip  upper TE  (elevator)
    [ hRHx, -hRY,    0                    ],  // 159 L root lower hinge
    [ hRHx, -hRY,    _hst_th * huh        ],  // 160 L root upper hinge
    [ hTHx, -_hst172, 0.001               ],  // 161 L tip  lower hinge
    [ hTHx, -_hst172, 0.001 + _hst_th*huh ],  // 162 L tip  upper hinge
  );
  /* V-stab rudder hinge vertices 163-164 */
  V_.push(
    [ vBHx, 0, _tr     ],  // 163 v-stab base hinge
    [ vTHx, 0, vTHz    ],  // 164 v-stab top  hinge
  );
  /* Aileron hinge vertices 165-172 */
  V_.push(
    [ waxH,  whY,   whZ              ],  // 165 R lower break hinge
    [ waxT,  whs,   wtz              ],  // 166 R lower tip  hinge
    [ waxH,  whY,   whZ + whT * wAuh ],  // 167 R upper break hinge
    [ waxT,  whs,   wtz + wtt * wAuh ],  // 168 R upper tip  hinge
    [ waxH, -whY,   whZ              ],  // 169 L lower break hinge
    [ waxT, -whs,   wtz              ],  // 170 L lower tip  hinge
    [ waxH, -whY,   whZ + whT * wAuh ],  // 171 L upper break hinge
    [ waxT, -whs,   wtz + wtt * wAuh ],  // 172 L upper tip  hinge
  );
  /* Wing strut tube vertices 173-180 — fore/aft offset ±t from centre */
  const t_strut = 0.00014;
  V_.push(
    [ 0.001+t_strut,  _hs172*0.95,  _xr         ],  // 173 R top fore
    [ 0.001-t_strut,  _hs172*0.95,  _xr         ],  // 174 R top aft
    [ 0.001+t_strut,  _xr*1.5,     -_xr*0.4     ],  // 175 R bot fore
    [ 0.001-t_strut,  _xr*1.5,     -_xr*0.4     ],  // 176 R bot aft
    [ 0.001+t_strut, -_hs172*0.95,  _xr         ],  // 177 L top fore
    [ 0.001-t_strut, -_hs172*0.95,  _xr         ],  // 178 L top aft
    [ 0.001+t_strut, -_xr*1.5,     -_xr*0.4     ],  // 179 L bot fore
    [ 0.001-t_strut, -_xr*1.5,     -_xr*0.4     ],  // 180 L bot aft
  );
  /* Aileron break-TE duplicates 181-184 — decouple flap from aileron at break station */
  V_.push(
    [ whTE,  whY,  whZ              ],  // 181 R break lower TE  (aileron, copy of 108)
    [ whTE,  whY,  whZ + whT * 0.15 ],  // 182 R break upper TE  (aileron, copy of 132)
    [ whTE, -whY,  whZ              ],  // 183 L break lower TE  (aileron, copy of 110)
    [ whTE, -whY,  whZ + whT * 0.15 ],  // 184 L break upper TE  (aileron, copy of 138)
  );

  const spBase = 111;  // first spinner base vertex (noseTip=80, tailTip=81, non-tube 82-110)
  /* Spinner tris: noseTip → spinner base (fuselage color — painted spinner) */
  for (let si = 0; si < N; si++) { F_.push([noseTip, spBase+(si+1)%N, spBase+si]); FC_.push(0); }
  /* Cowl front: spinner base → cowl ring, annular face (dark — cowling front visible head-on) */
  for (let si = 0; si < N; si++) { F_.push([spBase+si, spBase+(si+1)%N, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(2); }
  /* Tail tris: tail-boom → tailTip (outward) */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[4]+si, rb[4]+(si+1)%N]); FC_.push(0); }

  /* Non-tube faces (wings upper+lower, tip caps, v-stab, h-stabs) */
  F_.push(
    [82,139,140,107],       // R lower fixed (LE→hinge)
    [139,83,108,140],       // R lower flap  (hinge→TE)
    [107,165,166,84],       // R lower aileron fixed
    [165,181,85,166],       // R lower aileron moving
    [127,131,144,143],      // R upper fixed
    [143,144,132,128],      // R upper flap
    [131,129,168,167],      // R upper aileron fixed
    [167,168,130,182],      // R upper aileron moving
    [84,166,168,129],       // R tip cap fixed
    [166,85,130,168],       // R tip cap moving
    [86,109,142,141],       // L lower fixed
    [141,142,110,87],       // L lower flap
    [109,88,170,169],       // L lower aileron fixed
    [169,170,89,183],       // L lower aileron moving
    [133,145,146,137],      // L upper fixed
    [145,134,138,146],      // L upper flap
    [137,171,172,135],      // L upper aileron fixed
    [171,184,136,172],      // L upper aileron moving
    [88,135,172,170],       // L tip cap fixed
    [170,172,136,89],       // L tip cap moving
    [90,92,164,163],[90,163,164,92],      // V-stab fixed (port/stbd)
    [163,164,93,91],[163,91,93,164],      // V-stab rudder (port/stbd)
    [94,151,153,96],[151,95,97,153],      // R h-stab lower (fixed/elevator)
    [147,149,154,152],[152,154,150,148],  // R h-stab upper (fixed/elevator)
    [96,97,150,149],                      // R tip cap
    [98,100,161,159],[159,161,101,99],    // L h-stab lower (fixed/elevator)
    [155,160,162,157],[160,156,158,162],  // L h-stab upper (fixed/elevator)
    [100,157,158,101],                    // L tip cap
    [173,175,176,174],[174,176,175,173],  // R strut fore/aft
    [177,179,180,178],[178,180,179,177],  // L strut fore/aft
  );
  FC_.push(1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1, 0,0,0,0, 0,0,0,0,0,0,0,0,0,0, 0,0,0,0);

  /* Longerons: noseTip → spinner base → cowl ring → … → tailTip at 4 cardinal sides */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, spBase+si]);
    E_.push([spBase+si, rb[0]+si]);
    for (let ri = 0; ri < 4; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[4]+si, tailTip]);
  }
  /* Spinner base ring perimeter */
  for (let si = 0; si < N; si++) E_.push([spBase+si, spBase+(si+1)%N]);
  /* Non-tube edges */
  E_.push(
    // R lower wing
    [82,107],[107,84],[83,108],
    [82,139],[139,83],[107,140],[140,165],[165,181],[181,85],[84,166],[166,85],[139,140],[165,166],
    [rb[2]+0, 82],[rb[2]+0, 83],
    // L lower wing
    [86,109],[109,88],[87,110],
    [86,141],[141,87],[109,142],[142,169],[169,183],[183,89],[88,170],[170,89],[141,142],[169,170],
    [rb[2]+0, 86],[rb[2]+0, 87],
    // R upper surface
    [82,127],[83,128],[107,131],[108,132],[84,129],[85,130],[181,182],  // lower→upper thickness
    [165,167],[166,168],                                                 // aileron hinge lower→upper R
    [139,143],[140,144],                                                 // flap hinge lower→upper R
    [127,131],[131,129],  // upper LE
    [128,132],[182,130],  // upper TE (flap side / aileron side decoupled)
    [127,143],[143,128],[131,144],[144,167],[167,182],[129,168],[168,130],[143,144],[167,168],
    // L upper surface
    [86,133],[87,134],[109,137],[110,138],[88,135],[89,136],[183,184],
    [169,171],[170,172],                                                 // aileron hinge lower→upper L
    [141,145],[142,146],                                                 // flap hinge lower→upper L
    [133,137],[137,135],
    [134,138],[184,136],
    [133,145],[145,134],[137,146],[146,171],[171,184],[135,172],[172,136],[145,146],[171,172],
    [173,175],[175,176],[176,174],[174,173],  // R strut outline
    [177,179],[179,180],[180,178],[178,177],  // L strut outline
    [90,92],[91,93],[90,163],[163,91],[92,164],[164,93],[163,164],[rb[4]+0,90],[rb[4]+0,91],  // V-stab
    [94,96],[95,97],[94,151],[151,95],[96,153],[153,97],[151,153],[rb[4]+4,94],               // R h-stab lower
    [94,147],[95,148],[96,149],[97,150],[151,152],[153,154],                                   // R h-stab thickness
    [147,149],[148,150],[147,152],[152,148],[149,154],[154,150],[152,154],                     // R h-stab upper
    [98,100],[99,101],[98,159],[159,99],[100,161],[161,101],[159,161],[rb[4]+12,98],           // L h-stab lower
    [98,155],[99,156],[100,157],[101,158],[159,160],[161,162],                                 // L h-stab thickness
    [155,157],[156,158],[155,160],[160,156],[157,162],[162,158],[160,162],                     // L h-stab upper
  );

  return { V_, F_, FC_, E_, anim: { r_fl, r_el, r_ru, r_ail } };
})();
const _FN_c172 = computeFaceNormals(_V_c172, _F_c172);

/* Light positions in body frame — [fwd, right, up], color [r,g,b], switch key */
const _LIGHTS_c172 = [
  { pos: [ 0.003,  _hs172,  _xr+_dh172], col: [0,210,80],    key: 'nav'     },  // R wingtip green
  { pos: [ 0.003, -_hs172,  _xr+_dh172], col: [220,40,40],   key: 'nav'     },  // L wingtip red
  { pos: [-0.013,  0,        0.007      ], col: [255,255,255], key: 'nav'     },  // tail white
  { pos: [ 0.000,  0,        _xr+0.001  ], col: [220,50,50],  key: 'beacon'  },  // rotating beacon top
  { pos: [ 0.003,  _hs172,  _xr+_dh172], col: [255,255,255], key: 'strobe'  },  // R strobe
  { pos: [ 0.003, -_hs172,  _xr+_dh172], col: [255,255,255], key: 'strobe'  },  // L strobe
  { pos: [ 0.011,  0,        0          ], col: [255,248,220], key: 'landing' },  // landing light
];

/* Wide-body jet light positions — body frame [fwd, right, up] */
const _LIGHTS_wb = [
  { pos: [-0.003,  _hs,  _dh    ], col: [  0, 210,  80], key: 'nav'     },  // R wingtip green
  { pos: [-0.003, -_hs,  _dh    ], col: [220,  40,  40], key: 'nav'     },  // L wingtip red
  { pos: [-0.020,  0,    0.007  ], col: [255, 255, 255], key: 'nav'     },  // tail white
  { pos: [ 0.001,  0,    _r     ], col: [220,  50,  50], key: 'beacon'  },  // rotating beacon (fuselage top)
  { pos: [-0.003,  _hs,  _dh    ], col: [255, 255, 255], key: 'strobe'  },  // R wingtip strobe
  { pos: [-0.003, -_hs,  _dh    ], col: [255, 255, 255], key: 'strobe'  },  // L wingtip strobe
  { pos: [ 0.013,  0,    0      ], col: [255, 248, 220], key: 'landing' },  // nose landing lights
];

const _GV_c172 = [
  /* 0 */ [ 0.007,  0,        -_xr        ],  // nose strut top
  /* 1 */ [ 0.007,  0,        -_xr-0.0018 ],  // nose wheel
  /* 2 */ [ 0.000,  0.0014,   -_xr        ],  // R main top
  /* 3 */ [ 0.000,  0.0014,   -_xr-0.0020 ],  // R main wheel
  /* 4 */ [ 0.000, -0.0014,   -_xr        ],  // L main top
  /* 5 */ [ 0.000, -0.0014,   -_xr-0.0020 ],  // L main wheel
];

/* ══════════════════════════════════════════════════════════════
   Messerschmitt Bf 109G-6
   Body frame: fwd = nose, right = starboard, up = above
   Units: NM
   ══════════════════════════════════════════════════════════════ */

/* Fuselage cross-sections — ry = half-width, rz = half-height */
const _bcR  = 0.0016;  // cowl  (near-circular)
const _bfRy = 0.0011;  // body  half-width  (narrow!)
const _bfRz = 0.0015;  // body  half-height
const _baRy = 0.0007;  // aft   half-width
const _baRz = 0.0011;  // aft   half-height
const _btRy = 0.0004;  // tail  half-width
const _btRz = 0.0006;  // tail  half-height
const _b9hs = 0.0138;   // half-span
const _b9dh = 0.0002;   // wing dihedral
const _b9vH = 0.0038;   // V-stab height above fuselage top
const _b9hw = 0.0045;   // H-stab half-span
const _b9pr = 0.0042;   // prop disk radius
const _bCzH = 0.0010;   // canopy height above fuselage top
const _bCyW = 0.0007;   // canopy half-width

const _COLORS_b109 = [
  [168, 174, 145],  // 0 fuselage — RLM 74 dark grey-green
  [150, 158, 136],  // 1 wings    — RLM 75 grey-violet
  [ 50,  54,  46],  // 2 cowl     — dark engine cowl
  [168, 174, 145],  // 3 tail surfaces — same as fuselage
  [ 38,  52,  68],  // 4 canopy glass — dark tinted
];

/* buildTube: 16-sided, 6 rings A-F → rb=[0,16,32,48,64,80], noseTip=96, tailTip=97, extra=98+ */
const { V_: _V_b109, F_: _F_b109, FC_: _FC_b109, E_: _E_b109, anim: _anim_b109 } = (() => {
  const N = 16;

  /* ── Wing spec (low-wing, slight dihedral) ── */
  const whs = _b9hs, wdh = _b9dh;
  const wry = _bfRy, wrz = -_bfRz*0.4, wtz = wrz + wdh;
  const wrLE = 0.004, wrTE = -0.002, wtLE = 0.001, wtTE = -0.004;
  const wtr = 0.00060, wtt = 0.00038;     // root / tip thickness
  const wfb = 0.55, wfh = 0.70;           // span-break, hinge chord fraction
  const wbY  = wry + (whs - wry) * wfb;
  const wbLE = wrLE + wfb * (wtLE - wrLE);
  const wbTE = wrTE + wfb * (wtTE - wrTE);
  const wbZ  = wrz  + wfb * (wtz  - wrz);
  const wbt  = wtr  + wfb * (wtt  - wtr);
  const wfxR = wrLE + wfh * (wrTE - wrLE);  // root flap hinge x
  const wfxB = wbLE + wfh * (wbTE - wbLE);  // break hinge x (shared by flap + ail)
  const waxT = wtLE + wfh * (wtTE - wtLE);   // tip aileron hinge x
  const r_fl  = wfxR - wrTE;
  const r_ail = wfxB - wbTE;
  const wuh   = 1 - wfh * 0.85;             // upper z-fraction at hinge

  /* ── H-stab elevator hinge (60% chord) ── */
  const hst_th = 0.00025, hst_tt = 0.00018;
  const heH  = 0.60;
  const heRx = -0.010 + heH * (-0.013 - (-0.010));
  const heTx = -0.011 + heH * (-0.013 - (-0.011));
  const r_el = heRx - (-0.013);
  const huh  = 1 - heH * 0.85;

  /* ── Rudder hinge (62% chord) ── */
  const ruH  = 0.62;
  const ruBx = -0.007 + ruH * (-0.013 - (-0.007));
  const ruTx = -0.009 + ruH * (-0.013 - (-0.009));
  const r_ru = (ruBx + ruTx) * 0.5 - (-0.013);  // avg arm ≈ 0.0019 NM
  const ruBz = _baRz + ruH * (_btRz - _baRz);
  const ruTz = (_baRz+_b9vH) + ruH * ((_btRz+_b9vH*0.82) - (_baRz+_b9vH));

  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF:  0.011, r: _bcR,                col: 2 },  // A cowl-fwd  → B: col 2
    { vF:  0.006, r: _bcR,                col: 2 },  // B cowl-rear → C: col 2
    { vF:  0.002, ry: _bfRy, rz: _bfRz,  col: 2 },  // C body-fwd  → D: col 2 (cowl area)
    { vF: -0.002, ry: _bfRy, rz: _bfRz,  col: 0 },  // D wing-stn  → E
    { vF: -0.007, ry: _baRy, rz: _baRz,  col: 0 },  // E aft       → F
    { vF: -0.011, ry: _btRy, rz: _btRz          },  // F tail (terminal)
  ]);

  const noseTip = V_.length;  V_.push([ 0.015, 0, 0]);
  const tailTip = V_.length;  V_.push([-0.014, 0, 0]);

  V_.push(  /* non-tube vertices 98-126 */
    [ 0.004, +_bfRy,  -_bfRz*0.4              ],  // 98  R root LE
    [-0.002, +_bfRy,  -_bfRz*0.4              ],  // 99  R root TE
    [ 0.001, +_b9hs,  -_bfRz*0.4+_b9dh        ],  // 100 R tip LE
    [-0.004, +_b9hs,  -_bfRz*0.4+_b9dh        ],  // 101 R tip TE
    [ 0.004, -_bfRy,  -_bfRz*0.4              ],  // 102 L root LE
    [-0.002, -_bfRy,  -_bfRz*0.4              ],  // 103 L root TE
    [ 0.001, -_b9hs,  -_bfRz*0.4+_b9dh        ],  // 104 L tip LE
    [-0.004, -_b9hs,  -_bfRz*0.4+_b9dh        ],  // 105 L tip TE
    [-0.007,  0,       _baRz                   ],  // 106 V-stab LE base
    [-0.013,  0,       _btRz                   ],  // 107 V-stab TE base
    [-0.009,  0,       _baRz+_b9vH             ],  // 108 V-stab LE top
    [-0.013,  0,       _btRz+_b9vH*0.82        ],  // 109 V-stab TE top
    [-0.010, +_btRy,   _btRz*0.1               ],  // 110 R h-stab root fwd
    [-0.013, +_btRy,   _btRz*0.1               ],  // 111 R h-stab root aft
    [-0.011, +_b9hw,   0.001                   ],  // 112 R h-stab tip fwd
    [-0.013, +_b9hw,   0.001                   ],  // 113 R h-stab tip aft
    [-0.010, -_btRy,   _btRz*0.1               ],  // 114 L h-stab root fwd
    [-0.013, -_btRy,   _btRz*0.1               ],  // 115 L h-stab root aft
    [-0.011, -_b9hw,   0.001                   ],  // 116 L h-stab tip fwd
    [-0.013, -_b9hw,   0.001                   ],  // 117 L h-stab tip aft
    [ 0.015, +_b9pr,   0                       ],  // 118 prop disk radius ref
    [ 0.004, -_bCyW,   _bfRz                   ],  // 119 windscreen base L
    [ 0.004, +_bCyW,   _bfRz                   ],  // 120 windscreen base R
    [ 0.003, +_bCyW*0.118, _bfRz+_bCzH*0.118  ],  // 121 windscreen top R
    [ 0.003, -_bCyW*0.118, _bfRz+_bCzH*0.118  ],  // 122 windscreen top L
    [-0.001, -_bCyW*0.118, _bfRz+_bCzH        ],  // 123 crown top L
    [-0.001, +_bCyW*0.118, _bfRz+_bCzH        ],  // 124 crown top R
    [-0.003, +_bCyW,   _bfRz                   ],  // 125 aft base R
    [-0.003, -_bCyW,   _bfRz                   ],  // 126 aft base L
    /* Spinner base ring — 16 verts at prop plane, r=_spb (indices 127-142) */
    ...Array.from({length: N}, (_, si) => {
      const a = Math.PI * 0.5 - si / N * Math.PI * 2;
      return [0.012, _spb * Math.cos(a), _spb * Math.sin(a)];
    }),
  );

  /* ── Wing lower break station (143-146) ── */
  V_.push(
    [ wbLE, +wbY, wbZ ],  // 143 R break lower LE
    [ wbTE, +wbY, wbZ ],  // 144 R break lower TE  (flap side)
    [ wbLE, -wbY, wbZ ],  // 145 L break lower LE
    [ wbTE, -wbY, wbZ ],  // 146 L break lower TE  (flap side)
  );
  /* ── Wing upper surface (147-158) ── */
  V_.push(
    [ wrLE, +wry, wrz + wtr        ],  // 147 R root upper LE
    [ wrTE, +wry, wrz + wtr * 0.15 ],  // 148 R root upper TE
    [ wtLE, +whs, wtz + wtt        ],  // 149 R tip  upper LE
    [ wtTE, +whs, wtz + wtt * 0.15 ],  // 150 R tip  upper TE
    [ wbLE, +wbY, wbZ + wbt        ],  // 151 R break upper LE
    [ wbTE, +wbY, wbZ + wbt * 0.15 ],  // 152 R break upper TE
    [ wrLE, -wry, wrz + wtr        ],  // 153 L root upper LE
    [ wrTE, -wry, wrz + wtr * 0.15 ],  // 154 L root upper TE
    [ wtLE, -whs, wtz + wtt        ],  // 155 L tip  upper LE
    [ wtTE, -whs, wtz + wtt * 0.15 ],  // 156 L tip  upper TE
    [ wbLE, -wbY, wbZ + wbt        ],  // 157 L break upper LE
    [ wbTE, -wbY, wbZ + wbt * 0.15 ],  // 158 L break upper TE
  );
  /* ── Flap hinge verts (159-166) ── */
  V_.push(
    [ wfxR, +wry, wrz              ],  // 159 R root lower flap hinge
    [ wfxB, +wbY, wbZ              ],  // 160 R break lower flap hinge
    [ wfxR, +wry, wrz + wtr * wuh  ],  // 161 R root upper flap hinge
    [ wfxB, +wbY, wbZ + wbt * wuh  ],  // 162 R break upper flap hinge
    [ wfxR, -wry, wrz              ],  // 163 L root lower flap hinge
    [ wfxB, -wbY, wbZ              ],  // 164 L break lower flap hinge
    [ wfxR, -wry, wrz + wtr * wuh  ],  // 165 L root upper flap hinge
    [ wfxB, -wbY, wbZ + wbt * wuh  ],  // 166 L break upper flap hinge
  );
  /* ── Aileron hinge verts (167-174) ── */
  V_.push(
    [ wfxB, +wbY, wbZ              ],  // 167 R break lower ail hinge
    [ waxT, +whs, wtz              ],  // 168 R tip   lower ail hinge
    [ wfxB, +wbY, wbZ + wbt * wuh  ],  // 169 R break upper ail hinge
    [ waxT, +whs, wtz + wtt * wuh  ],  // 170 R tip   upper ail hinge
    [ wfxB, -wbY, wbZ              ],  // 171 L break lower ail hinge
    [ waxT, -whs, wtz              ],  // 172 L tip   lower ail hinge
    [ wfxB, -wbY, wbZ + wbt * wuh  ],  // 173 L break upper ail hinge
    [ waxT, -whs, wtz + wtt * wuh  ],  // 174 L tip   upper ail hinge
  );
  /* ── Break-TE duplicates — decouple flap/aileron at span break (175-178) ── */
  V_.push(
    [ wbTE, +wbY, wbZ              ],  // 175 R break lower TE (ail side, dup of 144)
    [ wbTE, +wbY, wbZ + wbt * 0.15 ],  // 176 R break upper TE (ail side, dup of 152)
    [ wbTE, -wbY, wbZ              ],  // 177 L break lower TE (ail side, dup of 146)
    [ wbTE, -wbY, wbZ + wbt * 0.15 ],  // 178 L break upper TE (ail side, dup of 158)
  );
  /* ── H-stab upper surface (179-186) ── */
  const hRY = _btRy, hTY = _b9hw, hRZ = _btRz * 0.1, hTZ = 0.001;
  V_.push(
    [ -0.010, +hRY, hRZ + hst_th          ],  // 179 R root upper LE
    [ -0.013, +hRY, hRZ + hst_th * 0.15   ],  // 180 R root upper TE
    [ -0.011, +hTY, hTZ + hst_tt          ],  // 181 R tip  upper LE
    [ -0.013, +hTY, hTZ + hst_tt * 0.15   ],  // 182 R tip  upper TE
    [ -0.010, -hRY, hRZ + hst_th          ],  // 183 L root upper LE
    [ -0.013, -hRY, hRZ + hst_th * 0.15   ],  // 184 L root upper TE
    [ -0.011, -hTY, hTZ + hst_tt          ],  // 185 L tip  upper LE
    [ -0.013, -hTY, hTZ + hst_tt * 0.15   ],  // 186 L tip  upper TE
  );
  /* ── Elevator hinge verts (187-194) ── */
  V_.push(
    [ heRx, +hRY, hRZ                   ],  // 187 R root lower elevator hinge
    [ heRx, +hRY, hRZ + hst_th * huh    ],  // 188 R root upper elevator hinge
    [ heTx, +hTY, hTZ                   ],  // 189 R tip  lower elevator hinge
    [ heTx, +hTY, hTZ + hst_tt * huh    ],  // 190 R tip  upper elevator hinge
    [ heRx, -hRY, hRZ                   ],  // 191 L root lower elevator hinge
    [ heRx, -hRY, hRZ + hst_th * huh    ],  // 192 L root upper elevator hinge
    [ heTx, -hTY, hTZ                   ],  // 193 L tip  lower elevator hinge
    [ heTx, -hTY, hTZ + hst_tt * huh    ],  // 194 L tip  upper elevator hinge
  );
  /* ── Rudder hinge verts (195-196) ── */
  V_.push(
    [ ruBx, 0, ruBz ],  // 195 V-stab base hinge
    [ ruTx, 0, ruTz ],  // 196 V-stab top  hinge
  );

  const spBase = 127;
  for (let si = 0; si < N; si++) { F_.push([noseTip, spBase+(si+1)%N, spBase+si]); FC_.push(2); }
  for (let si = 0; si < N; si++) { F_.push([spBase+si, spBase+(si+1)%N, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(2); }
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[5]+si, rb[5]+(si+1)%N]); FC_.push(0); }

  /* Non-tube faces */
  F_.push(
    /* R wing lower: fixed + flap + ail fixed + ail moving */
    [98,159,160,143],[159,99,144,160],[143,167,168,100],[167,175,101,168],
    /* R wing upper: fixed + flap + ail fixed + ail moving */
    [147,151,162,161],[161,162,152,148],[151,149,170,169],[169,170,150,176],
    /* R tip cap: fixed + moving */
    [100,168,170,149],[168,101,150,170],
    /* L wing lower: fixed + flap + ail fixed + ail moving */
    [102,145,164,163],[163,164,146,103],[145,104,172,171],[171,172,105,177],
    /* L wing upper: fixed + flap + ail fixed + ail moving */
    [153,165,166,157],[165,154,158,166],[157,173,174,155],[173,178,156,174],
    /* L tip cap: fixed + moving */
    [104,155,174,172],[172,174,156,105],
    /* V-stab: fixed (both sides) + rudder (both sides) */
    [106,108,196,195],[106,195,196,108],[195,196,109,107],[195,107,109,196],
    /* R h-stab lower: fixed + elevator */
    [110,187,189,112],[187,111,113,189],
    /* R h-stab upper: fixed + elevator */
    [179,181,190,188],[188,190,182,180],
    /* R h-stab tip cap */
    [112,113,182,181],
    /* L h-stab lower: fixed + elevator */
    [114,116,193,191],[191,193,117,115],
    /* L h-stab upper: fixed + elevator */
    [183,192,194,185],[192,184,186,194],
    /* L h-stab tip cap */
    [116,117,186,185],
    /* Canopy */
    [119,120,121,122],[120,125,124,121],[119,122,123,126],[122,121,124,123],[126,123,124,125],
  );
  FC_.push(
    1,1,1,1, 1,1,1,1, 1,1,   // R wing (10)
    1,1,1,1, 1,1,1,1, 1,1,   // L wing (10)
    3,3,3,3,                   // V-stab (4)
    3,3, 3,3, 3,               // R h-stab (5)
    3,3, 3,3, 3,               // L h-stab (5)
    4,4,4,4,4,                 // canopy (5)
  );

  /* Longerons: noseTip → spinner base → cowl ring A → … → tailTip */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, spBase+si]);
    E_.push([spBase+si, rb[0]+si]);
    for (let ri = 0; ri < 5; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[5]+si, tailTip]);
  }
  for (let si = 0; si < N; si++) E_.push([spBase+si, spBase+(si+1)%N]);

  /* Non-tube edges */
  E_.push(
    /* R wing lower spans + cross-chord */
    [98,143],[143,100],[99,144],
    [98,159],[159,99],[143,160],[160,167],[167,175],[175,101],[100,168],[168,101],[159,160],[167,168],
    [rb[2]+4,98],[rb[3]+4,99],
    /* L wing lower spans + cross-chord */
    [102,145],[145,104],[103,146],
    [102,163],[163,103],[145,164],[164,171],[171,177],[177,105],[104,172],[172,105],[163,164],[171,172],
    [rb[2]+12,102],[rb[3]+12,103],
    /* R wing upper thickness */
    [98,147],[99,148],[100,149],[101,150],[143,151],[144,152],[175,176],
    [159,161],[160,162],[167,169],[168,170],
    /* R wing upper LE + TE spans */
    [147,151],[151,149],[148,152],[176,150],
    /* R wing upper cross-chord */
    [147,161],[161,148],[151,162],[162,169],[169,176],[149,170],[170,150],[161,162],[169,170],
    /* L wing upper thickness */
    [102,153],[103,154],[104,155],[105,156],[145,157],[146,158],[177,178],
    [163,165],[164,166],[171,173],[172,174],
    /* L wing upper LE + TE spans */
    [153,157],[157,155],[154,158],[178,156],
    /* L wing upper cross-chord */
    [153,165],[165,154],[157,166],[166,173],[173,178],[155,174],[174,156],[165,166],[173,174],
    /* V-stab: fixed outline + rudder outline */
    [106,108],[106,195],[108,196],[195,196],
    [107,109],[107,195],[109,196],
    /* R h-stab lower */
    [110,112],[110,187],[112,189],[187,189],
    [111,113],[111,187],[113,189],
    /* R h-stab thickness */
    [110,179],[111,180],[112,181],[113,182],[187,188],[189,190],
    /* R h-stab upper */
    [179,181],[179,188],[181,190],[188,190],
    [180,182],[188,180],[190,182],
    /* R h-stab tip cap + body */
    [181,182],[112,181],[113,182],[rb[5]+4,110],
    /* L h-stab lower */
    [114,116],[114,191],[116,193],[191,193],
    [115,117],[115,191],[117,193],
    /* L h-stab thickness */
    [114,183],[115,184],[116,185],[117,186],[191,192],[193,194],
    /* L h-stab upper */
    [183,185],[183,192],[185,194],[192,194],
    [184,186],[192,184],[194,186],
    /* L h-stab tip cap + body */
    [185,186],[116,185],[117,186],[rb[5]+12,114],
    /* Canopy */
    [119,120],[120,121],[121,122],[122,119],
    [123,124],[124,125],[125,126],[126,123],
    [121,124],[122,123],[119,126],[120,125],
  );

  return { V_, F_, FC_, E_, anim: { r_fl, r_el, r_ru, r_ail } };
})();
const _FN_b109 = computeFaceNormals(_V_b109, _F_b109);

const _GV_b109 = [
  /* 0 */ [ 0.001,  0.0009, -0.0015 ],  // R main top (at fuselage bottom-right)
  /* 1 */ [ 0.001,  0.0016, -0.0037 ],  // R main wheel (narrow track)
  /* 2 */ [ 0.001, -0.0009, -0.0015 ],  // L main top
  /* 3 */ [ 0.001, -0.0016, -0.0037 ],  // L main wheel
  /* 4 */ [-0.012,  0,      -0.0006 ],  // tail strut top
  /* 5 */ [-0.012,  0,      -0.0012 ],  // tail wheel
];

/* ══════════════════════════════════════════════════════════════
   F4U-1A Corsair — inverted gull-wing fighter (R-2800 Double Wasp)
   Body frame: fwd = nose (+x), right = starboard (+y), up = +z
   Units: NM
   ══════════════════════════════════════════════════════════════ */
const _f4uCowlR = 0.00220;  // R-2800 radial cowl radius
const _f4uFRy   = 0.00130;  // body half-width
const _f4uFRz   = 0.00145;  // body half-height
const _f4uARy   = 0.00080;  // aft half-width
const _f4uARz   = 0.00100;  // aft half-height
const _f4uTRy   = 0.00040;  // tail half-width
const _f4uTRz   = 0.00055;  // tail half-height
const _f4uHS    = 0.01580;  // half-span
const _f4uVH    = 0.00350;  // V-stab height
const _f4uHW    = 0.00460;  // H-stab half-span
const _f4uPropR = 0.00520;  // prop disk radius ref
const _f4uSpb   = 0.00050;  // spinner base radius
const _f4uCzH   = 0.00080;  // canopy height
const _f4uCyW   = 0.00075;  // canopy half-width

const _COLORS_f4u = [
  [110, 130, 148],  // 0 fuselage — USN Non-specular Blue Gray
  [110, 130, 148],  // 1 wings
  [ 68,  78,  92],  // 2 cowl ring
  [110, 130, 148],  // 3 tail surfaces
  [ 42,  68, 100],  // 4 canopy glass
];

/* buildTube: 16-sided, 6 rings A-F → rb=[0,16,32,48,64,80], noseTip=96, tailTip=97, extra=98+ */
const { V_: _V_f4u, F_: _F_f4u, FC_: _FC_f4u, E_: _E_f4u, anim: _anim_f4u } = (() => {
  const N = 16;

  /* ── Inverted gull wing — 4 stations: root, kink, break, tip ── */
  const wrY  = _f4uFRy;                            // root Y = fuselage wall
  const wkY  = 0.00400, wbY = 0.00920;             // kink Y, break Y
  const wrZ  = -_f4uFRz * 0.40;                    // root Z ≈ -0.000580
  const wkZ  = wrZ - 0.00092;                      // kink Z ≈ -0.001500 (gull lowest point)
  const wbZ  = wkZ + 0.00058;                      // break Z ≈ -0.000920
  const wtZ  = wkZ + 0.00100;                      // tip Z  ≈ -0.000500
  const wrLE = 0.0050, wrTE = -0.0020;
  const wkLE = 0.0044, wkTE = -0.0020;
  const wbLE = 0.0030, wbTE = -0.0025;
  const wtLE = 0.0010, wtTE = -0.0035;
  const wRTh = 0.00080, wKTh = 0.00068, wBkTh = 0.00055, wTTh = 0.00040;
  const wHF  = 0.70;
  const wkHX = wkLE + wHF * (wkTE - wkLE);        // kink hinge x  ≈ -0.000080
  const wbHX = wbLE + wHF * (wbTE - wbLE);        // break hinge x ≈ -0.000850
  const wtHX = wtLE + wHF * (wtTE - wtLE);        // tip hinge x   ≈ -0.002150
  const r_fl  = wkHX - wkTE;                       // flap arm  ≈ 0.001920
  const r_ail = wbHX - wbTE;                       // aileron arm ≈ 0.001650
  const wKUH  = 1 - wHF * 0.85;                    // upper hinge Z fraction = 0.405

  /* ── H-stab elevator hinge (60% chord) ── */
  const hRY = _f4uTRy, hTY = _f4uHW;
  const hRZ  = _f4uTRz * 0.10, hTZ = 0.00080;
  const hst_th = 0.00022, hst_tt = 0.00016;
  const heH  = 0.60;
  const heRx = -0.010 + heH * (-0.013 - (-0.010));
  const heTx = -0.011 + heH * (-0.013 - (-0.011));
  const r_el  = heRx - (-0.013);
  const huh   = 1 - heH * 0.85;

  /* ── Rudder hinge (62% chord) ── */
  const ruH  = 0.62;
  const ruBx = -0.008 + ruH * (-0.013 - (-0.008));
  const ruTx = -0.010 + ruH * (-0.013 - (-0.010));
  const r_ru = (ruBx + ruTx) * 0.5 - (-0.013);
  const ruBz = _f4uARz + ruH * (_f4uTRz - _f4uARz);
  const ruTz = (_f4uARz + _f4uVH) + ruH * ((_f4uTRz + _f4uVH * 0.82) - (_f4uARz + _f4uVH));

  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF:  0.014, r: _f4uCowlR,               col: 2 },  // A cowl-fwd
    { vF:  0.009, r: _f4uCowlR,               col: 2 },  // B cowl-rear
    { vF:  0.005, ry: _f4uFRy, rz: _f4uFRz,  col: 2 },  // C body-fwd
    { vF:  0.000, ry: _f4uFRy, rz: _f4uFRz,  col: 0 },  // D wing-stn
    { vF: -0.007, ry: _f4uARy, rz: _f4uARz,  col: 0 },  // E aft
    { vF: -0.013, ry: _f4uTRy, rz: _f4uTRz         },  // F tail (terminal)
  ]);

  const noseTip = V_.length;  V_.push([0.018, 0, 0]);
  const tailTip = V_.length;  V_.push([-0.015, 0, 0]);

  V_.push(  /* wing lower outline 98-113 + tail 114-125 */
    [ wrLE, +wrY,    wrZ              ],  // 98  R root LE
    [ wrTE, +wrY,    wrZ              ],  // 99  R root TE
    [ wkLE, +wkY,    wkZ              ],  // 100 R kink LE
    [ wkTE, +wkY,    wkZ              ],  // 101 R kink TE (flap zone)
    [ wbLE, +wbY,    wbZ              ],  // 102 R break LE
    [ wbTE, +wbY,    wbZ              ],  // 103 R break TE (flap side)
    [ wtLE, +_f4uHS, wtZ              ],  // 104 R tip LE
    [ wtTE, +_f4uHS, wtZ              ],  // 105 R tip TE
    [ wrLE, -wrY,    wrZ              ],  // 106 L root LE
    [ wrTE, -wrY,    wrZ              ],  // 107 L root TE
    [ wkLE, -wkY,    wkZ              ],  // 108 L kink LE
    [ wkTE, -wkY,    wkZ              ],  // 109 L kink TE (flap zone)
    [ wbLE, -wbY,    wbZ              ],  // 110 L break LE
    [ wbTE, -wbY,    wbZ              ],  // 111 L break TE (flap side)
    [ wtLE, -_f4uHS, wtZ              ],  // 112 L tip LE
    [ wtTE, -_f4uHS, wtZ              ],  // 113 L tip TE
    [ -0.008, 0,      _f4uARz                  ],  // 114 V-stab LE base
    [ -0.013, 0,      _f4uTRz                  ],  // 115 V-stab TE base
    [ -0.010, 0,      _f4uARz + _f4uVH         ],  // 116 V-stab LE top
    [ -0.013, 0,      _f4uTRz + _f4uVH * 0.82  ],  // 117 V-stab TE top
    [ -0.010, +hRY,   hRZ                      ],  // 118 R h-stab root fwd
    [ -0.013, +hRY,   hRZ                      ],  // 119 R h-stab root aft
    [ -0.011, +hTY,   hTZ                      ],  // 120 R h-stab tip fwd
    [ -0.013, +hTY,   hTZ                      ],  // 121 R h-stab tip aft
    [ -0.010, -hRY,   hRZ                      ],  // 122 L h-stab root fwd
    [ -0.013, -hRY,   hRZ                      ],  // 123 L h-stab root aft
    [ -0.011, -hTY,   hTZ                      ],  // 124 L h-stab tip fwd
    [ -0.013, -hTY,   hTZ                      ],  // 125 L h-stab tip aft
  );

  V_.push( [ 0.018, +_f4uPropR, 0 ] );             // 126 prop disk radius ref

  V_.push(  /* canopy 127-134 */
    [ 0.006, +_f4uCyW,        _f4uFRz                    ],  // 127 windscreen base R
    [ 0.006, -_f4uCyW,        _f4uFRz                    ],  // 128 windscreen base L
    [ 0.005, +_f4uCyW * 0.15, _f4uFRz + _f4uCzH * 0.15  ],  // 129 windscreen top R
    [ 0.005, -_f4uCyW * 0.15, _f4uFRz + _f4uCzH * 0.15  ],  // 130 windscreen top L
    [ 0.001, +_f4uCyW * 0.15, _f4uFRz + _f4uCzH          ],  // 131 crown top R
    [ 0.001, -_f4uCyW * 0.15, _f4uFRz + _f4uCzH          ],  // 132 crown top L
    [-0.002, +_f4uCyW,        _f4uFRz                    ],  // 133 aft base R
    [-0.002, -_f4uCyW,        _f4uFRz                    ],  // 134 aft base L
  );

  /* Spinner base ring — 16 verts at prop plane, r=_f4uSpb (indices 135-150) */
  const spBase = 135;
  V_.push(...Array.from({length: N}, (_, si) => {
    const a = Math.PI * 0.5 - si / N * Math.PI * 2;
    return [0.015, _f4uSpb * Math.cos(a), _f4uSpb * Math.sin(a)];
  }));

  /* ── Wing upper surface (151-166) ── */
  V_.push(
    [ wrLE, +wrY,    wrZ + wRTh           ],  // 151 R root upper LE
    [ wrTE, +wrY,    wrZ + wRTh  * 0.15   ],  // 152 R root upper TE
    [ wkLE, +wkY,    wkZ + wKTh           ],  // 153 R kink upper LE
    [ wkTE, +wkY,    wkZ + wKTh  * 0.15   ],  // 154 R kink upper TE
    [ wbLE, +wbY,    wbZ + wBkTh          ],  // 155 R break upper LE
    [ wbTE, +wbY,    wbZ + wBkTh * 0.15   ],  // 156 R break upper TE
    [ wtLE, +_f4uHS, wtZ + wTTh           ],  // 157 R tip  upper LE
    [ wtTE, +_f4uHS, wtZ + wTTh  * 0.15   ],  // 158 R tip  upper TE
    [ wrLE, -wrY,    wrZ + wRTh           ],  // 159 L root upper LE
    [ wrTE, -wrY,    wrZ + wRTh  * 0.15   ],  // 160 L root upper TE
    [ wkLE, -wkY,    wkZ + wKTh           ],  // 161 L kink upper LE
    [ wkTE, -wkY,    wkZ + wKTh  * 0.15   ],  // 162 L kink upper TE
    [ wbLE, -wbY,    wbZ + wBkTh          ],  // 163 L break upper LE
    [ wbTE, -wbY,    wbZ + wBkTh * 0.15   ],  // 164 L break upper TE
    [ wtLE, -_f4uHS, wtZ + wTTh           ],  // 165 L tip  upper LE
    [ wtTE, -_f4uHS, wtZ + wTTh  * 0.15   ],  // 166 L tip  upper TE
  );

  /* ── Flap hinge verts (167-174) — at kink and break stations ── */
  V_.push(
    [ wkHX, +wkY,  wkZ                    ],  // 167 R kink  lower flap hinge
    [ wbHX, +wbY,  wbZ                    ],  // 168 R break lower flap hinge
    [ wkHX, +wkY,  wkZ + wKTh  * wKUH    ],  // 169 R kink  upper flap hinge
    [ wbHX, +wbY,  wbZ + wBkTh * wKUH    ],  // 170 R break upper flap hinge
    [ wkHX, -wkY,  wkZ                    ],  // 171 L kink  lower flap hinge
    [ wbHX, -wbY,  wbZ                    ],  // 172 L break lower flap hinge
    [ wkHX, -wkY,  wkZ + wKTh  * wKUH    ],  // 173 L kink  upper flap hinge
    [ wbHX, -wbY,  wbZ + wBkTh * wKUH    ],  // 174 L break upper flap hinge
  );

  /* ── Aileron hinge verts (175-182) — at break and tip stations ── */
  V_.push(
    [ wbHX, +wbY,    wbZ                    ],  // 175 R break lower ail hinge (= 168)
    [ wtHX, +_f4uHS, wtZ                    ],  // 176 R tip   lower ail hinge
    [ wbHX, +wbY,    wbZ + wBkTh * wKUH    ],  // 177 R break upper ail hinge (= 170)
    [ wtHX, +_f4uHS, wtZ + wTTh  * wKUH    ],  // 178 R tip   upper ail hinge
    [ wbHX, -wbY,    wbZ                    ],  // 179 L break lower ail hinge (= 172)
    [ wtHX, -_f4uHS, wtZ                    ],  // 180 L tip   lower ail hinge
    [ wbHX, -wbY,    wbZ + wBkTh * wKUH    ],  // 181 L break upper ail hinge (= 174)
    [ wtHX, -_f4uHS, wtZ + wTTh  * wKUH    ],  // 182 L tip   upper ail hinge
  );

  /* ── Break-TE duplicates — decouple flap/aileron at span break (183-186) ── */
  V_.push(
    [ wbTE, +wbY,  wbZ               ],  // 183 R break lower TE ail (dup of 103)
    [ wbTE, +wbY,  wbZ + wBkTh * 0.15 ],  // 184 R break upper TE ail (dup of 156)
    [ wbTE, -wbY,  wbZ               ],  // 185 L break lower TE ail (dup of 111)
    [ wbTE, -wbY,  wbZ + wBkTh * 0.15 ],  // 186 L break upper TE ail (dup of 164)
  );

  /* ── H-stab upper surface (187-194) ── */
  V_.push(
    [ -0.010, +hRY,  hRZ + hst_th          ],  // 187 R root upper LE
    [ -0.013, +hRY,  hRZ + hst_th * 0.15   ],  // 188 R root upper TE
    [ -0.011, +hTY,  hTZ + hst_tt          ],  // 189 R tip  upper LE
    [ -0.013, +hTY,  hTZ + hst_tt * 0.15   ],  // 190 R tip  upper TE
    [ -0.010, -hRY,  hRZ + hst_th          ],  // 191 L root upper LE
    [ -0.013, -hRY,  hRZ + hst_th * 0.15   ],  // 192 L root upper TE
    [ -0.011, -hTY,  hTZ + hst_tt          ],  // 193 L tip  upper LE
    [ -0.013, -hTY,  hTZ + hst_tt * 0.15   ],  // 194 L tip  upper TE
  );

  /* ── Elevator hinge verts (195-202) ── */
  V_.push(
    [ heRx, +hRY,  hRZ                    ],  // 195 R root lower
    [ heRx, +hRY,  hRZ + hst_th * huh     ],  // 196 R root upper
    [ heTx, +hTY,  hTZ                    ],  // 197 R tip  lower
    [ heTx, +hTY,  hTZ + hst_tt * huh     ],  // 198 R tip  upper
    [ heRx, -hRY,  hRZ                    ],  // 199 L root lower
    [ heRx, -hRY,  hRZ + hst_th * huh     ],  // 200 L root upper
    [ heTx, -hTY,  hTZ                    ],  // 201 L tip  lower
    [ heTx, -hTY,  hTZ + hst_tt * huh     ],  // 202 L tip  upper
  );

  /* ── Rudder hinge verts (203-204) ── */
  V_.push(
    [ ruBx, 0,  ruBz ],  // 203 V-stab base hinge
    [ ruTx, 0,  ruTz ],  // 204 V-stab top  hinge
  );

  /* ── LE nose vertices — one per station per side (205-212) ── */
  V_.push(
    [ wrLE + wRTh  * 0.5, +wrY,    wrZ + wRTh  * 0.5 ],  // 205 R root  LE nose
    [ wkLE + wKTh  * 0.5, +wkY,    wkZ + wKTh  * 0.5 ],  // 206 R kink  LE nose
    [ wbLE + wBkTh * 0.5, +wbY,    wbZ + wBkTh * 0.5 ],  // 207 R break LE nose
    [ wtLE + wTTh  * 0.5, +_f4uHS, wtZ + wTTh  * 0.5 ],  // 208 R tip   LE nose
    [ wrLE + wRTh  * 0.5, -wrY,    wrZ + wRTh  * 0.5 ],  // 209 L root  LE nose
    [ wkLE + wKTh  * 0.5, -wkY,    wkZ + wKTh  * 0.5 ],  // 210 L kink  LE nose
    [ wbLE + wBkTh * 0.5, -wbY,    wbZ + wBkTh * 0.5 ],  // 211 L break LE nose
    [ wtLE + wTTh  * 0.5, -_f4uHS, wtZ + wTTh  * 0.5 ],  // 212 L tip   LE nose
  );

  /* Spinner nose tris + cowl band + tail tris */
  for (let si = 0; si < N; si++) { F_.push([noseTip, spBase+(si+1)%N, spBase+si]); FC_.push(2); }
  for (let si = 0; si < N; si++) { F_.push([spBase+si, spBase+(si+1)%N, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(2); }
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[5]+si, rb[5]+(si+1)%N]); FC_.push(0); }

  /* Non-tube faces */
  F_.push(
    /* R wing lower: inner fixed, flap-fixed, flap moving, ail-fixed, ail moving */
    [98,99,101,100],[100,167,168,102],[167,101,103,168],[102,175,176,104],[175,183,105,176],
    /* R wing upper: inner fixed, flap-fixed, flap moving, ail-fixed, ail moving */
    [151,153,154,152],[153,155,170,169],[169,170,156,154],[155,157,178,177],[177,178,158,184],
    /* R tip cap: fixed + moving */
    [104,176,178,157],[176,105,158,178],
    /* L wing lower: inner fixed, flap-fixed, flap moving, ail-fixed, ail moving */
    [106,108,109,107],[108,110,172,171],[171,172,111,109],[110,112,180,179],[179,180,113,185],
    /* L wing upper: inner fixed, flap-fixed, flap moving, ail-fixed, ail moving */
    [159,160,162,161],[161,173,174,163],[173,162,164,174],[163,181,182,165],[181,186,166,182],
    /* L tip cap: fixed + moving */
    [112,165,182,180],[180,182,166,113],
    /* V-stab: fixed both sides + rudder both sides */
    [114,116,204,203],[114,203,204,116],[203,204,117,115],[203,115,117,204],
    /* R h-stab lower: fixed + elevator */
    [118,195,197,120],[195,119,121,197],
    /* R h-stab upper: fixed + elevator */
    [187,189,198,196],[196,198,190,188],
    /* R h-stab tip cap */
    [120,121,190,189],
    /* L h-stab lower: fixed + elevator */
    [122,124,201,199],[199,201,125,123],
    /* L h-stab upper: fixed + elevator */
    [191,200,202,193],[200,192,194,202],
    /* L h-stab tip cap */
    [124,193,194,125],
    /* Canopy */
    [128,127,129,130],[127,133,131,129],[128,130,132,134],[130,129,131,132],[134,132,131,133],
    /* R wing LE rounds: lower half + upper half per panel */
    [98,100,206,205],[205,206,153,151],
    [100,102,207,206],[206,207,155,153],
    [102,104,208,207],[207,208,157,155],
    /* L wing LE rounds */
    [106,209,210,108],[209,159,161,210],
    [108,210,211,110],[210,161,163,211],
    [110,211,212,112],[211,163,165,212],
  );
  FC_.push(
    1,1,1,1,1, 1,1,1,1,1, 1,1,   // R wing (12)
    1,1,1,1,1, 1,1,1,1,1, 1,1,   // L wing (12)
    3,3,3,3,                       // V-stab (4)
    3,3, 3,3, 3,                   // R h-stab (5)
    3,3, 3,3, 3,                   // L h-stab (5)
    4,4,4,4,4,                     // canopy (5)
    1,1, 1,1, 1,1,                 // R wing LE rounds (6)
    1,1, 1,1, 1,1,                 // L wing LE rounds (6)
  );

  /* Longerons: noseTip → spinner ring → ring A → … → tailTip */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, spBase+si]);
    E_.push([spBase+si, rb[0]+si]);
    for (let ri = 0; ri < 5; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[5]+si, tailTip]);
  }
  for (let si = 0; si < N; si++) E_.push([spBase+si, spBase+(si+1)%N]);

  /* Non-tube edges */
  E_.push(
    /* R wing lower spans + cross-chord */
    [98,100],[100,102],[102,104],[99,101],[101,103],
    [98,99],[100,101],[102,103],[104,105],
    [rb[3]+4,98],[rb[3]+4,99],
    /* R wing hinge spans (lower) */
    [98,167],[167,102],[99,167],[101,168],[103,175],[105,176],[167,168],[175,176],
    /* R wing upper thickness (LE routed through nose vertex) */
    [98,205],[205,151],[99,152],[100,206],[206,153],[101,154],[102,207],[207,155],[103,156],[104,208],[208,157],[105,158],
    [167,169],[168,170],[175,177],[176,178],
    /* R wing upper spans + cross-chord */
    [151,153],[153,155],[155,157],[152,154],[154,156],[184,158],[169,170],[177,178],
    [151,169],[169,152],[153,170],[170,177],[177,184],[157,178],[178,158],
    [205,206],[206,207],[207,208],
    /* L wing lower spans + cross-chord */
    [106,108],[108,110],[110,112],[107,109],[109,111],
    [106,107],[108,109],[110,111],[112,113],
    [rb[3]+12,106],[rb[3]+12,107],
    /* L wing hinge spans (lower) */
    [106,171],[171,110],[107,171],[109,172],[111,179],[113,180],[171,172],[179,180],
    /* L wing upper thickness (LE routed through nose vertex) */
    [106,209],[209,159],[107,160],[108,210],[210,161],[109,162],[110,211],[211,163],[111,164],[112,212],[212,165],[113,166],
    [171,173],[172,174],[179,181],[180,182],
    /* L wing upper spans + cross-chord */
    [159,161],[161,163],[163,165],[160,162],[162,164],[186,166],[173,174],[181,182],
    [159,173],[173,160],[161,174],[174,181],[181,186],[165,182],[182,166],
    [209,210],[210,211],[211,212],
    /* V-stab */
    [114,116],[114,203],[116,204],[203,204],[115,117],[115,203],[117,204],
    /* R h-stab lower + thickness + upper + tip */
    [118,120],[118,195],[120,197],[195,197],[119,121],[119,195],[121,197],
    [118,187],[119,188],[120,189],[121,190],[195,196],[197,198],
    [187,189],[187,196],[189,198],[196,198],[188,190],[196,188],[198,190],
    [189,190],[rb[5]+4,118],
    /* L h-stab lower + thickness + upper + tip */
    [122,124],[122,199],[124,201],[199,201],[123,125],[123,199],[125,201],
    [122,191],[123,192],[124,193],[125,194],[199,200],[201,202],
    [191,193],[191,200],[193,202],[200,202],[192,194],[200,192],[202,194],
    [193,194],[rb[5]+12,122],
    /* Canopy */
    [128,127],[127,129],[129,130],[130,128],
    [132,131],[131,133],[133,134],[134,132],
    [129,131],[130,132],[128,134],[127,133],
  );

  return { V_, F_, FC_, E_, anim: { r_fl, r_el, r_ru, r_ail } };
})();
const _FN_f4u = computeFaceNormals(_V_f4u, _F_f4u);

const _GV_f4u = [
  /* 0 */ [ 0.001,  +0.0016, -0.0020 ],  // R main strut top
  /* 1 */ [ 0.001,  +0.0050, -0.0038 ],  // R main wheel center (wide track — gull wing)
  /* 2 */ [ 0.001,  -0.0016, -0.0020 ],  // L main strut top
  /* 3 */ [ 0.001,  -0.0050, -0.0038 ],  // L main wheel center
  /* 4 */ [-0.012,   0,      -0.0008 ],  // tail wheel strut top
  /* 5 */ [-0.012,   0,      -0.0015 ],  // tail wheel center
];

/* ══════════════════════════════════════════════════════════════
   Saturn V geometry — Apollo-era launch vehicle (Step 1: body)
   Body frame: fwd = nose (+x), right = starboard, up = +z
   Units: NM. Origin ≈ centre of mass.
   ══════════════════════════════════════════════════════════════ */

const _sv1r  = 0.0028;  // S-IC / S-II radius (10.1 m dia)
const _sv3r  = 0.0018;  // S-IVB radius (6.6 m dia)
const _svcr  = 0.0011;  // CSM radius (3.9 m dia)
const _svcr2 = _svcr * 0.55;   // CM nose radius
const _svFS  = 0.0026;  // stabilizer fin radial span (~4.8 m)
const _svLT  = _svcr2 * 0.70;  // LES tower mid-ring radius (tapered)

const _COLORS_sv = [
  [240, 238, 230],  // 0 body — warm off-white (NASA standard white)
  [ 20,  20,  26],  // 1 interstage — near-black
  [ 52,  55,  64],  // 2 forward skirt — dark grey
  [ 42,  38,  34],  // 3 S-IC engine section — dark structural skirt near F-1s
  [158, 128,  72],  // 4 SM — gold Mylar thermal blanket
];

/* buildTube: 16-sided, 10 rings → rb=[0,16,…,144]; no noseTip; extras at 160+
   Rings added vs. 8-ring layout:
     Ring 1  (-0.024): S-IC engine section top (separates dark skirt from white body)
     Ring 8  ( 0.027): SM/CM boundary (SM=golden Mylar, CM=white)              */
const { V_: _V_sv, F_: _F_sv, FC_: _FC_sv, E_: _E_sv } = (() => {
  const N = 16;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF: -0.030, r: _sv1r,  col: 3 },  // Ring 0: S-IC aft → engine section (dark)
    { vF: -0.024, r: _sv1r,  col: 0 },  // Ring 1: engine section → S-IC body (white)
    { vF: -0.009, r: _sv1r,  col: 1 },  // Ring 2: S-IC body → interstage (black)
    { vF: -0.006, r: _sv1r,  col: 0 },  // Ring 3: interstage → S-II body (white)
    { vF:  0.007, r: _sv1r,  col: 2 },  // Ring 4: S-II → forward skirt (dark grey)
    { vF:  0.010, r: _sv3r,  col: 0 },  // Ring 5: S-IVB body (white)
    { vF:  0.019, r: _sv3r,  col: 0 },  // Ring 6: S-IVB top → SLA (tapered, white)
    { vF:  0.024, r: _svcr,  col: 4 },  // Ring 7: SM base → SM top (gold Mylar)
    { vF:  0.027, r: _svcr,  col: 0 },  // Ring 8: CM base → CM nose (white)
    { vF:  0.030, r: _svcr2         },  // Ring 9: CM top (terminal)
  ]);
  // rb: [0,16,32,48,64,80,96,112,128,144]; extras start at 160

  V_.push( /* extra verts */
    [ 0.037,  0,                        0                  ],  // 160 LES tower tip
    [-0.024,  0,                        _sv1r              ],  // 161 +z fin root fwd
    [-0.030,  0,                        _sv1r + _svFS      ],  // 162 +z fin tip aft
    [-0.025,  0,                        _sv1r + _svFS*0.5  ],  // 163 +z fin tip fwd
    [-0.024,  _sv1r,                    0                  ],  // 164 +y fin root fwd
    [-0.030,  _sv1r + _svFS,            0                  ],  // 165 +y fin tip aft
    [-0.025,  _sv1r + _svFS*0.5,        0                  ],  // 166 +y fin tip fwd
    [-0.024,  0,                       -_sv1r              ],  // 167 -z fin root fwd
    [-0.030,  0,                      -(_sv1r + _svFS)     ],  // 168 -z fin tip aft
    [-0.025,  0,                      -(_sv1r + _svFS*0.5) ],  // 169 -z fin tip fwd
    [-0.024, -_sv1r,                    0                  ],  // 170 -y fin root fwd
    [-0.030, -(_sv1r + _svFS),          0                  ],  // 171 -y fin tip aft
    [-0.025, -(_sv1r + _svFS*0.5),      0                  ],  // 172 -y fin tip fwd
    [ 0.034,  0,       _svLT ],  // 173 LES lattice +z leg
    [ 0.034,  _svLT,   0     ],  // 174 LES lattice +y leg
    [ 0.034,  0,      -_svLT ],  // 175 LES lattice -z leg
    [ 0.034, -_svLT,   0     ],  // 176 LES lattice -y leg
  );

  /* CM nose cone: Ring 9 → LES tip */
  for (let si = 0; si < N; si++) { F_.push([160, rb[9]+(si+1)%N, rb[9]+si]); FC_.push(0); }

  /* Stabilizer fins — double-sided */
  F_.push(
    [0, 161, 163, 162],[0, 162, 163, 161],   // +z fin
    [4, 164, 166, 165],[4, 165, 166, 164],   // +y fin
    [8, 167, 169, 168],[8, 168, 169, 167],   // -z fin
    [12, 170, 172, 171],[12, 171, 172, 170],  // -y fin
  );
  FC_.push(0,0, 0,0, 0,0, 0,0);

  /* Longerons through all rings → LES lattice → tip */
  const lesVerts = [173, 174, 175, 176];
  for (let i = 0; i < 4; i++) {
    const si = i * 4;  // top(0), right(4), bottom(8), left(12)
    E_.push([rb[0]+si, rb[1]+si]);
    for (let ri = 1; ri < 9; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[9]+si, lesVerts[i]], [lesVerts[i], 160]);
  }
  /* LES lattice bracing — Ring 9 cardinal verts (144,148,152,156) × LES legs */
  E_.push([144,174],[148,173],[148,175],[152,174],[152,176],[156,175],[156,173],[144,176]);
  E_.push([173,174],[174,175],[175,176],[176,173]);
  /* Stabilizer fin outlines */
  E_.push([0,161],[161,163],[163,162],[162,0]);
  E_.push([4,164],[164,166],[166,165],[165,4]);
  E_.push([8,167],[167,169],[169,168],[168,8]);
  E_.push([12,170],[170,172],[172,171],[171,12]);

  return { V_, F_, FC_, E_ };
})();
const _FN_sv = computeFaceNormals(_V_sv, _F_sv);

/* ══════════════════════════════════════════════════════════════
   Apollo LM geometry — basic first pass
   Docked config: aft face at CM docking port (vF = 0.030 in SV frame).
   +vF points away from CSM; descent stage is at maximum vF.
   ══════════════════════════════════════════════════════════════ */
const _lmO  = 0.0300;   // CM top / LM docking port in SV frame
const _lmAR = 0.00095;  // ascent stage body radius   (wider: 1.76 m)
const _lmAH = 0.00152;  // ascent stage height        (2.81 m)
const _lmDR = 0.00120;  // descent stage body radius  (2.22 m)
const _lmDH = 0.00092;  // descent stage height       (1.70 m)
const _lmLR = 0.00254;  // landing leg footpad radius (4.70 m)
const _lmNR = 0.00052;  // descent engine nozzle exit radius (wider bell)
const _lmNH = 0.00042;  // descent engine nozzle protrusion

const _COLORS_lm = [
  [200, 178,  80],  // 0 gold Mylar — descent stage
  [215, 212, 200],  // 1 aluminized Mylar — ascent stage
  [ 72,  70,  65],  // 2 dark thermal blanket — DS base cap
  [ 48,  48,  52],  // 3 engine dark
  [ 20,  26,  38],  // 4 window glass
];

const { V_: _V_lm, F_: _F_lm, FC_: _FC_lm, E_: _E_lm } = (() => {
  const N = 8;
  const asRY = _lmAR * 1.20;   // boxy ellipse — wide in Y
  const asRZ = _lmAR * 0.88;   // compressed in Z

  /* Ascent stage — boxy elliptical cylinder */
  const asT  = buildTube(N, [
    { vF: _lmO,        ry: asRY, rz: asRZ, col: 1 },
    { vF: _lmO+_lmAH,  ry: asRY, rz: asRZ, col: 1 },
  ]);
  const V_  = [...asT.V_];
  const F_  = [...asT.F_];
  const FC_ = [...asT.FC_];
  const E_  = [...asT.E_];
  const asAft = asT.rb[0];   // = 0
  const asFwd = asT.rb[1];   // = 8
  for (let i = 0; i < N; i++) E_.push([asAft+i, asFwd+i]);   // longerons

  /* AS aft cap — closes the CM-interface end */
  const asCtr = V_.length;   // = 16
  V_.push([_lmO, 0, 0]);
  for (let i = 0; i < N; i++) { F_.push([asCtr, asAft+i, asAft+(i+1)%N]); FC_.push(1); }

  /* Descent stage — slightly boxy elliptical cylinder */
  const dsRY = _lmDR * 1.10;
  const dsRZ = _lmDR * 0.95;
  const dsOfs = V_.length;   // = 17
  const dsT   = buildTube(N, [
    { vF: _lmO+_lmAH,        ry: dsRY, rz: dsRZ, col: 0 },
    { vF: _lmO+_lmAH+_lmDH,  ry: dsRY, rz: dsRZ, col: 0 },
  ]);
  dsT.V_.forEach(v  => V_.push(v));
  dsT.F_.forEach(fi => F_.push(fi.map(i => i + dsOfs)));
  dsT.FC_.forEach(c => FC_.push(c));
  dsT.E_.forEach(([a,b]) => E_.push([a+dsOfs, b+dsOfs]));
  for (let i = 0; i < N; i++) E_.push([dsOfs+i, dsOfs+N+i]);  // longerons
  const dsTop = dsOfs;       // = 17
  const dsBot = dsOfs + N;   // = 25

  /* Junction: AS fwd ring ↔ DS upper ring (shoulder step) */
  for (let i = 0; i < N; i++) E_.push([asFwd+i, dsTop+i]);

  /* DS base cap — center vertex + 8 triangles */
  const dsCtr = V_.length;   // = 33
  V_.push([_lmO+_lmAH+_lmDH, 0, 0]);
  for (let i = 0; i < N; i++) { F_.push([dsCtr, dsBot+(i+1)%N, dsBot+i]); FC_.push(2); }

  /* Landing legs — 4 legs at 45° diagonal positions (si = 1,3,5,7 in N=8 ring) */
  const legBase = V_.length;  // = 34
  const S2      = Math.SQRT2 / 2;
  const legVF   = _lmO + _lmAH + _lmDH + 0.00022;
  [[S2,S2],[-S2,S2],[-S2,-S2],[S2,-S2]].forEach(([cr,cu]) => {
    V_.push([legVF, _lmLR*cr, _lmLR*cu]);
  });
  /* Primary struts: DS bot diagonal verts → footpads */
  [[1,0],[3,1],[5,2],[7,3]].forEach(([si,li]) => E_.push([dsBot+si, legBase+li]));
  /* Secondary braces: adjacent verts → footpads */
  [[0,0],[2,0],[2,1],[4,1],[4,2],[6,2],[6,3],[0,3]].forEach(([si,li]) => E_.push([dsBot+si, legBase+li]));
  /* Lateral footpad ring — connect adjacent footpads */
  for (let i = 0; i < 4; i++) E_.push([legBase+i, legBase+(i+1)%4]);

  /* Descent engine nozzle — 8-sided bell */
  const nzN   = 8;
  const nzVF  = _lmO + _lmAH + _lmDH;
  const nzRim = V_.length;  // = 38
  for (let i = 0; i < nzN; i++) {
    const a = (i / nzN) * 2 * Math.PI;
    V_.push([nzVF, _lmNR * Math.cos(a), _lmNR * Math.sin(a)]);
  }
  const nzTip = V_.length;  // = 46
  V_.push([nzVF + _lmNH, 0, 0]);
  for (let i = 0; i < nzN; i++) E_.push([nzRim+i, nzRim+(i+1)%nzN]);
  for (let i = 0; i < nzN; i++) E_.push([nzRim+i, nzTip]);
  for (let i = 0; i < nzN; i++) { F_.push([nzRim+i, nzRim+(i+1)%nzN, nzTip]); FC_.push(3); }

  /* Docking tunnel — small ring at aft face */
  const dtRim = V_.length;  // = 47
  const dtR   = 0.00022;
  const dtVF  = _lmO + 0.00012;
  [[dtR,0],[0,dtR],[-dtR,0],[0,-dtR]].forEach(([cr,cu]) => V_.push([dtVF, cr, cu]));
  for (let i = 0; i < 4; i++) E_.push([dtRim+i, dtRim+(i+1)%4]);
  [[0,0],[2,1],[4,2],[6,3]].forEach(([si,ti]) => E_.push([asAft+si, dtRim+ti]));

  /* Rendezvous radar — flat ring above AS forward face */
  const rrVF  = _lmO + _lmAH * 1.05;
  const rrR   = _lmAR * 0.52;
  const rrRim = V_.length;  // = 51
  [[rrR,0],[0,rrR],[-rrR,0],[0,-rrR]].forEach(([cr,cu]) => V_.push([rrVF, cr, cu]));
  for (let i = 0; i < 4; i++) E_.push([rrRim+i, rrRim+(i+1)%4]);
  /* Struts from AS fwd cardinal verts up to radar */
  [[0,0],[2,1],[4,2],[6,3]].forEach(([si,ri]) => E_.push([asFwd+si, rrRim+ri]));

  /* Forward windows — two small rectangles on the +Z face of AS */
  const winZ  = asRZ * 0.97;   // on the +Z surface
  const winV0 = _lmO + _lmAH * 0.35;   // lower vF edge
  const winV1 = _lmO + _lmAH * 0.62;   // upper vF edge
  const winHalf = asRY * 0.28;  // half-width of each window in Y
  const winGap  = asRY * 0.08;  // gap between the two windows

  /* Left window (+Y side) */
  const lwBase = V_.length;  // = 55
  V_.push([winV0,  winGap, winZ]);
  V_.push([winV1,  winGap, winZ]);
  V_.push([winV1,  winGap+winHalf, winZ]);
  V_.push([winV0,  winGap+winHalf, winZ]);
  F_.push([lwBase, lwBase+1, lwBase+2, lwBase+3]); FC_.push(4);

  /* Right window (-Y side) */
  const rwBase = V_.length;  // = 59
  V_.push([winV0, -winGap-winHalf, winZ]);
  V_.push([winV1, -winGap-winHalf, winZ]);
  V_.push([winV1, -winGap, winZ]);
  V_.push([winV0, -winGap, winZ]);
  F_.push([rwBase, rwBase+1, rwBase+2, rwBase+3]); FC_.push(4);

  return { V_, F_, FC_, E_ };
})();
const _FN_lm = computeFaceNormals(_V_lm, _F_lm);

/* Stage separation tumble animations — module state */
let _svSepLastAcId = null;
let _svSepPrevStage = 1;
const _svSepAnims = [];   // [{ stage, t0 }]

/* ── Auto-director ─────────────────────────────────────────────────
   Triggers cinematic camera cuts on key mission events.
   Each shot blends camSide (zoom) and a vertical look-at offset (cy shift)
   smoothly in/out, then returns control to the normal auto-fit camera.   */
const _dir = { shot: null, t0: 0, _tliWas: false };

const _DIR_SHOTS = {
  //              zoom   lookAtF   orbitAz  dur    easeIn easeOut
  sic_sep: { zoom: 0.44, lF: -0.018, orbitAz:   0, dur: 5200, eIn:  380, eOut:  750 },
  sii_sep: { zoom: 0.52, lF:  0.002, orbitAz:   0, dur: 4500, eIn:  380, eOut:  650 },
  tli:     { zoom: 1.55, lF:  0.014, orbitAz:   0, dur: 8000, eIn: 1000, eOut: 1500 },
};

function _dirBlend() {
  if (!_dir.shot) return 0;
  const sh = _DIR_SHOTS[_dir.shot];
  const t  = Date.now() - _dir.t0;
  if (t >= sh.dur) { _dir.shot = null; return 0; }
  const raw = Math.min(t / sh.eIn, 1, (sh.dur - t) / sh.eOut);
  return raw * raw * (3 - 2 * raw);   // smoothstep
}

/* ══════════════════════════════════════════════════════════════
   Falcon 9 geometry — Block 5 two-stage rocket + Dragon capsule
   Body frame: fwd = nose, right = starboard, up = any radial
   Units: NM. Origin ≈ centre of mass of full stack.
   ══════════════════════════════════════════════════════════════ */

const _rf9  = 0.0020;          // body radius (≈ 3.7 m / 1852)
const _gfS  = 0.0048;          // grid fin outer half-span from CL
const _nzO  = 0.00120;         // outer engine ring radius (octaweb)
const _nzO7 = _nzO * 0.7071;
const _nzVac  = 0.00148;       // S2 Merlin Vacuum nozzle exit radius
const _nzVac7 = _nzVac * 0.7071;
const _nzSk   = 0.00062;       // S2 nozzle skirt (throat) radius
const _nzSk7  = _nzSk  * 0.7071;

const _COLORS_f9 = [
  [252, 252, 254],  // 0 Stage 1  — bright white
  [248, 250, 254],  // 1 Stage 2  — slightly cooler white
  [ 18,  20,  26],  // 2 Interstage — near-black (carbon lattice)
  [246, 247, 252],  // 3 Dragon capsule — warm white
  [ 60,  66,  78],  // 4 Grid fins — titanium
  [ 52,  58,  72],  // 5 Trunk — dark structural / solar panels
];

/* buildTube: 16-sided, 6 rings → rb=[0,16,32,48,64,80]; Dragon tip at v96; extras 97+ */
const { V_: _V_f9, F_: _F_f9, FC_: _FC_f9, E_: _E_f9 } = (() => {
  const N = 16;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF: -0.016, r: _rf9,       col: 0 },  // Ring 0: S1 aft → mid
    { vF: -0.004, r: _rf9,       col: 2 },  // Ring 1: S1 mid → top (interstage lower)
    { vF:  0.004, r: _rf9,       col: 2 },  // Ring 2: S1 top → interstage taper
    { vF:  0.006, r: _rf9*0.136,  col: 1 },  // Ring 3: interstage/S2 base → S2 top
    { vF:  0.014, r: _rf9,       col: 5 },  // Ring 4: S2 top → Trunk (Dragon base)
    { vF:  0.020, r: _rf9               },  // Ring 5: Trunk/Dragon base (terminal)
  ]);
  // rb: [0,16,32,48,64,80]; Dragon tip=96; extras=97+

  V_.push(
    [ 0.024,  0,        0         ],  // 96 Dragon nosecone tip
    [ 0.002,  0,        _rf9      ], [ 0.005,  0,        _rf9      ],  // 97-98 Fin A
    [ 0.005,  0,        _gfS      ], [ 0.002,  0,        _gfS      ],  // 99-100
    [ 0.002,  _rf9,     0         ], [ 0.005,  _rf9,     0         ],  // 101-102 Fin B
    [ 0.005,  _gfS,     0         ], [ 0.002,  _gfS,     0         ],  // 103-104
    [ 0.002,  0,       -_rf9      ], [ 0.005,  0,       -_rf9      ],  // 105-106 Fin C
    [ 0.005,  0,       -_gfS      ], [ 0.002,  0,       -_gfS      ],  // 107-108
    [ 0.002, -_rf9,     0         ], [ 0.005, -_rf9,     0         ],  // 109-110 Fin D
    [ 0.005, -_gfS,     0         ], [ 0.002, -_gfS,     0         ],  // 111-112
    [-0.018,  0,        0         ],  // 113 centre Merlin
    [-0.018,  0,        _nzO      ],[-0.018,  _nzO7,  _nzO7     ],  // 114-115
    [-0.018,  _nzO,     0         ],[-0.018,  _nzO7, -_nzO7     ],  // 116-117
    [-0.018,  0,       -_nzO      ],[-0.018, -_nzO7, -_nzO7     ],  // 118-119
    [-0.018, -_nzO,     0         ],[-0.018, -_nzO7,  _nzO7     ],  // 120-121
    [ 0.006,  0,        _nzSk  ],[ 0.006,  _nzSk7,  _nzSk7 ],  // 122-123 S2 MVac skirt
    [ 0.006,  _nzSk,    0      ],[ 0.006,  _nzSk7, -_nzSk7 ],  // 124-125
    [ 0.006,  0,       -_nzSk  ],[ 0.006, -_nzSk7, -_nzSk7 ],  // 126-127
    [ 0.006, -_nzSk,    0      ],[ 0.006, -_nzSk7,  _nzSk7 ],  // 128-129
    [ 0.004,  0,        _nzVac ],[ 0.004,  _nzVac7, _nzVac7 ],  // 130-131 S2 MVac exit
    [ 0.004,  _nzVac,   0      ],[ 0.004,  _nzVac7,-_nzVac7 ],  // 132-133
    [ 0.004,  0,       -_nzVac ],[ 0.004, -_nzVac7,-_nzVac7 ],  // 134-135
    [ 0.004, -_nzVac,   0      ],[ 0.004, -_nzVac7, _nzVac7 ],  // 136-137
    [ 0.003,  0,        0      ],  // 138 nozzle exit centre (glow ref)
  );

  /* Dragon nosecone: Ring 5 → tip (v48) */
  for (let si = 0; si < N; si++) { F_.push([96, rb[5]+(si+1)%N, rb[5]+si]); FC_.push(3); }

  /* Non-tube faces (indices unchanged) */
  F_.push(
    [97,98,99,100],[100,99,98,97],   // Fin A (both sides)
    [101,102,103,104],[104,103,102,101],   // Fin B
    [105,106,107,108],[108,107,106,105],   // Fin C
    [109,110,111,112],[112,111,110,109],   // Fin D
    [122,123,131,130],[123,124,132,131],[124,125,133,132],[125,126,134,133],   // S2 MVac bell
    [126,127,135,134],[127,128,136,135],[128,129,137,136],[129,122,130,137],
    [138,130,131],[138,131,132],[138,132,133],[138,133,134],               // nozzle exit cap
    [138,134,135],[138,135,136],[138,136,137],[138,137,130],
  );
  FC_.push(4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4);

  /* Longerons */
  for (const si of [0, 4, 8, 12]) {
    for (let ri = 0; ri < 5; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[5]+si, 96]);
  }
  /* Non-tube edges */
  E_.push(
    [97,100],[100,99],[99,98],   // Fin A outer
    [101,104],[104,103],[103,102],   // Fin B outer
    [105,108],[108,107],[107,106],   // Fin C outer
    [109,112],[112,111],[111,110],   // Fin D outer
    [114,115],[115,116],[116,117],[117,118],[118,119],[119,120],[120,121],[121,114],  // octaweb ring
    [0,114],[4,116],[8,118],[12,120],                                      // thrust struct
    [122,123],[123,124],[124,125],[125,126],[126,127],[127,128],[128,129],[129,122],  // MVac skirt
    [130,131],[131,132],[132,133],[133,134],[134,135],[135,136],[136,137],[137,130],  // MVac exit ring
    [122,130],[124,132],[126,134],[128,136],                                   // MVac longerons
  );

  return { V_, F_, FC_, E_ };
})();
const _FN_f9 = computeFaceNormals(_V_f9, _F_f9);

/* ── Cabin windows (body frame, NM) ──────────────────────────── */
const _WIN = (() => {
  const w = [];
  for (let x = 0.011; x >= -0.013; x -= 0.002)
    w.push([x, _r, 0], [x, -_r, 0]);
  return w;
})();

/* ── Cockpit windows (body frame, NM) ────────────────────────── */
const _CWIN = [
  [ 0.017, -0.0012,  0.0009 ],  // captain main
  [ 0.017,  0.0012,  0.0009 ],  // FO main
  [ 0.018, -0.0017,  0.0003 ],  // captain DV
  [ 0.018,  0.0017,  0.0003 ],  // FO DV
];

/* ── Door outlines (body frame, NM) ──────────────────────────── */
const _DOOR = [
  [ 0.009,  _r, 0 ], [ 0.009, -_r, 0 ],  // pair 1 (fwd)
  [ 0.001,  _r, 0 ], [ 0.001, -_r, 0 ],  // pair 2
  [-0.006,  _r, 0 ], [-0.006, -_r, 0 ],  // pair 3
  [-0.011,  _r, 0 ], [-0.011, -_r, 0 ],  // pair 4 (aft)
];

/* Draw a volumetric tire (far face + tread band + near face + hub).
   wc: world-space axle centre [x,y,z]. tR: tire radius. */
function drawVolumetricTire(ctx, wc, tR, project) {
  const M   = 24;
  const tW  = tR * 0.40;
  const yS  = wc[1] === 0 ? 1 : Math.sign(wc[1]);
  const wO  = [wc[0], wc[1] + yS * tW, wc[2]];  // outboard face
  const wI  = [wc[0], wc[1] - yS * tW, wc[2]];  // inboard face
  const pCO = project(wO), pCI = project(wI);
  const pUO = project([wO[0], wO[1], wO[2]+tR]), pFO = project([wO[0]+tR, wO[1], wO[2]]);
  const pUI = project([wI[0], wI[1], wI[2]+tR]), pFI = project([wI[0]+tR, wI[1], wI[2]]);
  if (!pCO || !pCI || !pUO || !pFO || !pUI || !pFI) return;

  const ring = (pC, pU, pF) => Array.from({length: M+1}, (_, i) => {
    const t = i / M * Math.PI * 2;
    return [pC.x + Math.cos(t)*(pU.x-pC.x) + Math.sin(t)*(pF.x-pC.x),
            pC.y + Math.cos(t)*(pU.y-pC.y) + Math.sin(t)*(pF.y-pC.y)];
  });
  const fill = (pts, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    pts.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath(); ctx.fill();
  };

  const ptO = ring(pCO, pUO, pFO);
  const ptI = ring(pCI, pUI, pFI);

  /* Near face has smaller depth value (closer to camera) — draw far face first */
  const outerIsNear = pCO.d <= pCI.d;
  const [ptFar, ptNear, pCNear, wNear] = outerIsNear
    ? [ptI, ptO, pCO, wO]
    : [ptO, ptI, pCI, wI];

  const H = M / 2;
  fill(ptFar, 'rgba(28,32,40,0.95)');
  ctx.fillStyle = 'rgba(40,45,55,0.97)';
  for (const [s, e] of [[0, H], [H, M]]) {
    ctx.beginPath();
    ptFar.slice(s, e+1).forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    [...ptNear.slice(s, e+1)].reverse().forEach(([x,y]) => ctx.lineTo(x,y));
    ctx.closePath(); ctx.fill();
  }
  fill(ptNear, 'rgba(35,40,50,0.96)');

  /* Hub on near face */
  const hR  = tR * 0.20;
  const pH1 = project([wNear[0], wNear[1], wNear[2]+hR]);
  const pH2 = project([wNear[0]+hR, wNear[1], wNear[2]]);
  if (pH1 && pH2) {
    ctx.fillStyle = 'rgba(115,130,150,0.85)';
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
function drawTirePair(ctx, wc, tR, project, dpr) {
  const tW  = tR * 0.40;   // half-width of one tire (matches drawVolumetricTire)
  const axH = tR * 0.55;   // half-span: center → each tire center
  const yS  = wc[1] === 0 ? 1 : Math.sign(wc[1]);
  const wcO = [wc[0], wc[1] + yS * axH, wc[2]];  // outboard tire center
  const wcI = [wc[0], wc[1] - yS * axH, wc[2]];  // inboard  tire center
  drawVolumetricTire(ctx, wcO, tR, project);
  drawVolumetricTire(ctx, wcI, tR, project);
  // Axle tube between inner faces
  const pO = project([wcO[0], wcO[1] - yS * tW, wcO[2]]);
  const pI = project([wcI[0], wcI[1] + yS * tW, wcI[2]]);
  if (pO && pI) drawStrutTube(ctx, pO, pI, dpr);
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

/* Rotate a hinged surface by arc displacement.
   angle: signed — positive = TE up (z) or TE right (y).
   src: base positions to read from; omit to read from verts (accumulated). */
function animHinge(verts, idxs, r, angle, axis, src) {
  const dX   = r * (1 - Math.cos(angle));
  const dLat = r * Math.sin(angle);
  const base = src ?? verts;
  for (const vi of idxs) {
    const v = base[vi];
    verts[vi] = axis === 'z'
      ? [v[0]+dX, v[1],      v[2]+dLat]
      : [v[0]+dX, v[1]+dLat, v[2]     ];
  }
}

/* ── Generic turbofan fan-face renderer (screen-space) ───────────────────────
   hubPt  projected center of fan disk  {x, y, d}
   rimPt  projected rim vertex (sets disk radius in pixels)
   power  enginePower 0→1 (0=static blades, <0.30=slow, ≥0.30=blur disk)
   nBlades  fan blade count (22 typical CFM56 / LEAP)                        */
let _fanAngle = 0;

function _drawTurbofanFace(ctx, hubPt, rimPt, power, dpr, nBlades = 22) {
  if (!hubPt || !rimPt) return;
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const cx = hubPt.x, cy = hubPt.y;
  const hubR = r * 0.28, tipR = r * 0.94;
  ctx.save();

  if (power < 0.05) {
    /* Static — N tapered blade quads */
    ctx.fillStyle = 'rgba(96,110,126,0.92)';
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.085, aR = a + 0.085;
      ctx.beginPath();
      ctx.moveTo(cx + hubR * Math.cos(aL), cy + hubR * Math.sin(aL));
      ctx.lineTo(cx + tipR * Math.cos(aL - 0.10), cy + tipR * Math.sin(aL - 0.10));
      ctx.lineTo(cx + tipR * Math.cos(aR - 0.14), cy + tipR * Math.sin(aR - 0.14));
      ctx.lineTo(cx + hubR * Math.cos(aR), cy + hubR * Math.sin(aR));
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
      ctx.moveTo(cx + hubR * Math.cos(aL), cy + hubR * Math.sin(aL));
      ctx.lineTo(cx + tipR * Math.cos(aL - 0.12), cy + tipR * Math.sin(aL - 0.12));
      ctx.lineTo(cx + tipR * Math.cos(aR - 0.16), cy + tipR * Math.sin(aR - 0.16));
      ctx.lineTo(cx + hubR * Math.cos(aR), cy + hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
    /* Blur wash */
    const bGrad = ctx.createRadialGradient(cx, cy, hubR, cx, cy, tipR);
    bGrad.addColorStop(0, `rgba(138,152,168,${(t * 0.32).toFixed(2)})`);
    bGrad.addColorStop(1, `rgba(78,90,106,${(t * 0.20).toFixed(2)})`);
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(cx, cy, tipR, 0, Math.PI*2); ctx.fill();
  } else {
    /* Running — solid blur disk + faint streaks */
    const bGrad = ctx.createRadialGradient(cx, cy, hubR, cx, cy, tipR);
    bGrad.addColorStop(0,   'rgba(152,165,180,0.58)');
    bGrad.addColorStop(0.5, 'rgba(112,124,140,0.44)');
    bGrad.addColorStop(1,   'rgba(72,84,100,0.32)');
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(cx, cy, tipR, 0, Math.PI*2); ctx.fill();
    /* Radial streaks */
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = 'rgba(210,222,235,1)';
    ctx.lineWidth   = Math.max(0.5, dpr * 0.4);
    for (let i = 0; i < 9; i++) {
      const a = _fanAngle + i / 9 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + hubR * Math.cos(a), cy + hubR * Math.sin(a));
      ctx.lineTo(cx + tipR * Math.cos(a), cy + tipR * Math.sin(a));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* Spinner cone */
  ctx.fillStyle = 'rgba(52,58,70,0.97)';
  ctx.beginPath(); ctx.arc(cx, cy, hubR, 0, Math.PI*2); ctx.fill();

  /* Outer cowl ring */
  ctx.strokeStyle = 'rgba(158,172,188,0.78)';
  ctx.lineWidth   = Math.max(0.8, dpr * 0.7);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();

  ctx.restore();
}

/* ── CSM orbit-mode detail — windows, panel seams, RCS, soot streaks ─
   Called from _drawWireframe when isSV && S.rocketOrbit is true.
   Uses the live project() closure and already-computed pts array.    */
function _drawCSMOrbitDetail(ctx, pts, project, dpr, camSide) {
  if (camSide <= 0) return;   // side cam only; chase-cam depth check doesn't apply

  const smBase = 0.024, cmBase = 0.027, cmTop = 0.030;

  const smDamaged  = S.smDamaged ?? false;
  const smAge      = smDamaged ? Math.max(0, (S.time ?? 0) - (S.smExplosionT ?? 0)) : Infinity;
  const _o2BayAng  = Math.PI / 3;   // 60° — bay 1, O₂ tank 2 location

  /* CM cone radius at a given longitudinal position */
  function cmR(vF) {
    const t = (vF - cmBase) / (cmTop - cmBase);
    return _svcr * (1 - t) + _svcr2 * t;
  }

  /* Body-frame vertex on the CM cone at angle theta and longitudinal vF.
     Angle convention: π/2 = top (+z), 0 = right (+y), matching buildTube. */
  function cv(vF, theta) {
    const r = cmR(vF);
    return [vF, r * Math.cos(theta), r * Math.sin(theta)];
  }

  /* Draw a 4-corner quad as a glass window.
     Skips back-facing quads (2D winding check) and sub-pixel quads. */
  function drawWindow(q) {
    const ps = q.map(project);
    if (ps.some(p => !p)) return;
    const cross = (ps[1].x-ps[0].x)*(ps[2].y-ps[0].y) - (ps[1].y-ps[0].y)*(ps[2].x-ps[0].x);
    if (cross < 0) return;
    if (Math.hypot(ps[2].x-ps[0].x, ps[2].y-ps[0].y) < 2 * dpr) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ps[0].x, ps[0].y); ctx.lineTo(ps[1].x, ps[1].y);
    ctx.lineTo(ps[2].x, ps[2].y); ctx.lineTo(ps[3].x, ps[3].y);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(12, 22, 44, 0.93)'; ctx.fill();
    ctx.strokeStyle = 'rgba(155, 210, 250, 0.28)';
    ctx.lineWidth   = 0.8 * dpr; ctx.stroke();
    ctx.restore();
  }

  /* Visibility check: surface point at angle ang is on the front side if its
     projected depth is less than the SM axis centre depth. Valid for camSide > 0. */
  const smMidF  = (smBase + cmBase) * 0.5;
  const pCenter = project([smMidF, 0, 0]);
  function frontSide(ang) {
    const p = project([smMidF, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    return p && pCenter && p.d < pCenter.d;
  }

  /* ── CM windows (5 total) ──────────────────────────────────────── */
  const wF0 = cmBase + 0.0005;
  const wF1 = cmBase + 0.0014;

  /* Two forward crew windows: upper-right (θ ≈ +45°) and upper-left (θ ≈ +135°) */
  for (const [th, s] of [[Math.PI / 4, 1], [Math.PI * 3 / 4, -1]]) {
    if (!frontSide(th)) continue;
    drawWindow([cv(wF0, th - 0.13 * s), cv(wF0, th + 0.13 * s),
                cv(wF1, th + 0.13 * s), cv(wF1, th - 0.13 * s)]);
  }

  /* Two rendezvous windows: +y and -y sides (smaller) */
  const rvF1 = wF0 + 0.0008;
  for (const th of [0, Math.PI]) {
    if (!frontSide(th)) continue;
    drawWindow([cv(wF0, th - 0.09), cv(wF0, th + 0.09),
                cv(rvF1, th + 0.09), cv(rvF1, th - 0.09)]);
  }

  /* Top hatch window: centred on +z (top of CM) */
  if (frontSide(Math.PI / 2)) {
    drawWindow([cv(cmBase + 0.0003, Math.PI / 2 - 0.07), cv(cmBase + 0.0003, Math.PI / 2 + 0.07),
                cv(cmBase + 0.0010, Math.PI / 2 + 0.07), cv(cmBase + 0.0010, Math.PI / 2 - 0.07)]);
  }

  /* ── CM nose endcap — flat disc at Ring 9 (vF=0.030) after LES jettison ── */
  if (S.lesJettisoned) {
    const N16 = 16;
    const nosePts = [];
    for (let si = 0; si < N16; si++) {
      const theta = (si / N16) * Math.PI * 2;
      const p = project([cmTop, _svcr2 * Math.cos(theta), _svcr2 * Math.sin(theta)]);
      nosePts.push(p);
    }
    if (nosePts.every(p => p)) {
      const cross = (nosePts[1].x - nosePts[0].x) * (nosePts[2].y - nosePts[0].y)
                  - (nosePts[1].y - nosePts[0].y) * (nosePts[2].x - nosePts[0].x);
      if (cross > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(nosePts[0].x, nosePts[0].y);
        for (let si = 1; si < N16; si++) ctx.lineTo(nosePts[si].x, nosePts[si].y);
        ctx.closePath();
        ctx.fillStyle   = '#c4c0b8';
        ctx.fill();
        ctx.strokeStyle = 'rgba(145, 138, 128, 0.60)';
        ctx.lineWidth   = 0.7 * dpr; ctx.stroke();
        ctx.restore();
        /* Docking probe collar nub */
        const probP = project([cmTop + 0.00025, 0, 0]);
        if (probP) {
          ctx.save();
          ctx.beginPath(); ctx.arc(probP.x, probP.y, 2.0 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = '#9a948a'; ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  /* ── SM panel seams — 6 bays at 60° intervals ───────────────────── */
  ctx.save();
  ctx.strokeStyle = 'rgba(78, 60, 26, 0.36)';
  ctx.lineWidth   = 0.65 * dpr;
  for (let s = 0; s < 6; s++) {
    if (smDamaged && s === 1) continue;  // bay 1 panel blown off
    const ang = (s / 6) * Math.PI * 2;
    if (!frontSide(ang)) continue;
    const p7 = project([smBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    const p8 = project([cmBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    if (!p7 || !p8) continue;
    ctx.beginPath(); ctx.moveTo(p7.x, p7.y); ctx.lineTo(p8.x, p8.y); ctx.stroke();
  }
  ctx.restore();

  /* ── SM RCS — 4 quad pods at 45°/135°/225°/315° ────────────────── */
  const rcsvF  = smBase + 0.0020;   // mid-SM, upper region
  const rcsOut = _svcr * 1.18;      // outer face (protruding ~0.35 m from SM skin)
  const da     = 0.12;              // angular half-width of pod  (≈ 14°)
  const dvF    = 0.00028;           // axial half-height of pod

  /* Nozzle bell dimensions (frustum = 6-sided, cone-shaped) */
  const bellR   = _svcr * 0.070;   // bell mouth radius
  const throatR = bellR  * 0.50;   // throat (inner) radius
  const bellD   = _svcr  * 0.12;   // how far bell protrudes beyond pod face

  for (let q = 0; q < 4; q++) {
    const ang = q * Math.PI / 2 + Math.PI / 4;
    if (!frontSide(ang)) continue;

    /* Build pod corners — outer face at rcsOut, inner face at _svcr */
    const Co = (a, f) => [f, rcsOut  * Math.cos(a), rcsOut  * Math.sin(a)];
    const Ci = (a, f) => [f, _svcr   * Math.cos(a), _svcr   * Math.sin(a)];
    const oc = [Co(ang-da, rcsvF-dvF), Co(ang+da, rcsvF-dvF),
                Co(ang+da, rcsvF+dvF), Co(ang-da, rcsvF+dvF)];
    const ic = [Ci(ang-da, rcsvF-dvF), Ci(ang+da, rcsvF-dvF),
                Ci(ang+da, rcsvF+dvF), Ci(ang-da, rcsvF+dvF)];
    const po = oc.map(project), pi = ic.map(project);
    if (!po.every(p => p) || !pi.every(p => p)) continue;

    /* Front face */
    const fwc = (po[1].x-po[0].x)*(po[2].y-po[0].y) - (po[1].y-po[0].y)*(po[2].x-po[0].x);
    if (fwc > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(po[0].x, po[0].y); ctx.lineTo(po[1].x, po[1].y);
      ctx.lineTo(po[2].x, po[2].y); ctx.lineTo(po[3].x, po[3].y);
      ctx.closePath();
      ctx.fillStyle = '#12151d'; ctx.fill();
      ctx.strokeStyle = 'rgba(130, 148, 170, 0.45)'; ctx.lineWidth = 0.7 * dpr; ctx.stroke();
      ctx.restore();
    }

    /* Side walls — 4 faces connecting outer face to SM skin */
    ctx.save();
    const walls = [
      [po[3], po[0], pi[0], pi[3]],   // aft-vF wall
      [po[1], po[2], pi[2], pi[1]],   // fwd-vF wall
      [po[0], po[1], pi[1], pi[0]],   // ang- wall
      [po[2], po[3], pi[3], pi[2]],   // ang+ wall
    ];
    for (const w of walls) {
      if (w.some(p => !p)) continue;
      const wc = (w[1].x-w[0].x)*(w[2].y-w[0].y) - (w[1].y-w[0].y)*(w[2].x-w[0].x);
      if (wc <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(w[0].x, w[0].y); ctx.lineTo(w[1].x, w[1].y);
      ctx.lineTo(w[2].x, w[2].y); ctx.lineTo(w[3].x, w[3].y);
      ctx.closePath();
      ctx.fillStyle = '#1c2130'; ctx.fill();
      ctx.strokeStyle = 'rgba(110, 128, 150, 0.30)'; ctx.lineWidth = 0.5 * dpr; ctx.stroke();
    }
    ctx.restore();

    /* 4 nozzle bells — 2×2 grid; each is a truncated-cone frustum (6-sided) */
    const Np = 6;
    for (const nda of [-da * 0.52, da * 0.52]) {
      for (const ndvF of [-dvF * 0.52, dvF * 0.52]) {
        const a = ang + nda;
        /* Tangent axes perpendicular to the radial nozzle-axis [0, cos(a), sin(a)] */
        const ax1 = [1, 0, 0];                                 /* vF direction */
        const ax2 = [0, -Math.sin(a), Math.cos(a)];           /* circumferential */

        /* Throat sits at pod face; bell rim is bellD further outward */
        const tc = [rcsvF + ndvF,  rcsOut * Math.cos(a),               rcsOut * Math.sin(a)];
        const bc = [tc[0],         tc[1] + bellD * Math.cos(a),        tc[2] + bellD * Math.sin(a)];

        const bPts = [], tPts = [];
        for (let k = 0; k < Np; k++) {
          const phi = k * Math.PI * 2 / Np;
          const cp = Math.cos(phi), sp = Math.sin(phi);
          const off = (r, ctr) => [
            ctr[0] + r * (cp * ax1[0] + sp * ax2[0]),
            ctr[1] + r * (cp * ax1[1] + sp * ax2[1]),
            ctr[2] + r * (cp * ax1[2] + sp * ax2[2]),
          ];
          bPts.push(off(bellR,   bc));
          tPts.push(off(throatR, tc));
        }
        const bp = bPts.map(project), tp = tPts.map(project);
        if (!bp.every(p => p) || !tp.every(p => p)) continue;

        /* Skip if bell mouth faces away from camera */
        const bwc = (bp[1].x-bp[0].x)*(bp[2].y-bp[0].y) - (bp[1].y-bp[0].y)*(bp[2].x-bp[0].x);
        if (bwc <= 0) continue;

        ctx.save();
        /* Bell mouth face — dark interior */
        ctx.beginPath();
        ctx.moveTo(bp[0].x, bp[0].y);
        for (let k = 1; k < Np; k++) ctx.lineTo(bp[k].x, bp[k].y);
        ctx.closePath();
        ctx.fillStyle = '#050608'; ctx.fill();
        ctx.strokeStyle = 'rgba(140, 165, 190, 0.72)'; ctx.lineWidth = 0.55 * dpr; ctx.stroke();

        /* Frustum sides (bell rim → throat) */
        ctx.fillStyle = 'rgba(28, 34, 46, 0.90)';
        ctx.strokeStyle = 'rgba(90, 110, 140, 0.38)'; ctx.lineWidth = 0.4 * dpr;
        for (let k = 0; k < Np; k++) {
          const k1 = (k + 1) % Np;
          const sc = (bp[k1].x-bp[k].x)*(tp[k].y-bp[k].y) - (bp[k1].y-bp[k].y)*(tp[k].x-bp[k].x);
          if (sc <= 0) continue;
          ctx.beginPath();
          ctx.moveTo(bp[k].x, bp[k].y); ctx.lineTo(tp[k].x, tp[k].y);
          ctx.lineTo(tp[k1].x, tp[k1].y); ctx.lineTo(bp[k1].x, bp[k1].y);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* ── CM RCS — 12 thrusters in 6 pairs around aft CM section ─────── */
  const cmRcsVF = cmBase - 0.0006;
  const cmRcsR  = _svcr * 1.012;
  const cmNozR  = Math.max(0.8, 1.0 * dpr);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    if (!frontSide(ang)) continue;
    /* Two thrusters per position (subsystem A and B), offset axially */
    for (const [dA, dVF] of [[-0.009, -0.00015], [0.009, 0.00015]]) {
      const n = project([cmRcsVF + dVF, cmRcsR * Math.cos(ang + dA), cmRcsR * Math.sin(ang + dA)]);
      if (!n) continue;
      ctx.beginPath(); ctx.arc(n.x, n.y, cmNozR, 0, Math.PI * 2);
      ctx.fillStyle   = '#0e1115'; ctx.fill();
      ctx.strokeStyle = 'rgba(108, 125, 148, 0.45)';
      ctx.lineWidth   = 0.5 * dpr; ctx.stroke();
    }
  }

  /* ── Soot streaks on SM gold Mylar — gradient lines along SM axis ─ */
  let rng = 0x6b4d2e;
  const lcg = s => ((s * 1664525 + 1013904223) & 0xffffffff) >>> 0;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    rng = lcg(rng); const ang = (rng % 10000) / 10000 * Math.PI * 2;
    if (!frontSide(ang)) { rng = lcg(rng); rng = lcg(rng); continue; }
    rng = lcg(rng); const alpha = 0.07 + (rng % 100) / 1000 * 0.11;
    rng = lcg(rng); const wid   = (1.3 + (rng % 100) / 55) * dpr;
    const pS = project([cmBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    const pE = project([smBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    if (!pS || !pE) continue;
    const g = ctx.createLinearGradient(pS.x, pS.y, pE.x, pE.y);
    g.addColorStop(0,    `rgba(8,6,2,${alpha.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(6,5,1,${(alpha * 0.5).toFixed(3)})`);
    g.addColorStop(1,    'rgba(4,3,1,0)');
    ctx.strokeStyle = g; ctx.lineWidth = wid;
    ctx.beginPath(); ctx.moveTo(pS.x, pS.y); ctx.lineTo(pE.x, pE.y); ctx.stroke();
  }
  ctx.restore();

  /* ── O₂ tank 2 explosion damage — bay 1 at 60° ──────────────────── */
  if (smDamaged && frontSide(_o2BayAng)) {
    /* 1. Scorch mark — permanent dark burn around the bay */
    const pScorch = project([smMidF + 0.001, _svcr * Math.cos(_o2BayAng), _svcr * Math.sin(_o2BayAng)]);
    if (pScorch) {
      const sr = 14 * dpr;
      const sg = ctx.createRadialGradient(pScorch.x, pScorch.y, 0, pScorch.x, pScorch.y, sr);
      sg.addColorStop(0,   'rgba(18,12,4,0.92)');
      sg.addColorStop(0.3, 'rgba(30,18,6,0.60)');
      sg.addColorStop(1,   'rgba(50,35,12,0)');
      ctx.save(); ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(pScorch.x, pScorch.y, sr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    /* 2. Bent panel — dark scorched quad sticking outward from bay */
    const da = Math.PI / 6.5;
    const panelOut = _svcr * 0.26;
    const pq = [
      project([smBase + 0.0005, _svcr * Math.cos(_o2BayAng - da * 0.5), _svcr * Math.sin(_o2BayAng - da * 0.5)]),
      project([smBase + 0.0005, _svcr * Math.cos(_o2BayAng + da * 0.5), _svcr * Math.sin(_o2BayAng + da * 0.5)]),
      project([cmBase - 0.0005, (_svcr + panelOut) * Math.cos(_o2BayAng + da * 0.2), (_svcr + panelOut) * Math.sin(_o2BayAng + da * 0.2)]),
      project([cmBase - 0.0005, (_svcr + panelOut) * Math.cos(_o2BayAng - da * 0.2), (_svcr + panelOut) * Math.sin(_o2BayAng - da * 0.2)]),
    ];
    if (pq.every(p => p)) {
      const cross = (pq[1].x - pq[0].x) * (pq[2].y - pq[0].y) - (pq[1].y - pq[0].y) * (pq[2].x - pq[0].x);
      if (cross > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pq[0].x, pq[0].y); ctx.lineTo(pq[1].x, pq[1].y);
        ctx.lineTo(pq[2].x, pq[2].y); ctx.lineTo(pq[3].x, pq[3].y);
        ctx.closePath();
        ctx.fillStyle   = 'rgba(55,42,18,0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,100,35,0.65)';
        ctx.lineWidth   = 0.8 * dpr; ctx.stroke();
        ctx.restore();
      }
    }

    /* 3. Persistent O₂ vent — thin gas trail, fades over 10 minutes */
    if (smAge < 600) {
      const rampIn  = smAge < 1 ? smAge : 1;
      const ventA   = 0.45 * rampIn * Math.max(0, 1 - smAge / 600);
      if (ventA > 0.005) {
        const pVBase = project([smMidF, (_svcr + 0.00005) * Math.cos(_o2BayAng), (_svcr + 0.00005) * Math.sin(_o2BayAng)]);
        const pVTip  = project([smMidF + 0.003, (_svcr + 0.0012) * Math.cos(_o2BayAng + 0.08), (_svcr + 0.0012) * Math.sin(_o2BayAng + 0.08)]);
        if (pVBase && pVTip) {
          const vg = ctx.createLinearGradient(pVBase.x, pVBase.y, pVTip.x, pVTip.y);
          vg.addColorStop(0,   `rgba(210,225,255,${ventA.toFixed(3)})`);
          vg.addColorStop(0.5, `rgba(190,210,255,${(ventA * 0.55).toFixed(3)})`);
          vg.addColorStop(1,   'rgba(180,200,255,0)');
          ctx.save();
          ctx.strokeStyle = vg;
          ctx.lineWidth   = Math.max(1.5, 2.8 * dpr);
          ctx.lineCap     = 'round';
          ctx.beginPath(); ctx.moveTo(pVBase.x, pVBase.y); ctx.lineTo(pVTip.x, pVTip.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* 4. Initial explosion puff — expanding cloud, first 5 seconds */
    if (smAge < 5) {
      const pBay = project([smMidF, _svcr * Math.cos(_o2BayAng), _svcr * Math.sin(_o2BayAng)]);
      if (pBay) {
        const frac  = smAge / 5;
        const puffR = frac * 80 * dpr;
        const puffA = Math.max(0, 1 - frac * frac);
        const pg = ctx.createRadialGradient(pBay.x, pBay.y, 0, pBay.x, pBay.y, Math.max(1, puffR));
        pg.addColorStop(0,    `rgba(255,215,130,${(puffA * 0.95).toFixed(2)})`);
        pg.addColorStop(0.15, `rgba(230,200,160,${(puffA * 0.70).toFixed(2)})`);
        pg.addColorStop(0.45, `rgba(180,185,200,${(puffA * 0.35).toFixed(2)})`);
        pg.addColorStop(1,    'rgba(160,170,200,0)');
        ctx.save();
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(pBay.x, pBay.y, Math.max(1, puffR), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

/* ── Core wireframe + shading renderer ───────────────────────── */
function _drawWireframe(canvas, acPitchDeg, acRollDeg, camBack, camUp, camSide, wingView = false, orbitAzDeg = 0, orbitElDeg = 0) {
  /* Advance fan rotation angle — capped so it doesn't spin during static frames */
  _fanAngle = (_fanAngle + Math.min(0.06, (S.enginePower ?? 0) * 0.35)) % (Math.PI * 2);

  const isC172  = (S.aircraft?.panel === 'g1000' || S.aircraft?.panel === 'dr400');
  const isSV    = !isC172 && (S.aircraft?.id === 'saturn-v');
  const isF9    = !isC172 && !isSV && (S.aircraft?.id?.startsWith('falcon9') || S.aircraft?.vehicleType === 'rocket');
  const isBf109 = !isC172 && !isF9 && !isSV && (S.aircraft?.id === 'bf109');
  const isF4U  = !isC172 && !isF9 && !isSV && !isBf109 && (S.aircraft?.id === 'f4u1a');
  const _wbGeo = (!isC172 && !isF9 && !isBf109 && !isF4U && !isSV)
    ? (_wbCache[S.aircraft?.id] ?? _wbCache.default) : null;
  const _b   = _wbGeo?.b ?? 162;  // base index of non-tube vertices; 162 for nNose=5, 194 for nNose=7
  const V_   = isC172 ? _V_c172      : isF9 ? _V_f9      : isBf109 ? _V_b109      : isF4U ? _V_f4u      : isSV ? _V_sv      : _wbGeo.V_;
  const F_   = isC172 ? _F_c172      : isF9 ? _F_f9      : isBf109 ? _F_b109      : isF4U ? _F_f4u      : isSV ? _F_sv      : _wbGeo.F_;
  const FC_  = isC172 ? _FC_c172     : isF9 ? _FC_f9     : isBf109 ? _FC_b109     : isF4U ? _FC_f4u     : isSV ? _FC_sv     : _wbGeo.FC_;
  const FN_  = isC172 ? _FN_c172     : isF9 ? _FN_f9     : isBf109 ? _FN_b109     : isF4U ? _FN_f4u     : isSV ? _FN_sv     : _wbGeo.FN_;
  const E_   = isC172 ? _E_c172      : isF9 ? _E_f9      : isBf109 ? _E_b109      : isF4U ? _E_f4u      : isSV ? _E_sv      : _wbGeo.E_;
  const _livCol = S.aircraft?.livery?.colors;
  const COL_ = isC172 ? _COLORS_c172 : isF9 ? _COLORS_f9 : isBf109 ? _COLORS_b109 : isF4U ? _COLORS_f4u : isSV ? _COLORS_sv
             : _livCol ? _COLORS.map((c, i) => _livCol[i] ?? c) : _COLORS;
  const GV_  = isC172 ? _GV_c172     : isBf109 ? _GV_b109 : isF4U ? _GV_f4u : _GV;

  const P = acPitchDeg * DEG, R = acRollDeg * DEG;
  const cosP = Math.cos(P), sinP = Math.sin(P);
  const cosR = Math.cos(R), sinR = Math.sin(R);
  /* Rockets spin around their longitudinal axis (pre-roll before pitch).
     Aircraft bank around the camera forward axis (post-pitch roll). */
  const isBodyRoll = isSV || isF9;

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
    const _afStage      = (isF9 || isSV) ? (S.rocketStage ?? 1) : 0;
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
        minCR = Math.min(minCR, rR); maxCR = Math.max(maxCR, rR);
        minCU = Math.min(minCU, uR); maxCU = Math.max(maxCU, uR);
      }
    }
    /* Include launch tower in auto-fit only while still near the pad */
    if ((isSV || isF9) && camSide > 0) {
      const _padNm = (S.mission?.departure?.elevation ?? 0) * FT_NM;
      const _rise  = Math.max(0, (S.alt ?? 0) * FT_NM - _padNm);
      if (_rise < 0.050) {
        const _tR  = isSV ? 0.0028 : 0.0020;
        const _top = (isSV ? 0.038 : 0.024) + _tR * 2;
        const _bot = (isSV ? -0.030 : -0.016) - 0.004;
        minCU = Math.min(minCU, _bot); maxCU = Math.max(maxCU, _top);
        minCR = Math.min(minCR, -_tR * 9.8); maxCR = Math.max(maxCR, _tR * 9.8);
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
    if (camSide > 0) { camSide = d * _orbitZoom; camUp = 0; }
    else              { camBack = d * _orbitZoom; camUp = d * _orbitZoom * 0.18; }
    /* Shift cx/cy so the bounding-box centre lands at the viewport centre */
    const _camD = camSide > 0 ? camSide : camBack;
    cx -= centerCR * focal / _camD;
    cy += centerCU * focal / _camD;

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
  }

  const camDist  = camSide > 0 ? camSide : camBack;
  const camPitch = Math.atan2(-camUp, camDist);
  const cosCP = Math.cos(camPitch), sinCP = Math.sin(camPitch);
  const sinEl = Math.sin(orbitElDeg * DEG), cosEl = Math.cos(orbitElDeg * DEG);

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

    /* Elevation orbit: tilt the scene up/down around the camera horizontal axis */
    if (orbitElDeg !== 0 && camSide > 0) {
      const fP2 = fP * cosEl + rR * sinEl;
      rR = -fP * sinEl + rR * cosEl;
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

  /* Flaps + ailerons */
  let verts = V_;
  if (isC172) {
    const flapCfg  = S.flaps ?? 0;
    const maxBank  = S.aircraft?.handling?.maxBank ?? 60;
    const ailCmd   = Math.max(-1, Math.min(1, (S.rollT ?? 0) / maxBank));
    const pitchErr = (S.pitchT ?? 0) - (S.pitch ?? 0);
    const elevCmd  = Math.max(-1, Math.min(1, pitchErr / 10 + (S.trim ?? 0) / 10));
    const hdgDelta = ((((S.hdgT ?? 0) - (S.hdg ?? 0)) + 540) % 360) - 180;
    const rudCmd   = Math.max(-1, Math.min(1, hdgDelta / 20));
    if (flapCfg > 0 || Math.abs(ailCmd) > 0.01 || Math.abs(elevCmd) > 0.02 || Math.abs(rudCmd) > 0.02) {
      verts = _V_c172.map(v => v.slice());
      if (flapCfg > 0)
        animHinge(verts, [83,108,87,110,128,132,134,138], _anim_c172.r_fl, -(flapCfg*10*DEG), 'z', _V_c172);
      if (Math.abs(ailCmd) > 0.01) {
        const aa = ailCmd * 18 * DEG;
        animHinge(verts, [181,85,182,130], _anim_c172.r_ail, -aa, 'z');  // R: TE down
        animHinge(verts, [183,89,184,136], _anim_c172.r_ail, +aa, 'z');  // L: TE up
      }
      if (Math.abs(elevCmd) > 0.02)
        animHinge(verts, [95,97,99,101,148,150,156,158], _anim_c172.r_el, elevCmd*20*DEG, 'z');
      if (Math.abs(rudCmd) > 0.02)
        animHinge(verts, [91,93], _anim_c172.r_ru, -(rudCmd*25*DEG), 'y');
    }
  } else if (isBf109) {
    const flapCfg  = S.flaps ?? 0;
    const maxBank  = S.aircraft?.handling?.maxBank ?? 60;
    const ailCmd   = Math.max(-1, Math.min(1, (S.rollT ?? 0) / maxBank));
    const pitchErr = (S.pitchT ?? 0) - (S.pitch ?? 0);
    const elevCmd  = Math.max(-1, Math.min(1, pitchErr / 10 + (S.trim ?? 0) / 10));
    const hdgDelta = ((((S.hdgT ?? 0) - (S.hdg ?? 0)) + 540) % 360) - 180;
    const rudCmd   = Math.max(-1, Math.min(1, hdgDelta / 20));
    if (flapCfg > 0 || Math.abs(ailCmd) > 0.01 || Math.abs(elevCmd) > 0.02 || Math.abs(rudCmd) > 0.02) {
      verts = _V_b109.map(v => v.slice());
      const { r_fl, r_el, r_ru, r_ail } = _anim_b109;
      if (flapCfg > 0)
        animHinge(verts, [99,144,103,146,148,152,154,158], r_fl, -(flapCfg*10*DEG), 'z', _V_b109);
      if (Math.abs(ailCmd) > 0.01) {
        const aa = ailCmd * 25 * DEG;
        animHinge(verts, [175,101,176,150], r_ail, -aa, 'z', _V_b109);  // R: TE down
        animHinge(verts, [177,105,178,156], r_ail, +aa, 'z', _V_b109);  // L: TE up
      }
      if (Math.abs(elevCmd) > 0.02)
        animHinge(verts, [111,113,115,117,180,182,184,186], r_el, elevCmd*20*DEG, 'z', _V_b109);
      if (Math.abs(rudCmd) > 0.02)
        animHinge(verts, [107,109], r_ru, -(rudCmd*25*DEG), 'y', _V_b109);
    }
  } else if (isF4U) {
    const flapCfg  = S.flaps ?? 0;
    const maxBank  = S.aircraft?.handling?.maxBank ?? 60;
    const ailCmd   = Math.max(-1, Math.min(1, (S.rollT ?? 0) / maxBank));
    const pitchErr = (S.pitchT ?? 0) - (S.pitch ?? 0);
    const elevCmd  = Math.max(-1, Math.min(1, pitchErr / 10 + (S.trim ?? 0) / 10));
    const hdgDelta = ((((S.hdgT ?? 0) - (S.hdg ?? 0)) + 540) % 360) - 180;
    const rudCmd   = Math.max(-1, Math.min(1, hdgDelta / 20));
    if (flapCfg > 0 || Math.abs(ailCmd) > 0.01 || Math.abs(elevCmd) > 0.02 || Math.abs(rudCmd) > 0.02) {
      verts = _V_f4u.map(v => v.slice());
      const { r_fl, r_el, r_ru, r_ail } = _anim_f4u;
      if (flapCfg > 0)
        animHinge(verts, [101,103,154,156], r_fl, -(flapCfg*15*DEG), 'z', _V_f4u);
      if (Math.abs(ailCmd) > 0.01) {
        const aa = ailCmd * 25 * DEG;
        animHinge(verts, [183,105,184,158], r_ail, -aa, 'z', _V_f4u);
        animHinge(verts, [185,113,186,166], r_ail, +aa, 'z', _V_f4u);
      }
      if (Math.abs(elevCmd) > 0.02)
        animHinge(verts, [119,121,123,125,188,190,192,194], r_el, elevCmd*20*DEG, 'z', _V_f4u);
      if (Math.abs(rudCmd) > 0.02)
        animHinge(verts, [115,117], r_ru, -(rudCmd*25*DEG), 'y', _V_f4u);
    }
  } else if (!isF9 && !isBf109 && !isF4U && !isSV) {
    const flap   = S.flaps ?? 0;
    /* AP aircraft (no manualControl): add heading error so arrow-key turns show aileron deflection.
       Manual WB aircraft (AN-225 etc.) use rollT from tickControls; hdgDelta would drift spuriously. */
    const _isAPAircraft = !S.aircraft?.manualControl;
    const hdgDelta = _isAPAircraft ? ((((S.hdgT ?? 0) - (S.hdg ?? 0)) + 540) % 360) - 180 : 0;
    const rollErr  = (S.rollT ?? 0) - (S.roll ?? 0);
    const bankCmd  = Math.max(-1, Math.min(1, (S.roll ?? 0) / 30));  // ±1 at ±30° bank
    const ailCmd   = Math.max(-1, Math.min(1, rollErr / 20 + bankCmd * 0.3 + hdgDelta / 40));
    if (flap > 0 || Math.abs(ailCmd) > 0.02) {
      verts = _wbGeo.V_.map(v => v.slice());
      const _bL = _wbGeo.b, _wbV = _wbGeo.V_;
      if (flap > 0) {
        const fa = flap * 15 * DEG;
        const { r_rt, r_hs } = _wbGeo.anim;
        animHinge(verts, [_bL+1,_bL+117,_bL+5,_bL+121],   r_rt, -fa, 'z', _wbV);
        animHinge(verts, [_bL+125,_bL+127,_bL+129,_bL+131], r_hs, -fa, 'z', _wbV);
      }
      if (Math.abs(ailCmd) > 0.01) {
        const aa = ailCmd * 40 * DEG;
        const { r_ail } = _wbGeo.anim;
        animHinge(verts, [_bL+132, _bL+3, _bL+133, _bL+119], r_ail, -aa, 'z', _wbV);
        animHinge(verts, [_bL+134, _bL+7, _bL+135, _bL+123], r_ail, +aa, 'z', _wbV);
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
    const silVI  = isC172
      ? [80, 84, 85, 81, 89, 88]                   // C172: nose(80), R tip, tail(81), L tip
      : isF9
      ? [96, 100, 0, 8, 108]                       // F9: nose, fin dorsal, aft top/bot, fin ventral
      : isBf109
      ? [96, 100, 101, 97, 105, 104]               // Bf109: spinner(96), R tip LE/TE, tail(97), L tip
      : isF4U
      ? [96, 104, 105, 97, 112, 113]               // F4U: noseTip(96), R tip LE/TE, tailTip(97), L tip LE/TE
      : isSV
      ? [160, 0, 4, 8, 12]                         // Saturn V: tip, aft base cardinal points
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

    /* Ground level: for rockets use lowest vertex (vertical body), for aircraft use AGL */
    const groundUR = (isSV || isF9)
      ? Math.min(...rotated.map(v => v.uR))
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
  const rStage = (isF9 || isSV) ? (S.rocketStage ?? 1) : 0;

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

  const _DBG_CULL = false;  // ← set true to paint front=blue, back=red

  const _trActive = !isF9 && !isSV && !isC172 && !isBf109 && !isF4U && !!(S.thrustReverser);

  /* Build shaded face list with average depth */
  const faces = F_.map((fi, i) => {
    /* F9 stage sep: main vehicle = S2 + Dragon + MVac nozzle (faces 48-95 + 96-103) */
    if (isF9 && rStage >= 2 && (i < 48 || (i > 95 && i < 104))) return null;

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
      if (orbitElDeg !== 0 && camSide > 0) rWn = -fPn * sinEl + rWn * cosEl;
      isBackFace = camSide > 0 ? rWn < 0 : fPn > 0;
    } else {
      const p0 = ps[0], p1 = ps[1], p2 = ps[2];
      const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
      isBackFace = cross < 0;
    }
    if (isBackFace && !_DBG_CULL) return null;

    if (_DBG_CULL) {
      const avgD = ps.reduce((s, p) => s + p.d, 0) / ps.length;
      return { ps, br: 1, avgD, col: isBackFace ? [200, 0, 0] : [0, 80, 200] };
    }

    const [nF, nR, nU] = rotateNormal(FN_[i]);
    const amb  = (isF9 && FC_[i] === 4) ? 0.55 : 0.18;
    const br   = litBr(nF, nR, nU, amb);
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

    return { ps, br, avgD, col: COL_[FC_[i]], grad };
  }).filter(Boolean);

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
        const fP2 = mF * cosEl + mR * sinEl;
        mR = -mF * sinEl + mR * cosEl;
        mF = fP2;
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
  const _PLUME_ROOT = { rp1: [255, 240, 160], lh2: [215, 240, 255] };
  const _PLUME_HOT  = { rp1: [255, 165,  60], lh2: [170, 215, 255] };
  const _PLUME_OFF  = { rp1: [ 22,  18,  15], lh2: [ 15,  18,  24] };

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

  if (isSV && pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO) {
    const svStage = S.rocketStage ?? 1;
    /* S-IC — 5× F-1, RP-1/LOX orange plume, emits from nozzle exit plane */
    if (svStage === 1) {
      const _nzExit = -0.030 - _sv1r * 0.58;
      const pNoz = project([_nzExit, 0, 0]);
      _drawPlume(pNoz, _sv1r, [_nzExit, 0, 0], 0.026, 0.72 * _engFrac);
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

      /* Top attachment cap — throat glow when firing */
      if (!topR.some(p => !p)) {
        const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: topR, br: f1On ? 1.0 : 0.06, avgD,
                     col: f1On ? _PLUME_HOT.rp1 : _PLUME_OFF.rp1 });
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
        faces.push({ ps: topR, br: j2On ? 1.0 : 0.06, avgD,
                     col: j2On ? _PLUME_HOT[style] : _PLUME_OFF[style] });
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

  /* Engine overlays: thrust-reverser cascade + chevrons */
  if (!isF9 && !isSV && !isC172 && !isBf109 && !isF4U) _engineOverlays(pts, faces, S.aircraft?.engine, _b);

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

  /* Painter's algorithm: farthest first */
  faces.sort((a, b) => b.avgD - a.avgD);

  /* Fill shaded faces */
  for (const { ps, br, col, grad } of faces) {
    if (grad) {
      const { pL, pR, brL, brR } = grad;
      const g = ctx.createLinearGradient(pL.x, pL.y, pR.x, pR.y);
      g.addColorStop(0, `rgb(${col[0]*brL|0},${col[1]*brL|0},${col[2]*brL|0})`);
      g.addColorStop(1, `rgb(${col[0]*brR|0},${col[1]*brR|0},${col[2]*brR|0})`);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = `rgb(${Math.round(col[0]*br)},${Math.round(col[1]*br)},${Math.round(col[2]*br)})`;
    }
    ctx.beginPath();
    ctx.moveTo(ps[0].x, ps[0].y);
    for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
    ctx.closePath();
    ctx.fill();
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

  /* Swiss cross — v-stab + both winglets */
  if (S.aircraft?.swissCross) {
    _drawSwissCross(ctx, pts[_b+8],  pts[_b+9],   pts[_b+11],  pts[_b+10]);   // v-stab
    _drawSwissCross(ctx, pts[_b+118], pts[_b+147], pts[_b+101], pts[_b+100]);  // R winglet (upper surf)
    _drawSwissCross(ctx, pts[_b+122], pts[_b+151], pts[_b+103], pts[_b+102]);  // L winglet (upper surf)
  }

  /* Prop disk — C172 and Bf109, only while engine running */
  if ((isC172 || isBf109 || isF4U) && S.engineState === 'running') {
    const p0    = isBf109 ? pts[96] : isF4U ? pts[96] : pts[80];
    const pProp = isBf109 ? pts[118] : isF4U ? pts[126] : pts[106];
    if (p0 && pProp) {
      const r = Math.hypot(pProp.x - p0.x, pProp.y - p0.y);
      if (r > 2) {
        ctx.save();
        ctx.fillStyle = 'rgba(200,210,220,0.22)';
        ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200,215,225,0.70)';
        ctx.lineWidth = Math.max(1, devicePixelRatio);
        ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* Turbofan fan face — wide-body (WB) aircraft only */
  if (!isC172 && !isF9 && !isBf109 && !isF4U && !isSV) {
    const ePow = S.enginePower ?? 0;
    if (ePow > 0 || S.engineState === 'running') {
      _drawTurbofanFace(ctx, pts[_b+158], pts[_b+20], ePow, dpr, 22);  // R inner
      _drawTurbofanFace(ctx, pts[_b+159], pts[_b+60], ePow, dpr, 22);  // L inner
      /* 4-engine aircraft (A340): also render outer engine fans at ey2 */
      const _ey2 = _wbGeo?.ey2;
      if (_ey2) {
        const _ez2 = _wbGeo.ez ?? _ez;
        const _er2 = _wbGeo.er ?? _er;
        const pHR = project([0.005,  _ey2, _ez2]);
        const pRR = project([0.005,  _ey2, _ez2 + _er2]);
        const pHL = project([0.005, -_ey2, _ez2]);
        const pRL = project([0.005, -_ey2, _ez2 + _er2]);
        if (pHR && pRR) _drawTurbofanFace(ctx, pHR, pRR, ePow, dpr, 22);
        if (pHL && pRL) _drawTurbofanFace(ctx, pHL, pRL, ePow, dpr, 22);
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

  /* Cabin + cockpit windows and doors — A350 only */
  if (!isC172 && !isF9 && !isBf109 && !isF4U && !isSV) {
    const dpr = devicePixelRatio;
    {
      const ww = Math.max(2, 2 * dpr), wh = Math.max(3, 3.5 * dpr);
      ctx.save();
      ctx.fillStyle = 'rgba(155,210,245,0.80)';
      for (const wv of _WIN) {
        const wp = project(wv);
        if (wp) ctx.fillRect(wp.x - ww/2, wp.y - wh/2, ww, wh);
      }
      ctx.restore();
    }
    {
      const ww = Math.max(3, 4 * dpr), wh = Math.max(2.5, 3 * dpr);
      ctx.save();
      ctx.fillStyle = 'rgba(25,35,55,0.92)';
      for (const wv of _CWIN) {
        const wp = project(wv);
        if (wp) ctx.fillRect(wp.x - ww/2, wp.y - wh/2, ww, wh);
      }
      ctx.restore();
    }
    {
      const dw = Math.max(3.5, 4 * dpr), dh = Math.max(5, 6 * dpr);
      ctx.save();
      ctx.strokeStyle = 'rgba(160,175,195,0.65)';
      ctx.lineWidth = Math.max(0.5, 0.7 * dpr);
      for (const dv of _DOOR) {
        const dp = project(dv);
        if (dp) ctx.strokeRect(dp.x - dw/2, dp.y - dh/2, dw, dh);
      }
      ctx.restore();
    }
  }

  /* Edge backface culling — hide edges where both endpoints' normals face away from camera.
     Returns the camera-depth derivative of the vertex normal: negative = faces toward camera. */
  function edgeCamDir(vi) {
    const [nF, nR, nU] = VN_[vi];
    let fP, rW;
    if (isBodyRoll) {
      const nR2 = nR * cosR - nU * sinR;
      const nU2 = nR * sinR + nU * cosR;
      fP = nF * cosP - nU2 * sinP;
      rW = nR2;
    } else {
      fP = nF * cosP - nU * sinP;
      const uP = nF * sinP + nU * cosP;
      rW = nR * cosR + uP * sinR;
    }
    if (orbitElDeg !== 0 && camSide > 0) {
      const fP2 = fP * cosEl + rW * sinEl;
      rW = -fP * sinEl + rW * cosEl;
      fP = fP2;
    }
    return camSide > 0 ? -rW : fP;
  }

  /* Wireframe edges on top */
  ctx.save();
  ctx.strokeStyle = 'rgba(175,195,215,0.65)';
  ctx.lineWidth   = Math.max(1, devicePixelRatio);
  ctx.beginPath();
  for (const [a, b] of E_) {
    /* F9 stage sep: main vehicle = S2+Dragon (v48-v96) + MVac nozzle (v122-v138) */
    if (isF9 && rStage >= 2) {
      const inMain = v => (v >= 48 && v <= 96) || (v >= 122 && v <= 138);
      if (!inMain(a) || !inMain(b)) continue;
    }
    /* Saturn V LES jettison: hide tower lattice (mid-ring verts 173-176 + diagonals) */
    if (isSV && S.lesJettisoned && (a >= 173 || b >= 173)) continue;
    /* Saturn V staging: hide spent stage edges
       S-IC body/interstage: verts 0–47 + fin verts 161–172
       S-II body/skirt:      verts 48–79                           */
    if (isSV && rStage >= 2 && ((a <= 47 || (a >= 161 && a <= 172)) || (b <= 47 || (b >= 161 && b <= 172)))) continue;
    if (isSV && rStage >= 3 && ((a >= 48 && a <= 79) || (b >= 48 && b <= 79))) continue;
    if (isSV && S.sivbSep   && ((a >= 80 && a <= 111) || (b >= 80 && b <= 111))) continue;
    if (isSV && _inTDSep    && ((a >= 96 && a <= 111) || (b >= 96 && b <= 111))) continue;
    const pa = (isSV && _inTDSep && ptsCSM && a >= 112) ? ptsCSM[a] : pts[a];
    const pb = (isSV && _inTDSep && ptsCSM && b >= 112) ? ptsCSM[b] : pts[b];
    if (!pa || !pb) continue;
    /* Cull edges that are entirely on the back side */
    if (edgeCamDir(a) > 0 && edgeCamDir(b) > 0) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();
  ctx.restore();

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

  /* Landing gear — always visible on C172 + Bf109, animated on wide-body, none for rockets */
  const _gearP = (!isC172 && !isBf109 && !isF4U) ? (S.gearAnim ?? (S.gear ? 1 : 0)) : 1;
  const _lerpV3 = (up, dn, t) => [up[0]+(dn[0]-up[0])*t, up[1]+(dn[1]-up[1])*t, up[2]+(dn[2]-up[2])*t];
  const _animGV = (isC172 || isBf109 || isF4U) ? GV_ : [
    GV_[0],  // nose strut pivot (fixed)
    _lerpV3([0.013,  0.0005, -_r+0.001], GV_[1], _gearP),  // nose wheel folds forward-up
    GV_[2],  // R main pivot (fixed)
    _lerpV3([-0.001, 0.0012, -_r+0.001], GV_[3], _gearP),  // R main folds inward-up
    GV_[4],  // L main pivot (fixed)
    _lerpV3([-0.001,-0.0012, -_r+0.001], GV_[5], _gearP),  // L main folds inward-up
  ];

  if (!isF9 && !isSV && (isC172 || isBf109 || isF4U || _gearP > 0.01)) {
    const gpts = _animGV.map(project);
    ctx.save();
    ctx.lineWidth = Math.max(1, dpr);
    for (const [a, b] of _GE) {
      const pa = gpts[a], pb = gpts[b];
      if (!pa || !pb) continue;
      drawStrutTube(ctx, pa, pb, dpr);
    }
    /* Side stays + drag braces — wide-body only.
       Each stay runs from a fixed aircraft attachment to the animated strut midpoint.
       Midpoints track _animGV so the stays collapse naturally during retraction. */
    if (!isC172 && !isBf109 && !isF4U) {
      const _wbR   = _wbGeo?.r ?? _r;
      const _midV3 = (a, b) => [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
      /* Nose drag brace: aft belly anchor → mid nose strut */
      const nA   = project([0.007,  0,       -_wbR + 0.0008]);
      const nM   = project(_midV3(_animGV[0], _animGV[1]));
      if (nA && nM) drawStrutTube(ctx, nA, nM, dpr);
      /* R main side stay: inboard wing anchor → mid main strut */
      const rA   = project([0.001,  0.0012, -_wbR * 0.50]);
      const rM   = project(_midV3(_animGV[2], _animGV[3]));
      if (rA && rM) drawStrutTube(ctx, rA, rM, dpr);
      /* L main side stay */
      const lA   = project([0.001, -0.0012, -_wbR * 0.50]);
      const lM   = project(_midV3(_animGV[4], _animGV[5]));
      if (lA && lM) drawStrutTube(ctx, lA, lM, dpr);
    }
    if (isC172) {
      for (const [vi, tR] of [[1, _xr*0.48], [3, _xr*0.56], [5, _xr*0.56]])
        drawVolumetricTire(ctx, GV_[vi], tR, project);
    } else if (isBf109) {
      for (const [vi, tR] of [[1, _bcR*0.55], [3, _bcR*0.55], [5, _bcR*0.26]])
        drawVolumetricTire(ctx, GV_[vi], tR, project);
    } else if (isF4U) {
      for (const [vi, tR] of [[1, _f4uCowlR*0.58], [3, _f4uCowlR*0.58], [5, _f4uCowlR*0.30]])
        drawVolumetricTire(ctx, GV_[vi], tR, project);
    } else {
      for (const [vi, tR] of [[1, _r*0.12], [3, _r*0.16], [5, _r*0.16]])
        drawTirePair(ctx, _animGV[vi], tR, project, dpr);
    }
    ctx.restore();
  }

  /* Gear bay doors — geometry derived from GV positions + tire dimensions.
     Nose: 2 clamshell halves.
     Main: 2 split panels per side — forward panel closes when gear is down,
           aft panel stays at ~30° as an aerodynamic fairing. */
  if (!isF9 && !isSV && !isC172 && !isBf109 && !isF4U && _gearP > 0.02) {
    const _gdR = _wbGeo?.r ?? _r;

    /* ── Nose door dimensions (from GV[0] + nose tire geometry) ── */
    const nTR  = _gdR * 0.12;
    const nAxH = nTR * 0.55;             // axle half-span (= tire pair Y offset)
    const nTW  = nTR * 0.40;             // one tire half-width
    const nSX  = 0.013;                  // nose stow X (from _animGV retract target)
    const nX1  = nSX + nTR * 0.8;       // forward door edge: stow pos + margin
    const nX2  = _GV[0][0] - nTR * 0.6; // aft door edge: hinge at strut pivot
    const nH   = nAxH + nTW + nTR * 0.30; // clamshell half-width: outer tire face + clearance

    /* ── Main door dimensions (from GV[2] + main tire geometry) ── */
    const mTR  = _gdR * 0.16;
    const mAxH = mTR * 0.55;
    const mTW  = mTR * 0.40;
    const mX1  = _GV[2][0] + mTR * 2.0; // forward door edge
    const mX2  = _GV[2][0] - mTR * 2.5; // aft door edge
    const mXm  = (mX1 + mX2) * 0.5;     // fore/aft panel split line
    const mHi  = _GV[2][1] - (mAxH + mTW) - mTR * 0.25; // inboard hinge: inner tire face − clearance
    const mW   = (mAxH + mTW) * 2.0 + mTR * 0.50;       // panel width: inner→outer tire face + margins

    /* ── Animation ── */
    const doorFrac = _gearP < 0.15 ? _gearP / 0.15 : 1.0;

    // Nose: single-phase clamshell
    const nθ  = doorFrac * Math.PI * 0.5;

    // Main forward panel: opens during transit, closes when gear fully down
    const AERO = 0.33;  // aft panel stay-open fraction at gear-down
    const tFwd = _gearP < 0.15 ? _gearP / 0.15
               : _gearP > 0.85 ? (1 - _gearP) / 0.15
               : 1.0;
    // Main aft panel: opens during transit, holds at AERO fraction when gear is down
    const tAft = _gearP < 0.15 ? _gearP / 0.15
               : _gearP > 0.85 ? 1.0 - (1.0 - AERO) * (_gearP - 0.85) / 0.15
               : 1.0;
    const mθF = tFwd * Math.PI * 0.5;
    const mθA = tAft * Math.PI * 0.5;

    ctx.save();
    ctx.lineWidth = Math.max(1, devicePixelRatio);

    const _dDoor = (corners, fillA, strokeA) => {
      const p2 = corners.map(project);
      if (!p2.every(Boolean)) return;
      ctx.beginPath();
      p2.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle   = `rgba(22,27,35,${fillA})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(148,162,178,${strokeA})`;
      ctx.stroke();
    };

    /* Gear well cutout — dark opening on fuselage belly, drawn before doors so panels cover it */
    ctx.fillStyle = 'rgba(10,12,16,0.96)';
    for (const [x1,x2,y1,y2] of [
      [nX1,nX2,-nH,nH],
      [mX1,mX2,mHi,mHi+mW],
      [mX1,mX2,-(mHi+mW),-mHi],
    ]) {
      const wp = [[x1,y1,-_gdR],[x2,y1,-_gdR],[x2,y2,-_gdR],[x1,y2,-_gdR]].map(project);
      if (wp.every(Boolean)) {
        ctx.beginPath();
        wp.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
        ctx.closePath(); ctx.fill();
      }
    }

    const fa  = (doorFrac * 0.88).toFixed(2);
    const sa  = (doorFrac * 0.75).toFixed(2);
    const mfA = (Math.max(tFwd, tAft) * 0.88).toFixed(2);
    const msA = (Math.max(tFwd, tAft) * 0.75).toFixed(2);

    /* Nose: 2 clamshell halves — hinge at Y=0, each half swings outboard + down */
    const ndy = nH * Math.cos(nθ), ndz = -nH * Math.sin(nθ);
    _dDoor([[nX1, 0,-_gdR],[nX2, 0,-_gdR],[nX2, +ndy,-_gdR+ndz],[nX1, +ndy,-_gdR+ndz]], fa, sa);
    _dDoor([[nX1, 0,-_gdR],[nX2, 0,-_gdR],[nX2, -ndy,-_gdR+ndz],[nX1, -ndy,-_gdR+ndz]], fa, sa);

    /* Main: forward + aft panel per side.  sign=+1 for R, −1 for L */
    const _drawMain = (sign) => {
      const Hi = sign * mHi;
      const fdy = sign * mW * Math.cos(mθF), fdz = -mW * Math.sin(mθF);
      const ady = sign * mW * Math.cos(mθA), adz = -mW * Math.sin(mθA);
      _dDoor([[mX1,Hi,-_gdR],[mXm,Hi,-_gdR],[mXm,Hi+fdy,-_gdR+fdz],[mX1,Hi+fdy,-_gdR+fdz]], mfA, msA);
      _dDoor([[mXm,Hi,-_gdR],[mX2,Hi,-_gdR],[mX2,Hi+ady,-_gdR+adz],[mXm,Hi+ady,-_gdR+adz]], mfA, msA);
    };
    _drawMain(+1);  // R main
    _drawMain(-1);  // L main

    ctx.restore();
  }

  /* Passenger windows + door outlines — wide-body only, properly perspective-projected */
  if (!isF9 && !isSV && !isC172 && !isBf109 && !isF4U) {
    /* Draw a quad from 4 body-space corners — depth-culls if center is on far side */
    const _quad3d = (x, y, z, hw, hh, fill, stroke) => {
      const pc = project([x, 0, 0]);
      const pw = project([x, y, z]);
      if (!pc || !pw || pw.d > pc.d + 0.0008) return;
      const p0 = project([x + hw, y, z + hh]);
      const p1 = project([x - hw, y, z + hh]);
      const p2 = project([x - hw, y, z - hh]);
      const p3 = project([x + hw, y, z - hh]);
      if (!p0 || !p1 || !p2 || !p3) return;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    };

    ctx.save();
    ctx.lineWidth = Math.max(0.75, devicePixelRatio * 0.75);

    /* Use per-aircraft fuselage radius so narrow-body windows sit on the body surface */
    const _wbR = _wbGeo?.r ?? _r;

    /* Window row — cabin section x = 0.011 → −0.008, on fuselage side (y = ±_wbR) */
    const hw = _wbR * 0.120;  // half-width in body units
    const hh = _wbR * 0.170;  // half-height
    const wZ = _wbR * 0.18;   // slightly above equator
    const nW = 12, xA = 0.011, xB = -0.008;
    const wFill   = 'rgba(55,85,130,0.82)';
    const wStroke = 'rgba(130,155,185,0.55)';
    for (let i = 0; i < nW; i++) {
      const wx = xA + (xB - xA) * (i / (nW - 1));
      _quad3d(wx,  _wbR, wZ, hw, hh, wFill, wStroke);
      _quad3d(wx, -_wbR, wZ, hw, hh, wFill, wStroke);
    }

    /* Doors — fwd pair (L1/R1) + aft pair (L2/R2), outlines only */
    const dhw = _wbR * 0.170;
    const dhh = _wbR * 0.325;
    const dZ  = _wbR * 0.08;
    const dStroke = 'rgba(145,160,178,0.70)';
    for (const [dx, dy] of [[0.010, _wbR],[0.010,-_wbR],[-0.006, _wbR],[-0.006,-_wbR]]) {
      _quad3d(dx, dy, dZ, dhw, dhh, null, dStroke);
    }

    ctx.restore();
  }

  /* Aircraft lights */
  const _lightList = isC172 ? (S.masterBat ? _LIGHTS_c172 : null)
                             : (!isF9 && !isBf109 && !isF4U && !isSV) ? _LIGHTS_wb : null;
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
      const uR  = vF * sinP + vU2 * cosP;
      let   vR3 = vR2;
      if (orbitElDeg !== 0) {
        const fP2 = fP * cosEl + vR2 * sinEl;
        vR3 = -fP * sinEl + vR2 * cosEl;
        fP  = fP2;
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

  /* ── CSM orbit-mode detail: windows, seams, RCS, soot ── */
  if (isSV && S.rocketOrbit && !_inTDSep) _drawCSMOrbitDetail(ctx, pts, project, dpr, camSide);

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

/* ── Swiss cross on V-stab tail fin ──────────────────────────── */
function _drawSwissCross(ctx, p0, p1, p2, p3) {
  if (!p0 || !p1 || !p2 || !p3) return;
  // p0=fwd_base, p1=aft_base, p2=aft_top, p3=fwd_top
  const bmx = (p0.x + p1.x) * 0.5, bmy = (p0.y + p1.y) * 0.5;
  const tmx = (p2.x + p3.x) * 0.5, tmy = (p2.y + p3.y) * 0.5;
  const fcx = (bmx + tmx) * 0.5, fcy = (bmy + tmy) * 0.5;
  const upLen = Math.hypot(tmx - bmx, tmy - bmy);
  if (upLen < 4) return;
  const uux = (tmx - bmx) / upLen, uuy = (tmy - bmy) / upLen;
  const urx = uuy, ury = -uux;             // right ⊥ up
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
