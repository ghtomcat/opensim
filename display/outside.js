/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view: cockpit forward · chase cam · side cam.
   Aircraft = flat-shaded 3-D wireframe (painter's algorithm).
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { renderTerrain } from './terrain.js';
import { getMapReservedRight } from './map.js';

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

  /* Drag-to-orbit: only active when paused + side cam.
     #outside-canvas has pointer-events:none so listen on window. */
  window.addEventListener('mousedown', e => {
    if (_camMode === 2) { _orbitDragX = e.clientX; _orbitDragY = e.clientY; }
  });
  window.addEventListener('mousemove', e => {
    if (_orbitDragX !== null) {
      _orbitAz = ((_orbitAz + (e.clientX - _orbitDragX) * 0.4) % 360 + 360) % 360;
      _orbitEl = Math.max(-85, Math.min(85, _orbitEl - (e.clientY - _orbitDragY) * 0.3));
      _orbitDragX = e.clientX; _orbitDragY = e.clientY;
    }
  });
  window.addEventListener('mouseup', () => { _orbitDragX = null; _orbitDragY = null; });

  /* Wheel / trackpad gestures in side cam:
       pinch (ctrlKey on Mac trackpad) → zoom, always
       paused + scroll → orbit (az / el)
       unpaused + scroll → horizontal = az, vertical = zoom */
  window.addEventListener('wheel', e => {
    if (_camMode !== 2) return;
    e.preventDefault();
    if (e.ctrlKey) {
      _orbitZoom = Math.max(0.1, Math.min(10, _orbitZoom * Math.exp(e.deltaY * 0.01)));
      return;
    }
    _orbitAz = ((_orbitAz - e.deltaX * 0.35) % 360 + 360) % 360;
    if (S.paused) {
      _orbitEl = Math.max(-85, Math.min(85, _orbitEl - e.deltaY * 0.25));
    } else {
      _orbitZoom = Math.max(0.1, Math.min(10, _orbitZoom * Math.exp(e.deltaY * 0.015)));
    }
  }, { passive: false });

  /* 0 key: reset orbit + zoom to default while paused */
  window.addEventListener('keydown', e => {
    if (e.key === '0' && S.paused && _camMode === 2) { _orbitAz = 0; _orbitEl = 12; _orbitZoom = 1; }
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
  const dN = -Math.cos(hdgRad) * CHASE_BACK;
  const dE = -Math.sin(hdgRad) * CHASE_BACK;

  const sL=S.lat,sLo=S.lon,sA=S.alt,sP=S.pitch,sR=S.roll;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + CHASE_UP / FT_NM;
  S.pitch = Math.atan2(-CHASE_UP, CHASE_BACK) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.pitch=sP;S.roll=sR;

  _drawWireframe(canvas, acP, acR, CHASE_BACK, CHASE_UP, 0);
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

  const sL=S.lat,sLo=S.lon,sA=S.alt,sH=S.hdg,sP=S.pitch,sR=S.roll;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + (sideUp + vElev) / FT_NM;
  S.hdg   = ((S.hdg??0) - 90 - renderOrbit + 360) % 360;
  S.pitch = Math.atan2(-(sideUp + vElev), hDist) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true });
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
const _ez  = -0.0040;
const _er  = 0.0013;
const _e7  = _er  * 0.7071;
const _erc = 0.0008;
const _e7c = _erc * 0.7071;
const _dh  = 0.0012;
const _wz  = _dh + 0.0040;
const _wy  = _hs  - 0.0010;

const { V_: _V, F_: _F, FC_: _FC, E_: _E } = (() => {
  const N = 16, N4 = 4, N2 = 8, N3 = 12;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF:  0.019, r: _nr1, col: 0 },   // ring1 → ring2: nose
    { vF:  0.017, r: _nr2, col: 0 },   // ring2 → ring3: nose
    { vF:  0.015, r: _nr3, col: 0 },   // ring3 → fwd
    { vF:  0.013, r: _r,   col: 0 },   // fwd → wing-stn
    { vF:  0.001, r: _r,   col: 0 },   // wing-stn → rear
    { vF: -0.010, r: _r,   col: 0 },   // rear → tail
    { vF: -0.017, r: _r,   col: 0 },   // tail → taper
    { vF: -0.019, r: _nr2          },   // taper (terminal)
  ]);
  // rb: [0,16,32,48,64,80,96,112]  noseTip=128  tailTip=129  extra=130+

  const noseTip = V_.length;  V_.push([ 0.021, 0, 0]);
  const tailTip = V_.length;  V_.push([-0.021, 0, 0]);

  V_.push(  /* non-tube vertices — indices 130-201 */
    [ 0.005,  _r,      -_r      ],  //  130 R wing root LE
    [-0.004,  _r,      -_r      ],  //  131 R wing root TE
    [-0.001,  _hs,      _dh     ],  // 132 R wing tip LE
    [-0.009,  _hs,      _dh     ],  // 133 R wing tip TE
    [ 0.005, -_r,      -_r      ],  // 134 L wing root LE
    [-0.004, -_r,      -_r      ],  // 135 L wing root TE
    [-0.001, -_hs,      _dh     ],  // 136 L wing tip LE
    [-0.009, -_hs,      _dh     ],  // 137 L wing tip TE
    [-0.013,  0,        _r      ],  // 138 V-stab base fwd
    [-0.019,  0,        _r      ],  // 139 V-stab base aft
    [-0.015,  0,        0.008   ],  // 140 V-stab top fwd
    [-0.020,  0,        0.007   ],  // 141 V-stab top aft
    [-0.017,  _r,       0.001   ],  // 142 R h-stab root fwd
    [-0.020,  _r,       0.001   ],  // 143 R h-stab root aft
    [-0.018,  0.008,    0.002   ],  // 144 R h-stab tip fwd
    [-0.021,  0.008,    0.002   ],  // 145 R h-stab tip aft
    [-0.017, -_r,       0.001   ],  // 146 L h-stab root fwd
    [-0.020, -_r,       0.001   ],  // 147 L h-stab root aft
    [-0.018, -0.008,    0.002   ],  // 148 L h-stab tip fwd
    [-0.021, -0.008,    0.002   ],  // 149 L h-stab tip aft
    /* R engine — intake(150-157), mid(158-165), exhaust(166-173) */
    [ 0.008, _ey,      _ez+_er  ],[ 0.008, _ey+_e7,  _ez+_e7  ],
    [ 0.008, _ey+_er,  _ez      ],[ 0.008, _ey+_e7,  _ez-_e7  ],
    [ 0.008, _ey,      _ez-_er  ],[ 0.008, _ey-_e7,  _ez-_e7  ],
    [ 0.008, _ey-_er,  _ez      ],[ 0.008, _ey-_e7,  _ez+_e7  ],
    [-0.001, _ey,      _ez+_er  ],[-0.001, _ey+_e7,  _ez+_e7  ],
    [-0.001, _ey+_er,  _ez      ],[-0.001, _ey+_e7,  _ez-_e7  ],
    [-0.001, _ey,      _ez-_er  ],[-0.001, _ey-_e7,  _ez-_e7  ],
    [-0.001, _ey-_er,  _ez      ],[-0.001, _ey-_e7,  _ez+_e7  ],
    [-0.003, _ey,      _ez+_erc ],[-0.003, _ey+_e7c, _ez+_e7c ],
    [-0.003, _ey+_erc, _ez      ],[-0.003, _ey+_e7c, _ez-_e7c ],
    [-0.003, _ey,      _ez-_erc ],[-0.003, _ey-_e7c, _ez-_e7c ],
    [-0.003, _ey-_erc, _ez      ],[-0.003, _ey-_e7c, _ez+_e7c ],
    /* L engine — intake(174-181), mid(182-189), exhaust(190-197) */
    [ 0.008, -_ey,      _ez+_er  ],[ 0.008, -_ey-_e7,  _ez+_e7  ],
    [ 0.008, -_ey-_er,  _ez      ],[ 0.008, -_ey-_e7,  _ez-_e7  ],
    [ 0.008, -_ey,      _ez-_er  ],[ 0.008, -_ey+_e7,  _ez-_e7  ],
    [ 0.008, -_ey+_er,  _ez      ],[ 0.008, -_ey+_e7,  _ez+_e7  ],
    [-0.001, -_ey,      _ez+_er  ],[-0.001, -_ey-_e7,  _ez+_e7  ],
    [-0.001, -_ey-_er,  _ez      ],[-0.001, -_ey-_e7,  _ez-_e7  ],
    [-0.001, -_ey,      _ez-_er  ],[-0.001, -_ey+_e7,  _ez-_e7  ],
    [-0.001, -_ey+_er,  _ez      ],[-0.001, -_ey+_e7,  _ez+_e7  ],
    [-0.003, -_ey,      _ez+_erc ],[-0.003, -_ey-_e7c, _ez+_e7c ],
    [-0.003, -_ey-_erc, _ez      ],[-0.003, -_ey-_e7c, _ez-_e7c ],
    [-0.003, -_ey,      _ez-_erc ],[-0.003, -_ey+_e7c, _ez-_e7c ],
    [-0.003, -_ey+_erc, _ez      ],[-0.003, -_ey+_e7c, _ez+_e7c ],
    /* Winglets (198-201) */
    [-0.005,  _wy, _wz],[-0.012,  _wy, _wz],
    [-0.005, -_wy, _wz],[-0.012, -_wy, _wz],
  );

  /* Nose tris: noseTip → ring1 (outward normals) */
  for (let si = 0; si < N; si++) { F_.push([noseTip, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(0); }
  /* Tail tris: ring8 → tailTip (outward normals) */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[7]+si, rb[7]+(si+1)%N]); FC_.push(0); }

  /* Non-tube faces — all reference v98-201 (indices unchanged) */
  F_.push(
    [130,132,133,131],[130,131,133,132],          // R wing (×2 sides)
    [134,135,137,136],[134,136,137,135],       // L wing
    [132,133,199,198],[132,198,199,133],       // R winglet
    [136,200,201,137],[136,137,201,200],       // L winglet
    [138,139,141,140],[138,140,141,139],       // V-stab (×2 sides)
    [142,143,145,144],[142,144,145,143],       // R h-stab
    [146,147,149,148],[146,148,149,147],       // L h-stab
    [150,151,159,158],[151,152,160,159],[152,153,161,160],[153,154,162,161],
    [154,155,163,162],[155,156,164,163],[156,157,165,164],[157,150,158,165],
    [158,159,167,166],[159,160,168,167],[160,161,169,168],[161,162,170,169],
    [162,163,171,170],[163,164,172,171],[164,165,173,172],[165,158,166,173],
    [174,182,183,175],[175,183,184,176],[176,184,185,177],[177,185,186,178],
    [178,186,187,179],[179,187,188,180],[180,188,189,181],[181,189,182,174],
    [182,190,191,183],[183,191,192,184],[184,192,193,185],[185,193,194,186],
    [186,194,195,187],[187,195,196,188],[188,196,197,189],[189,197,190,182],
  );
  FC_.push(
    1,1,1,1, 1,1,1,1,             // wings + winglets
    2,2, 3,3,3,3,                 // v-stab + h-stabs
    4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4,   // R engine front + rear
    4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4,   // L engine front + rear
  );

  /* Longerons: noseTip ↔ all rings ↔ tailTip at 4 cardinal si */
  for (const si of [0, N4, N2, N3]) {
    E_.push([noseTip, rb[0]+si]);
    for (let ri = 0; ri < 7; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[7]+si, tailTip]);
  }
  /* Fuselage ↔ non-tube connections (updated indices: all -1 vs original) */
  const wStn = rb[4], tail = rb[6];
  E_.push(
    [wStn+N2, 130],[wStn+N2, 131],[wStn+N2, 134],[wStn+N2, 135],
    [tail,    138],[tail,    139],
    [tail+N4, 142], [tail+N3, 146],
  );
  /* Non-tube edges (indices unchanged — all reference v98-201) */
  E_.push(
    [130,132],[131,133],[130,131],[132,133],
    [134,136],[135,137],[134,135],[136,137],
    [138,140],[139,141],[140,141],[138,139],
    [142,144],[143,145],[142,143],[144,145],
    [146,148],[147,149],[146,147],[148,149],
    [132,198],[133,199],[198,199],
    [136,200],[137,201],[200,201],
    [150,151],[151,152],[152,153],[153,154],[154,155],[155,156],[156,157],[157,150],
    [158,159],[159,160],[160,161],[161,162],[162,163],[163,164],[164,165],[165,158],
    [166,167],[167,168],[168,169],[169,170],[170,171],[171,172],[172,173],[173,166],
    [150,158],[152,160],[154,162],[156,164],[158,166],[160,168],[162,170],[164,172],
    [150,130],[166,131],
    [174,175],[175,176],[176,177],[177,178],[178,179],[179,180],[180,181],[181,174],
    [182,183],[183,184],[184,185],[185,186],[186,187],[187,188],[188,189],[189,182],
    [190,191],[191,192],[192,193],[193,194],[194,195],[195,196],[196,197],[197,190],
    [174,182],[176,184],[178,186],[180,188],[182,190],[184,192],[186,194],[188,196],
    [174,134],[190,135],
  );

  return { V_, F_, FC_, E_ };
})();
const _FN = computeFaceNormals(_V, _F);

/* ── Landing gear (body frame, NM) — struts only ─────────────── */
const _GV = [
  /* 0 */ [ 0.009,  0,      -_r         ],  // nose strut top
  /* 1 */ [ 0.009,  0,      -_r - 0.003 ],  // nose wheel
  /* 2 */ [-0.001,  0.006,  -_r         ],  // R main top
  /* 3 */ [-0.001,  0.006,  -_r - 0.004 ],  // R main wheel
  /* 4 */ [-0.001, -0.006,  -_r         ],  // L main top
  /* 5 */ [-0.001, -0.006,  -_r - 0.004 ],  // L main wheel
];
const _GE = [[0,1],[2,3],[4,5]];

/* ══════════════════════════════════════════════════════════════
   C172 geometry — high-wing piston single
   ══════════════════════════════════════════════════════════════ */

const _cr  = 0.0018;   // cowl ring radius
const _xr  = 0.0021;   // cabin ring radius
const _abr = 0.0016;   // aft-cabin ring radius
const _tr  = 0.0009;   // tail-boom ring radius
const _hs172 = 0.0110;   // C172 half-span
const _dh172 = 0.0004;   // C172 wing-tip dihedral offset
const _pr172 = 0.0014;   // prop disk radius (for arc rendering)

const _COLORS_c172 = [
  [240, 240, 240],  // 0 fuselage/tail — white
  [230, 235, 238],  // 1 wings / h-stabs — slightly darker
  [ 85,  90, 100],  // 2 cowl — dark gray
];

/* buildTube: 16-sided, 5 rings → rb=[0,16,32,48,64], noseTip=80, tailTip=81, extra=82+ */
const { V_: _V_c172, F_: _F_c172, FC_: _FC_c172, E_: _E_c172 } = (() => {
  const N = 16;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF:  0.009, r: _cr,  col: 2 },  // cowl  → cabin-fwd (dark)
    { vF:  0.004, r: _xr,  col: 0 },  // cabin-fwd → wing-stn
    { vF:  0.000, r: _xr,  col: 0 },  // wing-stn → aft-cabin
    { vF: -0.004, r: _abr, col: 0 },  // aft-cabin → tail-boom
    { vF: -0.009, r: _tr          },  // tail-boom (terminal)
  ]);

  const noseTip = V_.length;  V_.push([ 0.013, 0, 0]);
  const tailTip = V_.length;  V_.push([-0.013, 0, 0]);

  V_.push(  /* non-tube vertices 82-110 — same indices as original */
    [ 0.005,  0.0002,          _xr                ],  // 82 R wing root LE
    [-0.002,  0.0002,          _xr                ],  // 83 R wing root TE
    [ 0.003,  _hs172,          _xr+_dh172         ],  // 84 R wing tip LE
    [-0.004,  _hs172,          _xr+_dh172         ],  // 85 R wing tip TE
    [ 0.005, -0.0002,          _xr                ],  // 86 L wing root LE
    [-0.002, -0.0002,          _xr                ],  // 87 L wing root TE
    [ 0.003, -_hs172,          _xr+_dh172         ],  // 88 L wing tip LE
    [-0.004, -_hs172,          _xr+_dh172         ],  // 89 L wing tip TE
    [-0.007,  0,               _tr                ],  // 90 V-stab base fwd
    [-0.012,  0,               _tr                ],  // 91 V-stab base aft
    [-0.008,  0,               0.008              ],  // 92 V-stab top fwd
    [-0.013,  0,               0.007              ],  // 93 V-stab top aft
    [-0.009,  _tr+0.0003,      0                  ],  // 94 R h-stab root fwd
    [-0.012,  _tr+0.0003,      0                  ],  // 95 R h-stab root aft
    [-0.010,  0.95,          0.001              ],  // 96 R h-stab tip fwd
    [-0.013,  0.95,          0.001              ],  // 97 R h-stab tip aft
    [-0.009, -_tr-0.0003,      0                  ],  // 98 L h-stab root fwd
    [-0.012, -_tr-0.0003,      0                  ],  // 99 L h-stab root aft
    [-0.010, -0.95,          0.001              ],  // 100 L h-stab tip fwd
    [-0.013, -0.95,          0.001              ],  // 101 L h-stab tip aft
    [ 0.001,  _hs172*0.95,     _xr                ],  // 102 R strut top
    [ 0.001,  _xr*1.5,        -_xr*0.4            ],  // 103 R strut bottom
    [ 0.001, -_hs172*0.95,     _xr                ],  // 104 L strut top
    [ 0.001, -_xr*1.5,        -_xr*0.4            ],  // 105 L strut bottom
    [ 0.013,  _pr172,          0                  ],  // 106 prop tip (arc ref)
    [ 0.0039,  0.102,         _xr+_dh172*0.95    ],  // 107 R break LE
    [-0.0031,  0.102,         _xr+_dh172*0.95    ],  // 108 R break TE
    [ 0.0039, -0.102,         _xr+_dh172*0.95    ],  // 109 L break LE
    [-0.0031, -0.102,         _xr+_dh172*0.95    ],  // 110 L break TE
  );

  /* Nose tris: noseTip → cowl ring (outward) */
  for (let si = 0; si < N; si++) { F_.push([noseTip, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(2); }
  /* Tail tris: tail-boom → tailTip (outward) */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[4]+si, rb[4]+(si+1)%N]); FC_.push(0); }

  /* Non-tube faces (inboard+outboard wings ×2 sides, v-stab, h-stabs) */
  F_.push(
    [82,107,108,83],[82,83,108,107],      // R wing inboard (flap) top + bottom
    [107,84,85,108],[107,108,85,84],      // R wing outboard (aileron)
    [86,87,110,109],[86,109,110,87],      // L wing inboard
    [109,110,89,88],[109,88,89,110],      // L wing outboard
    [90,91,93,92],[90,92,93,91],      // V-stab (both sides)
    [94,96,97,95],[94,95,97,96],      // R h-stab
    [98,99,101,100],[98,100,101,99],      // L h-stab
  );
  FC_.push(1,1,1,1,1,1,1,1, 0,0, 0,0,0,0);

  /* Longerons: noseTip ↔ all ring rows ↔ tailTip at 4 cardinal sides */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, rb[0]+si]);
    for (let ri = 0; ri < 4; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[4]+si, tailTip]);
  }
  /* Non-tube edges */
  E_.push(
    [82,107],[107,84],[83,108],[108,85],[82,83],[107,108],[84,85],
    [rb[2]+0, 82],[rb[2]+0, 83],   // wing-stn top → R wing roots
    [86,109],[109,88],[87,110],[110,89],[86,87],[109,110],[88,89],
    [rb[2]+0, 86],[rb[2]+0, 87],   // wing-stn top → L wing roots
    [102,103],[104,105],               // struts
    [90,92],[91,93],[92,93],[90,91],[rb[4]+0, 90],[rb[4]+0, 91],   // V-stab
    [94,96],[95,97],[94,95],[96,97],[rb[4]+4, 94],                 // R h-stab
    [98,100],[99,101],[98,99],[100,101],[rb[4]+12, 98],                 // L h-stab
  );

  return { V_, F_, FC_, E_ };
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
const { V_: _V_b109, F_: _F_b109, FC_: _FC_b109, E_: _E_b109 } = (() => {
  const N = 16;
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

  V_.push(  /* non-tube vertices 98-126 — same indices as original */
    [ 0.004, +_bfRy,              -_bfRz*0.4             ],  // 98 R root LE
    [-0.002, +_bfRy,              -_bfRz*0.4             ],  // 99 R root TE
    [ 0.001, +_b9hs,              -_bfRz*0.4+_b9dh       ],  // 100 R tip LE
    [-0.004, +_b9hs,              -_bfRz*0.4+_b9dh       ],  // 101 R tip TE
    [ 0.004, -_bfRy,              -_bfRz*0.4             ],  // 102 L root LE
    [-0.002, -_bfRy,              -_bfRz*0.4             ],  // 103 L root TE
    [ 0.001, -_b9hs,              -_bfRz*0.4+_b9dh       ],  // 104 L tip LE
    [-0.004, -_b9hs,              -_bfRz*0.4+_b9dh       ],  // 105 L tip TE
    [-0.007,  0,                   _baRz                  ],  // 106 V-stab LE base (= Ring E top)
    [-0.013,  0,                   _btRz                  ],  // 107 V-stab TE base
    [-0.009,  0,                   _baRz+_b9vH            ],  // 108 V-stab LE top
    [-0.013,  0,                   _btRz+_b9vH*0.82       ],  // 109 V-stab TE top
    [-0.010, +_btRy,               _btRz*0.1              ],  // 110 R h-stab root fwd
    [-0.013, +_btRy,               _btRz*0.1              ],  // 111 R h-stab root aft
    [-0.011, +_b9hw,               0.001                  ],  // 112 R h-stab tip fwd
    [-0.013, +_b9hw,               0.001                  ],  // 113 R h-stab tip aft
    [-0.010, -_btRy,               _btRz*0.1              ],  // 114 L h-stab root fwd
    [-0.013, -_btRy,               _btRz*0.1              ],  // 115 L h-stab root aft
    [-0.011, -_b9hw,               0.001                  ],  // 116 L h-stab tip fwd
    [-0.013, -_b9hw,               0.001                  ],  // 117 L h-stab tip aft
    [ 0.015, +_b9pr,               0                      ],  // 118 prop disk radius ref
    [ 0.004, -_bCyW,               _bfRz                  ],  // 119 windscreen base L
    [ 0.004, +_bCyW,               _bfRz                  ],  // 120 windscreen base R
    [ 0.003, +_bCyW*0.118,          _bfRz+_bCzH*0.118       ],  // 121 windscreen top R
    [ 0.003, -_bCyW*0.118,          _bfRz+_bCzH*0.118       ],  // 122 windscreen top L
    [-0.001, -_bCyW*0.118,          _bfRz+_bCzH            ],  // 123 crown top L
    [-0.001, +_bCyW*0.118,          _bfRz+_bCzH            ],  // 124 crown top R
    [-0.003, +_bCyW,               _bfRz                  ],  // 125 aft base R
    [-0.003, -_bCyW,               _bfRz                  ],  // 126 aft base L
  );

  /* Nose tris: noseTip → Ring A (outward) */
  for (let si = 0; si < N; si++) { F_.push([noseTip, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(2); }
  /* Tail tris: Ring F → tailTip (outward) */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[5]+si, rb[5]+(si+1)%N]); FC_.push(0); }

  /* Non-tube faces */
  F_.push(
    [98,100,101,99],[98,99,101,100],   // R wing (top + bottom)
    [102,103,105,104],[102,104,105,103],   // L wing
    [106,108,109,107],[106,107,109,108],   // V-stab (both sides)
    [110,112,113,111],[110,111,113,112],   // R h-stab
    [114,115,117,116],[114,116,117,115],   // L h-stab
    [119,120,121,122],                 // windscreen front
    [120,125,124,121],                 // R glass panel
    [119,122,123,126],                 // L glass panel
    [122,121,124,123],                 // crown top
    [126,123,124,125],                 // aft fairing
  );
  FC_.push(1,1,1,1, 3,3, 3,3,3,3, 4,4,4,4,4);

  /* Longerons */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, rb[0]+si]);
    for (let ri = 0; ri < 5; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[5]+si, tailTip]);
  }
  /* Non-tube edges */
  E_.push(
    [98,100],[100,101],[101,99],[99,98],
    [rb[2]+4, 98],[rb[3]+4, 99],   // Ring C/D right → R wing roots
    [102,104],[104,105],[105,103],[103,102],
    [rb[2]+12, 102],[rb[3]+12, 103],   // Ring C/D left  → L wing roots
    [106,108],[108,109],[109,107],[107,106],
    [110,112],[112,113],[113,111],[111,110], [rb[5]+4, 110],   // R h-stab
    [114,116],[116,117],[117,115],[115,114], [rb[5]+12, 114],   // L h-stab
    [119,120],[120,121],[121,122],[122,119],
    [123,124],[124,125],[125,126],[126,123],
    [121,124],[122,123],[119,126],[120,125],
  );

  return { V_, F_, FC_, E_ };
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

/* ── Core wireframe + shading renderer ───────────────────────── */
function _drawWireframe(canvas, acPitchDeg, acRollDeg, camBack, camUp, camSide, wingView = false, orbitAzDeg = 0, orbitElDeg = 0) {
  const isC172  = (S.aircraft?.id === 'c172');
  const isSV    = !isC172 && (S.aircraft?.id === 'saturn-v');
  const isF9    = !isC172 && !isSV && (S.aircraft?.id?.startsWith('falcon9') || S.aircraft?.vehicleType === 'rocket');
  const isBf109 = !isC172 && !isF9 && !isSV && (S.aircraft?.id === 'bf109');
  const V_   = isC172 ? _V_c172      : isF9 ? _V_f9      : isBf109 ? _V_b109      : isSV ? _V_sv      : _V;
  const F_   = isC172 ? _F_c172      : isF9 ? _F_f9      : isBf109 ? _F_b109      : isSV ? _F_sv      : _F;
  const FC_  = isC172 ? _FC_c172     : isF9 ? _FC_f9     : isBf109 ? _FC_b109     : isSV ? _FC_sv     : _FC;
  const FN_  = isC172 ? _FN_c172     : isF9 ? _FN_f9     : isBf109 ? _FN_b109     : isSV ? _FN_sv     : _FN;
  const E_   = isC172 ? _E_c172      : isF9 ? _E_f9      : isBf109 ? _E_b109      : isSV ? _E_sv      : _E;
  const COL_ = isC172 ? _COLORS_c172 : isF9 ? _COLORS_f9 : isBf109 ? _COLORS_b109 : isSV ? _COLORS_sv : _COLORS;
  const GV_  = isC172 ? _GV_c172     : isBf109 ? _GV_b109 : _GV;

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
  const cx    = (W - mapPx) / 2;
  let   cy    = H / 2;          // mutable — auto-director shifts this for look-at offset
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG);

  // Auto-fit: project vertices through attitude rotation, then fit screen extents.
  // Must happen after cosP/sinP/cosR/sinR are computed.
  if (!wingView) {
    const aspect = W / H;
    const hfH    = FOV_H / 2 * DEG;
    const hfV    = Math.atan(Math.tan(hfH) / aspect);
    const PAD    = 1.15;
    let maxCR = 0, maxCU = 0;
    for (const [vF, vR, vU] of V_) {
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
        maxCR = Math.max(maxCR, Math.abs(fP));  // side cam horizontal
        maxCU = Math.max(maxCU, Math.abs(uR));  // side cam vertical
      } else {
        maxCR = Math.max(maxCR, Math.abs(rR));  // chase cam horizontal
        maxCU = Math.max(maxCU, Math.abs(uR));  // chase cam vertical
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
        maxCU = Math.max(maxCU, Math.abs(_top), Math.abs(_bot));
        maxCR = Math.max(maxCR, _tR * 9.8);
      }
    }
    const d = Math.max(maxCR * PAD / Math.tan(hfH), maxCU * PAD / Math.tan(hfV));
    if (camSide > 0) { camSide = d * _orbitZoom; camUp = 0; }
    else              { camBack = d; camUp = d * 0.18; }

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
    const rollErr  = (S.rollT ?? 0) - (S.roll ?? 0);  // commanded – actual
    const ailCmd   = Math.max(-1, Math.min(1, rollErr / 20));  // ±1
    if (flapCfg > 0 || Math.abs(ailCmd) > 0.02) {
      verts = _V_c172.map(v => v.slice());
      if (flapCfg > 0) {
        const fa = flapCfg * 10 * DEG;   // ~10° per notch (C172: 10/20/30°)
        const fc = 0.003;
        const dX = -(1 - Math.cos(fa)) * fc;
        const dZ = -Math.sin(fa) * fc;
        for (const vi of [83, 108, 87, 110])
          verts[vi] = [_V_c172[vi][0]+dX, _V_c172[vi][1], _V_c172[vi][2]+dZ];
      }
      if (Math.abs(ailCmd) > 0.02) {
        const aa = ailCmd * 18 * DEG;  // max ±18° aileron
        const ac = 0.002;
        const dZ = Math.sin(aa) * ac;
        // R aileron: down when rolling right (ailCmd > 0 → right bank commanded)
        verts[108] = [verts[108][0], verts[108][1], verts[108][2] - dZ];
        verts[85] = [_V_c172[85][0], _V_c172[85][1], _V_c172[85][2] - dZ];
        // L aileron: up when rolling right
        verts[110] = [verts[110][0], verts[110][1], verts[110][2] + dZ];
        verts[89] = [_V_c172[89][0], _V_c172[89][1], _V_c172[89][2] + dZ];
      }
    }
  } else if ((S.flaps ?? 0) > 0) {
    verts = _V.map(v => v.slice());
    const fa  = (S.flaps ?? 0) * 15 * DEG;
    const fc  = 0.0025;
    const dX  = -(1 - Math.cos(fa)) * fc;
    const dZ  = -Math.sin(fa) * fc;
    verts[131]  = [_V[131][0]+dX,  _V[131][1],  _V[131][2]+dZ];
    verts[135] = [_V[135][0]+dX, _V[135][1], _V[135][2]+dZ];
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
      : isSV
      ? [160, 0, 4, 8, 12]                         // Saturn V: tip, aft base cardinal points
      : [128, 132, 133, 129, 137, 136];            // A350: nose(128), R wing tip, tail(129), L wing tip

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

  /* Build shaded face list with average depth */
  const faces = F_.map((fi, i) => {
    /* F9 stage sep: main vehicle = S2 + Dragon + MVac nozzle (faces 48-95 + 96-103) */
    if (isF9 && rStage >= 2 && (i < 48 || (i > 95 && i < 104))) return null;

    /* Saturn V staging: hide spent stage geometry
       10-ring layout face ranges:
         0–47   = S-IC engine section + S-IC body + interstage  (rings 0→3)
         48–79  = S-II body + forward skirt                     (rings 3→5)
         160+   = stabilizer fins                                            */
    if (isSV && rStage >= 2 && (i <= 47 || i >= 160)) return null;
    if (isSV && rStage >= 3 && i <= 79) return null;

    const ps = fi.map(vi => pts[vi]);
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
    const capBase = rStage === 1 ? 0 : rStage === 2 ? 48 : 80;
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
     Renders: lateral bell faces (side cam only) + exit disc (always).
     Exit disc color: _PLUME_OFF.lh2 (cold dark teal) — J-2 uses LH2.  */
  const _drawJ2Nozzles = (baseVF, bodyR, engCenters) => {
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
          faces.push({ ps: botR, br: 0.07, avgD: botR.reduce((s,p)=>s+p.d,0)/nNoz, col: _PLUME_OFF.lh2 });
        }
      }
    }
  };

  /* S-II — 5× J-2, visible from stage 2 onward */
  if (isSV && rStage === 2) {
    const nzE = _sv1r * 0.55;   // outer engine radial offset  (≈ 2.75 m)
    _drawJ2Nozzles(-0.006, _sv1r, [[0,0],[nzE,0],[-nzE,0],[0,nzE],[0,-nzE]]);
  }

  /* S-IVB — 1× J-2, centered, visible from stage 3 onward */
  if (isSV && rStage >= 3) {
    _drawJ2Nozzles(0.010, _sv3r, [[0, 0]]);
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

  /* Swiss cross on V-stab — A350 only */
  if (!isC172 && !isF9 && !isBf109 && !isSV) _drawSwissCross(ctx, pts[138], pts[139], pts[141], pts[140]);

  /* Prop disk — C172 and Bf109, only while engine running */
  if ((isC172 || isBf109) && S.engineState === 'running') {
    const p0    = isBf109 ? pts[96] : pts[80];   // noseTip: BF109=96, C172=80
    const pProp = isBf109 ? pts[118] : pts[106];
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

  /* Engine nozzle cluster — Falcon 9 Stage 1 only (pre-separation) */
  if (isF9 && rStage < 2) {
    const dpr = devicePixelRatio;
    const nozzleVerts = [113,114,115,116,117,118,119,120,121];
    const pC = pts[113];
    const pEdge = pts[114];
    if (pC && pEdge) {
      /* Nozzle exit radius in screen pixels from projected centre + edge vertex */
      const nR = Math.hypot(pEdge.x - pC.x, pEdge.y - pC.y) * 0.46;
      ctx.save();
      /* Dark octaweb plate behind nozzles */
      ctx.fillStyle = 'rgba(20,22,28,0.95)';
      const pRing = nozzleVerts.slice(1).map(vi => pts[vi]).filter(Boolean);
      if (pRing.length === 8) {
        ctx.beginPath();
        ctx.arc(pC.x, pC.y, Math.hypot(pRing[0].x-pC.x, pRing[0].y-pC.y) + nR * 1.2, 0, Math.PI*2);
        ctx.fill();
      }
      /* Individual nozzle circles */
      for (const vi of nozzleVerts) {
        const pt = pts[vi];
        if (!pt) continue;
        const r = (vi === 65 ? nR * 1.15 : nR);
        /* Nozzle throat glow */
        const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
        grad.addColorStop(0,   'rgba(255,210,100,0.70)');
        grad.addColorStop(0.5, 'rgba(180,130,60,0.40)');
        grad.addColorStop(1,   'rgba(40,40,48,0.95)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(140,150,165,0.80)';
        ctx.lineWidth = Math.max(0.5, 0.7 * dpr);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* Cabin + cockpit windows and doors — A350 only */
  if (!isC172 && !isF9 && !isBf109 && !isSV) {
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
    const pa = pts[a], pb = pts[b];
    if (!pa || !pb) continue;
    /* Cull edges that are entirely on the back side */
    if (edgeCamDir(a) > 0 && edgeCamDir(b) > 0) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();
  ctx.restore();

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

  /* Landing gear — always visible on C172 + Bf109, retractable on A350, none for rockets */
  if (!isF9 && !isSV && (isC172 || isBf109 || S.gear)) {
    const gpts = GV_.map(project);
    ctx.save();
    ctx.strokeStyle = 'rgba(200,210,220,0.90)';
    ctx.lineWidth = Math.max(1.5, 1.5 * devicePixelRatio);
    ctx.beginPath();
    for (const [a, b] of _GE) {
      const pa = gpts[a], pb = gpts[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(1, devicePixelRatio);
    if (isC172) {
      /* C172: project tire as 3D disc (xz-plane, axle along y) so it
         foreshortens correctly — circle from side, thin ellipse from behind */
      const tireSpecs = [
        [1, _xr * 0.48],   // nose wheel radius
        [3, _xr * 0.56],   // R main
        [5, _xr * 0.56],   // L main
      ];
      for (const [vi, tR] of tireSpecs) {
        const wc = GV_[vi];
        const pC = project(wc);
        if (!pC) continue;
        const pU = project([wc[0],       wc[1], wc[2] + tR]);
        const pFwd = project([wc[0] + tR, wc[1], wc[2]     ]);
        if (!pU || !pFwd) continue;
        const ax = pU.x - pC.x, ay = pU.y - pC.y;
        const bx = pFwd.x - pC.x, by = pFwd.y - pC.y;
        ctx.fillStyle = 'rgba(35,40,50,0.96)';
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 2 + 0.01; t += Math.PI / 12) {
          const ex = pC.x + Math.cos(t) * ax + Math.sin(t) * bx;
          const ey = pC.y + Math.cos(t) * ay + Math.sin(t) * by;
          t === 0 ? ctx.moveTo(ex, ey) : ctx.lineTo(ex, ey);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(190,200,215,0.80)';
        ctx.stroke();
      }
    } else {
      const tireTopBottom = [[gpts[0],gpts[1]], [gpts[2],gpts[3]], [gpts[4],gpts[5]]];
      for (const [top, bot] of tireTopBottom) {
        if (!top || !bot) continue;
        const strutPx = Math.hypot(bot.x - top.x, bot.y - top.y);
        const r = Math.max(3, strutPx * 0.35);
        ctx.fillStyle = 'rgba(35,40,50,0.96)';
        ctx.beginPath(); ctx.arc(bot.x, bot.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(190,200,215,0.80)';
        ctx.beginPath(); ctx.arc(bot.x, bot.y, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* Aircraft lights */
  if (isC172 && S.masterBat) {
    const li  = S.lights ?? {};
    const now = Date.now();
    const strobeFlash  = (now % 857)  < 65;   // ~70/min, 65 ms flash
    const beaconFlash  = (now % 1200) < 600;  // ~50 RPM, half-cycle on
    const dpr = devicePixelRatio;

    for (const { pos, col, key } of _LIGHTS_c172) {
      if (!li[key]) continue;
      if (key === 'strobe'  && !strobeFlash) continue;
      if (key === 'beacon'  && !beaconFlash) continue;

      const pt = project(pos);
      if (!pt) continue;

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
