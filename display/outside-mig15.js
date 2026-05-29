/* OpenSim — display/outside-mig15.js
   Mikoyan-Gurevich MiG-15 'Fagot' geometry.

   Scale: ~0.00278 units/m, same as Bf 109 / F4U.
   Vertex layout (tube rings 0-95, then non-tube):
     96  noseTip (intake centerbody)    97  tailTip (exhaust center)
     98-141 wing (buildWingSurface × 44 verts, wingOfs=98)
     142 vstab base LE   143 vstab base TE
     144 vstab tip LE    145 vstab tip TE
     146 vstab base hinge 147 vstab tip hinge
     148-151 R h-stab lower LE/TE root/tip
     152-155 R h-stab upper LE/TE root/tip
     156-159 R elev hinge lower/upper root/tip
     160-171 L h-stab (mirror of R)
     172-179 canopy (windscreen base L/R, top R/L, crown L/R, aft R/L)     */

import { buildTube, buildWingSurface, computeFaceNormals, animHinge } from './outside-shared.js';

const DEG = Math.PI / 180;

export const _m15r   = 0.0021;   // max fuselage radius
export const _m15ir  = 0.0019;   // intake lip radius
export const _m15er  = 0.0009;   // exhaust nozzle radius
export const _m15hs  = 0.0140;   // wing half-span
export const _m15dh  = 0.0015;   // wing dihedral rise at tip
export const _m15cH  = 0.0012;   // canopy height above fuselage top
export const _m15cW  = 0.0008;   // canopy half-width

export const _COLORS_mig15 = [
  [208, 210, 205],  // 0 fuselage — bare metal silver
  [192, 196, 190],  // 1 wings
  [ 20,  25,  30],  // 2 intake / exhaust interior
  [192, 196, 190],  // 3 tail surfaces
  [ 22,  38,  58],  // 4 canopy glass
  [190,  28,  28],  // 5 intake lip ring — Soviet red
];

export const { V_: _V_mig15, F_: _F_mig15, FC_: _FC_mig15, E_: _E_mig15, anim: _anim_mig15 } = (() => {
  const N = 16;

  /* Tube rings — rb[0]=0  [1]=16  [2]=32  [3]=48  [4]=64  [5]=80 */
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF:  0.013, r: _m15ir,         col: 5 },  // A intake lip → B (red band)
    { vF:  0.009, r: _m15r,          col: 0 },  // B body fwd → C
    { vF:  0.001, r: _m15r * 1.05,   col: 0 },  // C wing station → D (slight bulge)
    { vF: -0.005, r: _m15r * 0.90,   col: 0 },  // D aft body → E
    { vF: -0.010, r: _m15r * 0.62,   col: 0 },  // E tail pipe → F
    { vF: -0.013, r: _m15er,                 },  // F exhaust (terminal)
  ]);

  const noseTip  = V_.length;  V_.push([0.015,  0, 0]);   // 96 centerbody tip
  const tailTip  = V_.length;  V_.push([-0.015, 0, 0]);   // 97 exhaust centre

  /* Intake centerbody cap */
  for (let si = 0; si < N; si++) { F_.push([noseTip, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(2); }
  /* Exhaust cap */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[5]+si, rb[5]+(si+1)%N]); FC_.push(2); }

  /* ── Wing ────────────────────────────────────────────────────────── */
  const wRY   = _m15r * 0.707;           // root span station — 45° on fuselage
  const wRZ   = -_m15r * 0.40;           // root z — mid-wing mount
  const wBY   = 0.0084;                  // break span station (55% exposed)
  const wBZ   = wRZ + (wBY - wRY) / (_m15hs - wRY) * _m15dh * 0.55;
  const wTZ   = wRZ + _m15dh;            // tip z (dihedral)
  const wingOfs = V_.length;             // 98

  const wing = buildWingSurface({
    root: { y: wRY,    z: wRZ,  LE:  0.003,  TE: -0.0037, thick: 0.00085 },
    brk:  { y: wBY,    z: wBZ,  LE: -0.0018, TE: -0.0060, thick: 0.00052 },
    tip:  { y: _m15hs, z: wTZ,  LE: -0.0058, TE: -0.0080, thick: 0.00018 },
    flapHinge: 0.65,
    ailHinge:  0.65,
    color: 1,
  });
  V_.push(...wing.verts);
  F_.push(...wing.faces.map(fi => fi.map(vi => vi + wingOfs)));
  FC_.push(...wing.faceColors);
  E_.push(...wing.edges.map(([a, b]) => [a + wingOfs, b + wingOfs]));

  /* ── V-stab + rudder (142-147) ───────────────────────────────────── */
  const ruH  = 0.55;
  const ruBx = -0.006 + ruH * (-0.013 - (-0.006));   // -0.009850
  const ruTx = -0.010 + ruH * (-0.013 - (-0.010));   // -0.011650
  const r_ru = Math.abs(-0.013 - (ruBx + ruTx) * 0.5);

  V_.push(
    [-0.006,  0,  0.0021],   // 142 vstab base LE
    [-0.013,  0,  0.0010],   // 143 vstab base TE
    [-0.010,  0,  0.0109],   // 144 vstab tip LE
    [-0.013,  0,  0.0100],   // 145 vstab tip TE
    [ ruBx,   0,  0.0021],   // 146 vstab base hinge
    [ ruTx,   0,  0.0109],   // 147 vstab tip hinge
  );

  /* ── H-stab + elevator (148-171) ────────────────────────────────── */
  const hRY    = 0.0010, hTY = 0.0055;
  const hstZ   = 0.0054;  // ~43% up V-stab height
  const hst_th = 0.00030, hst_tt = 0.00015;
  const elH    = 0.60;
  const elRx   = -0.009 + elH * (-0.013 - (-0.009));   // -0.01140
  const elTx   = -0.012 + elH * (-0.014 - (-0.012));   // -0.01320
  const r_el   = Math.abs(-0.014 - (elRx + elTx) * 0.5);
  const huh    = 1 - elH * 0.85;

  V_.push(
    // R lower (148-151)
    [-0.009, +hRY, hstZ             ], [-0.013, +hRY, hstZ             ],
    [-0.012, +hTY, hstZ             ], [-0.014, +hTY, hstZ             ],
    // R upper (152-155)
    [-0.009, +hRY, hstZ + hst_th          ], [-0.013, +hRY, hstZ + hst_th * 0.15 ],
    [-0.012, +hTY, hstZ + hst_tt          ], [-0.014, +hTY, hstZ + hst_tt * 0.15 ],
    // R elevator hinge (156-159)
    [elRx,  +hRY, hstZ                    ], [elRx,  +hRY, hstZ + hst_th * huh   ],
    [elTx,  +hTY, hstZ                    ], [elTx,  +hTY, hstZ + hst_tt * huh   ],
    // L lower (160-163)
    [-0.009, -hRY, hstZ             ], [-0.013, -hRY, hstZ             ],
    [-0.012, -hTY, hstZ             ], [-0.014, -hTY, hstZ             ],
    // L upper (164-167)
    [-0.009, -hRY, hstZ + hst_th          ], [-0.013, -hRY, hstZ + hst_th * 0.15 ],
    [-0.012, -hTY, hstZ + hst_tt          ], [-0.014, -hTY, hstZ + hst_tt * 0.15 ],
    // L elevator hinge (168-171)
    [elRx,  -hRY, hstZ                    ], [elRx,  -hRY, hstZ + hst_th * huh   ],
    [elTx,  -hTY, hstZ                    ], [elTx,  -hTY, hstZ + hst_tt * huh   ],
  );

  /* ── Canopy (172-179) — moved forward to match actual MiG-15 cockpit position ── */
  const cT = _m15r;
  V_.push(
    [ 0.007, -_m15cW,       cT                  ],  // 172 windscreen base L
    [ 0.007, +_m15cW,       cT                  ],  // 173 windscreen base R
    [ 0.006, +_m15cW*0.15,  cT+_m15cH*0.12      ],  // 174 windscreen top R
    [ 0.006, -_m15cW*0.15,  cT+_m15cH*0.12      ],  // 175 windscreen top L
    [ 0.002, -_m15cW*0.15,  cT+_m15cH           ],  // 176 crown L
    [ 0.002, +_m15cW*0.15,  cT+_m15cH           ],  // 177 crown R
    [ 0.000, +_m15cW,       cT                  ],  // 178 aft base R
    [ 0.000, -_m15cW,       cT                  ],  // 179 aft base L
  );

  /* ── Non-tube faces ─────────────────────────────────────────────── */
  F_.push(
    // V-stab fixed body (+Y / -Y) — winding verified for correct normals
    [142, 144, 147, 146], [142, 146, 147, 144],
    // Rudder (+Y / -Y)
    [146, 143, 145, 147], [146, 147, 145, 143],
    // R h-stab lower: fixed + elevator
    [148, 156, 158, 150], [156, 149, 151, 158],
    // R h-stab upper: fixed + elevator
    [152, 154, 159, 157], [157, 159, 155, 153],
    // R h-stab tip cap
    [150, 151, 155, 154],
    // L h-stab lower: fixed + elevator
    [160, 162, 170, 168], [168, 170, 163, 161],
    // L h-stab upper: fixed + elevator
    [164, 169, 171, 166], [169, 165, 167, 171],
    // L h-stab tip cap
    [162, 166, 167, 163],
    // Canopy
    [172, 173, 174, 175], [173, 178, 177, 174],
    [172, 175, 176, 179], [175, 174, 177, 176],
    [179, 176, 177, 178],
  );
  FC_.push(
    3,3, 3,3,             // vstab (4)
    3,3, 3,3, 3,          // R h-stab (5)
    3,3, 3,3, 3,          // L h-stab (5)
    4,4, 4,4, 4,          // canopy (5)
  );

  /* ── Longerons: noseTip → rings A–F → tailTip ─────────────────── */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, rb[0]+si]);
    for (let ri = 0; ri < 5; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[5]+si, tailTip]);
  }

  /* ── Non-tube edges ─────────────────────────────────────────────── */
  E_.push(
    // Wing root to fuselage (si=6 → 45° below +Y on ring C/D)
    [rb[2]+6,  wingOfs+0 ], [rb[3]+6,  wingOfs+1 ],
    [rb[2]+10, wingOfs+22], [rb[3]+10, wingOfs+23],
    // V-stab outline + hinge line
    [rb[3]+0, 142], [rb[5]+0, 143],
    [142, 144], [144, 145], [145, 143],
    [142, 146], [146, 143],
    [144, 147], [147, 145],
    [146, 147],
    // R h-stab
    [rb[5]+4, 148],
    [148, 150], [150, 151], [151, 149], [149, 148],
    [152, 154], [154, 155], [155, 153], [153, 152],
    [148, 152], [149, 153], [150, 154], [151, 155],
    [156, 158], [157, 159],
    [156, 157], [158, 159],
    // L h-stab
    [rb[5]+12, 160],
    [160, 162], [162, 163], [163, 161], [161, 160],
    [164, 166], [166, 167], [167, 165], [165, 164],
    [160, 164], [161, 165], [162, 166], [163, 167],
    [168, 170], [169, 171],
    [168, 169], [170, 171],
    // Canopy
    [172, 173], [173, 174], [174, 175], [175, 172],
    [176, 177], [177, 178], [178, 179], [179, 176],
    [174, 177], [175, 176], [172, 179], [173, 178],
  );

  /* Anim — expose global vertex indices for outside.js animation */
  const W = wingOfs;
  return {
    V_, F_, FC_, E_,
    anim: {
      r_fl:     wing.anim.r_fl,
      r_flb:    wing.anim.r_flb,
      r_ail:    wing.anim.r_ail,
      r_ru,
      r_el,
      flapRoot: wing.anim.flapRoot.map(i => i + W),
      flapBrk:  wing.anim.flapBrk.map(i => i + W),
      ailR:     wing.anim.ailR.map(i => i + W),
      ailL:     wing.anim.ailL.map(i => i + W),
      elR:      [149, 151, 153, 155],
      elL:      [161, 163, 165, 167],
      rudTE:    [143, 145],
    },
  };
})();

export const _FN_mig15 = computeFaceNormals(_V_mig15, _F_mig15);

export const _GV_mig15 = [
  [ 0.009,  0.000,  -_m15ir - 0.0008],   // 0 nose strut top
  [ 0.009,  0.000,  -_m15ir - 0.0028],   // 1 nose wheel
  [-0.001, +0.0060, -_m15r  * 0.85  ],   // 2 R main top
  [-0.001, +0.0060, -_m15r  * 0.85 - 0.0032],  // 3 R main wheel
  [-0.001, -0.0060, -_m15r  * 0.85  ],   // 4 L main top
  [-0.001, -0.0060, -_m15r  * 0.85 - 0.0032],  // 5 L main wheel
];
export const _GE_mig15 = [[0,1],[2,3],[4,5]];

/* Animate control surfaces (flaps/ailerons/elevator/rudder). Returns a clone. */
export function animSurfaces_mig15({ flapCfg, ailCmd, elevCmd, rudCmd }) {
  const verts = _V_mig15.map(v => v.slice());
  const { r_fl, r_flb, r_ail, r_el, r_ru, flapRoot, flapBrk, ailR, ailL, elR, elL, rudTE } = _anim_mig15;
  if (flapCfg > 0) {
    animHinge(verts, flapRoot, r_fl,  -(flapCfg * 10 * DEG), 'z', _V_mig15);
    animHinge(verts, flapBrk,  r_flb, -(flapCfg * 10 * DEG), 'z', _V_mig15);
  }
  if (Math.abs(ailCmd) > 0.01) {
    const aa = ailCmd * 25 * DEG;
    animHinge(verts, ailR, r_ail, -aa, 'z', _V_mig15);
    animHinge(verts, ailL, r_ail, +aa, 'z', _V_mig15);
  }
  if (Math.abs(elevCmd) > 0.02)
    animHinge(verts, [...elR, ...elL], r_el, elevCmd * 20 * DEG, 'z', _V_mig15);
  if (Math.abs(rudCmd) > 0.02)
    animHinge(verts, rudTE, r_ru, -(rudCmd * 25 * DEG), 'y', _V_mig15);
  return verts;
}
