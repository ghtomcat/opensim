/* OpenSim — display/outside-wb.js
   Wide-body jet geometry (A220/A340/A350/B737/E190). */
import { buildTube, buildWingSurface, computeFaceNormals } from './outside-shared.js';

export const _r   = 0.0025;        // fuselage radius
export const _nr1 = _r * 0.3827;  // nose/tail ring radii (sin π/8, π/4, 3π/8)
export const _nr2 = _r * 0.7071;
export const _nr3 = _r * 0.9239;
export const _hs  = 0.0165;
export const _ey  = 0.0068;
export const _ez  = -0.0028;
export const _pz  = -0.0008;  // pylon top — wing underside at engine span station
export const _er  = 0.0013;
export const _e7  = _er  * 0.7071;
export const _efr = _er  * 1.20;   // fan cowl ring — 20% wider (turbofan bulge)
export const _ef7 = _efr * 0.7071;
export const _erc = 0.0008;
export const _e7c = _erc * 0.7071;
export const _wr  = _r * 0.7071;   // wing-root offset: on fuselage surface, lower-diagonal (45° from bottom)
export const _dh  = 0.0012;

/* ── Wing spec — defines planform, thickness, and surface-break fractions ──
   root/fuselage attachment position is NOT part of the spec (fuselage join is
   a separate element). All x values = body-frame forward (+x = nose).         */
export const _WB_WING_DEFAULT = {
  span:      0.0267,   // half-span (NM) — A330-style widebody, W/D ≈ 10.7
  rootLE:    0.005,
  rootTE:   -0.004,
  tipLE:    -0.0079,   // scaled to maintain 25.9° LE sweep
  tipTE:    -0.0103,   // maintains root taper ratio ~0.33
  dihedral:  0.0019,
  rootThick: 0.00090,
  tipThick:  0.00022,
  flapBreak: 0.60,
  flapHinge: 0.70,
};

/* ── Wide-body fallback profile — used for unknown aircraft IDs ────────────── */
export const _WB_NP = {
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
};

export function _buildWB(np) {
  const N = 16, N4 = 4, N2 = 8, N3 = 12;
  const nNose  = np.noseRings.length;  // variable: 5 (default/a220/e190) or 7 (a350)
  /* Per-aircraft overrides fall back to module globals so existing profiles are unchanged */
  const tailX  = np.tailX ?? -0.021;
  const ts     = tailX / -0.021;
  const vstabZ = np.vstabZ ?? 0.008;  // V-stab tip height (z, above fuselage centre)
  const r   = np.r   ?? _r;
  const nr2 = r * 0.7071;
  const nr3 = r * 0.9239;
  const wr  = r * 0.7071;
  /* Wing vertical position: by default the root lower surface sits on the 45°
     lower-diagonal (z = -wr). `wing.rootZ` overrides it (lower-surface z, from the
     DWG); the whole wing — break, tip, spoilers (via WV), pylons — shifts with it. */
  const wzShift = (np.wing?.rootZ ?? -wr) + wr;
  const ey  = np.ey  ?? _ey;
  let   ez  = np.ez  ?? _ez;
  const er  = np.er  ?? _er;
  const efr = er * (np.fanCowlRatio ?? 1.20);   // fan-cowl bulge ratio (GE90 fat ~1.28, CFM56 lean ~1.15)
  const ef7 = efr * 0.7071;
  const e7  = er  * 0.7071;
  const erc = np.erc ?? _erc;
  const e7c = erc * 0.7071;
  const pz  = (np.pz  ?? _pz) + wzShift;   // pylon top follows the wing underside

  /* Engine X offset — shifts all ring positions with wing rootLE (default rootLE=0.005 → exOff=0) */
  const exOff = (np.wing?.rootLE ?? 0.005) - 0.005;
  const eLen = np.eLen ?? 1.0;  // nacelle length scale (1.0 = default; shorter engines < 1.0)
  /* Nacelle profile — x-offsets (×eLen) from the intake for [fanCowl, TR-fwd, TR-aft,
     nozzle]. The nozzle offset (last) sets how far the core sticks out aft: a GE90
     has a long, tapered, visible nozzle; a CFM56 ends bluntly (nozzle near TR-aft). */
  const _nprof = np.nacelleProfile ?? [0.004, 0.006, 0.007, 0.008];
  const eA = np.engineX ?? (0.005 + exOff);   // intake ring face (wing rootLE, or explicit engineX)
  const eB = eA - _nprof[0] * eLen;  // fan cowl ring
  const eC = eA - _nprof[1] * eLen;  // TR forward ring / pylon aft
  const eD = eA - _nprof[2] * eLen;  // TR aft ring
  const eE = eA - _nprof[3] * eLen;  // nozzle ring
  const ePF = eA - 0.002 * eLen;     // pylon fwd attach
  const _rBody = np.nacelleBody ?? er;                 // body rings eC/eD radius (fat fan cowl on the 737)
  const _flat  = np.nacelleFlatBottom ?? [0,0,0,0,0];  // per-ring flat-bottom amount [eA..eE], model units

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
  /* Engine vertical position: if `engineTopGap` (nacelle top below the wing
     underside, model units) is given, derive ez from the wing so the gap stays
     true as the wing moves; otherwise keep the literal engineZ. */
  if (np.engineTopGap != null || np.cowlTopToWingTop != null) {
    const _z0 = -wr + wzShift, _zB = wzh + wzShift, _zT = dh + wzShift;
    const _wczEy = ey <= wh
      ? _z0 + (ey - wr) / Math.max(wh - wr, 1e-9) * (_zB - _z0)
      : _zB + (ey - wh) / Math.max(hs - wh, 1e-9) * (_zT - _zB);
    if (np.cowlTopToWingTop != null) {
      // 737-style: fan-cowl top sits `gap` below the wing UPPER surface (lower + thickness at ey)
      const _thEy = ey <= wh
        ? wtr + (ey - wr) / Math.max(wh - wr, 1e-9) * (wth - wtr)
        : wth + (ey - wh) / Math.max(hs - wh, 1e-9) * (wtt - wth);
      ez = (_wczEy + _thEy) - np.cowlTopToWingTop - efr;
    } else {
      ez = _wczEy - np.engineTopGap - er;   // nacelle top below the wing underside
    }
  }
  const wfxR = rLE + fh * (rTE - rLE);          // x at root flap-hinge line
  const wfxH = wxhL + fh * (wxhT - wxhL);       // x at span-break flap-hinge
  const r_rt = -(rTE - wfxR);                   // root: dist from flap-hinge to TE
  const r_hs = -(wxhT - wfxH);                  // span-break: dist from flap-hinge to TE

  /* Derive aileron hinge positions and r_ail from buildWingSurface */
  const _ws = buildWingSurface({
    root: { y: wr,  z: -wr + wzShift, LE: rLE, TE: rTE, thick: wtr },
    brk:  { y: wh,  z: wzh + wzShift, LE: wxhL, TE: wxhT, thick: wth },
    tip:  { y: hs,  z: dh  + wzShift, LE: tLE,  TE: tTE,  thick: wtt },
    flapHinge: fh,
    ailHinge: 0.70,
  });
  const WV = _ws.verts;
  const r_ail = _ws.anim.r_ail;

  /* Winglet geometry — auto-derives X from tipLE/tipTE, height from winglet type */
  const _wlType = np.winglet ?? 'classic';
  const _wlH  = { classic: 0.0030, sharklet: 0.0065, blended: 0.0055, raked: 0.0015, none: 0 }[_wlType] ?? 0.0030;
  const _wlSw = { classic: 0.0012, sharklet: 0.0040, blended: 0.0008, raked: 0.0035, none: 0 }[_wlType] ?? 0.0012;
  const wy   = hs;
  const wz   = dh + _wlH;
  const nTotal = nNose + 5;            // + 5 fixed tail rings
  const { V_, F_, FC_, E_, rb } = buildTube(N, [
    ...np.noseRings,                                    // rings 0…nNose-1: aircraft-specific nose
    { vF:        0.001, r: r,    col: 0 },              // ring nNose+0: wing-stn (fixed)
    { vF: -0.010 * ts,  r: r,    col: 0 },              // ring nNose+1: rear
    { vF: -0.014 * ts,  ry: r, rz: r*0.88, col: 0, cz: r*0.12 }, // ring nNose+2: full width, belly rises
    { vF: -0.017 * ts,  ry: r, rz: r*0.65,         cz: r*0.35 }, // ring nNose+3: full width, belly rises
    { vF: -0.0205 * ts, ry: r*0.28, rz: r*0.22, cz: r*0.70 }, // ring nNose+4: APU exhaust, belly risen
  ]);

  const noseTip = V_.length;  V_.push([np.tipX, 0, np.tipCz ?? 0]);
  const tailTip = V_.length;  V_.push([tailX, 0, r * 0.70]);

  /* Engine nacelle ring — 8 verts in the legacy hand-laid order (top, +y diag, +y,
     +y-z diag, bottom, -y-z diag, -y, -y+z diag). ys=+1 right engine / -1 left
     (mirrors the y diagonals so face winding is preserved). flat>0 raises the lower
     verts onto a horizontal clip line z = zc-rr+flat — the flat-bottom nacelle. */
  const _engRing = (x, yc, zc, rr, ys = 1, flat = 0) => {
    const r7 = rr * 0.7071;
    if (flat > 0) {   // flat bottom: repurpose verts 3 & 5 (lower diagonals) as the flat edges
      const zMin = zc - rr + flat;
      const hw = Math.sqrt(Math.max(rr*rr - (rr - flat)*(rr - flat), 0));  // half-width of the flat chord
      return [
        [x, yc,         zc + rr], [x, yc + ys*r7, zc + r7],
        [x, yc + ys*rr, zc     ], [x, yc + ys*hw, zMin   ],
        [x, yc,         zMin   ], [x, yc - ys*hw, zMin   ],
        [x, yc - ys*rr, zc     ], [x, yc - ys*r7, zc + r7],
      ];
    }
    return [
      [x, yc,         zc + rr], [x, yc + ys*r7, zc + r7],
      [x, yc + ys*rr, zc     ], [x, yc + ys*r7, zc - r7],
      [x, yc,         zc - rr], [x, yc - ys*r7, zc - r7],
      [x, yc - ys*rr, zc     ], [x, yc - ys*r7, zc + r7],
    ];
  };

  V_.push(  /* non-tube vertices — b+0..b+151 */
    WV[0], WV[1], WV[4], WV[5],    // b+0..3:  R root lower LE/TE, R tip lower LE/TE
    WV[22], WV[23], WV[26], WV[27], // b+4..7:  L root lower LE/TE, L tip lower LE/TE
    [-0.013*ts,  0,        r        ],  //  b+8  V-stab base fwd
    [-0.019*ts,  0,        r        ],  //  b+9  V-stab base aft
    [(np.vstabTipLE??-0.016)*ts, 0, vstabZ],  //  b+10 V-stab top fwd
    [-0.021*ts,  0,        vstabZ-0.001],//b+11 V-stab top aft
    [-0.017*ts,  nr3,      0.0      ],  //  b+12 R h-stab root fwd
    [-0.0175*ts, nr2,      0.0      ],  //  b+13 R h-stab root aft
    [-0.019*ts,  0.008,    0.001    ],  //  b+14 R h-stab tip fwd  (30° LE sweep)
    [-0.0175*ts, 0.008,    0.001    ],  //  b+15 R h-stab tip aft
    [-0.017*ts, -nr3,      0.0      ],  //  b+16 L h-stab root fwd
    [-0.0175*ts,-nr2,      0.0      ],  //  b+17 L h-stab root aft
    [-0.019*ts, -0.008,    0.001    ],  //  b+18 L h-stab tip fwd
    [-0.0175*ts,-0.008,    0.001    ],  //  b+19 L h-stab tip aft
    /* R engine rings (b+20..59) — intake er · fan-cowl efr · body _rBody · nozzle erc; flat-bottom per ring */
    ..._engRing(eA, ey, ez, er,     1, _flat[0]), ..._engRing(eB, ey, ez, efr,    1, _flat[1]),
    ..._engRing(eC, ey, ez, _rBody, 1, _flat[2]), ..._engRing(eD, ey, ez, _rBody, 1, _flat[3]),
    ..._engRing(eE, ey, ez, erc,    1, _flat[4]),
    /* L engine rings (b+60..99) */
    ..._engRing(eA, -ey, ez, er,     -1, _flat[0]), ..._engRing(eB, -ey, ez, efr,    -1, _flat[1]),
    ..._engRing(eC, -ey, ez, _rBody, -1, _flat[2]), ..._engRing(eD, -ey, ez, _rBody, -1, _flat[3]),
    ..._engRing(eE, -ey, ez, erc,    -1, _flat[4]),
    /* Winglets (262-265) */
    [tLE-_wlSw,  wy, wz],[tTE,  wy, wz],   // b+100/101 R winglet outer LE/TE (auto from tipLE/tipTE)
    [tLE-_wlSw, -wy, wz],[tTE, -wy, wz],   // b+102/103 L winglet outer LE/TE
    /* Cockpit windows (b+104..b+111) — explicit panels, manual coords, or ring-sampled */
    ...(() => {
      if (np.cockpitPanels) {
        const p = np.cockpitPanels[0];
        return [...p, ...p.map(v => [v[0], -v[1], v[2]])];
      }
      if (np.winFwdRi == null) return np.windows;   // other profiles: keep manual coords
      const fR = np.winFwdRi, aR = np.winAftRi;
      const sO = np.winSiOuter ?? 2;
      const sI = np.winSiInner ?? 0;  // inner corner: 0=shared top, 1=creates center post
      const ins = 0.975;   // 2.5% inset so windows always win depth sort over tube face
      const wv = (ri, si) => {
        const v = V_[rb[ri] + si % N];
        const cy = np.noseRings[ri].cy ?? 0, cz = np.noseRings[ri].cz ?? 0;
        return [v[0], cy + (v[1]-cy)*ins, cz + (v[2]-cz)*ins];
      };
      return [
        wv(fR,sI),   wv(aR,sI),   wv(aR,sO),   wv(fR,sO),    // R: inner-fwd, inner-aft, out-aft, out-fwd
        wv(fR,N-sI), wv(aR,N-sI), wv(aR,N-sO), wv(fR,N-sO),  // L: mirrored inner, mirrored outer
      ];
    })(),
    /* Engine pylons — top attach on wing underside at span station y=_ey */
    [ ePF,  ey, pz],[ eC,  ey, pz],                         // R pylon top fwd, aft
    [ ePF, -ey, pz],[ eC, -ey, pz],                         // L pylon top fwd, aft
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
    [eA,  ey, ez],  // b+158 R intake center
    [eA, -ey, ez],  // b+159 L intake center
  );

  /* ── V-stab airfoil surface (b+160..b+171) ──────────────────────────────
     Span direction: Z (up).  Thickness direction: Y (lateral).
     6 span-line positions × 2 Y-sides = 12 vertices.
     Three chord stations per station: LE, hinge (65% chord), TE.              */
  const _vTr = 0.00070;                        // root half-thickness (≈12% t/c)
  const _vTt = 0.00040;                        // tip half-thickness (≈9% t/c)
  const _vTE = 0.00008;                        // closed TE half-gap
  const _vsRL = -0.013*ts, _vsRH = -0.017*ts, _vsRT = -0.019*ts;  // root LE/hinge/TE
  const _vsTL = (np.vstabTipLE ?? -0.016)*ts, _vsTH = -0.019*ts, _vsTT = tailX; // tip LE/hinge/TE
  V_.push(
    [_vsRL, +_vTr,       r        ], // b+160  root LE  +Y
    [_vsRL, -_vTr,       r        ], // b+161  root LE  -Y
    [_vsRH, +_vTr*0.70,  r        ], // b+162  root hinge +Y
    [_vsRH, -_vTr*0.70,  r        ], // b+163  root hinge -Y
    [_vsRT, +_vTE,        r        ], // b+164  root TE  +Y
    [_vsRT, -_vTE,        r        ], // b+165  root TE  -Y
    [_vsTL, +_vTt,        vstabZ   ], // b+166  tip  LE  +Y
    [_vsTL, -_vTt,        vstabZ   ], // b+167  tip  LE  -Y
    [_vsTH, +_vTt*0.70,   vstabZ   ], // b+168  tip  hinge +Y
    [_vsTH, -_vTt*0.70,   vstabZ   ], // b+169  tip  hinge -Y
    [_vsTT, +_vTE,         vstabZ   ], // b+170  tip  TE  +Y
    [_vsTT, -_vTE,         vstabZ   ], // b+171  tip  TE  -Y
  );

  /* ── H-stab airfoil surface (b+172..b+195) ──────────────────────────────
     Span direction: Y (lateral, same as main wing).  Thickness direction: Z.
     Three chord stations × 2 Z-sides × 2 span stations × 2 (R+L) = 24 verts.
     Hinge at 70% chord → elevator is rear 30%.                               */
  const _hTr = 0.00040;                           // root half-thickness
  const _hTt = 0.00025;                           // tip half-thickness
  const _hTE = 0.00005;                           // TE gap
  const _hsRL = -0.014*ts, _hsRH = -0.01645*ts, _hsRT = -0.0175*ts;
  const _hsTL = -0.016*ts, _hsTH = -0.01705*ts, _hsTT = -0.0175*ts;
  /* Root LE at ring nNose+2 (cz=r*0.12), root hinge at ring nNose+3 (cz=r*0.26) */
  const _hsRY  = r;               // root LE y — ry-equator of ring nNose+2 (ry=r)
  const _hsRZ  = r * 0.12;       // root LE z center
  const _hsHY  = r;              // hinge/TE root y — ry-equator of ring nNose+3 (ry=r)
  const _hsHZ  = r * 0.26;       // hinge/TE root z center
  V_.push(
    // R side (b+172..b+183)
    [_hsRL,  _hsRY,  _hsRZ+_hTr], [_hsRL,  _hsRY,  _hsRZ-_hTr],  // b+172/173 R root LE up/dn
    [_hsRH,  _hsHY,  _hsHZ+_hTr*0.5], [_hsRH, _hsHY, _hsHZ-_hTr*0.5],  // b+174/175 R root hinge up/dn
    [_hsRT,  _hsHY,  _hsHZ+_hTE], [_hsRT,  _hsHY,  _hsHZ-_hTE],  // b+176/177 R root TE up/dn
    [_hsTL,  0.008, 0.001+_hTt], [_hsTL, 0.008, 0.001-_hTt], // b+178/179 R tip LE up/dn
    [_hsTH,  0.008, 0.001+_hTt*0.5],[_hsTH,0.008,0.001-_hTt*0.5],// b+180/181 R tip hinge up/dn
    [_hsTT,  0.008, 0.001+_hTE], [_hsTT, 0.008, 0.001-_hTE],  // b+182/183 R tip TE up/dn
    // L side (b+184..b+195)
    [_hsRL, -_hsRY,  _hsRZ+_hTr], [_hsRL, -_hsRY,  _hsRZ-_hTr],  // b+184/185 L root LE up/dn
    [_hsRH, -_hsHY,  _hsHZ+_hTr*0.5],[_hsRH,-_hsHY, _hsHZ-_hTr*0.5],  // b+186/187 L root hinge up/dn
    [_hsRT, -_hsHY,  _hsHZ+_hTE], [_hsRT, -_hsHY,  _hsHZ-_hTE],  // b+188/189 L root TE up/dn
    [_hsTL, -0.008, 0.001+_hTt],[_hsTL,-0.008,0.001-_hTt],  // b+190/191 L tip LE up/dn
    [_hsTH, -0.008, 0.001+_hTt*0.5],[_hsTH,-0.008,0.001-_hTt*0.5],// b+192/193 L tip hinge up/dn
    [_hsTT, -0.008, 0.001+_hTE],[_hsTT,-0.008,0.001-_hTE],  // b+194/195 L tip TE up/dn
  );

  /* ── Decoupled flap geometry (b+196..b+211) ─────────────────────────────────
     Separate vertices for flap panels — start coincident with wing hinge/TE so
     flap is flush when retracted, then slide aft + rotate independently.
     R flap LE: WV[12/14/13/15] = root lower/upper, break lower/upper hinge
     R flap TE: WV[1/7/3/9]    = root lower/upper, break lower/upper TE        */
  V_.push(
    WV[12], WV[14], WV[13], WV[15],  // b+196..199: R flap LE (root lo/up, break lo/up)
    WV[1],  WV[7],  WV[3],  WV[9],   // b+200..203: R flap TE (root lo/up, break lo/up)
    WV[34], WV[36], WV[35], WV[37],  // b+204..207: L flap LE
    WV[23], WV[29], WV[25], WV[31],  // b+208..211: L flap TE
  );

  /* Spoiler hinge line (b+212..b+215) — inner wing upper surface at 55% LE→flap-hinge
     Spoiler panel: from this hinge line aft to the flap hinge line (b+137/139/141/143).
     When deployed, the aft edge (= upper flap hinge) rotates upward.                  */
  const spF   = 0.55;
  const _shRx = WV[6][0]  + spF * (WV[14][0] - WV[6][0]);   // R root  SH x
  const _shRz = WV[6][2]  + spF * (WV[14][2] - WV[6][2]);   // R root  SH z
  const _shBx = WV[8][0]  + spF * (WV[15][0] - WV[8][0]);   // R break SH x
  const _shBz = WV[8][2]  + spF * (WV[15][2] - WV[8][2]);   // R break SH z
  const r_sp_rt = -(WV[14][0] - _shRx);   // spoiler chord arm at root
  const r_sp_hs = -(WV[15][0] - _shBx);   // spoiler chord arm at break
  V_.push(
    [_shRx,  wr, _shRz],  // b+212  R root  spoiler hinge (upper)
    [_shBx,  wh, _shBz],  // b+213  R break spoiler hinge (upper)
    [_shRx, -wr, _shRz],  // b+214  L root  spoiler hinge (upper)
    [_shBx, -wh, _shBz],  // b+215  L break spoiler hinge (upper)
  );
  /* Spoiler intermediate stations (b+216..b+227) — 3 spanwise stations, hinge+TE per side */
  const _spLerp = (v0, v1, t) => [v0[0]+(v1[0]-v0[0])*t, v0[1]+(v1[1]-v0[1])*t, v0[2]+(v1[2]-v0[2])*t];
  const _shR = [_shRx,  wr, _shRz], _shB = [_shBx,  wh, _shBz];
  const _shRL= [_shRx, -wr, _shRz], _shBL= [_shBx, -wh, _shBz];
  for (const t of [0.25, 0.5, 0.75]) {
    V_.push(_spLerp(_shR, _shB, t));            // R hinge intermediate
    V_.push(_spLerp(WV[14], WV[15], t));        // R TE intermediate (b+217/219/221)
  }
  for (const t of [0.25, 0.5, 0.75]) {
    V_.push(_spLerp(_shRL, _shBL, t));          // L hinge intermediate
    V_.push(_spLerp(WV[36], WV[37], t));        // L TE intermediate (b+223/225/227)
  }
  /* Spoiler panel root/break TE — separate from the wing-face corners b+137/139/141/143
     so the static wing face doesn't deform when spoilers deploy (b+228..b+231) */
  V_.push(WV[14].slice(), WV[15].slice(), WV[36].slice(), WV[37].slice());

  /* V-stab LE nose vertices (b+232/b+233) — rounded cap, mirrors wing _leN approach.
     Thickness in Y → nose sits at y=0, offset forward (more positive x) by half-thickness. */
  V_.push(
    [_vsRL + _vTr, 0, r      ],   // b+232  root LE nose
    [_vsTL + _vTt, 0, vstabZ ],   // b+233  tip  LE nose
  );

  /* Extra cockpit window panels (b+234+) — panels 2, 3, … for aircraft with cockpitPanels.
     Each panel: 4 R verts then 4 L verts (y negated). Panel pi-1 starts at b+234+(pi-1)*8. */
  if (np.cockpitPanels?.length > 1)
    for (let pi = 1; pi < np.cockpitPanels.length; pi++) {
      const p = np.cockpitPanels[pi];
      V_.push(...p, ...p.map(v => [v[0], -v[1], v[2]]));
    }

  /* Nose tris: noseTip → ring0 (outward normals) */
  for (let si = 0; si < N; si++) { F_.push([noseTip, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(6); }
  /* Tail tris: last ring → tailTip (outward normals) */
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[nTotal-1]+si, rb[nTotal-1]+(si+1)%N]); FC_.push(0); }
  /* b = base index of the non-tube vertex block (was hardcoded 162 when nNose=5) */
  const b = nTotal * N + 2;  // nTotal*16 tube verts + noseTip(+0) + tailTip(+1) → non-tube at +2

  /* Engine interior caps + tube faces are built in the appended 16-vert nacelle skin. */

  /* Non-tube faces — indices expressed as b+offset (b=162 for nNose=5, b=194 for nNose=7) */
  F_.push(
    /* R wing: inner upper (full, spoilers sit on top) + 4 spoiler panels + flap + lower; outer (aileron); tip cap */
    [b+116,b+126,b+139,b+137],                   // R inner fixed upper (LE→flap hinge, under spoilers)
    [b+212,b+216,b+217,b+228],                   // R spoiler panel 1 (root→0.25)
    [b+216,b+218,b+219,b+217],                   // R spoiler panel 2 (0.25→0.50)
    [b+218,b+220,b+221,b+219],                   // R spoiler panel 3 (0.50→0.75)
    [b+220,b+213,b+229,b+221],                   // R spoiler panel 4 (0.75→break)
    [b+197,b+199,b+203,b+201],                   // R flap upper         (decoupled hinge→TE)
    [b+0,b+136,b+138,b+124],                     // R inner fixed lower
    [b+196,b+200,b+202,b+198],                   // R flap lower         (decoupled)
    [b+126,b+118,b+147,b+145],                   // R outer fixed upper (break LE→tip LE→ail hinge)
    [b+145,b+147,b+119,b+133],                   // R aileron upper
    [b+124,b+144,b+146,b+2],                     // R outer fixed lower
    [b+144,b+132,b+3,b+146],                     // R aileron lower
    [b+2,b+146,b+147,b+118],                     // R tip LE cap (fixed)
    [b+146,b+3,b+119,b+147],                     // R aileron tip
    /* L wing */
    [b+120,b+141,b+143,b+130],                   // L inner fixed upper (LE→flap hinge, under spoilers)
    [b+214,b+230,b+223,b+222],                   // L spoiler panel 1 (root→0.25)
    [b+222,b+223,b+225,b+224],                   // L spoiler panel 2 (0.25→0.50)
    [b+224,b+225,b+227,b+226],                   // L spoiler panel 3 (0.50→0.75)
    [b+226,b+227,b+231,b+215],                   // L spoiler panel 4 (0.75→break)
    [b+205,b+209,b+211,b+207],                   // L flap upper         (decoupled)
    [b+4,b+128,b+142,b+140],                     // L inner fixed lower
    [b+204,b+206,b+210,b+208],                   // L flap lower         (decoupled)
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
    [b+118,b+147,b+101,b+100],[b+118,b+100,b+101,b+147],  // R winglet (LE→ailHinge root, swept tip)
    [b+122,b+151,b+103,b+102],[b+122,b+102,b+103,b+151],  // L winglet
    // V-stab airfoil (b+160..b+171)
    [b+166,b+233,b+232,b+160],[b+161,b+232,b+233,b+167],  // LE rounds +Y / -Y
    [b+160,b+162,b+168,b+166],[b+161,b+167,b+169,b+163],  // main body +Y/-Y
    [b+162,b+164,b+170,b+168],[b+163,b+169,b+171,b+165],  // rudder +Y/-Y
    [b+168,b+169,b+167,b+166],[b+170,b+171,b+169,b+168],  // tip cap fwd+aft
    // R h-stab airfoil (b+172..b+183)
    [b+172,b+174,b+180,b+178],[b+173,b+179,b+181,b+175],  // main body up/dn
    [b+174,b+176,b+182,b+180],[b+175,b+181,b+183,b+177],  // elevator up/dn
    // L h-stab airfoil (b+184..b+195)
    [b+184,b+186,b+192,b+190],[b+185,b+191,b+193,b+187],  // main body up/dn
    [b+186,b+188,b+194,b+192],[b+187,b+193,b+195,b+189],  // elevator up/dn
    /* engine tube faces moved to the appended 16-vert nacelle skin (above) */
  );
  /* FC_ order must match F_ push order: engine caps, then non-tube faces */
  FC_.push(
    1,1,1,1, 1,1,1,1,                          // LE rounds R+L (8)
    1,1,1,1,1,1,1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1,1,1,1,1,1,1, 9,9,9,9,  // R wing (14) + L wing (14) + winglets (4)
    2,2,2,2,2,2,2,2, 3,3,3,3, 3,3,3,3,     // vstab airfoil (8) + R hstab (4) + L hstab (4)
  );   // engine tube/cap colours are pushed by the appended 16-vert nacelle skin
  /* Cockpit window faces — only for ring-sampled aircraft (no cockpitPanels).
     cockpitPanels aircraft are rendered by the post-painter pass; no depth-sorted faces needed. */
  if (!np.cockpitPanels) {
    F_.push(
      [b+104,b+105,b+106,b+107],[b+104,b+107,b+106,b+105],  // R cockpit window
      [b+108,b+109,b+110,b+111],[b+108,b+111,b+110,b+109],  // L cockpit window
    );
    FC_.push(8, 8, 8, 8);
  }

  /* Longerons: noseTip ↔ all rings ↔ tailTip at 4 cardinal si */
  /* si=0 structural edge in the seam region (radomeRi→winFwdRi) is replaced
     by the kinked SL_ path — skip it here so the straight gray line doesn't show. */
  const _slRri = (np.winFwdRi != null && np.radomeRi != null) ? np.radomeRi : -1;
  const _slFR  = np.winFwdRi ?? -1;
  for (const si of [0, N4, N2, N3]) {
    E_.push([noseTip, rb[0]+si]);
    for (let ri = 0; ri < nTotal-1; ri++) {
      if (si === 0 && _slRri >= 0 && ri >= _slRri && ri < _slFR) continue;
      E_.push([rb[ri]+si, rb[ri+1]+si]);
    }
    E_.push([rb[nTotal-1]+si, tailTip]);
  }
  /* Radome seam: full-circumference circle at the radomeRi boundary (the seam sits
     after the tip rings — no spurious circle at the very tip). */
  const SE_ = [];
  if (np.radomeRi != null) {
    const rri = np.radomeRi;
    if (rb[rri]) for (let si = 0; si < N; si++) SE_.push([rb[rri]+si, rb[rri]+(si+1)%N]);
  }
  /* Nose panel seam lines: outer longitudinals (si=sO, N-sO) straight from radomeRi to
     winFwdRi, then center seam ring1:si0 → kink1 → kink2 → ring2:si0 (two kinks via
     custom intermediate vertices), then center post ring2:si0 → ring3:si0. */
  // (winSiInner/winSiOuter are used for window faces only, not the seam path)
  const SL_ = [];
  let _frontWin = null;
  if (np.winFwdRi != null && np.radomeRi != null) {
    const fR = np.winFwdRi, rri = np.radomeRi;
    const aR = np.winAftRi;
    const sI = np.winSiInner ?? 2, sO = np.winSiOuter ?? 4;
    /* Outer longitudinals: si=sO, si=N-sO straight from radome ring to fwd window ring */
    for (const si of [sO, N - sO]) {
      for (let ri = rri; ri < fR; ri++) SL_.push([rb[ri]+si, rb[ri+1]+si]);
    }
    /* Center seam: two kink vertices on the fuselage centreline (y=0), z follows a
       parabolic arch above the straight ring1→ring2 interpolation, creating two
       visible direction changes in the side-view seam while staying on the top seam. */
    const _cVF1 = np.noseRings[rri].vF, _cVF2 = np.noseRings[fR].vF;
    const _cR1  = np.noseRings[rri].r,  _cR2  = np.noseRings[fR].r;
    const _kBase = V_.length;
    const _mkKink = (t) => {
      const vFk = _cVF1 + t * (_cVF2 - _cVF1);
      const rk  = _cR1  + t * (_cR2  - _cR1);
      const bump = 4 * t * (1 - t) * 0.10 * (_cR2 - _cR1);  // parabolic arch, 10% peak at t=0.5
      return [vFk, 0, rk + bump];  // y=0: stays on fuselage top centreline
    };
    V_.push(_mkKink(0.33), _mkKink(0.67));  // _kBase: kink1 (t=0.33), _kBase+1: kink2 (t=0.67)
    SL_.push([rb[rri]+0, _kBase], [_kBase, _kBase+1], [_kBase+1, rb[fR]+0]);
    /* Cockpit front window diagonals — connect inner window corners to kink vertices,
       closing the windshield quad: ring1:sI → kink1 → kink2 → ring2:sI (and port mirror) */
    SL_.push([rb[rri]+sI,     _kBase    ]);  // ring1:sI  → kink1 (starboard fwd diagonal)
    SL_.push([_kBase+1, rb[fR]+sI      ]);  // kink2     → ring2:sI (starboard aft diagonal)
    SL_.push([rb[rri]+(N-sI), _kBase   ]);  // ring1:N-sI → kink1 (port fwd diagonal)
    SL_.push([_kBase+1, rb[fR]+(N-sI)  ]);  // kink2     → ring2:N-sI (port aft diagonal)
    /* Lower windshield dividers — true parallels to kink2→fR:sI / kink2→fR:N-sI.
       D = v(fR:sI) − kink2;  new endpoint = kink1 + D  (same displacement vector). */
    { const _k1   = V_[_kBase], _k2 = V_[_kBase + 1];
      const _angSI = Math.PI * 0.5 - (sI / N) * Math.PI * 2;
      const _rfR   = np.noseRings[fR].r;
      const _epx   = _k1[0] + (np.noseRings[fR].vF - _k2[0]);
      const _epy   =  _rfR * Math.cos(_angSI);          // Dy (kink2 has y=0)
      const _epz   = _k1[2] + (_rfR * Math.sin(_angSI) - _k2[2]);
      const _kPar  = V_.length;
      V_.push([_epx,  _epy, _epz], [_epx, -_epy, _epz]);
      SL_.push([_kBase,         _kPar    ], [_kBase,         _kPar + 1]);  // kink1 → new endpoints
      SL_.push([rb[fR] + sI,    _kPar    ], [rb[fR] + (N-sI), _kPar + 1]);  // 2:2/2:14 → new endpoints
      /* Expose corners for post-painter fill + silver outline (same path as cockpitPanels).
         Winding is CCW in screen space so cross-product cull keeps the front-facing side:
         starboard: kink2→2:sI→kPar→kink1  port: kink2→kink1→kPar+1→2:N-sI  */
      _frontWin = [
        [_kBase,   _kPar,        rb[fR]+sI,       _kBase+1],  // starboard — CCW from starboard
        [_kBase+1, rb[fR]+(N-sI), _kPar+1,        _kBase  ],  // port — CCW from port
      ];
    }
    /* Center post */
    if (aR != null) {
      SL_.push([rb[fR]+0, rb[aR]+0]);
    }
  }
  /* Fuselage ↔ non-tube connections */
  const wStn = rb[nNose], tail = rb[nNose+2];
  E_.push(
    [wStn+6, b+0],[wStn+6, b+1],[wStn+10, b+4],[wStn+10, b+5],   // fuselage → lower wing root
    [wStn+6, b+116],[wStn+6, b+117],[wStn+10, b+120],[wStn+10, b+121],  // fuselage → upper wing root
    [tail,         b+8],[rb[nNose+3], b+9],
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
    [b+116,b+212],[b+212,b+137],[b+137,b+117], [b+126,b+213],[b+213,b+139],[b+139,b+145],[b+145,b+133],
    [b+212,b+216],[b+216,b+218],[b+218,b+220],[b+220,b+213],  // R spoiler hinge spanwise (4 segs)
    [b+216,b+217],[b+218,b+219],[b+220,b+221],                // R spoiler panel chords
    [b+118,b+147],[b+147,b+119], [b+137,b+217],[b+217,b+219],[b+219,b+221],[b+221,b+139],[b+145,b+147],
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
    [b+120,b+214],[b+214,b+141],[b+141,b+121], [b+130,b+215],[b+215,b+143],[b+143,b+149],[b+149,b+135],
    [b+214,b+222],[b+222,b+224],[b+224,b+226],[b+226,b+215],  // L spoiler hinge spanwise (4 segs)
    [b+222,b+223],[b+224,b+225],[b+226,b+227],                // L spoiler panel chords
    [b+122,b+151],[b+151,b+123], [b+141,b+223],[b+223,b+225],[b+225,b+227],[b+227,b+143],[b+149,b+151],
    // L wing LE+hinge thickness (LE routed through nose vertex)
    [b+120,b+155],[b+155,b+4],[b+130,b+156],[b+156,b+128],[b+122,b+157],[b+157,b+6],
    [b+155,b+156],[b+156,b+157],                           // L LE nose span
    [b+140,b+141],[b+142,b+143],[b+148,b+149],[b+150,b+151],
    [b+140,b+142],[b+141,b+143],
    // V-stab airfoil edges (b+160..b+171, b+232/233 LE nose)
    [b+160,b+232],[b+232,b+161],[b+162,b+163],[b+164,b+165],  // root: LE nose halves + hinge/TE
    [b+166,b+233],[b+233,b+167],[b+168,b+169],[b+170,b+171],  // tip:  LE nose halves + hinge/TE
    [b+232,b+233],                                             // LE nose spanwise
    [b+160,b+166],[b+161,b+167],                              // LE spanwise +Y/-Y
    [b+162,b+168],[b+163,b+169],                     // hinge spanwise
    [b+164,b+170],[b+165,b+171],                     // TE spanwise
    // R h-stab airfoil edges (b+172..b+183)
    [b+172,b+173],[b+174,b+175],[b+176,b+177],       // R root thickness
    [b+178,b+179],[b+180,b+181],[b+182,b+183],       // R tip thickness
    [b+172,b+178],[b+173,b+179],                     // R LE spanwise
    [b+174,b+180],[b+175,b+181],                     // R hinge spanwise
    [b+176,b+182],[b+177,b+183],                     // R TE spanwise
    // L h-stab airfoil edges (b+184..b+195)
    [b+184,b+185],[b+186,b+187],[b+188,b+189],       // L root thickness
    [b+190,b+191],[b+192,b+193],[b+194,b+195],       // L tip thickness
    [b+184,b+190],[b+185,b+191],                     // L LE spanwise
    [b+186,b+192],[b+187,b+193],                     // L hinge spanwise
    [b+188,b+194],[b+189,b+195],                     // L TE spanwise
    [b+118,b+100],[b+147,b+101],[b+100,b+101],        // R winglet
    [b+122,b+102],[b+151,b+103],[b+102,b+103],        // L winglet
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

  /* winglet:"none" — drop the winglet faces/edges entirely (raked tips, e.g. 777).
     Zeroing height alone leaves a wing-thickness sliver that still reads as a winglet. */
  if (_wlType === 'none') {
    const _wlV = new Set([b+100, b+101, b+102, b+103]);
    for (let i = F_.length - 1; i >= 0; i--)
      if (F_[i].some(v => _wlV.has(v))) { F_.splice(i, 1); FC_.splice(i, 1); }
    for (let i = E_.length - 1; i >= 0; i--)
      if (E_[i].some(v => _wlV.has(v))) E_.splice(i, 1);
  }

  /* Core nozzle (data-driven stepped exhaust, e.g. GE90) — a concentric octagonal
     lofted tube behind the fan cowl, from np.coreNozzle = [[xOffsetFromIntake, radius]].
     Both engines; dark engine-interior colour (10). Appended (own vertex indices). */
  if (np.coreNozzle && np.coreNozzle.length >= 2) {
    for (const sgn of [1, -1]) {
      const ecy = sgn * ey, cnRows = [];
      for (const [xo, rr] of np.coreNozzle) {
        const x = eA - xo, r7r = rr * 0.7071, row = V_.length;
        V_.push(
          [x, ecy,     ez+rr ], [x, ecy+r7r, ez+r7r],
          [x, ecy+rr,  ez     ], [x, ecy+r7r, ez-r7r],
          [x, ecy,     ez-rr ], [x, ecy-r7r, ez-r7r],
          [x, ecy-rr,  ez     ], [x, ecy-r7r, ez+r7r],
        );
        cnRows.push(row);
      }
      for (let i = 0; i < cnRows.length - 1; i++) {
        const cnCol = i === 0 ? 17 : 10;   // section 1 silver (17); sections 2-3 + plug black (10)
        for (let s = 0; s < 8; s++) {
          const sj = (s + 1) % 8;
          F_.push([cnRows[i]+s, cnRows[i]+sj, cnRows[i+1]+sj, cnRows[i+1]+s]); FC_.push(cnCol);
        }
      }
    }
  }

  /* Fan spinner — a forward-pointing cone at each engine intake (3-D, so it shows
     from the side where the 2-D fan face goes edge-on). Dark, sized off the fan. */
  {
    const spR = er * 0.16, spR7 = spR * 0.7071;
    for (const sgn of [1, -1]) {
      const scy = sgn * ey, base = V_.length;
      V_.push(   // base ring on the fan-disk plane (eB) so it co-centres with the 2-D fan face
        [eB, scy,     ez+spR ], [eB, scy+spR7, ez+spR7],
        [eB, scy+spR, ez     ], [eB, scy+spR7, ez-spR7],
        [eB, scy,     ez-spR ], [eB, scy-spR7, ez-spR7],
        [eB, scy-spR, ez     ], [eB, scy-spR7, ez+spR7],
      );
      const tip = V_.length;
      V_.push([eA, scy, ez]);   // tip forward at the intake plane
      for (let s = 0; s < 8; s++) { F_.push([tip, base + (s+1)%8, base + s]); FC_.push(4); }
    }
  }

  /* Belly fairing (wing-to-body fairing) — its OWN structure built onto the lower
     fuselage (see DWG head-on cross-section): a wider, flatter-bottomed lobe that
     flares past the fuselage circle on both sides and drops below the belly, with
     its crest tucked up inside the fuselage (hidden by the painter's algorithm).
     Appended as separate rings so it doesn't disturb the tube's vertex indices.
       maxWidth = half-width at widest (> r);  maxDepth = drop below the belly.
     Cross-section is a super-ellipse (exponent > 2 ⇒ flat bottom + fuller sides);
     it morphs from the plain fuselage circle at the fore/aft ends to the full lobe
     across a flat-topped envelope so it sits along the whole wing box. */
  const bf = np.bellyFairing;
  if (bf && bf.fromX != null && bf.toX != null) {
    const maxHW = bf.maxWidth ?? r, depth = bf.maxDepth ?? 0, nF = 16, ramp = 0.26;
    const fRows = [];
    for (let i = 0; i <= nF; i++) {
      const prog = i / nF, x = bf.fromX + (bf.toX - bf.fromX) * prog;
      // flat-topped envelope: smoothstep up over the first `ramp`, hold, down over the last
      let t;
      if (prog < ramp)          { const u = prog / ramp;       t = u * u * (3 - 2 * u); }
      else if (prog > 1 - ramp) { const u = (1 - prog) / ramp; t = u * u * (3 - 2 * u); }
      else                        t = 1;
      const halfW = r + t * (maxHW - r);
      const ztop  = r * (1 - 0.78 * t);      // crest tucks from +r (fuselage) up under the skin
      const zbot  = -(r + t * depth);        // keel drops below the belly
      const Vz = (ztop - zbot) * 0.5, czf = (ztop + zbot) * 0.5;
      const nExp = 2 + t * 1.1;              // 2 = circle (ends) → ~3 flat-bottomed lobe (mid)
      const p = 2 / nExp;
      const row = V_.length;
      for (let si = 0; si < N; si++) {
        const a = Math.PI * 0.5 - (si / N) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const y = halfW * Math.sign(ca) * Math.pow(Math.abs(ca), p);
        const z = czf + Vz * Math.sign(sa) * Math.pow(Math.abs(sa), p);
        V_.push([x, y, z]);
      }
      fRows.push(row);
    }
    // Only draw faces that poke OUT past the fuselage skin — the belly lobe.
    // Faces at/inside the skin (the crest tucked up inside, the fore/aft fade)
    // are skipped, so the fairing never wraps around the upper fuselage.
    for (let i = 0; i < nF; i++)
      for (let si = 0; si < N; si++) {
        const sj = (si + 1) % N;
        const q = [fRows[i]+si, fRows[i]+sj, fRows[i+1]+sj, fRows[i+1]+si];
        let rho = 0;
        for (const vi of q) rho += Math.hypot(V_[vi][1], V_[vi][2]);
        if (rho / 4 < r * 1.012) continue;   // inside/on the skin → not part of the lobe
        F_.push(q); FC_.push(0);   // fuselage colour
      }
  }

  /* ── High-resolution (16-vert) nacelle skin (appended last, after the belly fairing,
     so it doesn't disturb any other vertex indices) ────────────────────────────────
     The 8-vert engine rings (b+20..99) stay as anchors for the 2-D fan-face math and
     the TR/chevron overlays; this 16-gon skin is the visible cowl (replaces the 8-vert
     tube faces) for a rounder cross-section. */
  {
    const NE = 16;
    const _chevD = np.chevronDepth ?? 0;   // fan-cowl TE chevron tooth depth (aft), model units
    const ringHi = (x, yc, zc, rr, ys, flat) => {
      const zMin = zc - rr + flat, out = [];
      for (let k = 0; k < NE; k++) {
        const th = k / NE * Math.PI * 2;
        let zz = zc + Math.cos(th) * rr;
        if (flat > 0 && zz < zMin) zz = zMin;
        out.push([x, yc + Math.sin(th) * rr * ys, zz]);
      }
      return out;
    };
    const _xs = [eA, eB, eC, eD, eE], _rs = [er, efr, _rBody, _rBody, erc];
    const _gapCol = [4, 4, 7, 4];   // A→B, B→C, C→D (TR zone, col 7), D→E
    for (const [yc, ys] of [[ey, 1], [-ey, -1]]) {
      const rbHi = [];
      for (let ri = 0; ri < 5; ri++) {
        rbHi.push(V_.length);
        for (const v of ringHi(_xs[ri], yc, ez, _rs[ri], ys, _flat[ri])) V_.push(v);
      }
      for (let g = 0; g < 4; g++) {           // tube faces — 4 gaps × NE quads, L winding mirrored
        const a = rbHi[g], nb = rbHi[g+1];
        for (let s = 0; s < NE; s++) {
          const sj = (s + 1) % NE;
          F_.push(ys > 0 ? [a+s, a+sj, nb+sj, nb+s] : [a+s, nb+s, nb+sj, a+sj]);
          FC_.push(_gapCol[g]);
        }
      }
      const cap = (rbase, rev) => { const f = []; for (let s = 0; s < NE; s++) f.push(rbase + (rev ? NE-1-s : s)); return f; };
      F_.push(cap(rbHi[0], ys > 0)); FC_.push(10);   // intake bore  (+x normal, dark)
      F_.push(cap(rbHi[4], ys < 0)); FC_.push(10);   // nozzle exit  (-x normal, dark)
      if (_chevD > 0) {   // fan-cowl TE chevrons — aft-pointing teeth on the eE (nozzle) ring
        const NC = 16, taperR = (erc - _rBody) / (eE - eD);   // cowl boat-tail dr/dx near the TE
        const vAt = (xoff, ang) => {
          const rr = erc - taperR * xoff, zMin = ez - rr + _flat[4];   // radius follows the taper aft
          let zz = ez + Math.cos(ang) * rr;
          if (_flat[4] > 0 && zz < zMin) zz = zMin;
          return [eE - xoff, yc + Math.sin(ang) * rr * ys, zz];
        };
        const rb0 = V_.length; for (let k = 0; k < NC; k++) V_.push(vAt(0,      k / NC * 2 * Math.PI));
        const tb0 = V_.length; for (let k = 0; k < NC; k++) V_.push(vAt(_chevD, (k + 0.5) / NC * 2 * Math.PI));
        for (let k = 0; k < NC; k++) {   // each tooth: base = root[k]→root[k+1], tip aft between them
          const kj = (k + 1) % NC;
          F_.push([rb0+k, rb0+kj, tb0+k]); FC_.push(4);
          F_.push([rb0+k, tb0+k, rb0+kj]); FC_.push(4);   // double-sided so teeth show from any angle
        }
      }
    }
  }

  return { V_, F_, FC_, E_, SE_, SL_, b, r, rb, ey: np.ey, ez, wing: np.wing, wzShift,
    winFwdRi: np.winFwdRi, winAftRi: np.winAftRi,
    winSiInner: np.winSiInner, winSiOuter: np.winSiOuter,
    cockpitPanels: np.cockpitPanels, cockpitPanelR: np.cockpitPanelR, frontWin: _frontWin,
    ey2: np.ey2, er: np.er, erc: np.erc, pz: np.pz, exOff, eLen, efr,
    eApos: eA, eBpos: eB, eCpos: eC, eDpos: eD, eEpos: eE, coreNozzle: np.coreNozzle,
    anim: { r_rt, r_hs, r_ail, r_sp_rt, r_sp_hs } };
}

/* Convert full aircraft JSON to the np-form _buildWB expects.
   baseNp supplies fallback values for any field absent from JSON.
   Priority: aircraft JSON > baseNp > _buildWB hardcoded defaults. */
export function _acGeoFromJson(aircraft, baseNp) {
  const nose = aircraft.nose ?? {};
  const jGeo = aircraft.geometry ?? {};
  const r    = jGeo.r ?? nose.r ?? baseNp.r ?? _r;
  const rings = (nose.noseRings ?? baseNp.noseRings ?? []).map(rg => ({
    ...rg, r: rg.rFrac != null ? r * rg.rFrac : rg.r,
    ...(rg.rzTopFrac != null ? { rzTop: r * rg.rzTopFrac } : {}),
  }));
  return {
    ...baseNp,
    tipX:          nose.tipX          ?? baseNp.tipX,
    tipCz:         nose.tipCz         ?? baseNp.tipCz ?? 0,
    noseRings:     rings,
    r,
    radomeRi:      nose.radomeRi      ?? baseNp.radomeRi,
    winFwdRi:      nose.winFwdRi      ?? baseNp.winFwdRi,
    winAftRi:      nose.winAftRi      ?? baseNp.winAftRi,
    winSiInner:    nose.winSiInner    ?? baseNp.winSiInner,
    winSiOuter:    nose.winSiOuter    ?? baseNp.winSiOuter,
    cockpitPanels: nose.cockpitPanels ?? baseNp.cockpitPanels,
    cockpitPanelR: nose.cockpitPanelR ?? baseNp.cockpitPanelR,
    windows:       nose.windows       ?? baseNp.windows,
    tailX:         jGeo.tailX         ?? baseNp.tailX,
    vstabZ:        jGeo.vstabZ        ?? baseNp.vstabZ,
    vstabTipLE:    jGeo.vstabTipLE    ?? baseNp.vstabTipLE,
    ey:            jGeo.engineY       ?? baseNp.ey,
    ey2:           jGeo.engineY2      ?? baseNp.ey2,
    ez:            jGeo.engineZ       ?? baseNp.ez,
    er:            jGeo.engineR       ?? baseNp.er,
    erc:           jGeo.engineRC      ?? baseNp.erc,
    engineTopGap:  jGeo.engineTopGap  ?? baseNp.engineTopGap,
    pz:            jGeo.pylonZ        ?? baseNp.pz,
    wing:          aircraft.wing      ?? baseNp.wing,
    winglet:       aircraft.winglet   ?? baseNp.winglet,
    eLen:          jGeo.engineLen     ?? baseNp.eLen ?? 1.0,
    fanCowlRatio:  jGeo.fanCowlRatio  ?? baseNp.fanCowlRatio,
    nacelleProfile: jGeo.nacelleProfile ?? baseNp.nacelleProfile,
    coreNozzle:    jGeo.coreNozzle    ?? baseNp.coreNozzle,
    fanCowlLen:    jGeo.fanCowlLen    ?? baseNp.fanCowlLen,
    engineX:       jGeo.engineX       ?? baseNp.engineX,
    nacelleBody:   jGeo.nacelleBody   ?? baseNp.nacelleBody,
    nacelleFlatBottom: jGeo.nacelleFlatBottom ?? baseNp.nacelleFlatBottom,
    cowlTopToWingTop:  jGeo.cowlTopToWingTop  ?? baseNp.cowlTopToWingTop,
    chevronDepth:      jGeo.chevronDepth      ?? baseNp.chevronDepth,
    bellyFairing:  aircraft.bellyFairing ?? baseNp.bellyFairing,
  };
}

/* Build default geometry at startup; per-aircraft profiles are built on first load via _acGeoFromJson */
export const _wbCache = {};
{ const geo = _buildWB(_WB_NP.default); geo.FN_ = computeFaceNormals(geo.V_, geo.F_); _wbCache.default = geo; }

/* Static aliases for the default profile (used as fallbacks + for non-WB aircraft selector) */
export const { V_: _V, F_: _F, FC_: _FC, E_: _E } = _wbCache.default;
export const _FN = _wbCache.default.FN_;

/* ── Landing gear (body frame, NM) — struts only ─────────────── */
export const _GV = [
  /* 0 */ [ 0.009,  0,      -_r         ],  // nose strut top
  /* 1 */ [ 0.009,  0,      -_r - 0.0022],  // nose wheel
  /* 2 */ [-0.001,  0.0020, -_r         ],  // R main top
  /* 3 */ [-0.001,  0.0020, -_r - 0.0032],  // R main wheel
  /* 4 */ [-0.001, -0.0020, -_r         ],  // L main top
  /* 5 */ [-0.001, -0.0020, -_r - 0.0032],  // L main wheel
];
export const _GE = [[0,1],[2,3],[4,5]];

/* Wide-body jet light positions — body frame [fwd, right, up] */
export const _LIGHTS_wb = [
  { pos: [-0.003,  _hs,  _dh    ], col: [  0, 210,  80], key: 'nav'     },  // R wingtip green
  { pos: [-0.003, -_hs,  _dh    ], col: [220,  40,  40], key: 'nav'     },  // L wingtip red
  { pos: [-0.020,  0,    0.007  ], col: [255, 255, 255], key: 'nav'     },  // tail white
  { pos: [ 0.001,  0,    _r     ], col: [220,  50,  50], key: 'beacon'  },  // rotating beacon (fuselage top)
  { pos: [-0.003,  _hs,  _dh    ], col: [255, 255, 255], key: 'strobe'  },  // R wingtip strobe
  { pos: [-0.003, -_hs,  _dh    ], col: [255, 255, 255], key: 'strobe'  },  // L wingtip strobe
  { pos: [ 0.013,  0,    0      ], col: [255, 248, 220], key: 'landing' },  // nose landing lights
];

/* ── Door outlines (body frame, NM) ──────────────────────────── */
export const _DOOR = [
  [ 0.009,  _r, 0 ], [ 0.009, -_r, 0 ],  // pair 1 (fwd)
  [ 0.001,  _r, 0 ], [ 0.001, -_r, 0 ],  // pair 2
  [-0.006,  _r, 0 ], [-0.006, -_r, 0 ],  // pair 3
  [-0.011,  _r, 0 ], [-0.011, -_r, 0 ],  // pair 4 (aft)
];
