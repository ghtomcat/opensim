/* OpenSim — display/outside-f4u.js
   Vought F4U Corsair geometry. */
import { buildTube, buildWingSurface, computeFaceNormals, animHinge } from './outside-shared.js';

const DEG = Math.PI / 180;

export const _f4uCowlR = 0.00220;  // R-2800 radial cowl radius
export const _f4uFRy   = 0.00130;  // body half-width
export const _f4uFRz   = 0.00145;  // body half-height
export const _f4uARy   = 0.00080;  // aft half-width
export const _f4uARz   = 0.00100;  // aft half-height
export const _f4uTRy   = 0.00040;  // tail half-width
export const _f4uTRz   = 0.00055;  // tail half-height
export const _f4uHS    = 0.01580;  // half-span
export const _f4uVH    = 0.00350;  // V-stab height
export const _f4uHW    = 0.00460;  // H-stab half-span
export const _f4uPropR = 0.00520;  // prop disk radius ref
export const _f4uSpb   = 0.00050;  // spinner base radius
export const _f4uCzH   = 0.00080;  // canopy height
export const _f4uCyW   = 0.00075;  // canopy half-width

export const _COLORS_f4u = [
  [110, 130, 148],  // 0 fuselage — USN Non-specular Blue Gray
  [110, 130, 148],  // 1 wings
  [ 68,  78,  92],  // 2 cowl ring
  [110, 130, 148],  // 3 tail surfaces
  [ 42,  68, 100],  // 4 canopy glass
];

/* buildTube: 16-sided, 6 rings A-F → rb=[0,16,32,48,64,80], noseTip=96, tailTip=97, extra=98+ */
export const { V_: _V_f4u, F_: _F_f4u, FC_: _FC_f4u, E_: _E_f4u, anim: _anim_f4u } = (() => {
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
export const _FN_f4u = computeFaceNormals(_V_f4u, _F_f4u);

export const _GV_f4u = [
  /* 0 */ [ 0.001,  +0.0016, -0.0020 ],  // R main strut top
  /* 1 */ [ 0.001,  +0.0050, -0.0038 ],  // R main wheel center (wide track — gull wing)
  /* 2 */ [ 0.001,  -0.0016, -0.0020 ],  // L main strut top
  /* 3 */ [ 0.001,  -0.0050, -0.0038 ],  // L main wheel center
  /* 4 */ [-0.012,   0,      -0.0008 ],  // tail wheel strut top
  /* 5 */ [-0.012,   0,      -0.0015 ],  // tail wheel center
];

/* Animate control surfaces (flaps/ailerons/elevator/rudder). Returns a clone. */
export function animSurfaces_f4u({ flapCfg, ailCmd, elevCmd, rudCmd }) {
  const verts = _V_f4u.map(v => v.slice());
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
  return verts;
}

/* Prop-disk anchors: hub (spin centre = noseTip) + tip (radius reference). */
export const _PROP_f4u = { hub: 96, tip: 126 };
