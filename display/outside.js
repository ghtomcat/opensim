/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view: cockpit forward · chase cam · side cam.
   Aircraft = flat-shaded 3-D wireframe (painter's algorithm).
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { renderTerrain } from './terrain.js';

const DEG   = Math.PI / 180;
const FT_NM = 1 / 6076.12;
const FOV_H = 70;   /* must match terrain.js */

/* ── Camera distances ─────────────────────────────────────────── */
const CHASE_BACK = 0.12;
const CHASE_UP   = 120 * FT_NM;
const SIDE_SIDE  = 0.18;
const SIDE_UP    = 80  * FT_NM;

/* ── Light direction in world/heading-aligned frame (fwd,right,up) ── */
const _LD = (v => v.map(x => x / Math.hypot(...v)))([0.25, -0.45, 0.85]);

/* ── Livery color groups  [R, G, B] base (multiplied by brightness) ── */
const _COLORS = [
  [210, 215, 220], // 0 fuselage — near-white
  [195, 205, 215], // 1 wings    — slightly darker
  [200,  16,  46], // 2 v-stab  — Swiss red
  [200, 210, 218], // 3 h-stabs — slightly lighter than wings
  [ 45,  50,  60], // 4 engines  — near-black
];

/* Face → color group (must stay in sync with _F order) */
const _FC = [
  0,0,0,0,0,0,0,0,0,0,0,0,  // nose tip→ring1 (12 tris)
  0,0,0,0,0,0,0,0,0,0,0,0,  // nose ring1→ring2 (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // nose ring2→ring3 (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // nose ring3→fwd (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // fwd→wing-stn (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // wing-stn→rear (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // rear→tail (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // tail→taper (12)
  0,0,0,0,0,0,0,0,0,0,0,0,  // taper→tip (12 tris)
  1,1,1,1,                    // wings (4)
  1,1,1,1,                    // winglets (4)
  2,2,                         // v-stab (2)
  3,3,3,3,                    // h-stabs (4)
  4,4,4,4,4,4,4,4,           // R engine front (8)
  4,4,4,4,4,4,4,4,           // R engine rear (8)
  4,4,4,4,4,4,4,4,           // L engine front (8)
  4,4,4,4,4,4,4,4,           // L engine rear (8)
];

let _canvas    = null;
let _camMode   = 0;
let _finAngle  = 0;   // grid fin fold: 0 = stowed aft, Math.PI/2 = deployed

export function initOutside()        { _canvas = document.getElementById('outside-canvas'); }
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
  const acR    =  S.roll  ?? 0;
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
  const acR      =  S.roll  ?? 0;
  const cosLat   = Math.cos((S.lat ?? 47) * DEG);
  const rightRad = hdgRad + Math.PI / 2;
  const dN = Math.cos(rightRad) * SIDE_SIDE;
  const dE = Math.sin(rightRad) * SIDE_SIDE;

  const sL=S.lat,sLo=S.lon,sA=S.alt,sH=S.hdg,sP=S.pitch,sR=S.roll;
  S.lat   = (S.lat??47)   + dN / 60;
  S.lon   = (S.lon??8)    + dE / (60 * cosLat);
  S.alt   = (S.alt??3000) + SIDE_UP / FT_NM;
  S.hdg   = ((S.hdg??0) - 90 + 360) % 360;
  S.pitch = Math.atan2(-SIDE_UP, SIDE_SIDE) / DEG;
  S.roll  = 0;
  renderTerrain(canvas, { outsideView: true });
  S.lat=sL;S.lon=sLo;S.alt=sA;S.hdg=sH;S.pitch=sP;S.roll=sR;

  _drawWireframe(canvas, acP, acR, 0, SIDE_UP, SIDE_SIDE);
  _drawLabel(canvas, 'SIDE CAM');
}

/* ── Wing view — close-up from cockpit level, left wing ───────── */
const WING_SIDE = 0.009;   // NM — just outside fuselage, cockpit-window distance
const WING_UP   = 0.0025;  // NM — slightly above wing plane

function _renderWingView(canvas) {
  const hdgRad   = (S.hdg  ?? 0) * DEG;
  const acP      =  S.pitch ?? 0;
  const acR      =  S.roll  ?? 0;
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
   Body frame: fwd = nose, right = starboard, up = above
   Units: NM
   ══════════════════════════════════════════════════════════════ */

const _r  = 0.0025;   // fuselage radius
const _ra = _r * 0.8660;   // 12-gon cos(30°) component
const _rb = _r * 0.5000;   // 12-gon sin(30°) component
// Tapered nose/tail ring radii — sin-curve profile at π/8, π/4, 3π/8
const _nr1 = _r * 0.3827, _nr1a = _nr1 * 0.8660, _nr1b = _nr1 * 0.5000;
const _nr2 = _r * 0.7071, _nr2a = _nr2 * 0.8660, _nr2b = _nr2 * 0.5000;
const _nr3 = _r * 0.9239, _nr3a = _nr3 * 0.8660, _nr3b = _nr3 * 0.5000;
const _hs = 0.0165;   // half-span
const _ey = 0.0068;   // engine lateral
const _ez = -0.0040;  // engine vertical (lower = more underwing)
const _er = 0.0013;   // engine cross-section radius
const _e7 = _er * 0.7071;  // fan-ring 45° offset
const _erc = 0.0008;        // exhaust/core radius (≈ 60% of fan)
const _e7c = _erc * 0.7071; // exhaust-ring 45° offset
const _dh = 0.0012;   // wing-tip dihedral
const _wz = _dh + 0.0040;  // winglet tip height above wing tip
const _wy = _hs - 0.0010;  // winglet tip y (slightly inboard)

const _V = [
  /* 0   */ [ 0.021,  0,        0      ],  // nose tip
  // Nose ring 1 — x=0.019, r=_nr1 (sin π/8 ≈ 0.383)
  /* 1   */ [ 0.019,  0,        _nr1   ], /* 2   */ [ 0.019,  _nr1b,  _nr1a  ],
  /* 3   */ [ 0.019,  _nr1a,   _nr1b  ], /* 4   */ [ 0.019,  _nr1,    0      ],
  /* 5   */ [ 0.019,  _nr1a,  -_nr1b  ], /* 6   */ [ 0.019,  _nr1b,  -_nr1a ],
  /* 7   */ [ 0.019,  0,       -_nr1   ], /* 8   */ [ 0.019, -_nr1b,  -_nr1a ],
  /* 9   */ [ 0.019, -_nr1a,  -_nr1b  ], /* 10  */ [ 0.019, -_nr1,    0      ],
  /* 11  */ [ 0.019, -_nr1a,   _nr1b  ], /* 12  */ [ 0.019, -_nr1b,   _nr1a  ],
  // Nose ring 2 — x=0.017, r=_nr2 (sin π/4 ≈ 0.707)
  /* 13  */ [ 0.017,  0,        _nr2   ], /* 14  */ [ 0.017,  _nr2b,  _nr2a  ],
  /* 15  */ [ 0.017,  _nr2a,   _nr2b  ], /* 16  */ [ 0.017,  _nr2,    0      ],
  /* 17  */ [ 0.017,  _nr2a,  -_nr2b  ], /* 18  */ [ 0.017,  _nr2b,  -_nr2a ],
  /* 19  */ [ 0.017,  0,       -_nr2   ], /* 20  */ [ 0.017, -_nr2b,  -_nr2a ],
  /* 21  */ [ 0.017, -_nr2a,  -_nr2b  ], /* 22  */ [ 0.017, -_nr2,    0      ],
  /* 23  */ [ 0.017, -_nr2a,   _nr2b  ], /* 24  */ [ 0.017, -_nr2b,   _nr2a  ],
  // Nose ring 3 — x=0.015, r=_nr3 (sin 3π/8 ≈ 0.924)
  /* 25  */ [ 0.015,  0,        _nr3   ], /* 26  */ [ 0.015,  _nr3b,  _nr3a  ],
  /* 27  */ [ 0.015,  _nr3a,   _nr3b  ], /* 28  */ [ 0.015,  _nr3,    0      ],
  /* 29  */ [ 0.015,  _nr3a,  -_nr3b  ], /* 30  */ [ 0.015,  _nr3b,  -_nr3a ],
  /* 31  */ [ 0.015,  0,       -_nr3   ], /* 32  */ [ 0.015, -_nr3b,  -_nr3a ],
  /* 33  */ [ 0.015, -_nr3a,  -_nr3b  ], /* 34  */ [ 0.015, -_nr3,    0      ],
  /* 35  */ [ 0.015, -_nr3a,   _nr3b  ], /* 36  */ [ 0.015, -_nr3b,   _nr3a  ],
  // Fwd ring — x=0.013, r=_r (full)
  /* 37  */ [ 0.013,  0,        _r     ], /* 38  */ [ 0.013,  _rb,    _ra    ],
  /* 39  */ [ 0.013,  _ra,     _rb    ], /* 40  */ [ 0.013,  _r,     0      ],
  /* 41  */ [ 0.013,  _ra,    -_rb    ], /* 42  */ [ 0.013,  _rb,   -_ra    ],
  /* 43  */ [ 0.013,  0,      -_r     ], /* 44  */ [ 0.013, -_rb,   -_ra    ],
  /* 45  */ [ 0.013, -_ra,    -_rb    ], /* 46  */ [ 0.013, -_r,     0      ],
  /* 47  */ [ 0.013, -_ra,     _rb    ], /* 48  */ [ 0.013, -_rb,    _ra    ],
  // Wing-stn ring — x=0.001
  /* 49  */ [ 0.001,  0,        _r     ], /* 50  */ [ 0.001,  _rb,    _ra    ],
  /* 51  */ [ 0.001,  _ra,     _rb    ], /* 52  */ [ 0.001,  _r,     0      ],
  /* 53  */ [ 0.001,  _ra,    -_rb    ], /* 54  */ [ 0.001,  _rb,   -_ra    ],
  /* 55  */ [ 0.001,  0,      -_r     ], /* 56  */ [ 0.001, -_rb,   -_ra    ],
  /* 57  */ [ 0.001, -_ra,    -_rb    ], /* 58  */ [ 0.001, -_r,     0      ],
  /* 59  */ [ 0.001, -_ra,     _rb    ], /* 60  */ [ 0.001, -_rb,    _ra    ],
  // Rear ring — x=-0.010
  /* 61  */ [-0.010,  0,        _r     ], /* 62  */ [-0.010,  _rb,    _ra    ],
  /* 63  */ [-0.010,  _ra,     _rb    ], /* 64  */ [-0.010,  _r,     0      ],
  /* 65  */ [-0.010,  _ra,    -_rb    ], /* 66  */ [-0.010,  _rb,   -_ra    ],
  /* 67  */ [-0.010,  0,      -_r     ], /* 68  */ [-0.010, -_rb,   -_ra    ],
  /* 69  */ [-0.010, -_ra,    -_rb    ], /* 70  */ [-0.010, -_r,     0      ],
  /* 71  */ [-0.010, -_ra,     _rb    ], /* 72  */ [-0.010, -_rb,    _ra    ],
  // Tail ring — x=-0.017
  /* 73  */ [-0.017,  0,        _r     ], /* 74  */ [-0.017,  _rb,    _ra    ],
  /* 75  */ [-0.017,  _ra,     _rb    ], /* 76  */ [-0.017,  _r,     0      ],
  /* 77  */ [-0.017,  _ra,    -_rb    ], /* 78  */ [-0.017,  _rb,   -_ra    ],
  /* 79  */ [-0.017,  0,      -_r     ], /* 80  */ [-0.017, -_rb,   -_ra    ],
  /* 81  */ [-0.017, -_ra,    -_rb    ], /* 82  */ [-0.017, -_r,     0      ],
  /* 83  */ [-0.017, -_ra,     _rb    ], /* 84  */ [-0.017, -_rb,    _ra    ],
  // Tail taper ring — x=-0.019, r=_nr2 (sin π/4)
  /* 85  */ [-0.019,  0,        _nr2   ], /* 86  */ [-0.019,  _nr2b,  _nr2a  ],
  /* 87  */ [-0.019,  _nr2a,   _nr2b  ], /* 88  */ [-0.019,  _nr2,    0      ],
  /* 89  */ [-0.019,  _nr2a,  -_nr2b  ], /* 90  */ [-0.019,  _nr2b,  -_nr2a ],
  /* 91  */ [-0.019,  0,       -_nr2   ], /* 92  */ [-0.019, -_nr2b,  -_nr2a ],
  /* 93  */ [-0.019, -_nr2a,  -_nr2b  ], /* 94  */ [-0.019, -_nr2,    0      ],
  /* 95  */ [-0.019, -_nr2a,   _nr2b  ], /* 96  */ [-0.019, -_nr2b,   _nr2a  ],
  /* 97  */ [-0.021,  0,        0      ],  // tail tip
  /* 98  */ [ 0.005,  _r,      -_r     ],  // R wing root LE
  /* 99  */ [-0.004,  _r,      -_r     ],  // R wing root TE
  /* 100 */ [-0.001,  _hs,     _dh     ],  // R wing tip  LE
  /* 101 */ [-0.009,  _hs,     _dh     ],  // R wing tip  TE
  /* 102 */ [ 0.005, -_r,      -_r     ],  // L wing root LE
  /* 103 */ [-0.004, -_r,      -_r     ],  // L wing root TE
  /* 104 */ [-0.001, -_hs,     _dh     ],  // L wing tip  LE
  /* 105 */ [-0.009, -_hs,     _dh     ],  // L wing tip  TE
  /* 106 */ [-0.013,  0,        _r     ],  // V-stab base fwd
  /* 107 */ [-0.019,  0,        _r     ],  // V-stab base aft
  /* 108 */ [-0.015,  0,        0.008  ],  // V-stab top  fwd
  /* 109 */ [-0.020,  0,        0.007  ],  // V-stab top  aft
  /* 110 */ [-0.017,  _r,       0.001  ],  // R h-stab root fwd
  /* 111 */ [-0.020,  _r,       0.001  ],  // R h-stab root aft
  /* 112 */ [-0.018,  0.008,    0.002  ],  // R h-stab tip  fwd
  /* 113 */ [-0.021,  0.008,    0.002  ],  // R h-stab tip  aft
  /* 114 */ [-0.017, -_r,       0.001  ],  // L h-stab root fwd
  /* 115 */ [-0.020, -_r,       0.001  ],  // L h-stab root aft
  /* 116 */ [-0.018, -0.008,    0.002  ],  // L h-stab tip  fwd
  /* 117 */ [-0.021, -0.008,    0.002  ],  // L h-stab tip  aft
  // R engine intake ring  (x=0.008, r=_er)
  /* 118 */ [ 0.008,  _ey,      _ez+_er  ], /* 119 */ [ 0.008,  _ey+_e7,  _ez+_e7  ],
  /* 120 */ [ 0.008,  _ey+_er,  _ez      ], /* 121 */ [ 0.008,  _ey+_e7,  _ez-_e7  ],
  /* 122 */ [ 0.008,  _ey,      _ez-_er  ], /* 123 */ [ 0.008,  _ey-_e7,  _ez-_e7  ],
  /* 124 */ [ 0.008,  _ey-_er,  _ez      ], /* 125 */ [ 0.008,  _ey-_e7,  _ez+_e7  ],
  // R engine mid ring  (x=-0.001)
  /* 126 */ [-0.001,  _ey,      _ez+_er  ], /* 127 */ [-0.001,  _ey+_e7,  _ez+_e7  ],
  /* 128 */ [-0.001,  _ey+_er,  _ez      ], /* 129 */ [-0.001,  _ey+_e7,  _ez-_e7  ],
  /* 130 */ [-0.001,  _ey,      _ez-_er  ], /* 131 */ [-0.001,  _ey-_e7,  _ez-_e7  ],
  /* 132 */ [-0.001,  _ey-_er,  _ez      ], /* 133 */ [-0.001,  _ey-_e7,  _ez+_e7  ],
  // R engine exhaust ring  (x=-0.003, r=_erc)
  /* 134 */ [-0.003,  _ey,      _ez+_erc ], /* 135 */ [-0.003,  _ey+_e7c, _ez+_e7c ],
  /* 136 */ [-0.003,  _ey+_erc, _ez      ], /* 137 */ [-0.003,  _ey+_e7c, _ez-_e7c ],
  /* 138 */ [-0.003,  _ey,      _ez-_erc ], /* 139 */ [-0.003,  _ey-_e7c, _ez-_e7c ],
  /* 140 */ [-0.003,  _ey-_erc, _ez      ], /* 141 */ [-0.003,  _ey-_e7c, _ez+_e7c ],
  // L engine intake ring  (outer = −y)
  /* 142 */ [ 0.008, -_ey,      _ez+_er  ], /* 143 */ [ 0.008, -_ey-_e7,  _ez+_e7  ],
  /* 144 */ [ 0.008, -_ey-_er,  _ez      ], /* 145 */ [ 0.008, -_ey-_e7,  _ez-_e7  ],
  /* 146 */ [ 0.008, -_ey,      _ez-_er  ], /* 147 */ [ 0.008, -_ey+_e7,  _ez-_e7  ],
  /* 148 */ [ 0.008, -_ey+_er,  _ez      ], /* 149 */ [ 0.008, -_ey+_e7,  _ez+_e7  ],
  // L engine mid ring  (x=-0.001)
  /* 150 */ [-0.001, -_ey,      _ez+_er  ], /* 151 */ [-0.001, -_ey-_e7,  _ez+_e7  ],
  /* 152 */ [-0.001, -_ey-_er,  _ez      ], /* 153 */ [-0.001, -_ey-_e7,  _ez-_e7  ],
  /* 154 */ [-0.001, -_ey,      _ez-_er  ], /* 155 */ [-0.001, -_ey+_e7,  _ez-_e7  ],
  /* 156 */ [-0.001, -_ey+_er,  _ez      ], /* 157 */ [-0.001, -_ey+_e7,  _ez+_e7  ],
  // L engine exhaust ring  (x=-0.003, r=_erc)
  /* 158 */ [-0.003, -_ey,      _ez+_erc ], /* 159 */ [-0.003, -_ey-_e7c, _ez+_e7c ],
  /* 160 */ [-0.003, -_ey-_erc, _ez      ], /* 161 */ [-0.003, -_ey-_e7c, _ez-_e7c ],
  /* 162 */ [-0.003, -_ey,      _ez-_erc ], /* 163 */ [-0.003, -_ey+_e7c, _ez-_e7c ],
  /* 164 */ [-0.003, -_ey+_erc, _ez      ], /* 165 */ [-0.003, -_ey+_e7c, _ez+_e7c ],
  // Winglets
  /* 166 */ [-0.005,  _wy,      _wz      ],  // R winglet tip LE
  /* 167 */ [-0.012,  _wy,      _wz      ],  // R winglet tip TE
  /* 168 */ [-0.005, -_wy,      _wz      ],  // L winglet tip LE
  /* 169 */ [-0.012, -_wy,      _wz      ],  // L winglet tip TE
];

/* Faces — CCW winding = outward normal via right-hand rule */
const _F = [
  // Nose tip → ring 1 (triangles)
  [0,2,1],[0,3,2],[0,4,3],[0,5,4],[0,6,5],[0,7,6],
  [0,8,7],[0,9,8],[0,10,9],[0,11,10],[0,12,11],[0,1,12],
  // Nose ring 1 → ring 2 (quads)
  [1,2,14,13],[2,3,15,14],[3,4,16,15],[4,5,17,16],
  [5,6,18,17],[6,7,19,18],[7,8,20,19],[8,9,21,20],
  [9,10,22,21],[10,11,23,22],[11,12,24,23],[12,1,13,24],
  // Nose ring 2 → ring 3 (quads)
  [13,14,26,25],[14,15,27,26],[15,16,28,27],[16,17,29,28],
  [17,18,30,29],[18,19,31,30],[19,20,32,31],[20,21,33,32],
  [21,22,34,33],[22,23,35,34],[23,24,36,35],[24,13,25,36],
  // Nose ring 3 → fwd ring (quads)
  [25,26,38,37],[26,27,39,38],[27,28,40,39],[28,29,41,40],
  [29,30,42,41],[30,31,43,42],[31,32,44,43],[32,33,45,44],
  [33,34,46,45],[34,35,47,46],[35,36,48,47],[36,25,37,48],
  // Main fuselage: fwd → wing-stn
  [37,38,50,49],[38,39,51,50],[39,40,52,51],[40,41,53,52],
  [41,42,54,53],[42,43,55,54],[43,44,56,55],[44,45,57,56],
  [45,46,58,57],[46,47,59,58],[47,48,60,59],[48,37,49,60],
  // Main fuselage: wing-stn → rear
  [49,50,62,61],[50,51,63,62],[51,52,64,63],[52,53,65,64],
  [53,54,66,65],[54,55,67,66],[55,56,68,67],[56,57,69,68],
  [57,58,70,69],[58,59,71,70],[59,60,72,71],[60,49,61,72],
  // Main fuselage: rear → tail ring
  [61,62,74,73],[62,63,75,74],[63,64,76,75],[64,65,77,76],
  [65,66,78,77],[66,67,79,78],[67,68,80,79],[68,69,81,80],
  [69,70,82,81],[70,71,83,82],[71,72,84,83],[72,61,73,84],
  // Tail ring → tail taper (quads)
  [73,74,86,85],[74,75,87,86],[75,76,88,87],[76,77,89,88],
  [77,78,90,89],[78,79,91,90],[79,80,92,91],[80,81,93,92],
  [81,82,94,93],[82,83,95,94],[83,84,96,95],[84,73,85,96],
  // Tail taper → tip (triangles)
  [97,85,86],[97,86,87],[97,87,88],[97,88,89],[97,89,90],[97,90,91],
  [97,91,92],[97,92,93],[97,93,94],[97,94,95],[97,95,96],[97,96,85],
  // Wings — top + bottom
  [98,100,101,99],[98,99,101,100],
  [102,103,105,104],[102,104,105,103],
  // Winglets — outer + inner faces
  [100,101,167,166],[100,166,167,101],
  [104,168,169,105],[104,105,169,168],
  // Vertical stabilizer — both sides
  [106,107,109,108],[106,108,109,107],
  // Horizontal stabilizers — top + bottom
  [110,111,113,112],[110,112,113,111],
  [114,115,117,116],[114,116,117,115],
  // R engine front  (intake → mid)
  [118,119,127,126],[119,120,128,127],[120,121,129,128],[121,122,130,129],
  [122,123,131,130],[123,124,132,131],[124,125,133,132],[125,118,126,133],
  // R engine rear  (mid → exhaust, tapered)
  [126,127,135,134],[127,128,136,135],[128,129,137,136],[129,130,138,137],
  [130,131,139,138],[131,132,140,139],[132,133,141,140],[133,126,134,141],
  // L engine front  (mirrored winding)
  [142,150,151,143],[143,151,152,144],[144,152,153,145],[145,153,154,146],
  [146,154,155,147],[147,155,156,148],[148,156,157,149],[149,157,150,142],
  // L engine rear  (mirrored)
  [150,158,159,151],[151,159,160,152],[152,160,161,153],[153,161,162,154],
  [154,162,163,155],[155,163,164,156],[156,164,165,157],[157,165,158,150],
];

/* Pre-compute body-frame face normals once */
const _FN = _F.map(fi => {
  const a = _V[fi[0]], b = _V[fi[1]], c = _V[fi[2]];
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n  = [
    ab[1]*ac[2] - ab[2]*ac[1],
    ab[2]*ac[0] - ab[0]*ac[2],
    ab[0]*ac[1] - ab[1]*ac[0],
  ];
  const len = Math.hypot(...n);
  return len > 1e-10 ? n.map(x => x/len) : [0, 0, 1];
});

/* Edges */
const _E = [
  // Fuselage rings (12 edges each, 8 rings)
  [1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,1],
  [13,14],[14,15],[15,16],[16,17],[17,18],[18,19],[19,20],[20,21],[21,22],[22,23],[23,24],[24,13],
  [25,26],[26,27],[27,28],[28,29],[29,30],[30,31],[31,32],[32,33],[33,34],[34,35],[35,36],[36,25],
  [37,38],[38,39],[39,40],[40,41],[41,42],[42,43],[43,44],[44,45],[45,46],[46,47],[47,48],[48,37],
  [49,50],[50,51],[51,52],[52,53],[53,54],[54,55],[55,56],[56,57],[57,58],[58,59],[59,60],[60,49],
  [61,62],[62,63],[63,64],[64,65],[65,66],[66,67],[67,68],[68,69],[69,70],[70,71],[71,72],[72,61],
  [73,74],[74,75],[75,76],[76,77],[77,78],[78,79],[79,80],[80,81],[81,82],[82,83],[83,84],[84,73],
  [85,86],[86,87],[87,88],[88,89],[89,90],[90,91],[91,92],[92,93],[93,94],[94,95],[95,96],[96,85],
  // Longerons — top/right/bottom/left through all rings
  [0,1],[1,13],[13,25],[25,37],[37,49],[49,61],[61,73],[73,85],[85,97],
  [0,4],[4,16],[16,28],[28,40],[40,52],[52,64],[64,76],[76,88],[88,97],
  [0,7],[7,19],[19,31],[31,43],[43,55],[55,67],[67,79],[79,91],[91,97],
  [0,10],[10,22],[22,34],[34,46],[46,58],[58,70],[70,82],[82,94],[94,97],
  // Wings
  [98,100],[99,101],[98,99],[100,101],[55,98],[55,99],
  [102,104],[103,105],[102,103],[104,105],[55,102],[55,103],
  // V-stab
  [106,108],[107,109],[108,109],[106,107],[73,106],[73,107],
  // H-stabs
  [110,112],[111,113],[110,111],[112,113],[76,110],
  [114,116],[115,117],[114,115],[116,117],[82,114],
  // Winglets
  [100,166],[101,167],[166,167],
  [104,168],[105,169],[168,169],
  // R engine — 3 rings, longitudinals, pylon
  [118,119],[119,120],[120,121],[121,122],[122,123],[123,124],[124,125],[125,118],
  [126,127],[127,128],[128,129],[129,130],[130,131],[131,132],[132,133],[133,126],
  [134,135],[135,136],[136,137],[137,138],[138,139],[139,140],[140,141],[141,134],
  [118,126],[120,128],[122,130],[124,132],
  [126,134],[128,136],[130,138],[132,140],
  [118,98],[134,99],
  // L engine — 3 rings, longitudinals, pylon
  [142,143],[143,144],[144,145],[145,146],[146,147],[147,148],[148,149],[149,142],
  [150,151],[151,152],[152,153],[153,154],[154,155],[155,156],[156,157],[157,150],
  [158,159],[159,160],[160,161],[161,162],[162,163],[163,164],[164,165],[165,158],
  [142,150],[144,152],[146,154],[148,156],
  [150,158],[152,160],[154,162],[156,164],
  [142,102],[158,103],
];

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

const _cr  = 0.0018, _cr7 = _cr * 0.7071;   // cowl ring radius (8-gon)
const _xr  = 0.0021, _xr7 = _xr * 0.7071;   // cabin ring radius
const _abr = 0.0016, _abr7= _abr* 0.7071;   // aft-cabin ring radius
const _tr  = 0.0009, _tr7 = _tr * 0.7071;   // tail-boom ring radius
const _hs172 = 0.0110;   // C172 half-span
const _dh172 = 0.0004;   // C172 wing-tip dihedral offset
const _pr172 = 0.0014;   // prop disk radius (for arc rendering)

const _COLORS_c172 = [
  [240, 240, 240],  // 0 fuselage/tail — white
  [230, 235, 238],  // 1 wings / h-stabs — slightly darker
  [ 85,  90, 100],  // 2 cowl — dark gray
];

const _V_c172 = [
  /* 0  */ [ 0.013,  0,              0             ],  // spinner
  /* 1  */ [ 0.009,  0,              _cr           ],  // cowl top
  /* 2  */ [ 0.009,  _cr7,           _cr7          ],
  /* 3  */ [ 0.009,  _cr,            0             ],  // cowl right
  /* 4  */ [ 0.009,  _cr7,          -_cr7          ],
  /* 5  */ [ 0.009,  0,             -_cr           ],  // cowl bottom
  /* 6  */ [ 0.009, -_cr7,          -_cr7          ],
  /* 7  */ [ 0.009, -_cr,            0             ],  // cowl left
  /* 8  */ [ 0.009, -_cr7,           _cr7          ],
  /* 9  */ [ 0.004,  0,              _xr           ],  // cabin-fwd top
  /* 10 */ [ 0.004,  _xr7,           _xr7          ],
  /* 11 */ [ 0.004,  _xr,            0             ],
  /* 12 */ [ 0.004,  _xr7,          -_xr7          ],
  /* 13 */ [ 0.004,  0,             -_xr           ],
  /* 14 */ [ 0.004, -_xr7,          -_xr7          ],
  /* 15 */ [ 0.004, -_xr,            0             ],
  /* 16 */ [ 0.004, -_xr7,           _xr7          ],
  /* 17 */ [ 0.000,  0,              _xr           ],  // wing-stn top
  /* 18 */ [ 0.000,  _xr7,           _xr7          ],
  /* 19 */ [ 0.000,  _xr,            0             ],
  /* 20 */ [ 0.000,  _xr7,          -_xr7          ],
  /* 21 */ [ 0.000,  0,             -_xr           ],
  /* 22 */ [ 0.000, -_xr7,          -_xr7          ],
  /* 23 */ [ 0.000, -_xr,            0             ],
  /* 24 */ [ 0.000, -_xr7,           _xr7          ],
  /* 25 */ [-0.004,  0,              _abr          ],  // aft-cabin top
  /* 26 */ [-0.004,  _abr7,          _abr7         ],
  /* 27 */ [-0.004,  _abr,           0             ],
  /* 28 */ [-0.004,  _abr7,         -_abr7         ],
  /* 29 */ [-0.004,  0,             -_abr          ],
  /* 30 */ [-0.004, -_abr7,         -_abr7         ],
  /* 31 */ [-0.004, -_abr,           0             ],
  /* 32 */ [-0.004, -_abr7,          _abr7         ],
  /* 33 */ [-0.009,  0,              _tr           ],  // tail-boom top
  /* 34 */ [-0.009,  _tr7,           _tr7          ],
  /* 35 */ [-0.009,  _tr,            0             ],  // tail-boom right
  /* 36 */ [-0.009,  _tr7,          -_tr7          ],
  /* 37 */ [-0.009,  0,             -_tr           ],  // tail-boom bottom
  /* 38 */ [-0.009, -_tr7,          -_tr7          ],
  /* 39 */ [-0.009, -_tr,            0             ],  // tail-boom left
  /* 40 */ [-0.009, -_tr7,           _tr7          ],
  /* 41 */ [-0.013,  0,              0             ],  // tail tip
  /* 42 */ [ 0.005,  0.0002,         _xr           ],  // R wing root LE
  /* 43 */ [-0.002,  0.0002,         _xr           ],  // R wing root TE
  /* 44 */ [ 0.003,  _hs172,         _xr+_dh172    ],  // R wing tip LE
  /* 45 */ [-0.004,  _hs172,         _xr+_dh172    ],  // R wing tip TE
  /* 46 */ [ 0.005, -0.0002,         _xr           ],  // L wing root LE
  /* 47 */ [-0.002, -0.0002,         _xr           ],  // L wing root TE
  /* 48 */ [ 0.003, -_hs172,         _xr+_dh172    ],  // L wing tip LE
  /* 49 */ [-0.004, -_hs172,         _xr+_dh172    ],  // L wing tip TE
  /* 50 */ [-0.007,  0,              _tr           ],  // V-stab base fwd
  /* 51 */ [-0.012,  0,              _tr           ],  // V-stab base aft
  /* 52 */ [-0.008,  0,              0.008         ],  // V-stab top fwd
  /* 53 */ [-0.013,  0,              0.007         ],  // V-stab top aft
  /* 54 */ [-0.009,  _tr+0.0003,     0             ],  // R h-stab root fwd
  /* 55 */ [-0.012,  _tr+0.0003,     0             ],  // R h-stab root aft
  /* 56 */ [-0.010,  0.0055,         0.001         ],  // R h-stab tip fwd
  /* 57 */ [-0.013,  0.0055,         0.001         ],  // R h-stab tip aft
  /* 58 */ [-0.009, -_tr-0.0003,     0             ],  // L h-stab root fwd
  /* 59 */ [-0.012, -_tr-0.0003,     0             ],  // L h-stab root aft
  /* 60 */ [-0.010, -0.0055,         0.001         ],  // L h-stab tip fwd
  /* 61 */ [-0.013, -0.0055,         0.001         ],  // L h-stab tip aft
  /* 62 */ [ 0.001,  _hs172*0.55,    _xr           ],  // R strut top
  /* 63 */ [ 0.001,  _xr*1.5,       -_xr*0.4      ],  // R strut bottom
  /* 64 */ [ 0.001, -_hs172*0.55,    _xr           ],  // L strut top
  /* 65 */ [ 0.001, -_xr*1.5,       -_xr*0.4      ],  // L strut bottom
  /* 66 */ [ 0.013,  _pr172,         0             ],  // prop tip (arc radius ref)
  // Flap / aileron break at ~55% semi-span (lerped along LE and TE)
  /* 67 */ [ 0.0039,  0.0062,       _xr+_dh172*0.55],  // R break LE
  /* 68 */ [-0.0031,  0.0062,       _xr+_dh172*0.55],  // R break TE (flap outer / ail inner)
  /* 69 */ [ 0.0039, -0.0062,       _xr+_dh172*0.55],  // L break LE
  /* 70 */ [-0.0031, -0.0062,       _xr+_dh172*0.55],  // L break TE
];

const _F_c172 = [
  // Nose cone: spinner → cowl (8 tris)
  [0,2,1],[0,3,2],[0,4,3],[0,5,4],[0,6,5],[0,7,6],[0,8,7],[0,1,8],
  // Cowl body: cowl → cabin-fwd (8 quads)
  [1,2,10,9],[2,3,11,10],[3,4,12,11],[4,5,13,12],
  [5,6,14,13],[6,7,15,14],[7,8,16,15],[8,1,9,16],
  // Cabin: cabin-fwd → wing-stn (8 quads)
  [9,10,18,17],[10,11,19,18],[11,12,20,19],[12,13,21,20],
  [13,14,22,21],[14,15,23,22],[15,16,24,23],[16,9,17,24],
  // Cabin: wing-stn → aft-cabin (8 quads)
  [17,18,26,25],[18,19,27,26],[19,20,28,27],[20,21,29,28],
  [21,22,30,29],[22,23,31,30],[23,24,32,31],[24,17,25,32],
  // Tail: aft-cabin → tail-boom (8 quads)
  [25,26,34,33],[26,27,35,34],[27,28,36,35],[28,29,37,36],
  [29,30,38,37],[30,31,39,38],[31,32,40,39],[32,25,33,40],
  // Tail cone: tail-boom → tip (8 tris)
  [41,33,34],[41,34,35],[41,35,36],[41,36,37],
  [41,37,38],[41,38,39],[41,39,40],[41,40,33],
  // Wings: inboard (flap) top+bottom, outboard (aileron) top+bottom — R then L
  [42,67,68,43],[42,43,68,67],
  [67,44,45,68],[67,68,45,44],
  [46,47,70,69],[46,69,70,47],
  [69,70,49,48],[69,48,49,70],
  // V-stab (both sides)
  [50,51,53,52],[50,52,53,51],
  // H-stabs: R top + bottom, L top + bottom
  [54,56,57,55],[54,55,57,56],
  [58,59,61,60],[58,60,61,59],
];

const _FN_c172 = _F_c172.map(fi => {
  const a = _V_c172[fi[0]], b = _V_c172[fi[1]], c = _V_c172[fi[2]];
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n  = [
    ab[1]*ac[2] - ab[2]*ac[1],
    ab[2]*ac[0] - ab[0]*ac[2],
    ab[0]*ac[1] - ab[1]*ac[0],
  ];
  const len = Math.hypot(...n);
  return len > 1e-10 ? n.map(x => x/len) : [0, 0, 1];
});

const _FC_c172 = [
  2,2,2,2,2,2,2,2,   // nose cone
  2,2,2,2,2,2,2,2,   // cowl body
  0,0,0,0,0,0,0,0,   // cabin fwd
  0,0,0,0,0,0,0,0,   // cabin mid
  0,0,0,0,0,0,0,0,   // tail section
  0,0,0,0,0,0,0,0,   // tail cone
  1,1,1,1,1,1,1,1,   // wings (8: flap+aileron × 2 sides × top+bottom)
  0,0,                // v-stab
  0,0,0,0,            // h-stabs
];

const _E_c172 = [
  // Fuselage rings (8 edges each)
  [1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,1],
  [9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,16],[16,9],
  [17,18],[18,19],[19,20],[20,21],[21,22],[22,23],[23,24],[24,17],
  [25,26],[26,27],[27,28],[28,29],[29,30],[30,31],[31,32],[32,25],
  [33,34],[34,35],[35,36],[36,37],[37,38],[38,39],[39,40],[40,33],
  // Longerons (top/right/bottom/left)
  [0,1],[1,9],[9,17],[17,25],[25,33],[33,41],
  [0,3],[3,11],[11,19],[19,27],[27,35],[35,41],
  [0,5],[5,13],[13,21],[21,29],[29,37],[37,41],
  [0,7],[7,15],[15,23],[23,31],[31,39],[39,41],
  // Wings: LE, TE, root chord, tip chord, break chord, root attach
  [42,67],[67,44],[43,68],[68,45],[42,43],[67,68],[44,45],[17,42],[17,43],
  [46,69],[69,48],[47,70],[70,49],[46,47],[69,70],[48,49],[17,46],[17,47],
  // Struts
  [62,63],[64,65],
  // V-stab
  [50,52],[51,53],[52,53],[50,51],[33,50],[33,51],
  // H-stabs
  [54,56],[55,57],[54,55],[56,57],[35,54],
  [58,60],[59,61],[58,59],[60,61],[39,58],
];

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
const _bcR  = 0.0016, _bcR7 = _bcR  * 0.7071;  // cowl  (near-circular)
const _bfRy = 0.0011, _bfRy7= _bfRy * 0.7071;  // body  half-width  (narrow!)
const _bfRz = 0.0015, _bfRz7= _bfRz * 0.7071;  // body  half-height
const _baRy = 0.0007, _baRy7= _baRy * 0.7071;  // aft   half-width
const _baRz = 0.0011, _baRz7= _baRz * 0.7071;  // aft   half-height
const _btRy = 0.0004, _btRy7= _btRy * 0.7071;  // tail  half-width
const _btRz = 0.0006, _btRz7= _btRz * 0.7071;  // tail  half-height
const _b9hs = 0.0138;   // half-span
const _b9dh = 0.0002;   // wing dihedral
const _b9vH = 0.0078;   // V-stab height above fuselage top
const _b9hw = 0.0060;   // H-stab half-span
const _b9pr = 0.0150;   // prop disk radius

const _COLORS_b109 = [
  [168, 174, 145],  // 0 fuselage — RLM 74 dark grey-green
  [150, 158, 136],  // 1 wings    — RLM 75 grey-violet
  [ 50,  54,  46],  // 2 cowl     — dark engine cowl
  [168, 174, 145],  // 3 tail surfaces — same as fuselage
];

const _V_b109 = [
  /* 0  */ [ 0.015,  0,       0          ],  // spinner

  // Ring A — cowl front  (x=+0.011, circular r=_bcR)
  /* 1  */ [ 0.011,  0,       _bcR       ], /* 2  */ [ 0.011,  _bcR7,  _bcR7  ],
  /* 3  */ [ 0.011,  _bcR,    0          ], /* 4  */ [ 0.011,  _bcR7, -_bcR7  ],
  /* 5  */ [ 0.011,  0,      -_bcR       ], /* 6  */ [ 0.011, -_bcR7, -_bcR7  ],
  /* 7  */ [ 0.011, -_bcR,    0          ], /* 8  */ [ 0.011, -_bcR7,  _bcR7  ],

  // Ring B — cowl rear   (x=+0.006, same r — step to body comes at B→C)
  /* 9  */ [ 0.006,  0,       _bcR       ], /* 10 */ [ 0.006,  _bcR7,  _bcR7  ],
  /* 11 */ [ 0.006,  _bcR,    0          ], /* 12 */ [ 0.006,  _bcR7, -_bcR7  ],
  /* 13 */ [ 0.006,  0,      -_bcR       ], /* 14 */ [ 0.006, -_bcR7, -_bcR7  ],
  /* 15 */ [ 0.006, -_bcR,    0          ], /* 16 */ [ 0.006, -_bcR7,  _bcR7  ],

  // Ring C — fuselage fwd (x=+0.002, narrow oval: dramatic narrowing from cowl)
  /* 17 */ [ 0.002,  0,       _bfRz      ], /* 18 */ [ 0.002,  _bfRy7, _bfRz7 ],
  /* 19 */ [ 0.002,  _bfRy,   0          ], /* 20 */ [ 0.002,  _bfRy7,-_bfRz7 ],
  /* 21 */ [ 0.002,  0,      -_bfRz      ], /* 22 */ [ 0.002, -_bfRy7,-_bfRz7 ],
  /* 23 */ [ 0.002, -_bfRy,   0          ], /* 24 */ [ 0.002, -_bfRy7, _bfRz7 ],

  // Ring D — wing station  (x=-0.002, same oval)
  /* 25 */ [-0.002,  0,       _bfRz      ], /* 26 */ [-0.002,  _bfRy7, _bfRz7 ],
  /* 27 */ [-0.002,  _bfRy,   0          ], /* 28 */ [-0.002,  _bfRy7,-_bfRz7 ],
  /* 29 */ [-0.002,  0,      -_bfRz      ], /* 30 */ [-0.002, -_bfRy7,-_bfRz7 ],
  /* 31 */ [-0.002, -_bfRy,   0          ], /* 32 */ [-0.002, -_bfRy7, _bfRz7 ],

  // Ring E — aft fuselage  (x=-0.007, narrowing)
  /* 33 */ [-0.007,  0,       _baRz      ], /* 34 */ [-0.007,  _baRy7, _baRz7 ],
  /* 35 */ [-0.007,  _baRy,   0          ], /* 36 */ [-0.007,  _baRy7,-_baRz7 ],
  /* 37 */ [-0.007,  0,      -_baRz      ], /* 38 */ [-0.007, -_baRy7,-_baRz7 ],
  /* 39 */ [-0.007, -_baRy,   0          ], /* 40 */ [-0.007, -_baRy7, _baRz7 ],

  // Ring F — tail          (x=-0.011, very narrow)
  /* 41 */ [-0.011,  0,       _btRz      ], /* 42 */ [-0.011,  _btRy7, _btRz7 ],
  /* 43 */ [-0.011,  _btRy,   0          ], /* 44 */ [-0.011,  _btRy7,-_btRz7 ],
  /* 45 */ [-0.011,  0,      -_btRz      ], /* 46 */ [-0.011, -_btRy7,-_btRz7 ],
  /* 47 */ [-0.011, -_btRy,   0          ], /* 48 */ [-0.011, -_btRy7, _btRz7 ],

  /* 49 */ [-0.014,  0,       0          ],  // tail tip

  // Wings — mid-low, slight taper, light dihedral
  /* 50 */ [ 0.004, +_bfRy,  -_bfRz*0.4 ],  // R root LE
  /* 51 */ [-0.002, +_bfRy,  -_bfRz*0.4 ],  // R root TE
  /* 52 */ [ 0.001, +_b9hs,  -_bfRz*0.4+_b9dh ], // R tip LE
  /* 53 */ [-0.004, +_b9hs,  -_bfRz*0.4+_b9dh ], // R tip TE
  /* 54 */ [ 0.004, -_bfRy,  -_bfRz*0.4 ],  // L root LE
  /* 55 */ [-0.002, -_bfRy,  -_bfRz*0.4 ],  // L root TE
  /* 56 */ [ 0.001, -_b9hs,  -_bfRz*0.4+_b9dh ], // L tip LE
  /* 57 */ [-0.004, -_b9hs,  -_bfRz*0.4+_b9dh ], // L tip TE

  // V-stab (tall, rectangular-ish — BF-109 has a very distinctive large tail)
  /* 58 */ [-0.007,  0,       _baRz      ],  // LE base (coincident with Ring E top)
  /* 59 */ [-0.013,  0,       _btRz      ],  // TE base (Ring F level)
  /* 60 */ [-0.009,  0,       _baRz+_b9vH],  // LE top
  /* 61 */ [-0.013,  0,       _btRz+_b9vH*0.82], // TE top

  // R h-stab
  /* 62 */ [-0.010, +_btRy,   _btRz*0.1  ], /* 63 */ [-0.013, +_btRy,  _btRz*0.1 ],
  /* 64 */ [-0.011, +_b9hw,   0.001      ], /* 65 */ [-0.013, +_b9hw,  0.001     ],

  // L h-stab
  /* 66 */ [-0.010, -_btRy,   _btRz*0.1  ], /* 67 */ [-0.013, -_btRy,  _btRz*0.1 ],
  /* 68 */ [-0.011, -_b9hw,   0.001      ], /* 69 */ [-0.013, -_b9hw,  0.001     ],

  /* 70 */ [ 0.015, +_b9pr,   0          ],  // prop disk radius ref
];

const _F_b109 = [
  // Nose cone: spinner → Ring A (8 tris)
  [0,2,1],[0,3,2],[0,4,3],[0,5,4],[0,6,5],[0,7,6],[0,8,7],[0,1,8],
  // Cowl body: Ring A → Ring B (8 quads)
  [1,2,10,9],[2,3,11,10],[3,4,12,11],[4,5,13,12],
  [5,6,14,13],[6,7,15,14],[7,8,16,15],[8,1,9,16],
  // Cowl→body: Ring B → Ring C (8 quads — dramatic narrowing)
  [9,10,18,17],[10,11,19,18],[11,12,20,19],[12,13,21,20],
  [13,14,22,21],[14,15,23,22],[15,16,24,23],[16,9,17,24],
  // Body: Ring C → Ring D (8 quads)
  [17,18,26,25],[18,19,27,26],[19,20,28,27],[20,21,29,28],
  [21,22,30,29],[22,23,31,30],[23,24,32,31],[24,17,25,32],
  // Aft: Ring D → Ring E (8 quads)
  [25,26,34,33],[26,27,35,34],[27,28,36,35],[28,29,37,36],
  [29,30,38,37],[30,31,39,38],[31,32,40,39],[32,25,33,40],
  // Tail: Ring E → Ring F (8 quads)
  [33,34,42,41],[34,35,43,42],[35,36,44,43],[36,37,45,44],
  [37,38,46,45],[38,39,47,46],[39,40,48,47],[40,33,41,48],
  // Tail cone: Ring F → tip (8 tris)
  [49,42,41],[49,43,42],[49,44,43],[49,45,44],
  [49,46,45],[49,47,46],[49,48,47],[49,41,48],
  // Wings (top + bottom, double-sided)
  [50,52,53,51],[50,51,53,52],  // R wing
  [54,55,57,56],[54,56,57,55],  // L wing
  // V-stab (double-sided)
  [58,60,61,59],[58,59,61,60],
  // H-stabs (top + bottom)
  [62,64,65,63],[62,63,65,64],  // R
  [66,67,69,68],[66,68,69,67],  // L
];

const _FN_b109 = _F_b109.map(fi => {
  const a = _V_b109[fi[0]], b = _V_b109[fi[1]], c = _V_b109[fi[2]];
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n  = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
  const len = Math.hypot(...n);
  return len > 1e-10 ? n.map(x => x/len) : [0,0,1];
});

const _FC_b109 = [
  2,2,2,2,2,2,2,2,  // nose cone
  2,2,2,2,2,2,2,2,  // cowl A→B
  2,2,2,2,2,2,2,2,  // cowl→body B→C
  0,0,0,0,0,0,0,0,  // body C→D
  0,0,0,0,0,0,0,0,  // aft D→E
  0,0,0,0,0,0,0,0,  // tail E→F
  0,0,0,0,0,0,0,0,  // tail cone
  1,1,1,1,          // wings
  3,3,              // V-stab
  3,3,3,3,          // H-stabs
];

const _E_b109 = [
  // Fuselage rings
  [1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,1],
  [9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,16],[16,9],
  [17,18],[18,19],[19,20],[20,21],[21,22],[22,23],[23,24],[24,17],
  [25,26],[26,27],[27,28],[28,29],[29,30],[30,31],[31,32],[32,25],
  [33,34],[34,35],[35,36],[36,37],[37,38],[38,39],[39,40],[40,33],
  [41,42],[42,43],[43,44],[44,45],[45,46],[46,47],[47,48],[48,41],
  // Longerons (top / right / bottom / left)
  [0,1],[1,9],[9,17],[17,25],[25,33],[33,41],[41,49],
  [0,3],[3,11],[11,19],[19,27],[27,35],[35,43],[43,49],
  [0,5],[5,13],[13,21],[21,29],[29,37],[37,45],[45,49],
  [0,7],[7,15],[15,23],[23,31],[31,39],[39,47],[47,49],
  // Wings: R perimeter + root attach
  [50,52],[52,53],[53,51],[51,50],
  [19,50],[27,51],
  // Wings: L perimeter + root attach
  [54,56],[56,57],[57,55],[55,54],
  [23,54],[31,55],
  // V-stab: perimeter (v58 coincident with Ring E top v33)
  [58,60],[60,61],[61,59],[59,58],
  // H-stabs: R + L perimeter, attach to Ring F right/left
  [62,64],[64,65],[65,63],[63,62],
  [43,62],
  [66,68],[68,69],[69,67],[67,66],
  [47,66],
];

const _GV_b109 = [
  /* 0 */ [ 0.001,  0.0009, -0.0015 ],  // R main top (at fuselage bottom-right)
  /* 1 */ [ 0.001,  0.0016, -0.0037 ],  // R main wheel (narrow track)
  /* 2 */ [ 0.001, -0.0009, -0.0015 ],  // L main top
  /* 3 */ [ 0.001, -0.0016, -0.0037 ],  // L main wheel
  /* 4 */ [-0.012,  0,      -0.0006 ],  // tail strut top
  /* 5 */ [-0.012,  0,      -0.0012 ],  // tail wheel
];

/* ══════════════════════════════════════════════════════════════
   Falcon 9 geometry — Block 5 two-stage rocket + Dragon capsule
   Body frame: fwd = nose, right = starboard, up = any radial
   Units: NM. Origin ≈ centre of mass of full stack.
   ══════════════════════════════════════════════════════════════ */

const _rf9  = 0.0020;          // body radius (≈ 3.7 m / 1852)
const _rf7  = _rf9 * 0.7071;  // 8-gon diagonal
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

const _V_f9 = [
  // Ring 0 — S1 aft body (x=-0.016)
  /* 0 */ [-0.016,  0,      _rf9 ], /* 1 */ [-0.016,  _rf7,   _rf7 ],
  /* 2 */ [-0.016,  _rf9,   0    ], /* 3 */ [-0.016,  _rf7,  -_rf7 ],
  /* 4 */ [-0.016,  0,     -_rf9 ], /* 5 */ [-0.016, -_rf7,  -_rf7 ],
  /* 6 */ [-0.016, -_rf9,   0    ], /* 7 */ [-0.016, -_rf7,   _rf7 ],
  // Ring 1 — S1 mid (x=-0.004)
  /* 8 */ [-0.004,  0,      _rf9 ], /* 9 */ [-0.004,  _rf7,   _rf7 ],
  /*10 */ [-0.004,  _rf9,   0    ], /*11 */ [-0.004,  _rf7,  -_rf7 ],
  /*12 */ [-0.004,  0,     -_rf9 ], /*13 */ [-0.004, -_rf7,  -_rf7 ],
  /*14 */ [-0.004, -_rf9,   0    ], /*15 */ [-0.004, -_rf7,   _rf7 ],
  // Ring 2 — S1 top / grid-fin station (x=+0.004)
  /*16 */ [ 0.004,  0,      _rf9 ], /*17 */ [ 0.004,  _rf7,   _rf7 ],
  /*18 */ [ 0.004,  _rf9,   0    ], /*19 */ [ 0.004,  _rf7,  -_rf7 ],
  /*20 */ [ 0.004,  0,     -_rf9 ], /*21 */ [ 0.004, -_rf7,  -_rf7 ],
  /*22 */ [ 0.004, -_rf9,   0    ], /*23 */ [ 0.004, -_rf7,   _rf7 ],
  // Ring 3 — interstage / S2 base (x=+0.006, taper to 88%)
  /*24 */ [ 0.006,  0,      _rf9*0.88], /*25 */ [ 0.006,  _rf7*0.88, _rf7*0.88],
  /*26 */ [ 0.006,  _rf9*0.88, 0     ], /*27 */ [ 0.006,  _rf7*0.88,-_rf7*0.88],
  /*28 */ [ 0.006,  0,     -_rf9*0.88], /*29 */ [ 0.006, -_rf7*0.88,-_rf7*0.88],
  /*30 */ [ 0.006, -_rf9*0.88, 0     ], /*31 */ [ 0.006, -_rf7*0.88, _rf7*0.88],
  // Ring 4 — S2 top / Dragon base (x=+0.014)
  /*32 */ [ 0.014,  0,      _rf9 ], /*33 */ [ 0.014,  _rf7,   _rf7 ],
  /*34 */ [ 0.014,  _rf9,   0    ], /*35 */ [ 0.014,  _rf7,  -_rf7 ],
  /*36 */ [ 0.014,  0,     -_rf9 ], /*37 */ [ 0.014, -_rf7,  -_rf7 ],
  /*38 */ [ 0.014, -_rf9,   0    ], /*39 */ [ 0.014, -_rf7,   _rf7 ],
  // Ring 5 — Trunk top / Dragon base (x=+0.020, full radius)
  /*40 */ [ 0.020,  0,      _rf9 ], /*41 */ [ 0.020,  _rf7,   _rf7 ],
  /*42 */ [ 0.020,  _rf9,   0    ], /*43 */ [ 0.020,  _rf7,  -_rf7 ],
  /*44 */ [ 0.020,  0,     -_rf9 ], /*45 */ [ 0.020, -_rf7,  -_rf7 ],
  /*46 */ [ 0.020, -_rf9,   0    ], /*47 */ [ 0.020, -_rf7,   _rf7 ],
  // Dragon nosecone tip
  /*48 */ [ 0.024,  0,      0    ],
  // Grid fins — 4 fins × 4 verts (v49-v64), straddling Ring 2 at x=+0.004
  /*49 */ [ 0.002,  0,      _rf9 ], /*50 */ [ 0.005,  0,      _rf9 ],  // Fin A (z+)
  /*51 */ [ 0.005,  0,      _gfS ], /*52 */ [ 0.002,  0,      _gfS ],
  /*53 */ [ 0.002,  _rf9,   0    ], /*54 */ [ 0.005,  _rf9,   0    ],  // Fin B (y+)
  /*55 */ [ 0.005,  _gfS,   0    ], /*56 */ [ 0.002,  _gfS,   0    ],
  /*57 */ [ 0.002,  0,     -_rf9 ], /*58 */ [ 0.005,  0,     -_rf9 ],  // Fin C (z-)
  /*59 */ [ 0.005,  0,     -_gfS ], /*60 */ [ 0.002,  0,     -_gfS ],
  /*61 */ [ 0.002, -_rf9,   0    ], /*62 */ [ 0.005, -_rf9,   0    ],  // Fin D (y-)
  /*63 */ [ 0.005, -_gfS,   0    ], /*64 */ [ 0.002, -_gfS,   0    ],
  // Engine nozzle exits — octaweb (x=-0.018)
  /*65 */ [-0.018,  0,      0         ],  // centre Merlin
  /*66 */ [-0.018,  0,      _nzO      ],  // outer 0°
  /*67 */ [-0.018,  _nzO7,  _nzO7     ],  // outer 45°
  /*68 */ [-0.018,  _nzO,   0         ],  // outer 90°
  /*69 */ [-0.018,  _nzO7, -_nzO7     ],  // outer 135°
  /*70 */ [-0.018,  0,     -_nzO      ],  // outer 180°
  /*71 */ [-0.018, -_nzO7, -_nzO7     ],  // outer 225°
  /*72 */ [-0.018, -_nzO,   0         ],  // outer 270°
  /*73 */ [-0.018, -_nzO7,  _nzO7     ],  // outer 315°
  // S2 Merlin Vacuum nozzle bell — skirt at S2 base (x=+0.006), exit (x=+0.004)
  /*74 */ [ 0.006,  0,       _nzSk  ], /*75 */ [ 0.006,  _nzSk7,  _nzSk7 ],
  /*76 */ [ 0.006,  _nzSk,   0      ], /*77 */ [ 0.006,  _nzSk7, -_nzSk7 ],
  /*78 */ [ 0.006,  0,      -_nzSk  ], /*79 */ [ 0.006, -_nzSk7, -_nzSk7 ],
  /*80 */ [ 0.006, -_nzSk,   0      ], /*81 */ [ 0.006, -_nzSk7,  _nzSk7 ],
  /*82 */ [ 0.004,  0,       _nzVac ], /*83 */ [ 0.004,  _nzVac7, _nzVac7 ],
  /*84 */ [ 0.004,  _nzVac,  0      ], /*85 */ [ 0.004,  _nzVac7,-_nzVac7 ],
  /*86 */ [ 0.004,  0,      -_nzVac ], /*87 */ [ 0.004, -_nzVac7,-_nzVac7 ],
  /*88 */ [ 0.004, -_nzVac,  0      ], /*89 */ [ 0.004, -_nzVac7, _nzVac7 ],
  /*90 */ [ 0.003,  0,       0      ],  // nozzle exit centre (glow reference)
];

const _F_f9 = [
  // Stage 1 aft → mid
  [0,1,9,8],[1,2,10,9],[2,3,11,10],[3,4,12,11],
  [4,5,13,12],[5,6,14,13],[6,7,15,14],[7,0,8,15],
  // Stage 1 mid → top
  [8,9,17,16],[9,10,18,17],[10,11,19,18],[11,12,20,19],
  [12,13,21,20],[13,14,22,21],[14,15,23,22],[15,8,16,23],
  // Interstage taper
  [16,17,25,24],[17,18,26,25],[18,19,27,26],[19,20,28,27],
  [20,21,29,28],[21,22,30,29],[22,23,31,30],[23,16,24,31],
  // Stage 2
  [24,25,33,32],[25,26,34,33],[26,27,35,34],[27,28,36,35],
  [28,29,37,36],[29,30,38,37],[30,31,39,38],[31,24,32,39],
  // Dragon cone base
  [32,33,41,40],[33,34,42,41],[34,35,43,42],[35,36,44,43],
  [36,37,45,44],[37,38,46,45],[38,39,47,46],[39,32,40,47],
  // Dragon nosecone
  [48,41,40],[48,42,41],[48,43,42],[48,44,43],
  [48,45,44],[48,46,45],[48,47,46],[48,40,47],
  // Grid fins — both sides each
  [49,50,51,52],[52,51,50,49],
  [53,54,55,56],[56,55,54,53],
  [57,58,59,60],[60,59,58,57],
  [61,62,63,64],[64,63,62,61],
  // S2 Merlin Vacuum nozzle bell (skirt → exit, 8 quads)
  [74,75,83,82],[75,76,84,83],[76,77,85,84],[77,78,86,85],
  [78,79,87,86],[79,80,88,87],[80,81,89,88],[81,74,82,89],
  // S2 nozzle exit cap — AFT-facing (visible from chase cam)
  [90,82,83],[90,83,84],[90,84,85],[90,85,86],
  [90,86,87],[90,87,88],[90,88,89],[90,89,82],
];

const _FN_f9 = _F_f9.map(fi => {
  const a = _V_f9[fi[0]], b = _V_f9[fi[1]], c = _V_f9[fi[2]];
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n  = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
  const len = Math.hypot(...n);
  return len > 1e-10 ? n.map(x => x/len) : [0,0,1];
});

const _FC_f9 = [
  0,0,0,0,0,0,0,0,  // S1 body (Ring0→Ring1)
  2,2,2,2,2,2,2,2,  // interstage lower (Ring1→Ring2)
  2,2,2,2,2,2,2,2,  // interstage taper (Ring2→Ring3)
  1,1,1,1,1,1,1,1,  // S2
  5,5,5,5,5,5,5,5,  // Trunk (Ring4→Ring5)
  3,3,3,3,3,3,3,3,  // Dragon nosecone (Ring5→tip)
  4,4,4,4,4,4,4,4,  // grid fins
  4,4,4,4,4,4,4,4,  // S2 MVac nozzle bell
  4,4,4,4,4,4,4,4,  // S2 MVac exit cap
];

const _E_f9 = [
  // Body rings
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],
  [8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,8],
  [16,17],[17,18],[18,19],[19,20],[20,21],[21,22],[22,23],[23,16],
  [24,25],[25,26],[26,27],[27,28],[28,29],[29,30],[30,31],[31,24],
  [32,33],[33,34],[34,35],[35,36],[36,37],[37,38],[38,39],[39,32],
  [40,41],[41,42],[42,43],[43,44],[44,45],[45,46],[46,47],[47,40],
  // Longerons (4 lines through all rings + nose)
  [0,8],[8,16],[16,24],[24,32],[32,40],[40,48],
  [2,10],[10,18],[18,26],[26,34],[34,42],[42,48],
  [4,12],[12,20],[20,28],[28,36],[36,44],[44,48],
  [6,14],[14,22],[22,30],[30,38],[38,46],[46,48],
  // Grid fin outlines
  [49,52],[52,51],[51,50],  // Fin A outer
  [53,56],[56,55],[55,54],  // Fin B outer
  [57,60],[60,59],[59,58],  // Fin C outer
  [61,64],[64,63],[63,62],  // Fin D outer
  // Engine ring at aft base
  [66,67],[67,68],[68,69],[69,70],[70,71],[71,72],[72,73],[73,66],
  // Thrust structure — Ring 0 → outer nozzle ring (4 longerons)
  [0,66],[2,68],[4,70],[6,72],
  // S2 MVac nozzle skirt ring
  [74,75],[75,76],[76,77],[77,78],[78,79],[79,80],[80,81],[81,74],
  // S2 MVac nozzle exit ring
  [82,83],[83,84],[84,85],[85,86],[86,87],[87,88],[88,89],[89,82],
  // S2 MVac bell longerons
  [74,82],[76,84],[78,86],[80,88],
];

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
function _drawWireframe(canvas, acPitchDeg, acRollDeg, camBack, camUp, camSide, wingView = false) {
  const isC172  = (S.aircraft?.id === 'c172');
  const isF9    = !isC172 && (S.aircraft?.id?.startsWith('falcon9') || S.aircraft?.vehicleType === 'rocket');
  const isBf109 = !isC172 && !isF9 && (S.aircraft?.id === 'bf109');
  const V_   = isC172 ? _V_c172      : isF9 ? _V_f9      : isBf109 ? _V_b109      : _V;
  const F_   = isC172 ? _F_c172      : isF9 ? _F_f9      : isBf109 ? _F_b109      : _F;
  const FC_  = isC172 ? _FC_c172     : isF9 ? _FC_f9     : isBf109 ? _FC_b109     : _FC;
  const FN_  = isC172 ? _FN_c172     : isF9 ? _FN_f9     : isBf109 ? _FN_b109     : _FN;
  const E_   = isC172 ? _E_c172      : isF9 ? _E_f9      : isBf109 ? _E_b109      : _E;
  const COL_ = isC172 ? _COLORS_c172 : isF9 ? _COLORS_f9 : isBf109 ? _COLORS_b109 : _COLORS;
  const GV_  = isC172 ? _GV_c172     : isBf109 ? _GV_b109 : _GV;

  const P = acPitchDeg * DEG, R = acRollDeg * DEG;
  const cosP = Math.cos(P), sinP = Math.sin(P);
  const cosR = Math.cos(R), sinR = Math.sin(R);

  const W = canvas.width, H = canvas.height;
  const ctx   = canvas.getContext('2d');
  const cx    = W / 2, cy = H / 2;
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG);

  const camDist  = camSide > 0 ? camSide : camBack;
  const camPitch = Math.atan2(-camUp, camDist);
  const cosCP = Math.cos(camPitch), sinCP = Math.sin(camPitch);

  /* Project body-frame vertex → { x, y, d } (d = cam fwd depth for sorting) */
  function project([vF, vR, vU]) {
    const fP =  vF * cosP - vU * sinP;
    const uP =  vF * sinP + vU * cosP;
    const rR =  vR * cosR + uP * sinR;
    const uR = -vR * sinR + uP * cosR;
    const fR =  fP;

    let cfW, crW, cuW;
    if (camSide > 0) {
      cfW = camSide - rR; crW = fR;
    } else {
      cfW = camBack + fR; crW = rR;
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
        for (const vi of [43, 68, 47, 70])
          verts[vi] = [_V_c172[vi][0]+dX, _V_c172[vi][1], _V_c172[vi][2]+dZ];
      }
      if (Math.abs(ailCmd) > 0.02) {
        const aa = ailCmd * 18 * DEG;  // max ±18° aileron
        const ac = 0.002;
        const dZ = Math.sin(aa) * ac;
        // R aileron: down when rolling right (ailCmd > 0 → right bank commanded)
        verts[68] = [verts[68][0], verts[68][1], verts[68][2] - dZ];
        verts[45] = [_V_c172[45][0], _V_c172[45][1], _V_c172[45][2] - dZ];
        // L aileron: up when rolling right
        verts[70] = [verts[70][0], verts[70][1], verts[70][2] + dZ];
        verts[49] = [_V_c172[49][0], _V_c172[49][1], _V_c172[49][2] + dZ];
      }
    }
  } else if ((S.flaps ?? 0) > 0) {
    verts = _V.map(v => v.slice());
    const fa  = (S.flaps ?? 0) * 15 * DEG;
    const fc  = 0.0025;
    const dX  = -(1 - Math.cos(fa)) * fc;
    const dZ  = -Math.sin(fa) * fc;
    verts[99]  = [_V[99][0]+dX,  _V[99][1],  _V[99][2]+dZ];
    verts[103] = [_V[103][0]+dX, _V[103][1], _V[103][2]+dZ];
  }
  if (isF9) {
    /* Grid fin fold: deploy during S1 coast (descent), stow during powered ascent */
    const finTarget = (S.rocketCoast ?? false) ? Math.PI / 2 : 0;
    _finAngle += (finTarget - _finAngle) * 0.025;  // ~2-3 s deployment
    const arm = _gfS - _rf9;
    const sa = Math.sin(_finAngle), ca = Math.cos(_finAngle);
    if (verts === V_) verts = _V_f9.map(v => v.slice());
    /* Fin A (z+): outer verts 51, 52 */
    verts[51] = [0.005 - arm*ca, 0,             _rf9 + arm*sa];
    verts[52] = [0.002 - arm*ca, 0,             _rf9 + arm*sa];
    /* Fin B (y+): outer verts 55, 56 */
    verts[55] = [0.005 - arm*ca,  _rf9 + arm*sa, 0            ];
    verts[56] = [0.002 - arm*ca,  _rf9 + arm*sa, 0            ];
    /* Fin C (z-): outer verts 59, 60 */
    verts[59] = [0.005 - arm*ca, 0,            -_rf9 - arm*sa ];
    verts[60] = [0.002 - arm*ca, 0,            -_rf9 - arm*sa ];
    /* Fin D (y-): outer verts 63, 64 */
    verts[63] = [0.005 - arm*ca, -_rf9 - arm*sa, 0            ];
    verts[64] = [0.002 - arm*ca, -_rf9 - arm*sa, 0            ];
  }
  const pts = verts.map(project);

  /* Ground shadow — visible below ~500 ft AGL, fades with altitude */
  const alt_nm = (S.alt ?? 0) * FT_NM;
  if (alt_nm < 0.082) {
    const slopeX = _LD[0] / _LD[2];
    const slopeY = _LD[1] / _LD[2];
    const silVI  = isC172
      ? [0, 44, 45, 41, 49, 48]                   // C172: nose, R tip, tail, L tip
      : isF9
      ? [48, 52, 0, 4, 60]                         // F9: nose, fin dorsal, aft top/bot, fin ventral
      : isBf109
      ? [0, 52, 53, 49, 57, 56]                    // Bf109: spinner, R tip LE/TE, tail, L tip TE/LE
      : [0, 100, 101, 97, 105, 104];               // A350: nose, R wing tip, tail, L wing tip
    const shadowPts = silVI.map(vi => {
      const [px, py, pz] = verts[vi];
      const sx = px - slopeX * (pz + alt_nm);
      const sy = py - slopeY * (pz + alt_nm);
      return project([sx, sy, -alt_nm]);
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

  /* Booster projection (F9 stage separation) */
  const rStage = isF9 ? (S.rocketStage ?? 1) : 0;
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

  /* Build shaded face list with average depth */
  const faces = F_.map((fi, i) => {
    /* F9 stage sep: main vehicle = S2 + Dragon + MVac nozzle (faces 24-47 + 56-71) */
    if (isF9 && rStage >= 2 && (i < 24 || (i > 47 && i < 56))) return null;

    const ps = fi.map(vi => pts[vi]);
    if (ps.some(p => !p)) return null;

    /* Wing view: skip fuselage, only render wings + control surfaces */
    if (wingView && FC_[i] !== 1) return null;

    /* Back-face culling: positive cross = front-facing in our projection */
    const p0 = ps[0], p1 = ps[1], p2 = ps[2];
    const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    if (cross < 0) return null;

    const [nF, nR, nU] = rotateNormal(FN_[i]);
    const dot  = Math.max(0, nF * _LD[0] + nR * _LD[1] + nU * _LD[2]);
    const amb  = (isF9 && FC_[i] === 4) ? 0.55 : 0.18;  // grid fins need visible ambient
    const br   = amb + (1 - amb) * dot;
    const avgD = ps.reduce((s, p) => s + p.d, 0) / ps.length;

    return { ps, br, avgD, col: COL_[FC_[i]] };
  }).filter(Boolean);

  /* Booster faces — Stage 1 body + grid fins */
  if (bPts) {
    const s1Idx = [...Array.from({length:24},(_,k)=>k), ...Array.from({length:8},(_,k)=>48+k)];
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
      const dot = Math.max(0, wF*_LD[0]+wR*_LD[1]+wU*_LD[2]);
      const amb = (_FC_f9[i] === 4) ? 0.55 : 0.18;
      const br  = amb+(1-amb)*dot;
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
    if (pts[18]) _vCloud(pts[18].x, pts[18].y, 10, 1.7, 32, 26, '212,228,255', 0.65);
    if (pts[22]) _vCloud(pts[22].x, pts[22].y,  8, 2.0, 24, 20, '212,228,255', 0.50);

    /* S1 tank body wisps — cryo boil-off from Ring 1 and Ring 0 */
    for (const vi of [8, 9, 10, 14, 15, 0, 2, 6]) {
      if (!pts[vi]) continue;
      _vCloud(pts[vi].x, pts[vi].y, 4, 2.6 + vi * 0.13, 11, 11, '222,235,255', 0.24);
    }

    /* S2 LOX vent — from Ring 4 (top of S2 body, Dragon base level) */
    if (pts[34]) _vCloud(pts[34].x, pts[34].y, 7, 2.2, 20, 18, '208,226,255', 0.50);
    if (pts[38]) _vCloud(pts[38].x, pts[38].y, 5, 2.5, 15, 14, '208,226,255', 0.38);

    /* S2 body wisps */
    for (const vi of [24, 26, 30]) {
      if (!pts[vi]) continue;
      _vCloud(pts[vi].x, pts[vi].y, 3, 3.1 + vi * 0.05, 8, 9, '218,232,255', 0.20);
    }

    ctx.restore();
  }

  /* Engine plumes — drawn before faces so body renders on top.
     S1: active until MECO.  S2: active after coast, until SECO. */
  const t0 = S.aircraft?.ignitionTime ?? 0;
  const pastIgnition = (S.time ?? 0) >= t0;

  function _drawPlume(pN, pEdge, plumeOriginVec, plumeLen, widthScale) {
    const plumeEnd = project(plumeOriginVec.map((v, i) => i === 0 ? v - plumeLen : v));
    if (!pN || !plumeEnd) return;
    const dx = plumeEnd.x - pN.x, dy = plumeEnd.y - pN.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const px = -dy / len, py = dx / len;
    const nozR = pEdge
      ? Math.hypot(pEdge.x - pN.x, pEdge.y - pN.y) * widthScale
      : 9 * devicePixelRatio;
    ctx.save();
    const grad = ctx.createLinearGradient(pN.x, pN.y, plumeEnd.x, plumeEnd.y);
    grad.addColorStop(0,    'rgba(255,240,160,0.80)');
    grad.addColorStop(0.08, 'rgba(255,165, 60,0.65)');
    grad.addColorStop(0.25, 'rgba(210, 80, 18,0.38)');
    grad.addColorStop(0.55, 'rgba(130, 28,  5,0.15)');
    grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    ctx.fillStyle = grad;
    const mx = (pN.x + plumeEnd.x) / 2, my = (pN.y + plumeEnd.y) / 2;
    ctx.beginPath();
    ctx.moveTo(pN.x + px * nozR, pN.y + py * nozR);
    ctx.quadraticCurveTo(mx + px * nozR * 2.2, my + py * nozR * 2.2,
                         plumeEnd.x + px * nozR * 3.8, plumeEnd.y + py * nozR * 3.8);
    ctx.lineTo(plumeEnd.x - px * nozR * 3.8, plumeEnd.y - py * nozR * 3.8);
    ctx.quadraticCurveTo(mx - px * nozR * 2.2, my - py * nozR * 2.2,
                         pN.x - px * nozR, pN.y - py * nozR);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  if (isF9) {
    /* S1 plume: ignition → MECO */
    if (pastIgnition && rStage < 2 && !S.rocketCoast && !S.rocketMECO)
      _drawPlume(pts[65], pts[66], [-0.018, 0, 0], 0.030, 2.8);

    /* S2 plume: coast ends → SECO */
    if (rStage >= 2 && !S.rocketCoast && !S.rocketSECO)
      _drawPlume(pts[90], pts[82], [0.003, 0, 0], 0.032, 3.2);
  }

  /* Painter's algorithm: farthest first */
  faces.sort((a, b) => b.avgD - a.avgD);

  /* Fill shaded faces */
  for (const { ps, br, col } of faces) {
    const ri = Math.round(col[0] * br);
    const gi = Math.round(col[1] * br);
    const bi = Math.round(col[2] * br);
    ctx.fillStyle = `rgb(${ri},${gi},${bi})`;
    ctx.beginPath();
    ctx.moveTo(ps[0].x, ps[0].y);
    for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
    ctx.closePath();
    ctx.fill();
  }

  /* Swiss cross on V-stab — A350 only */
  if (!isC172 && !isF9 && !isBf109) _drawSwissCross(ctx, pts[106], pts[107], pts[109], pts[108]);

  /* Prop disk — C172 and Bf109 */
  if (isC172 || isBf109) {
    const p0    = pts[0];
    const pProp = isBf109 ? pts[70] : pts[66];
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
    const pNvac  = pts[90];
    const pEvac  = pts[82];
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
    const nozzleVerts = [65,66,67,68,69,70,71,72,73];
    const pC = pts[65];
    const pEdge = pts[66];
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
  if (!isC172 && !isF9) {
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

  /* Wireframe edges on top */
  ctx.save();
  ctx.strokeStyle = 'rgba(175,195,215,0.65)';
  ctx.lineWidth   = Math.max(1, devicePixelRatio);
  ctx.beginPath();
  for (const [a, b] of E_) {
    /* F9 stage sep: main vehicle = S2+Dragon (v24-v48) + MVac nozzle (v74-v90) */
    if (isF9 && rStage >= 2) {
      const inMain = v => (v >= 24 && v <= 48) || (v >= 74 && v <= 90);
      if (!inMain(a) || !inMain(b)) continue;
    }
    const pa = pts[a], pb = pts[b];
    if (!pa || !pb) continue;
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
      const inB = v => v <= 23 || (v >= 49 && v <= 73);
      if (!inB(a) || !inB(b)) continue;
      const pa = bPts[a], pb = bPts[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke(); ctx.restore();

    /* Booster plume when powered (boostback / entry burn / landing burn) */
    const boosterFiring = ['boostback','entry','landing'].includes(S.booster?.phase);
    if (boosterFiring) {
      const bpN = bPts[65];
      const bpEdge = bPts[66];
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

    const bC = bPts[65], bEdge = bPts[66];
    if (bC && bEdge) {
      const nR = Math.hypot(bEdge.x-bC.x, bEdge.y-bC.y) * 0.46;
      ctx.save();
      ctx.fillStyle = 'rgba(20,22,28,0.95)';
      ctx.beginPath();
      ctx.arc(bC.x, bC.y, Math.hypot(bEdge.x-bC.x, bEdge.y-bC.y) + nR*1.2, 0, Math.PI*2);
      ctx.fill();
      for (const vi of [65,66,67,68,69,70,71,72,73]) {
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
  if (!isF9 && (isC172 || isBf109 || S.gear)) {
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
  const cx = W / 2, cy = H / 2;
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
