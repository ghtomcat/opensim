/* OpenSim — display/outside-space.js
   Saturn V, Lunar Module, and Falcon 9 geometry; auto-director state. */
import { buildTube, computeFaceNormals } from './outside-shared.js';

/* ══════════════════════════════════════════════════════════════
   Saturn V geometry — Apollo-era launch vehicle (Step 1: body)
   Body frame: fwd = nose (+x), right = starboard, up = +z
   Units: NM. Origin ≈ centre of mass.
   ══════════════════════════════════════════════════════════════ */

export const _sv1r  = 0.0028;  // S-IC / S-II radius (10.1 m dia)
export const _sv3r  = 0.0018;  // S-IVB radius (6.6 m dia)
export const _svcr  = 0.0011;  // CSM radius (3.9 m dia)
export const _svcr2 = _svcr * 0.55;   // CM nose radius
export const _svFS  = 0.0026;  // stabilizer fin radial span (~4.8 m)
export const _svLT  = _svcr2 * 0.70;  // LES tower mid-ring radius (tapered)

export const _COLORS_sv = [
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
export const { V_: _V_sv, F_: _F_sv, FC_: _FC_sv, E_: _E_sv } = (() => {
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
export const _FN_sv = computeFaceNormals(_V_sv, _F_sv);

/* ══════════════════════════════════════════════════════════════
   Apollo LM geometry — basic first pass
   Docked config: aft face at CM docking port (vF = 0.030 in SV frame).
   +vF points away from CSM; descent stage is at maximum vF.
   ══════════════════════════════════════════════════════════════ */
export const _lmO  = 0.0300;   // CM top / LM docking port in SV frame
export const _lmAR = 0.00095;  // ascent stage body radius   (wider: 1.76 m)
export const _lmAH = 0.00152;  // ascent stage height        (2.81 m)
export const _lmDR = 0.00120;  // descent stage body radius  (2.22 m)
export const _lmDH = 0.00092;  // descent stage height       (1.70 m)
export const _lmLR = 0.00254;  // landing leg footpad radius (4.70 m)
export const _lmNR = 0.00052;  // descent engine nozzle exit radius (wider bell)
export const _lmNH = 0.00042;  // descent engine nozzle protrusion

export const _COLORS_lm = [
  [200, 178,  80],  // 0 gold Mylar — descent stage
  [215, 212, 200],  // 1 aluminized Mylar — ascent stage
  [ 72,  70,  65],  // 2 dark thermal blanket — DS base cap
  [ 48,  48,  52],  // 3 engine dark
  [ 20,  26,  38],  // 4 window glass
];

export const { V_: _V_lm, F_: _F_lm, FC_: _FC_lm, E_: _E_lm } = (() => {
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
export const _FN_lm = computeFaceNormals(_V_lm, _F_lm);

/* Stage separation tumble animations — module state */
export const _svSepAnims = [];   // [{ stage, t0 }]

/* ── Auto-director ─────────────────────────────────────────────────
   Triggers cinematic camera cuts on key mission events.
   Each shot blends camSide (zoom) and a vertical look-at offset (cy shift)
   smoothly in/out, then returns control to the normal auto-fit camera.   */
export const _dir = { shot: null, t0: 0, _tliWas: false };

export const _DIR_SHOTS = {
  //              zoom   lookAtF   orbitAz  dur    easeIn easeOut
  sic_sep: { zoom: 0.44, lF: -0.018, orbitAz:   0, dur: 5200, eIn:  380, eOut:  750 },
  sii_sep: { zoom: 0.52, lF:  0.002, orbitAz:   0, dur: 4500, eIn:  380, eOut:  650 },
  tli:     { zoom: 1.55, lF:  0.014, orbitAz:   0, dur: 8000, eIn: 1000, eOut: 1500 },
};

export function _dirBlend() {
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

export const _rf9  = 0.0020;          // body radius (≈ 3.7 m / 1852)
export const _gfS  = 0.0048;          // grid fin outer half-span from CL
export const _nzO  = 0.00140;         // outer engine ring radius (octaweb) — ~0.70·R, near the body edge like the real F9
export const _nzO7 = _nzO * 0.7071;
export const _nzVac  = 0.00148;       // S2 Merlin Vacuum nozzle exit radius
export const _nzVac7 = _nzVac * 0.7071;
export const _nzSk   = 0.00062;       // S2 nozzle skirt (throat) radius
export const _nzSk7  = _nzSk  * 0.7071;

export const _COLORS_f9 = [
  [252, 252, 254],  // 0 Stage 1  — bright white
  [248, 250, 254],  // 1 Stage 2  — slightly cooler white
  [ 18,  20,  26],  // 2 Interstage — near-black (carbon lattice)
  [246, 247, 252],  // 3 Dragon capsule — warm white
  [ 60,  66,  78],  // 4 Grid fins — titanium
  [ 40,  44,  56],  // 5 Solar panels — dark blue (Crew Dragon trunk array)
];

/* buildTube: 16-sided, 6 rings → rb=[0,16,32,48,64,80]; Dragon tip at v96; extras 97+ */
export const { V_: _V_f9, F_: _F_f9, FC_: _FC_f9, E_: _E_f9 } = (() => {
  const N = 16;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF: -0.016, r: _rf9,       col: 2 },  // Ring 0: S1 aft — black engine/base band (narrow)
    { vF: -0.014, r: _rf9,       col: 0 },  // Ring 1: S1 body — white (the bulk)
    { vF:  0.003, r: _rf9,       col: 2 },  // Ring 2: interstage — black (belongs to S1, top of S1)
    { vF:  0.006, r: _rf9,       col: 1 },  // Ring 3: S2 base — white (full Ø; F9 is constant 3.7 m)
    { vF:  0.014, r: _rf9,       col: 1 },  // Ring 4: Trunk — white body (Crew Dragon)
    { vF:  0.020, r: _rf9               },  // Ring 5: Trunk/Dragon base (terminal)
  ]);
  // rb: [0,16,32,48,64,80]; Dragon tip=96; extras=97+

  /* Trunk: white body with a dark solar-panel array on one side (Crew Dragon). The trunk band
     is the ri=4 faces (one per side, index 4·N+si); recolour a ~120° arc dark. */
  for (const si of [5, 6, 7, 8, 9, 10]) FC_[4 * N + si] = 5;

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
export const _FN_f9 = computeFaceNormals(_V_f9, _F_f9);
