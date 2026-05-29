/* OpenSim — display/outside-c172.js
   Cessna 172 geometry. */
import { buildTube, buildWingSurface, computeFaceNormals, animHinge } from './outside-shared.js';

const DEG = Math.PI / 180;

export const _cr  = 0.0018;   // cowl ring radius
export const _xr  = 0.0021;   // cabin ring radius
export const _abr = 0.0016;   // aft-cabin ring radius
export const _tr  = 0.0009;   // tail-boom ring radius
export const _hs172  = 0.0110;   // C172 half-span
export const _dh172  = 0.0004;   // C172 wing-tip dihedral offset
export const _hst172 = 0.0050;   // C172 h-stab half-span
export const _hst_th = 0.00025;  // h-stab thickness (z)
export const _vst_th = 0.00022;  // v-stab half-thickness (y)
export const _pr172  = 0.0014;   // prop disk radius (for arc rendering)
export const _sp172  = 0.00050;  // C172 spinner base radius (small cone at prop plane)

/* ── C172 wing spec ───────────────────────────────────────────── */
export const _C172_WING = {
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

export const _COLORS_c172 = [
  [240, 240, 240],  // 0 fuselage/tail — white
  [230, 235, 238],  // 1 wings / h-stabs — slightly darker
  [ 85,  90, 100],  // 2 cowl — dark gray
];

/* buildTube: 16-sided, 5 rings → rb=[0,16,32,48,64], noseTip=80, tailTip=81, extra=82+ */
export const { V_: _V_c172, F_: _F_c172, FC_: _FC_c172, E_: _E_c172, anim: _anim_c172 } = (() => {
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
export const _FN_c172 = computeFaceNormals(_V_c172, _F_c172);

/* Light positions in body frame — [fwd, right, up], color [r,g,b], switch key */
export const _LIGHTS_c172 = [
  { pos: [ 0.003,  _hs172,  _xr+_dh172], col: [0,210,80],    key: 'nav'     },  // R wingtip green
  { pos: [ 0.003, -_hs172,  _xr+_dh172], col: [220,40,40],   key: 'nav'     },  // L wingtip red
  { pos: [-0.013,  0,        0.007      ], col: [255,255,255], key: 'nav'     },  // tail white
  { pos: [ 0.000,  0,        _xr+0.001  ], col: [220,50,50],  key: 'beacon'  },  // rotating beacon top
  { pos: [ 0.003,  _hs172,  _xr+_dh172], col: [255,255,255], key: 'strobe'  },  // R strobe
  { pos: [ 0.003, -_hs172,  _xr+_dh172], col: [255,255,255], key: 'strobe'  },  // L strobe
  { pos: [ 0.011,  0,        0          ], col: [255,248,220], key: 'landing' },  // landing light
];

export const _GV_c172 = [
  /* 0 */ [ 0.007,  0,        -_xr        ],  // nose strut top
  /* 1 */ [ 0.007,  0,        -_xr-0.0018 ],  // nose wheel
  /* 2 */ [ 0.000,  0.0014,   -_xr        ],  // R main top
  /* 3 */ [ 0.000,  0.0014,   -_xr-0.0020 ],  // R main wheel
  /* 4 */ [ 0.000, -0.0014,   -_xr        ],  // L main top
  /* 5 */ [ 0.000, -0.0014,   -_xr-0.0020 ],  // L main wheel
];

/* Animate control surfaces for the given command set (flaps/ailerons/
   elevator/rudder). Returns a freshly-cloned vertex array. */
export function animSurfaces_c172({ flapCfg, ailCmd, elevCmd, rudCmd }) {
  const verts = _V_c172.map(v => v.slice());
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
  return verts;
}

/* Prop-disk anchors: hub (spin centre = noseTip) + tip (radius reference). */
export const _PROP_c172 = { hub: 80, tip: 106 };
