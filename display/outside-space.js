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

export const _rf9  = 0.00105;         // body radius: 1.83 m (Ø 3.66 m) at ~1750 m/unit. Was 0.0020,
                                      // which used the *diameter* as a radius → ~1.9× too fat.

/* Falcon 9 Block 5 axial layout — derived from the real segment lengths (m) so the stage
   proportions are correct. Anchored: S1 base at -0.016, Dragon tip at 0.024 (total ≈ 70 m). */
const _F9L = { eng: 4.0, s1: 38.6, is: 6.7, s2: 12.6, trunk: 3.7, dragon: 4.4 };   // sums to 70
const _F9_vf0 = -0.016, _F9_vfTip = 0.024, _F9_tot = 70;
const _f9vf = (m) => _F9_vf0 + (m / _F9_tot) * (_F9_vfTip - _F9_vf0);
export const _f9EngTop   = _f9vf(_F9L.eng);                                              // white S1 start
export const _f9S1Top    = _f9vf(_F9L.eng + _F9L.s1);                                    // interstage base
export const _f9S2Base   = _f9vf(_F9L.eng + _F9L.s1 + _F9L.is);                          // S2 base
export const _f9S2Top    = _f9vf(_F9L.eng + _F9L.s1 + _F9L.is + _F9L.s2);                // trunk base
export const _f9TrunkTop = _f9vf(_F9L.eng + _F9L.s1 + _F9L.is + _F9L.s2 + _F9L.trunk);   // Dragon base

/* Radial dims expressed as multiples of _rf9 so the whole rocket stays to scale from one knob.
   (Axial values like _gfDepth and all vF positions are unaffected — the length was already right.) */
export const _gfS  = _rf9 * 2.4;      // grid fin outer half-span from CL
export const _gfW  = _rf9 * 0.55;     // grid fin tangential half-width (broad grid face is fore-aft)
export const _gfMidVF = _f9S1Top + (_f9S2Base - _f9S1Top) * 0.65;   // grid fins mount ON the interstage (upper part)
export const _gfHinge = _rf9 * 0.15;  // hinge bracket stand-off: fin pivots on a fixed mount, not the skin
export const _gfRH = _rf9 + _gfHinge; // fin hinge (inner edge) radius
export const _gfDepth = 0.00040;      // grid fin fore-aft depth (lattice chord) — axial, not scaled
export const _nzO  = _rf9 * 0.70;     // outer engine ring radius (octaweb) — ~0.70·R, near the body edge like the real F9
export const _nzO7 = _nzO * 0.7071;
export const _nzVac  = _rf9 * 0.74;   // S2 Merlin Vacuum nozzle exit radius
export const _nzVac7 = _nzVac * 0.7071;
export const _nzSk   = _rf9 * 0.31;   // S2 nozzle skirt (throat) radius — radial, scales with body
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
export const { V_: _V_f9, F_: _F_f9, FC_: _FC_f9, E_: _E_f9, _thBase: _f9ThBase } = (() => {
  const N = 16;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF: _F9_vf0,      r: _rf9, col: 2 },  // Ring 0: S1 aft — black engine/base band (narrow)
    { vF: _f9EngTop,    r: _rf9, col: 0 },  // Ring 1: S1 body — white (the bulk, 42.6 m stage)
    { vF: _f9S1Top,     r: _rf9, col: 2 },  // Ring 2: interstage — black (belongs to S1, top of S1)
    { vF: _f9S2Base,    r: _rf9, col: 1 },  // Ring 3: S2 base — white (full Ø; F9 is constant 3.7 m)
    { vF: _f9S2Top,     r: _rf9, col: 1 },  // Ring 4: Trunk — white body (Crew Dragon)
    { vF: _f9TrunkTop,  r: _rf9          },  // Ring 5: Trunk/Dragon base (terminal)
  ]);
  // rb: [0,16,32,48,64,80]; Dragon tip=96; extras=97+

  /* Trunk: white body with a dark solar-panel array on one side (Crew Dragon). The trunk band
     is the ri=4 faces (one per side, index 4·N+si); recolour a ~120° arc dark. */
  for (const si of [5, 6, 7, 8, 9, 10]) FC_[4 * N + si] = 5;

  /* S2 MVac axial positions, hung off the S2 base */
  const _mvSk = _f9S2Base, _mvEx = _f9S2Base - 0.0017, _mvTh = _f9S2Base - 0.00028;  // bell ~3 m long (real MVac)

  V_.push(
    [ _F9_vfTip, 0,      0         ],  // 96 Dragon nosecone tip
    /* Grid fins: broad grid face fore-aft (±vF), wide tangentially, span radial. Outer edge is
       animated (fold/deploy) in outside.js. inner = at body, outer = deployed radial extent. */
    [ _gfMidVF, -_gfW,  _gfRH ], [ _gfMidVF,  _gfW,  _gfRH ],  // 97-98  Fin A inner (radial +z, tang ±y)
    [ _gfMidVF,  _gfW,  _gfS  ], [ _gfMidVF, -_gfW,  _gfS  ],  // 99-100 outer
    [ _gfMidVF,  _gfRH, -_gfW ], [ _gfMidVF,  _gfRH,  _gfW ],  // 101-102 Fin B inner (radial +y, tang ±z)
    [ _gfMidVF,  _gfS,   _gfW ], [ _gfMidVF,  _gfS,  -_gfW ],  // 103-104 outer
    [ _gfMidVF, -_gfW, -_gfRH ], [ _gfMidVF,  _gfW, -_gfRH ],  // 105-106 Fin C inner (radial -z, tang ±y)
    [ _gfMidVF,  _gfW, -_gfS  ], [ _gfMidVF, -_gfW, -_gfS  ],  // 107-108 outer
    [ _gfMidVF, -_gfRH, -_gfW ], [ _gfMidVF, -_gfRH,  _gfW ],  // 109-110 Fin D inner (radial -y, tang ±z)
    [ _gfMidVF, -_gfS,   _gfW ], [ _gfMidVF, -_gfS,  -_gfW ],  // 111-112 outer
    [-0.018,  0,        0         ],  // 113 centre Merlin
    [-0.018,  0,        _nzO      ],[-0.018,  _nzO7,  _nzO7     ],  // 114-115
    [-0.018,  _nzO,     0         ],[-0.018,  _nzO7, -_nzO7     ],  // 116-117
    [-0.018,  0,       -_nzO      ],[-0.018, -_nzO7, -_nzO7     ],  // 118-119
    [-0.018, -_nzO,     0         ],[-0.018, -_nzO7,  _nzO7     ],  // 120-121
    [ _mvSk,  0,        _nzSk  ],[ _mvSk,  _nzSk7,  _nzSk7 ],  // 122-123 S2 MVac skirt (at S2 base)
    [ _mvSk,  _nzSk,    0      ],[ _mvSk,  _nzSk7, -_nzSk7 ],  // 124-125
    [ _mvSk,  0,       -_nzSk  ],[ _mvSk, -_nzSk7, -_nzSk7 ],  // 126-127
    [ _mvSk, -_nzSk,    0      ],[ _mvSk, -_nzSk7,  _nzSk7 ],  // 128-129
    [ _mvEx,  0,        _nzVac ],[ _mvEx,  _nzVac7, _nzVac7 ],  // 130-131 S2 MVac exit (bell mouth)
    [ _mvEx,  _nzVac,   0      ],[ _mvEx,  _nzVac7,-_nzVac7 ],  // 132-133
    [ _mvEx,  0,       -_nzVac ],[ _mvEx, -_nzVac7,-_nzVac7 ],  // 134-135
    [ _mvEx, -_nzVac,   0      ],[ _mvEx, -_nzVac7, _nzVac7 ],  // 136-137
    [ _mvTh,  0,        0      ],  // 138 nozzle throat centre — recessed INTO the bell (concave interior)
  );

  /* Dragon capsule profile — 4 rings between the trunk top (Ring 5) and the tip (96): nearly
     straight at the base, a sharper conical taper, then a strongly rounded nose cap.
     D1-D4 verts appended here; the upper segments + tip cap are built after the trunk fins. */
  const _drH = _F9_vfTip - _f9TrunkTop;
  const _drBase = V_.length;
  for (const [hf, rf] of [[0.30, 0.90], [0.58, 0.66], [0.80, 0.42], [0.93, 0.20]]) {
    const vF = _f9TrunkTop + _drH * hf, r = _rf9 * rf;
    for (let si = 0; si < N; si++) { const a = Math.PI / 2 - (si / N) * 2 * Math.PI; V_.push([vF, r * Math.cos(a), r * Math.sin(a)]); }
  }
  const _drD1 = _drBase, _drD2 = _drBase + 16, _drD3 = _drBase + 32, _drD4 = _drBase + 48;

  /* Ring 5 → D1 (base segment) — kept at faces 80-95 so the later face indices stay stable */
  for (let si = 0; si < N; si++) { const sj = (si + 1) % N; F_.push([rb[5] + si, rb[5] + sj, _drD1 + sj, _drD1 + si]); FC_.push(3); }

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
  FC_.push(4,4,4,4,4,4,4,4, 4,4,4,4,4,4,4,4, 2,2,2,2,2,2,2,2);   // fins + MVac bell (titanium) · exit cap (dark interior)

  /* Grid fin hinge mounts — a fixed bracket per fin (body _rf9 → hinge _gfRH); the fin pivots on
     top. Appended at the end (faces 120-139); kept with stage 1 via the booster/sep face lists. */
  const _mD = _rf9 * 0.12;   // mount axial half-depth
  for (const [Ry, Rz, Ty, Tz] of [
    [0,  1, 1, 0],   // Fin A: radial +z, tangential y
    [1,  0, 0, 1],   // Fin B: radial +y, tangential z
    [0, -1, 1, 0],   // Fin C: radial -z, tangential y
    [-1, 0, 0, 1],   // Fin D: radial -y, tangential z
  ]) {
    const base = V_.length;
    const mk = (rad, ts, as) => [_gfMidVF + as * _mD, rad * Ry + ts * _gfW * Ty, rad * Rz + ts * _gfW * Tz];
    V_.push(mk(_rf9, -1, -1), mk(_rf9, 1, -1), mk(_rf9, 1, 1), mk(_rf9, -1, 1),       // base  b0-b3
            mk(_gfRH, -1, -1), mk(_gfRH, 1, -1), mk(_gfRH, 1, 1), mk(_gfRH, -1, 1));  // top   t0-t3
    const b0 = base, b1 = base+1, b2 = base+2, b3 = base+3, t0 = base+4, t1 = base+5, t2 = base+6, t3 = base+7;
    F_.push([t0, t1, t2, t3], [b0, b1, t1, t0], [b1, b2, t2, t1], [b2, b3, t3, t2], [b3, b0, t0, t3]);
    FC_.push(2, 2, 2, 2, 2);   // dark bracket
  }

  /* Grid fin thickness — back grid face + 4 edge frames (faces 140-159). The back verts follow
     the fold in outside.js (offset along the fin's rotating fore-aft normal). Exported base so
     the animation in outside.js stays decoupled from absolute indices (Dragon rings shift them). */
  const _thBase = V_.length;
  for (const [a, b, c, d] of [[97,98,99,100], [101,102,103,104], [105,106,107,108], [109,110,111,112]]) {
    const base = V_.length;
    for (const vi of [a, b, c, d]) V_.push([V_[vi][0] + _gfDepth, V_[vi][1], V_[vi][2]]);  // deployed: +vF
    const A = base, B = base+1, C = base+2, D = base+3;
    F_.push([D, C, B, A], [a, b, B, A], [b, c, C, B], [c, d, D, C], [d, a, A, D]);
    FC_.push(4, 4, 4, 4, 4);
  }

  /* Crew Dragon trunk fins — 4 white swept stabiliser fins on the lower trunk: straight bottom
     edge at the S2 interface (vF _tfBot), beveled top edge up to _tfTop. Flat tangential blades
     (faces 160-167). Part of S2/Dragon, so they aren't in the booster face lists. */
  const _tfH = _f9TrunkTop - _f9S2Top;   // trunk height
  const _tfBot = _f9S2Top, _tfMidV = _f9S2Top + _tfH * 0.45, _tfTop = _f9S2Top + _tfH * 0.70, _tfTip = _rf9 * 1.40;
  for (const [Ry, Rz] of [[0,1], [1,0], [0,-1], [-1,0]]) {
    const base = V_.length;
    V_.push([_tfBot,  _rf9 * Ry,   _rf9 * Rz  ],   // A root-bottom (trunk surface)
            [_tfBot,  _tfTip * Ry, _tfTip * Rz],   // B tip-bottom  (straight bottom edge)
            [_tfMidV, _tfTip * Ry, _tfTip * Rz],   // D tip-top     (straight vertical leading edge)
            [_tfTop,  _rf9 * Ry,   _rf9 * Rz  ]);  // C root-top    (only the top is beveled)
    F_.push([base, base+1, base+2, base+3], [base+3, base+2, base+1, base]);   // double-sided quad
    FC_.push(1, 1);   // white
  }

  /* Dragon capsule upper segments (appended last → no shift of the culling face indices):
     D1→D2 (taper), D2→D3 + D3→D4 (rounding), D4→tip (96) cap. All white-ish col 3. */
  for (const [lo, hi] of [[_drD1, _drD2], [_drD2, _drD3], [_drD3, _drD4]]) {
    for (let si = 0; si < N; si++) { const sj = (si + 1) % N; F_.push([lo + si, lo + sj, hi + sj, hi + si]); FC_.push(3); }
  }
  for (let si = 0; si < N; si++) { F_.push([_drD4 + si, _drD4 + (si + 1) % N, 96]); FC_.push(3); }

  /* Longerons — routed up through the Dragon rings so the wireframe follows the capsule profile */
  for (const si of [0, 4, 8, 12]) {
    for (let ri = 0; ri < 5; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[5]+si, _drD1+si], [_drD1+si, _drD2+si], [_drD2+si, _drD3+si], [_drD3+si, _drD4+si], [_drD4+si, 96]);
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

  return { V_, F_, FC_, E_, _thBase };
})();
export const _FN_f9 = computeFaceNormals(_V_f9, _F_f9);

/* ── Falcon 1 (Flight 4, F1-004 · 28 Sep 2008) ───────────────────────────────
   SpaceX's first orbital rocket: 21.3 m tall, Ø 1.7 m, two stages, expendable.
   Stage 1 = ONE Merlin 1C (SL), Stage 2 = ONE Kestrel (vacuum, long radiative bell).
   No grid fins, no legs, no octaweb — a slender single-engine pencil with a payload
   fairing on top. Same world scale as the F9 (~1750 m/unit) so it sits true-to-size. */
export const _rf1 = _rf9 * 0.463;   // body radius 0.85 m (Ø 1.7 m)
const _UPM_f1 = (_F9_vfTip - _F9_vf0) / _F9_tot;   // unit per metre, shared with the F9
const _F1_vf0 = -0.016;                            // base on the pad (same datum as the F9)
const _f1vf = (m) => _F1_vf0 + m * _UPM_f1;
const _F1L = { eng: 1.3, s1: 12.0, is: 1.2, s2: 4.3, fairing: 2.5 };   // 21.3 m total
const _f1EngTop = _f1vf(_F1L.eng);
const _f1S1Top  = _f1vf(_F1L.eng + _F1L.s1);                        // interstage base
const _f1S2Base = _f1vf(_F1L.eng + _F1L.s1 + _F1L.is);              // Stage 2 base
const _f1S2Top  = _f1vf(_F1L.eng + _F1L.s1 + _F1L.is + _F1L.s2);    // fairing base
const _f1Sum    = _F1L.eng + _F1L.s1 + _F1L.is + _F1L.s2;
export const _F1_vfTip = _f1vf(_f1Sum + _F1L.fairing);

export const _COLORS_f1 = [
  [250, 250, 252],  // 0 Stage 1 — white
  [244, 246, 250],  // 1 Stage 2 — white (cooler)
  [ 22,  24,  30],  // 2 interstage / aft engine band — near-black
  [248, 248, 250],  // 3 payload fairing — white
  [ 40,  44,  54],  // 4 nozzle — dark metal
];

/* nozzle radii (exit / throat) as multiples of the body radius */
const _f1MerlinExit = _rf1 * 0.72, _f1KestrelExit = _rf1 * 0.82;

const _f1Build = (() => {
  const N = 16;
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    { vF: _F1_vf0,    r: _rf1,        col: 0 },  // R0 aft — white (Falcon 1 is white to the base; only the Merlin bell is dark)
    { vF: _f1EngTop,  r: _rf1,        col: 0 },  // R1 Stage 1 — white (the bulk)
    { vF: _f1S1Top,   r: _rf1,        col: 2 },  // R2 interstage — black band (between the white S1 tank and white S2)
    { vF: _f1S2Base,  r: _rf1,        col: 1 },  // R3 Stage 2 — white
    { vF: _f1S2Top,   r: _rf1,        col: 3 },  // R4 fairing base — white
    { vF: _f1vf(_f1Sum + _F1L.fairing * 0.45), r: _rf1 * 0.78, col: 3 },  // R5 fairing mid
    { vF: _f1vf(_f1Sum + _F1L.fairing * 0.80), r: _rf1 * 0.40, col: 3 },  // R6 fairing upper
  ]);
  // rb: [0,16,32,48,64,80,96] → body faces 0-95 (6 gaps), fairing tip cap next.

  /* Fairing nose cap: ring R6 → apex tip */
  const _tip = V_.length;
  V_.push([_F1_vfTip, 0, 0]);                                   // 112 tip
  for (let si = 0; si < N; si++) { F_.push([rb[6] + si, rb[6] + (si + 1) % N, _tip]); FC_.push(3); }
  // fairing cap faces 96-111.

  /* Single-engine bells as 8-sided cones (apex = throat recessed up, ring = exit). The dark
     open interior reads as the nozzle. Merlin (S1) stays with the booster on staging; Kestrel
     (S2) hangs down inside the interstage and is revealed after separation. */
  const _cone = (apexVF, exitVF, exitR, col) => {
    const a0 = V_.length;
    V_.push([apexVF, 0, 0]);
    for (let si = 0; si < 8; si++) { const a = Math.PI / 2 - (si / 8) * 2 * Math.PI; V_.push([exitVF, exitR * Math.cos(a), exitR * Math.sin(a)]); }
    for (let si = 0; si < 8; si++) { F_.push([a0, a0 + 1 + si, a0 + 1 + (si + 1) % 8]); FC_.push(col); }
    for (let si = 0; si < 8; si++) E_.push([a0 + 1 + si, a0 + 1 + (si + 1) % 8]);
    return a0;
  };
  const _merlinExitVF  = _F1_vf0 - 0.00210;    // bell mouth ~3.7 m below the base (engine hangs free)
  const _kestrelExitVF = _f1S2Base - 0.00130;  // hangs ~2.3 m into the interstage

  /* Exposed Merlin — the Falcon 1 aft was OPEN (no boattail): the whole engine (combustion
     chamber → throat → nozzle) hangs on struts BELOW the tank end, with the turbopump + gas
     generator alongside. Built from a few dark low-poly primitives. Part of stage 1. */
  const _ring = (vF, cy, cz, r, n) => {        // push an n-vert ring; return first index
    const b = V_.length;
    for (let si = 0; si < n; si++) { const a = Math.PI / 2 - si / n * 2 * Math.PI; V_.push([vF, cy + r * Math.cos(a), cz + r * Math.sin(a)]); }
    return b;
  };
  const _prism = (cVF, cy, cz, r, halfH, n) => {   // n-gon prism: side walls + top cap, dark metal
    const bb = _ring(cVF - halfH, cy, cz, r, n), tt = _ring(cVF + halfH, cy, cz, r, n);
    for (let si = 0; si < n; si++) { const sj = (si + 1) % n; F_.push([bb + si, bb + sj, tt + sj, tt + si]); FC_.push(4); }
    F_.push(Array.from({ length: n }, (_, si) => tt + si)); FC_.push(4);   // top cap
    return { bb, tt };
  };
  const _frustum = (vT, rT, vB, rB, cy, cz, n, col = 4) => {   // open n-gon frustum (no caps): nozzle bell / tapered tank end
    const tt = _ring(vT, cy, cz, rT, n), bb = _ring(vB, cy, cz, rB, n);
    for (let si = 0; si < n; si++) { const sj = (si + 1) % n; F_.push([bb + si, bb + sj, tt + sj, tt + si]); FC_.push(col); }
  };

  const _mF0 = F_.length, _mV0 = V_.length;     // Merlin assembly start
  /* White tapered tank end — the F1 aft dome narrows to a near-point (col 0, stays white) */
  const _tankEnd = _F1_vf0, _taperBot = _F1_vf0 - 0.00040;
  _frustum(_tankEnd, _rf1, _taperBot, _rf1 * 0.30, 0, 0, 16, 0);
  /* Engine hangs on struts BELOW the tapered tank end: chamber → throat → nozzle */
  const _chTop = _taperBot - 0.00030, _throat = _chTop - 0.00045;
  for (const [cy, cz] of [[0, _rf1 * 0.28], [-_rf1 * 0.24, -_rf1 * 0.14], [_rf1 * 0.24, -_rf1 * 0.14]])
    _prism((_taperBot + _chTop) / 2, cy, cz, _rf1 * 0.05, (_taperBot - _chTop) / 2 + 0.00008, 4);   // suspension struts
  _prism((_chTop + _throat) / 2, 0, 0, _rf1 * 0.22, (_chTop - _throat) / 2, 6);   // combustion chamber (+ injector cap)
  _frustum(_throat, _rf1 * 0.20, _merlinExitVF, _f1MerlinExit, 0, 0, 8);          // throat → nozzle bell
  const _off = _rf1 * 0.55;                                    // turbopump radial offset (+y, beside the chamber)
  _prism(_throat + 0.00020, _off, 0, _rf1 * 0.24, 0.00050, 6);   // turbopump (hex can)
  _prism(_chTop,            _off, 0, _rf1 * 0.12, 0.00030, 4);   // gas generator (box atop the pump)
  const _mF1 = F_.length - 1, _mV1 = V_.length - 1;           // Merlin assembly end

  _cone(_f1S2Base + 0.00070, _kestrelExitVF, _f1KestrelExit, 4);   // Kestrel bell (stays with S2)

  return { V_, F_, FC_, E_, _mF0, _mF1, _mV0, _mV1 };
})();
export const _V_f1 = _f1Build.V_, _F_f1 = _f1Build.F_, _FC_f1 = _f1Build.FC_, _E_f1 = _f1Build.E_;
/* Merlin assembly (bell + exposed turbopump/GG) face + vertex ranges — stage-1 hardware that
   must hide on staging and drop out of the auto-fit once the booster separates. */
export const _f1MerlinF0 = _f1Build._mF0, _f1MerlinF1 = _f1Build._mF1;
export const _f1MerlinV0 = _f1Build._mV0, _f1MerlinV1 = _f1Build._mV1;
export const _FN_f1 = computeFaceNormals(_V_f1, _F_f1);
/* exit-plane vF anchors for the ascent plumes (centre engine, on the long axis) */
export const _f1MerlinExitVF  = _F1_vf0 - 0.00210;
export const _f1KestrelExitVF = _f1S2Base - 0.00130;
