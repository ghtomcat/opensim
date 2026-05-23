/* OpenSim — display/outside-shared.js
   Shared geometry primitives. */

/* ── Procedural tube geometry ──────────────────────────────────────
   buildTube(nSides, rings) → { V_, F_, FC_, E_, rb }
   rings: [{ vF, r | ry/rz, col, cy?, cz? }]
     vF  forward position; r = circular radius (or ry/rz for ellipse)
     col = face color index for the segment from ring i → ring i+1
     cy/cz = centre offset (default 0; use for off-axis pods/engines)
   Angle convention: si=0 → top (+z), si=N/4 → right (+y), etc.
   E_ contains ring perimeter edges only; callers add longerons.
   ─────────────────────────────────────────────────────────────── */
export function buildTube(nSides, rings) {
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
export function buildWingSurface({ root, brk, tip, flapHinge, ailHinge, color = 1 }) {
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
export function computeFaceNormals(V_, F_) {
  return F_.map(fi => {
    const a = V_[fi[0]], b = V_[fi[1]], c = V_[fi[2]];
    const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n  = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
    const len = Math.hypot(...n);
    return len > 1e-10 ? n.map(x => x/len) : [0, 0, 1];
  });
}

/* ── Procedural rocket geometry builder ────────────────────────────
   _buildRocket(rocketGeometry) — reads aircraft.rocketGeometry from JSON.
   Schema:
     nSides      polygon sides (default 16)
     colors      color table  [r,g,b][]
     bodyRings   [{ vF, r, col }]  — fed directly to buildTube
     noseTip     vF of the tip vertex (null = no tip cap)
     stageSep    ring index array that marks stage-boundary planes, e.g. [5]
     gridFins    [{ vFBot, vFTop, rBody, rTip, col }]  — 4 fins at ±rR/±uR
     bodyFlaps   [{ vFBot, vFTop, rBody, rTip, axis:'uR'|'rR', col }] — 2 flaps each
     engineClusters  [{ vF, stage, rings:[{ count, radius, nozzleR, nozzleLen, type? }] }]
   Returns { V_, F_, FC_, E_, FN_, COLORS_, rb, stageRanges, engineClusters }
     stageRanges  [{ faceEnd }]  — face index where each stage's geometry ends
     engineClusters  metadata for the nozzle renderer (position, rings)
   ─────────────────────────────────────────────────────────────── */
export function _buildRocket(rg) {
  const N      = rg.nSides ?? 16;
  const rings  = rg.bodyRings ?? [];
  const { V_, F_, FC_, E_, rb } = buildTube(N, rings);

  /* Nose tip cap */
  const tipVF  = rg.noseTip;
  const tipIdx = tipVF != null ? V_.length : null;
  if (tipIdx != null) {
    V_.push([tipVF, 0, 0]);
    const lr = rings.length - 1;
    for (let si = 0; si < N; si++) {
      F_.push([tipIdx, rb[lr] + (si + 1) % N, rb[lr] + si]);
      FC_.push(rings[lr].col ?? 0);
    }
  }

  /* Longerons at 0 / 90 / 180 / 270° */
  for (const si of [0, N >> 2, N >> 1, (3 * N) >> 2]) {
    for (let ri = 0; ri < rings.length - 1; ri++) E_.push([rb[ri] + si, rb[ri + 1] + si]);
    if (tipIdx != null) E_.push([rb[rings.length - 1] + si, tipIdx]);
  }

  /* Stage separation face ranges
     stageSep: ring indices where one stage ends and the next begins.
     Faces from tube section i→i+1 start at face index i*N.
     "stage 1 ends after section (sep-1)→sep", so faceEnd = sep * N. */
  const stageRanges = (rg.stageSep ?? []).map(ri => ({ faceEnd: ri * N }));

  /* Helper: push a rectangular fin/flap panel (both sides) at 4 positions */
  function _addPanel(corners, col) {
    const base = V_.length;
    for (const c of corners) V_.push(c);
    F_.push([base, base+1, base+2, base+3], [base+3, base+2, base+1, base]);
    FC_.push(col, col);
    /* Three outer edges (root edge is shared with body — not drawn) */
    E_.push([base, base+3], [base+3, base+2], [base+2, base+1]);
  }

  /* Grid fins — 4 fins at ±uR and ±rR */
  for (const fin of (rg.gridFins ?? [])) {
    const { vFBot, vFTop, rBody, rTip, col = 3 } = fin;
    _addPanel([[vFBot,0,rBody],[vFTop,0,rBody],[vFTop,0,rTip],[vFBot,0,rTip]], col);
    _addPanel([[vFBot,rBody,0],[vFTop,rBody,0],[vFTop,rTip,0],[vFBot,rTip,0]], col);
    _addPanel([[vFBot,0,-rBody],[vFTop,0,-rBody],[vFTop,0,-rTip],[vFBot,0,-rTip]], col);
    _addPanel([[vFBot,-rBody,0],[vFTop,-rBody,0],[vFTop,-rTip,0],[vFBot,-rTip,0]], col);
  }

  /* Body flaps — 2 flaps each at ±uR or ±rR */
  for (const flap of (rg.bodyFlaps ?? [])) {
    const { vFBot, vFTop, rBody, rTip, axis = 'uR', col = 3 } = flap;
    if (axis === 'uR') {
      _addPanel([[vFBot,0,rBody],[vFTop,0,rBody],[vFTop,0,rTip],[vFBot,0,rTip]], col);
      _addPanel([[vFBot,0,-rBody],[vFTop,0,-rBody],[vFTop,0,-rTip],[vFBot,0,-rTip]], col);
    } else {
      _addPanel([[vFBot,rBody,0],[vFTop,rBody,0],[vFTop,rTip,0],[vFBot,rTip,0]], col);
      _addPanel([[vFBot,-rBody,0],[vFTop,-rBody,0],[vFTop,-rTip,0],[vFBot,-rTip,0]], col);
    }
  }

  /* Engine cluster ring outlines + metadata for the nozzle renderer */
  const engineClusters = (rg.engineClusters ?? []).map(cluster => {
    const clRings = cluster.rings.map(ring => {
      const { count, radius } = ring;
      const base = V_.length;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        V_.push([cluster.vF, radius * Math.sin(a), radius * Math.cos(a)]);
      }
      for (let i = 0; i < count; i++) E_.push([base + i, base + (i + 1) % count]);
      return { base, ...ring };
    });
    return { vF: cluster.vF, stage: cluster.stage ?? 1, rings: clRings };
  });

  const FN_     = computeFaceNormals(V_, F_);
  const COLORS_ = rg.colors ?? [];
  return { V_, F_, FC_, E_, FN_, COLORS_, rb, stageRanges, engineClusters };
}
