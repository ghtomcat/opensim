/* Landing-gear hardware draw helpers — volumetric tyres (2-D billboard and
   real-3-D), axle pairs, lit 3-D tubes, strut/actuator rods. Extracted from
   outside.js; pure functions over the caller's project / rotateNormal / litBr
   closures and the painter's faces list. */

/* Draw a volumetric tire (far face + tread band + near face + hub).
   wc: world-space axle centre [x,y,z]. tR: tire radius. */
export function drawVolumetricTire(ctx, wc, tR, project, hubR) {
  const M   = 24, H = M / 2;
  const tW  = tR * 0.40;
  const tRs = tR * 0.86;   // sidewall (face) radius — inset so the shoulders round into the tread
  const yS  = wc[1] === 0 ? 1 : Math.sign(wc[1]);
  const wO  = [wc[0], wc[1] + yS * tW, wc[2]];  // outboard face
  const wI  = [wc[0], wc[1] - yS * tW, wc[2]];  // inboard face
  /* Ring of M+1 screen points around the tyre at world centre w, radius r; .pC = projected centre */
  const ringAt = (w, r) => {
    const pC = project(w), pU = project([w[0], w[1], w[2]+r]), pF = project([w[0]+r, w[1], w[2]]);
    if (!pC || !pU || !pF) return null;
    const out = Array.from({length: M+1}, (_, i) => {
      const t = i / M * Math.PI * 2;
      return [pC.x + Math.cos(t)*(pU.x-pC.x) + Math.sin(t)*(pF.x-pC.x),
              pC.y + Math.cos(t)*(pU.y-pC.y) + Math.sin(t)*(pF.y-pC.y)];
    });
    out.pC = pC; return out;
  };
  const ptO = ringAt(wO, tRs), ptI = ringAt(wI, tRs), ptM = ringAt(wc, tR);
  if (!ptO || !ptI || !ptM) return;

  const fill = (pts, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    pts.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath(); ctx.fill();
  };
  /* Side band between two rings, split top/bottom so it reads as a curved surface */
  const band = (ptA, ptB, col) => {
    ctx.fillStyle = col;
    for (const [s, e] of [[0, H], [H, M]]) {
      ctx.beginPath();
      ptA.slice(s, e+1).forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
      [...ptB.slice(s, e+1)].reverse().forEach(([x,y]) => ctx.lineTo(x,y));
      ctx.closePath(); ctx.fill();
    }
  };

  /* Near face = smaller depth. Profile: far sidewall → bulged tread crown (ptM) → near
     sidewall, so the shoulders round instead of meeting the tread at a sharp edge. */
  const outerIsNear = ptO.pC.d <= ptI.pC.d;
  const [ptFar, ptNear, pCNear, wNear] = outerIsNear
    ? [ptI, ptO, ptO.pC, wO]
    : [ptO, ptI, ptI.pC, wI];

  fill(ptFar, 'rgba(28,32,40,0.95)');
  band(ptFar, ptM,    'rgba(34,39,49,0.97)');   // far shoulder → tread crown
  band(ptM,   ptNear, 'rgba(45,51,62,0.97)');   // tread crown → near shoulder (lighter)
  fill(ptNear, 'rgba(35,40,50,0.96)');

  /* Hub on near face — silver, sized from the measured hub diameter (fallback 0.20·tR) */
  const hR  = hubR ?? tR * 0.20;
  const pH1 = project([wNear[0], wNear[1], wNear[2]+hR]);
  const pH2 = project([wNear[0]+hR, wNear[1], wNear[2]]);
  if (pH1 && pH2) {
    ctx.fillStyle = 'rgba(176,183,196,0.92)';
    ctx.beginPath();
    for (let i = 0; i <= M; i++) {
      const t = i / M * Math.PI * 2;
      const x = pCNear.x + Math.cos(t)*(pH1.x-pCNear.x) + Math.sin(t)*(pH2.x-pCNear.x);
      const y = pCNear.y + Math.cos(t)*(pH1.y-pCNear.y) + Math.sin(t)*(pH2.y-pCNear.y);
      i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  }

  ctx.strokeStyle = 'rgba(190,200,215,0.70)';
  ctx.beginPath();
  ptNear.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  ctx.closePath(); ctx.stroke();
}

/* Draw a pair of tires (1 pair = 2 tires) on a short axle centred at wc.
   The axle runs along Y; each tire is offset ±axH from wc.
   An axle tube connects the inner faces of both tires. */
export function drawTirePair(ctx, wc, tR, project, dpr, hubR) {
  const tW  = tR * 0.40;   // half-width of one tire (matches drawVolumetricTire)
  const axH = tR * 0.55;   // half-span: center → each tire center
  const yS  = wc[1] === 0 ? 1 : Math.sign(wc[1]);
  const wcO = [wc[0], wc[1] + yS * axH, wc[2]];  // outboard tire center
  const wcI = [wc[0], wc[1] - yS * axH, wc[2]];  // inboard  tire center
  drawVolumetricTire(ctx, wcO, tR, project, hubR);
  drawVolumetricTire(ctx, wcI, tR, project, hubR);
  // Axle tube between inner faces
  const pO = project([wcO[0], wcO[1] - yS * tW, wcO[2]]);
  const pI = project([wcI[0], wcI[1] + yS * tW, wcI[2]]);
  if (pO && pI) drawStrutTube(ctx, pO, pI, dpr);
}

/* Orthonormal frame around an axle direction: returns [axle, u, v] with u,v ⊥ axle
   spanning the wheel-disc plane. Default Y axle reproduces the old X-Z disc. */
function _tireFrame(axis) {
  const crs = (p, q) => [p[1]*q[2]-p[2]*q[1], p[2]*q[0]-p[0]*q[2], p[0]*q[1]-p[1]*q[0]];
  const na = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const a = [axis[0]/na, axis[1]/na, axis[2]/na];
  const ref = Math.abs(a[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  let u = crs(ref, a); const mu = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0]/mu, u[1]/mu, u[2]/mu];
  const v = crs(a, u);
  return [a, u, v];
}

/* Real-3-D tyre — revolves the rounded cross-section (sidewall tRs → bulged tread tR
   → sidewall tRs, plus a silver hub disc) around the axle into actual lit faces, so
   it holds up from any angle / in WebXR. `axis` is the axle direction (default Y); the
   main gear passes a tilted axle so the wheel swings with the retracting leg. Pushes
   faces into the painter's `faces` list rather than painting ellipses on the canvas. */
export function pushTire(faces, wc, tR, hubR, tW, project, rotateNormal, litBr, axis, N) {
  N = N || 14; const tRs = tR * 0.86, hR = hubR ?? tR * 0.20;
  const [a, u, v] = _tireFrame(axis || [0, 1, 0]);
  const off  = (d) => [wc[0]+a[0]*d, wc[1]+a[1]*d, wc[2]+a[2]*d];
  const ring = (d, r) => { const c = off(d); return Array.from({ length: N }, (_, k) => {
    const t = k / N * Math.PI * 2, cu = Math.cos(t) * r, sv = Math.sin(t) * r;
    return [c[0]+u[0]*cu+v[0]*sv, c[1]+u[1]*cu+v[1]*sv, c[2]+u[2]*cu+v[2]*sv];
  }); };
  const rO = ring(tW, tRs), rI = ring(-tW, tRs), rM = ring(0, tR);
  const hO = ring(tW, hR),  hI = ring(-tW, hR);
  const cO = off(tW), cI = off(-tW);
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const crs = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const TYRE = [40, 45, 55], HUB = [176, 183, 196];
  const face = (v3, col, amb) => {
    const ps = v3.map(project);
    if (ps.some(p => !p)) return;
    const c = v3.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]).map(x => x / v3.length);
    let n = crs(sub(v3[1], v3[0]), sub(v3[2], v3[0]));
    const m = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0]/m, n[1]/m, n[2]/m];
    if (dot(n, sub(c, wc)) < 0) n = [-n[0], -n[1], -n[2]];   // outward normal for lighting
    const [nF, nR, nU] = rotateNormal(n);
    faces.push({ ps, br: litBr(nF, nR, nU, amb), avgD: ps.reduce((s, p) => s + p.d, 0) / ps.length, col });
  };
  for (let k = 0; k < N; k++) {
    const j = (k + 1) % N;
    face([rO[k], rO[j], rM[j], rM[k]], TYRE, 0.16);   // tread: outer shoulder → crown
    face([rM[k], rM[j], rI[j], rI[k]], TYRE, 0.16);   // tread: crown → inner shoulder
    face([hO[k], hO[j], rO[j], rO[k]], TYRE, 0.20);   // outer sidewall annulus
    face([hI[k], hI[j], rI[j], rI[k]], TYRE, 0.20);   // inner sidewall annulus
    face([cO, hO[k], hO[j]], HUB, 0.30);              // outer hub disc (silver)
    face([cI, hI[k], hI[j]], HUB, 0.30);              // inner hub disc
  }
}

/* A pair of tyres on a short axle, centred at wc (real-3-D). `axis` is the axle
   direction (default Y); both tyres + the axle stub follow it, so the pair tilts
   together when the leg swings. */
export function pushTirePair(faces, wc, tR, hubR, project, rotateNormal, litBr, axis) {
  const tW = tR * 0.40, axH = tR * 0.55;
  /* LOD: tyre segment count from the wheel's projected size — full 14 up close,
     down to a hexagon when small (the chase/side-cam framing, where a widebody has
     a dozen+ wheels). Cuts face count + per-frame allocations where it isn't seen. */
  const _pc = project(wc), _pe = project([wc[0], wc[1], wc[2] - tR]);
  let N = 14;
  if (_pc && _pe) N = Math.max(6, Math.min(14, Math.round(Math.hypot(_pe.x - _pc.x, _pe.y - _pc.y) / 7)));
  const [a, u, v] = _tireFrame(axis || [0, 1, 0]);
  const off = (d) => [wc[0]+a[0]*d, wc[1]+a[1]*d, wc[2]+a[2]*d];
  pushTire(faces, off( axH), tR, hubR, tW, project, rotateNormal, litBr, a, N);
  pushTire(faces, off(-axH), tR, hubR, tW, project, rotateNormal, litBr, a, N);
  /* axle stub between the inner faces */
  const aN = 8, axR = tR * 0.16;
  const sub = (p,q) => [p[0]-q[0],p[1]-q[1],p[2]-q[2]], dot = (p,q) => p[0]*q[0]+p[1]*q[1]+p[2]*q[2],
        crs = (p,q) => [p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
  const stub = (d) => { const c = off(d); return Array.from({ length: aN }, (_, k) => {
    const t = k/aN*Math.PI*2, cu = Math.cos(t)*axR, sv = Math.sin(t)*axR;
    return [c[0]+u[0]*cu+v[0]*sv, c[1]+u[1]*cu+v[1]*sv, c[2]+u[2]*cu+v[2]*sv]; }); };
  const r1 = stub(axH - tW), r2 = stub(-(axH - tW));
  for (let k = 0; k < aN; k++) { const j = (k+1)%aN, v3 = [r1[k], r1[j], r2[j], r2[k]];
    const ps = v3.map(project); if (ps.some(p => !p)) continue;
    const cc = v3.reduce((a,p)=>[a[0]+p[0],a[1]+p[1],a[2]+p[2]],[0,0,0]).map(x=>x/4);
    let n = crs(sub(v3[1],v3[0]), sub(v3[2],v3[0])); const m = Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/m,n[1]/m,n[2]/m];
    if (dot(n, sub(cc, wc)) < 0) n = [-n[0],-n[1],-n[2]];
    const [nF, nR, nU] = rotateNormal(n);
    faces.push({ ps, br: litBr(nF,nR,nU,0.20), avgD: ps.reduce((s,p)=>s+p.d,0)/4, col: [92, 98, 110] }); }
}

/* Real-3-D tube between two model points pa→pb (radii rA→rB), N sides, lit per face.
   `col` is [r,g,b]; `amb` the shadow floor; `cap` closes both ends with a fan (for
   bosses / oleo collars). The whole gear leg is built from these instead of 2-D lines,
   so it holds up close-in and in WebXR. */
export function pushTube3D(faces, pa, pb, rA, rB, col, project, rotateNormal, litBr, N, amb, cap) {
  N = N || 8; amb = amb ?? 0.18;
  const sub = (p,q) => [p[0]-q[0],p[1]-q[1],p[2]-q[2]], dot = (p,q) => p[0]*q[0]+p[1]*q[1]+p[2]*q[2],
        crs = (p,q) => [p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
  const [a, u, v] = _tireFrame(sub(pb, pa));
  const mid = [(pa[0]+pb[0])/2, (pa[1]+pb[1])/2, (pa[2]+pb[2])/2];
  const ring = (c, r) => Array.from({ length: N }, (_, k) => {
    const t = k/N*Math.PI*2, cu = Math.cos(t)*r, sv = Math.sin(t)*r;
    return [c[0]+u[0]*cu+v[0]*sv, c[1]+u[1]*cu+v[1]*sv, c[2]+u[2]*cu+v[2]*sv]; });
  const RA = ring(pa, rA), RB = ring(pb, rB);
  const face = (v3, am) => {
    const ps = v3.map(project); if (ps.some(p => !p)) return;
    const c = v3.reduce((s,p)=>[s[0]+p[0],s[1]+p[1],s[2]+p[2]],[0,0,0]).map(x=>x/v3.length);
    let n = crs(sub(v3[1],v3[0]), sub(v3[2],v3[0])); const m = Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/m,n[1]/m,n[2]/m];
    if (dot(n, sub(c, mid)) < 0) n = [-n[0],-n[1],-n[2]];
    const [nF, nR, nU] = rotateNormal(n);
    faces.push({ ps, br: litBr(nF,nR,nU,am), avgD: ps.reduce((s,p)=>s+p.d,0)/ps.length, col });
  };
  for (let k = 0; k < N; k++) { const j = (k+1)%N; face([RA[k],RA[j],RB[j],RB[k]], amb); }
  if (cap) for (let k = 0; k < N; k++) { const j = (k+1)%N;
    face([pa, RA[j], RA[k]], amb*1.3); face([pb, RB[k], RB[j]], amb*1.3); }
}

/* Draw a cylindrical gear strut between two projected screen points. */
export function drawStrutTube(ctx, pa, pb, dpr) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 1) return;
  const hw  = Math.max(1.5 * dpr, strutPx * 0.06);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);

  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(110,125,145,0.88)';  ctx.fill();
  ctx.strokeStyle = 'rgba(200,210,220,0.90)';  ctx.stroke();
}

export function drawStrutTubeCol(ctx, pa, pb, dpr, fill, stroke) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 1) return;
  const hw  = Math.max(1.5 * dpr, strutPx * 0.06);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.stroke();
}

/* Thinner actuator / side-brace rod — same style, ~half the width of drawStrutTube */
export function drawActuatorRod(ctx, pa, pb, dpr) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 0.5) return;
  const hw  = Math.max(0.7 * dpr, strutPx * 0.032);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(90,105,125,0.85)';  ctx.fill();
  ctx.strokeStyle = 'rgba(185,200,215,0.80)';  ctx.stroke();
}

export function drawActuatorRodCol(ctx, pa, pb, dpr, fill, stroke) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const strutPx = Math.hypot(dx, dy);
  if (strutPx < 0.5) return;
  const hw  = Math.max(0.7 * dpr, strutPx * 0.032);
  const nx  = -dy / strutPx * hw, ny = dx / strutPx * hw;
  const ang = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, hw, ang, ang + Math.PI);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, hw, ang + Math.PI, ang + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.stroke();
}
