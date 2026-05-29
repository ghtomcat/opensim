/* OpenSim — display/outside-b109.js
   Messerschmitt Bf 109 geometry. */
import { buildTube, buildWingSurface, computeFaceNormals, animHinge } from './outside-shared.js';

const DEG = Math.PI / 180;

export const _spb    = 0.00044;  // Bf 109 spinner base radius (tighter — longer pointy spinner)

/* Fuselage cross-sections — ry = half-width, rz = half-height */
export const _bcR  = 0.0016;  // cowl  (near-circular)
export const _bfRy = 0.0011;  // body  half-width  (narrow!)
export const _bfRz = 0.0015;  // body  half-height
export const _baRy = 0.0007;  // aft   half-width
export const _baRz = 0.0011;  // aft   half-height
export const _btRy = 0.0004;  // tail  half-width
export const _btRz = 0.0006;  // tail  half-height
export const _b9hs = 0.0138;   // half-span
export const _b9dh = 0.0002;   // wing dihedral
export const _b9vH = 0.0038;   // V-stab height above fuselage top
export const _b9hw = 0.0045;   // H-stab half-span
export const _b9pr = 0.0042;   // prop disk radius
export const _bCzH = 0.0010;   // canopy height above fuselage top
export const _bCyW = 0.0007;   // canopy half-width

export const _COLORS_b109 = [
  [168, 174, 145],  // 0 fuselage — RLM 74 dark grey-green
  [150, 158, 136],  // 1 wings    — RLM 75 grey-violet
  [ 50,  54,  46],  // 2 cowl     — dark engine cowl
  [168, 174, 145],  // 3 tail surfaces — same as fuselage
  [ 38,  52,  68],  // 4 canopy glass — dark tinted
];

/* buildTube: 16-sided, 6 rings A-F → rb=[0,16,32,48,64,80], noseTip=96, tailTip=97, extra=98+ */
export const { V_: _V_b109, F_: _F_b109, FC_: _FC_b109, E_: _E_b109, anim: _anim_b109 } = (() => {
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
export const _FN_b109 = computeFaceNormals(_V_b109, _F_b109);

export const _GV_b109 = [
  /* 0 */ [ 0.001,  0.0009, -0.0015 ],  // R main top (at fuselage bottom-right)
  /* 1 */ [ 0.001,  0.0016, -0.0037 ],  // R main wheel (narrow track)
  /* 2 */ [ 0.001, -0.0009, -0.0015 ],  // L main top
  /* 3 */ [ 0.001, -0.0016, -0.0037 ],  // L main wheel
  /* 4 */ [-0.012,  0,      -0.0006 ],  // tail strut top
  /* 5 */ [-0.012,  0,      -0.0012 ],  // tail wheel
];

/* Animate control surfaces (flaps/ailerons/elevator/rudder). Returns a clone. */
export function animSurfaces_b109({ flapCfg, ailCmd, elevCmd, rudCmd }) {
  const verts = _V_b109.map(v => v.slice());
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
  return verts;
}

/* Prop-disk anchors: hub (spin centre = noseTip) + tip (radius reference). */
export const _PROP_b109 = { hub: 96, tip: 118 };
