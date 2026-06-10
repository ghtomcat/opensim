/* Landing-gear hardware draw helpers — volumetric tyres (2-D billboard and
   real-3-D), axle pairs, lit 3-D tubes, strut/actuator rods. Extracted from
   outside.js; pure functions over the caller's project / rotateNormal / litBr
   closures and the painter's faces list. */
import { S } from '../core/state.js';
import { _r, _GE, _WB_WING_DEFAULT } from './outside-wb.js';

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

/* ── Landing-gear render pass ─────────────────────────────────────────────
   The full per-frame gear pass moved out of _drawWireframe: closed bay-door
   seams, well cutouts + opening doors, two-tone oleo struts, side stays,
   steerable nose wheel, bogies and the A340 centre leg. Takes the render
   context `rc`; pushes depth-sorted faces into rc.faces. */
export function drawLandingGear(rc) {
  const { ctx, dpr, faces, project, rotateNormal, litBr,
          wbGeo: _wbGeo, ppGeo: _ppGeo, GV_, isF9, isSS, isSV, isPP } = rc;
  /* Gear struts and tires — pushed into face list so they depth-sort with fuselage.
     Gear behaviour is data-driven from the aircraft JSON "gear" block:
       gear.fixed  — never retracts, always drawn, no bay doors (C172/Bf109/F4U)
       gear.tires  — explicit [gearVertexIndex, radius] list; static gear positions
                     (fixed-gear aircraft + the MiG-15, whose gear retracts but
                     whose tires sit at fixed model vertices).
     Aircraft with neither (airliners) use the procedural retractable-gear path. */
  const _gearFixed = !!S.aircraft?.gear?.fixed;
  const _gearTires = S.aircraft?.gear?.tires;
  const _gearP  = _gearFixed ? 1 : (S.gearAnim ?? (S.gear ? 1 : 0));
  const _lerpV3 = (up, dn, t) => [up[0]+(dn[0]-up[0])*t, up[1]+(dn[1]-up[1])*t, up[2]+(dn[2]-up[2])*t];
  /* WB landing-gear geometry — data-driven from the aircraft JSON "gear" block,
     with defaults matching the legacy hardcoded positions so the other widebodies
     render unchanged:
       gear.main: { x (station), y (half-track), len (belly→axle), tireR, axles }
       gear.nose: { x (station), len, tireR }                                     */
  const _gC   = S.aircraft?.gear ?? {};
  const _gwR  = _wbGeo?.r ?? _r;
  const _gNx  = _gC.nose?.x   ?? 0.009;
  const _gNl  = _gC.nose?.len ?? 0.0022;
  const _gMx  = _gC.main?.x   ?? -0.001;
  const _gMy  = _gC.main?.y   ?? 0.0020;
  const _gMl  = _gC.main?.len ?? 0.0032;
  const _nTR  = _gC.nose?.tireR ?? _gwR * 0.12;
  const _mTR  = _gC.main?.tireR ?? _gwR * 0.16;
  const _nHR  = _gC.nose?.hubR;   // measured hub radius (silver), undefined → 0.20·tireR fallback
  const _mHR  = _gC.main?.hubR;
  const _bogPitch  = _mTR * 0.85;   // fore/aft axle spacing in the bogie
  const _gAx  = _gC.main?.axles ?? (_gC.main?.type === 'bogie' ? 2 : 1);
  const _mBay = _gC.main?.bayDoors !== false;   // 737 retracts main wheels exposed → no big bay doors
  /* Oleo-strut radii (shared by the left/right main legs and the centre leg):
     upper-cylinder radius from measured strutR else ≈0.266·tyreR (A350 main is a
     substantial 388 mm ⌀); collar / piston / pivot bosses all scale off it. */
  const _mrU   = _gC.main?.strutR ?? _mTR * 0.266;
  const _mrL   = _mrU * 0.676;   // polished lower piston (slides inside the cylinder)
  const _mrC   = _mrU * 1.41;    // gland-nut collar (fatter band)
  const _bossR = _mrU * 1.765, _bossH = _mrU * 1.294;   // side-stay pivot lugs
  /* Lower body-surface z at station x, lateral y — the belly-fairing super-ellipse
     lobe where x falls inside the fairing span, else the bare fuselage circle.
     Mirrors the fairing math in outside-wb.js so the gear bay doors hug the skin. */
  const _bfG = S.aircraft?.bellyFairing;
  const _bodyLowerZ = (x, y) => {
    const rr = _gwR;
    let z = -Math.sqrt(Math.max(0, rr*rr - y*y));      // bare fuselage circle
    if (_bfG && _bfG.fromX != null && x <= _bfG.fromX && x >= _bfG.toX) {
      const prog = (_bfG.fromX - x) / (_bfG.fromX - _bfG.toX), ramp = 0.26;
      let t = prog < ramp ? prog/ramp : prog > 1-ramp ? (1-prog)/ramp : 1;
      t = t < 1 ? t*t*(3-2*t) : 1;
      const maxHW = _bfG.maxWidth ?? rr, depth = _bfG.maxDepth ?? 0;
      const halfW = rr + t*(maxHW - rr);
      const ztop = rr*(1 - 0.78*t), zbot = -(rr + t*depth);
      const Vz = (ztop-zbot)*0.5, czf = (ztop+zbot)*0.5, nExp = 2 + t*1.1;
      const yn = Math.min(1, Math.abs(y)/halfW);
      const zf = czf - Vz * Math.pow(Math.max(0, 1 - Math.pow(yn, nExp)), 1/nExp);
      if (zf < z) z = zf;
    }
    return z;
  };
  /* A bay door = a curved panel flush with the lower skin, sampled along x so it
     follows the fairing/fuselage curvature. Nudged a hair proud to avoid z-fight. */
  const _drawBayDoor = (xF, xA, y0, y1, col, tag) => {
    const M = 5, ring = [];
    const add = (x, y) => {
      const z = _bodyLowerZ(x, y), rho = Math.hypot(y, z) || 1, e = 0.00004;
      ring.push([x, y + (y/rho)*e, z + (z/rho)*e]);
    };
    for (let k=0;k<=M;k++) add(xF, y0 + (y1-y0)*k/M);
    for (let k=0;k<=M;k++) add(xA, y1 + (y0-y1)*k/M);
    const pj = ring.map(project);
    if (pj.some(p=>!p)) return;
    const avgD = pj.reduce((s,p)=>s+p.d,0)/pj.length;
    faces.push({ avgD, draw: () => {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(pj[0].x, pj[0].y);
      for (let i=1;i<pj.length;i++) ctx.lineTo(pj[i].x, pj[i].y);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(10,12,16,0.92)'; ctx.lineWidth = Math.max(1, dpr*0.9); ctx.stroke();
      /* Reg tag — last two chars of the registration, as on the real nose-gear door */
      if (tag) {
        let cx=0, cy=0; for (const p of pj) { cx+=p.x; cy+=p.y; } cx/=pj.length; cy/=pj.length;
        const h = Math.hypot(pj[0].x-pj[M].x, pj[0].y-pj[M].y);   // across-door span
        const fs = Math.max(5, h * 0.42);
        ctx.fillStyle = 'rgba(40,44,52,0.95)';
        ctx.font = `700 ${fs}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(tag, cx, cy);
      }
      ctx.restore();
    }});
  };
  /* Down (extended) positions; struts retract toward the belly as gearP → 0. */
  const _mStrZ =  _bodyLowerZ(_gMx,  _gMy);
  const _mStrZn = _bodyLowerZ(_gMx, -_gMy);
  const _gvDn = [
    [_gNx, 0,     -_gwR],    [_gNx, 0,     -_gwR - _gNl],
    [_gMx,  _gMy, _mStrZ],   [_gMx,  _gMy, _mStrZ  - _gMl],
    [_gMx, -_gMy, _mStrZn],  [_gMx, -_gMy, _mStrZn - _gMl],
  ];
  const _animGV = _gearTires ? GV_ : [
    _gvDn[0],
    _lerpV3([_gNx + _gNl * 0.75, 0, -_gwR * 0.5], _gvDn[1], _gearP),
    _gvDn[2],
    _lerpV3([_gMx,  _gMy * 0.08, -_gwR * 0.4], _gvDn[3], _gearP),
    _gvDn[4],
    _lerpV3([_gMx, -_gMy * 0.08, -_gwR * 0.4], _gvDn[5], _gearP),
  ];
  /* Closed bay-door panel seams — drawn when the gear is retracted so the door
     outlines stay visible on the belly (flush panels + dark border). When the gear
     is out, the animated bay below (cutout + opening doors) draws instead. */
  if (!isF9 && !isSS && !isSV && !_gearFixed && _gearP <= 0.01) {
    const _dCol = 'rgba(228,230,234,0.96)';
    if (_mBay) {
      const _wL = _mTR * 2.8, _yIn = _gwR * 0.16, _yStr = _gwR * 0.90;
      _drawBayDoor(_gMx + _wL, _gMx - _wL,  _yIn,  _yStr, _dCol);
      _drawBayDoor(_gMx + _wL, _gMx - _wL, -_yIn, -_yStr, _dCol);
    }
    const _rt = (S.aircraft?.registration ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();
    const _nF = _gNx + _nTR * 1.9, _nA = _gNx - _nTR * 1.9;
    _drawBayDoor(_nF, _nA,  0,  _gwR * 0.46, _dCol, _rt);
    _drawBayDoor(_nF, _nA,  0, -_gwR * 0.46, _dCol);
  }
  if (!isF9 && !isSS && !isSV && (_gearFixed || _gearP > 0.01)) {
    const _wbR   = _wbGeo?.r ?? _r;
    const _midV3 = (a, b) => [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
    for (const [a, b] of _GE) {
      if (isPP && _ppGeo?.gearTubes) continue;  // drawn as 3D faces in F_
      if (!_gearTires && a === 0) continue;  // nose strut drawn as two-tone below
      if (!_gearTires && (a === 2 || a === 4)) continue;  // main struts drawn as two-tone below
      const pa = project(_animGV[a]), pb = project(_animGV[b]);
      if (!pa || !pb) continue;
      faces.push({ avgD: (pa.d+pb.d)/2, draw: () => { ctx.save(); drawStrutTube(ctx, pa, pb, dpr); ctx.restore(); } });
    }
    /* Landing-gear bay doors — retractable-gear aircraft only. */
    if (!_gearFixed) {
      const _dCol = 'rgba(228,230,234,0.96)';
      const _nz   = (v, e) => { const y=v[1], z=v[2], rho=Math.hypot(y,z)||1; return [v[0], y+(y/rho)*e, z+(z/rho)*e]; };
      /* Curved door panel: sampled M×2 along (x, param s) so it follows the fairing
         cross-section instead of being a flat quad. ptFn(x, s) → 3D point. */
      const _curvedPanel = (xF, xA, s0, s1, ptFn, fill, stroke, bias=0) => {
        const M = 4, fwd = [], aft = [];
        for (let k=0;k<=M;k++){ const s=s0+(s1-s0)*k/M; fwd.push(ptFn(xF,s)); aft.push(ptFn(xA,s)); }
        const p = [...fwd, ...aft.reverse()].map(project);
        if (p.some(q=>!q)) return;
        faces.push({ avgD: p.reduce((s,q)=>s+q.d,0)/p.length + bias, draw: () => {
          ctx.save(); ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y);
          for (let i=1;i<p.length;i++) ctx.lineTo(p[i].x,p[i].y);
          ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
          ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, dpr*0.9); ctx.stroke();
          ctx.restore();
        }});
      };
      /* Main gear: dark wheel-well cutout + big bay doors that open mid-cycle and
         close again once the gear is down/up (a tent function of _gearP), leaving
         only the strut-width leg door open. All panels follow the fairing curve. */
      const _bigOpen = Math.max(0, Math.min(1, (0.5 - Math.abs(_gearP - 0.5)) / 0.42));
      const _bθ = _bigOpen * Math.PI * 0.5;
      for (const [sign, top, axle] of [[1, 2, 3], [-1, 4, 5]]) {
        const _wL   = _mTR * 2.8;                       // well fore/aft half-length
        const _yIn  = sign * _gwR * 0.16;               // inboard well edge
        const _yStr = sign * _gwR * 0.90;               // fairing edge — big door stays on the fairing
        const _yLeg = sign * _gMy;                      // strut (leg door reaches out to here)
        const _aIn  = Math.abs(_yIn);
        /* (a) dark well cutout — the full well opening, centreline out to the strut */
        _curvedPanel(_gMx+_wL, _gMx-_wL, _yIn, _yLeg,
          (x,y) => _nz([x, y, _bodyLowerZ(x,y)], 0.00002),
          'rgba(10,12,16,0.96)', 'rgba(0,0,0,0.80)', 1e-6);
        /* (b) big bay door — curved panel hinged at _yIn; conforms to the fairing
           when closed (_bθ=0) and rotates rigidly down about the hinge when open.
           Suppressed when gear.main.bayDoors === false (737: exposed main wheels). */
        if (_mBay) _curvedPanel(_gMx+_wL, _gMx-_wL, _yIn, _yStr, (x,y) => {
          const zH = _bodyLowerZ(x, _yIn), zc = _bodyLowerZ(x, y);
          const ay = Math.abs(y) - _aIn, dz = zc - zH;
          const L = Math.hypot(ay, dz), φ = Math.atan2(dz, ay);
          return _nz([x, sign*(_aIn + L*Math.cos(φ-_bθ)), zH + L*Math.sin(φ-_bθ)], 0.00006);
        }, _dCol, 'rgba(10,12,16,0.92)');
        /* (c) strut leg door — pinned to the OUTBOARD edge of the leg, covering the upper
           part of the leg (the bit inside the well opening); the wheels retract into the
           fairing, so the door stops well short of the axle. Follows the strut as it folds. */
        const _hl=_mTR*1.3, _stT=_animGV[top], _stA=_animGV[axle], _dEnd=0.45;
        _curvedPanel(_gMx+_hl, _gMx-_hl, 0, 1, (x,u) => {
          const t    = u * _dEnd;                            // 0 = well opening → _dEnd down the leg
          const legY = _stT[1] + (_stA[1] - _stT[1]) * t;    // leg centreline y at this height
          const z    = _stT[2] + (_stA[2] - _stT[2]) * t;
          return _nz([x, legY + sign*_mrU, z], 0.00006);     // outboard edge of the strut
        }, _dCol, 'rgba(10,12,16,0.92)');
      }
      /* Nose bay — the starboard leaf carries the reg tag (last two chars), as on
         many real airliners (e.g. "ME" of HB-JME on the nose-gear door). */
      const _regTag = (S.aircraft?.registration ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();
      const _nF = _gNx + _nTR * 1.9, _nA = _gNx - _nTR * 1.9;
      _drawBayDoor(_nF, _nA,  0.0003,  _gwR * 0.46, _dCol, _regTag);
      _drawBayDoor(_nF, _nA, -0.0003, -_gwR * 0.46, _dCol);
    }
    if (!_gearTires) {
      /* Nose strut — upper barrel (dark metal) + lower polished piston, real 3-D */
      const _nTop = _animGV[0], _nBot = _animGV[1];
      const _nJunc  = _lerpV3(_nTop, _nBot, 0.75);   // cylinder 75% / piston 25%
      const _nHinge = _lerpV3(_nTop, _nBot, 0.50);   // retraction-rod hinge (mid cylinder)
      const pNMid = project(_nHinge);
      const _nrU = _gC.nose?.strutR ?? _nTR * 0.18;   // measured (A350 nose 216 mm ⌀) or ratio
      const _nrL = _nrU * 0.667;                        // polished lower piston
      pushTube3D(faces, _nTop,  _nJunc, _nrU, _nrU, [70, 80, 96],    project, rotateNormal, litBr, 8, 0.16);
      pushTube3D(faces, _nJunc, _nBot,  _nrL, _nrL, [200, 212, 226], project, rotateNormal, litBr, 8, 0.20);
      /* Retraction rod — hinge on forward face of upper barrel, rod to forward well structure */
      const _nFwdAtt = [_gNx + 0.0015, 0, -_wbR + 0.0004];
      const pNFwd = project(_nFwdAtt);
      if (pNFwd && pNMid) faces.push({ avgD: (pNFwd.d+pNMid.d)/2, draw: () => {
        ctx.save(); drawActuatorRod(ctx, pNFwd, pNMid, dpr); ctx.restore();
      }});
      /* Nose-strut attachment boss — real 3-D lateral pivot lug at the rod hinge
         (lighter than the main-gear lugs, same treatment). */
      pushTube3D(faces, [_nHinge[0], _nHinge[1]+_nrU*1.15, _nHinge[2]], [_nHinge[0], _nHinge[1]-_nrU*1.15, _nHinge[2]],
                 _nrU*1.5, _nrU*1.5, [120, 132, 150], project, rotateNormal, litBr, 8, 0.24, true);
      /* Main struts — real 3-D oleo shock: dark upper cylinder, gland-nut collar at
         its base where the polished silver lower piston slides out, plus the two
         load-bearing side-stay attachment bosses (big lateral pivot lugs). */
      for (const [gv2, gv3] of [[2, 3], [4, 5]]) {
        const _mTop = _animGV[gv2], _mBot = _animGV[gv3];
        const _mMid  = _lerpV3(_mTop, _mBot, 0.75);   // cylinder 75% / piston 25%
        const _mColT = _lerpV3(_mTop, _mBot, 0.67);   // gland collar at the cylinder base
        pushTube3D(faces, _mTop,  _mMid, _mrU, _mrU, [70, 80, 96],    project, rotateNormal, litBr, 10, 0.16);
        pushTube3D(faces, _mMid,  _mBot, _mrL, _mrL, [200, 212, 226], project, rotateNormal, litBr, 10, 0.20);
        pushTube3D(faces, _mColT, _mMid, _mrC, _mrC, [50, 58, 72],    project, rotateNormal, litBr, 10, 0.14, true);  // gland-nut collar
        /* Side-stay attachment bosses — prominent pivot lugs. Pin axis follows the
           leg as it swings inboard (axle = X × legDir), same as the wheel axle, so the
           lugs rotate with the strut instead of staying lateral. */
        let _bax = [0, -(_mBot[2] - _mTop[2]), _mBot[1] - _mTop[1]];
        const _bm = Math.hypot(_bax[1], _bax[2]) || 1; _bax = [0, _bax[1]/_bm, _bax[2]/_bm];
        for (const f of [0.502, 0.192]) { const c = _lerpV3(_mTop, _mBot, f);
          pushTube3D(faces, [c[0]+_bax[0]*_bossH, c[1]+_bax[1]*_bossH, c[2]+_bax[2]*_bossH],
                            [c[0]-_bax[0]*_bossH, c[1]-_bax[1]*_bossH, c[2]-_bax[2]*_bossH],
                     _bossR, _bossR, [120, 132, 150], project, rotateNormal, litBr, 8, 0.24, true); }
      }

      /* Main gear side stays — fore + aft folding braces, real 3-D tubes. The mid
         knuckles get small pivot-joint bosses (the real brace folds there on a pin;
         the actual rack-and-pinion is sub-visible at this scale, so we read it as a
         pin joint). pushTube3D builds from the live points, so the braces flex as the
         leg swings inboard. */
      const _srR = _mrU * 0.42;                     // brace rod radius
      const _jR  = _mrU * 0.72, _jH = _mrU * 0.50;  // pivot-joint boss
      const _ROD = [120, 132, 150], _JNT = [142, 152, 168];
      /* Side-stay upper ends attach to the WING gear well, not the belly. Seat them on the
         wing lower surface (same root→break→tip interpolation the flap-track fairings use)
         at the edge where the wing meets the belly fairing — the fairing's outboard edge
         (maxWidth), where the gear flap covering the wing part of the well begins. */
      const _ssWg  = S.aircraft?.wing ?? _wbGeo?.wing ?? _WB_WING_DEFAULT;
      const _ssWR  = _gwR * 0.7071;
      const _ssSh  = (_ssWg.rootZ ?? -_ssWR) + _ssWR;
      const _ssBrk = (_ssWg.span ?? 0.0267) * (_ssWg.flapBreak ?? 0.58);
      const _ssZR  = -_ssWR + _ssSh;
      const _ssZB  = -_ssWR + (_ssWg.flapBreak ?? 0.58) * ((_ssWg.dihedral ?? 0) + _ssWR) + _ssSh;
      const _ssZT  = (_ssWg.dihedral ?? 0) + _ssSh;
      const _ssWingZ = (ya) => ya <= _ssBrk
        ? _ssZR + (ya - _ssWR) / Math.max(_ssBrk - _ssWR, 1e-9) * (_ssZB - _ssZR)
        : _ssZB + (ya - _ssBrk) / Math.max((_ssWg.span ?? 0.0267) - _ssBrk, 1e-9) * (_ssZT - _ssZB);
      const _ssTopY = S.aircraft?.bellyFairing?.maxWidth ?? _gwR;   // wing ↔ fairing meeting edge
      const _ssTopZ = _ssWingZ(_ssTopY);
      const _ssHalfW = _mTR * 2.8;                  // fore/aft span = the gear-flap half-width (= bay-door _wL)
      for (const [sign, gv2, gv3] of [[+1, 2, 3], [-1, 4, 5]]) {
        const strBkt  = _lerpV3(_animGV[gv2], _animGV[gv3], 0.502);
        const strBkt2 = _lerpV3(_animGV[gv2], _animGV[gv3], 0.192);
        const frTop = [_gMx + _ssHalfW, sign * _ssTopY, _ssTopZ];   // fore brace at the flap leading edge
        const arTop = [_gMx - _ssHalfW, sign * _ssTopY, _ssTopZ];   // aft brace at the flap trailing edge
        const frMid    = _midV3(frTop, strBkt);
        const arMid    = _midV3(arTop, strBkt);
        const redFrMid = _midV3(strBkt2, frMid);
        const redArMid = _midV3(strBkt2, arMid);
        /* fore + aft braces: belly attachment → lower strut bracket */
        pushTube3D(faces, frTop, strBkt, _srR, _srR, _ROD, project, rotateNormal, litBr, 7, 0.20);
        pushTube3D(faces, arTop, strBkt, _srR, _srR, _ROD, project, rotateNormal, litBr, 7, 0.20);
        /* secondary lock links: upper bracket → mid knuckle */
        pushTube3D(faces, strBkt2, frMid, _srR*0.85, _srR*0.85, _ROD, project, rotateNormal, litBr, 7, 0.20);
        pushTube3D(faces, strBkt2, arMid, _srR*0.85, _srR*0.85, _ROD, project, rotateNormal, litBr, 7, 0.20);
        /* pivot-joint bosses at the folding knuckles (short fore-aft pin) */
        for (const c of [frMid, arMid, redFrMid, redArMid])
          pushTube3D(faces, [c[0]+_jH, c[1], c[2]], [c[0]-_jH, c[1], c[2]], _jR, _jR, _JNT,
                     project, rotateNormal, litBr, 8, 0.26, true);

        /* Outboard gear-leg door (gear.main.door) — the side-stays fold the leg
           inboard, and this door closes the wheel well; when extended it hangs on
           the outboard side of the leg. A flat body-coloured panel. */
        if (_gC.main?.door) {
          const _dHW = _mTR * 1.6;                       // door half-length (fore/aft)
          const _dYo = sign * (_gMy + _mTR * 0.85);      // outboard of the bogie
          const _dZt = -_wbR + 0.0002;                   // top at the belly
          const _dZb = _animGV[gv3][2] + _mTR * 0.8;     // bottom above the axle
          const _dPts = [
            [_gMx + _dHW, _dYo, _dZt], [_gMx - _dHW, _dYo, _dZt],
            [_gMx - _dHW, _dYo, _dZb], [_gMx + _dHW, _dYo, _dZb],
          ].map(project);
          if (_dPts.every(Boolean)) {
            const _dD = _dPts.reduce((s, p) => s + p.d, 0) / 4;
            faces.push({ avgD: _dD, draw: () => {
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(_dPts[0].x, _dPts[0].y);
              for (let i = 1; i < 4; i++) ctx.lineTo(_dPts[i].x, _dPts[i].y);
              ctx.closePath();
              ctx.fillStyle   = 'rgba(228,230,234,0.97)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(120,130,145,0.85)';
              ctx.lineWidth   = dpr * 0.9;
              ctx.stroke();
              ctx.restore();
            }});
          }
        }
      }
    }
    if (_gearTires) {
      for (const [vi, tR, hubR] of _gearTires) {
        const wc = GV_[vi], pt = project(wc);
        if (pt) faces.push({ avgD: pt.d, draw: () => { ctx.save(); drawVolumetricTire(ctx, wc, tR, project, hubR); ctx.restore(); } });
      }
    } else {
      const _gearCfg   = S.aircraft?.gear ?? {};

      /* Nose gear — steerable: deflect the wheel with the ground steering command
         (heading error hdgT−hdg) while on the ground, centred in the air. The strut is
         a symmetric cylinder so only the wheel turns, about the vertical (Z) axis. */
      { const wc = _animGV[1], pt = project(wc);
        let _steerAx;
        if (S.wow) {
          let _sa;
          if (S.aircraft?.manualControl) {
            _sa = (S.steer ?? 0) * 70 * Math.PI / 180;                    // tiller, up to ±70°
          } else {
            const _he = (((S.hdgT ?? S.hdg) - S.hdg + 540) % 360) - 180;  // AP: signed heading error
            _sa = Math.max(-45, Math.min(45, _he * 4)) * Math.PI / 180;
          }
          if (S.pushbackStart && !S.pushbackDone) _sa = -_sa;            // rolling backwards → wheel steers opposite
          _steerAx = [-Math.sin(_sa), Math.cos(_sa), 0];
        }
        if (pt) pushTirePair(faces, wc, _nTR, _nHR, project, rotateNormal, litBr, _steerAx); }

      /* Main gear — N-axle bogie (fore/aft) or a single pair (gear.main.axles).
         The leg swings inboard about the fore-aft (X) axis, so the wheel axle tilts
         with it: axle = X × legDir = [0, -legZ, legY]. Extended → [0,1,0] (lateral). */
      for (const vi of [3, 5]) {
        const wc = _animGV[vi], top = _animGV[vi - 1], pt = project(wc);
        if (!pt) continue;
        let _ax = [0, -(wc[2] - top[2]), wc[1] - top[1]];
        const _am = Math.hypot(_ax[1], _ax[2]) || 1; _ax = [0, _ax[1]/_am, _ax[2]/_am];
        if (_gAx >= 2) {
          const ends = [];
          for (let k = 0; k < _gAx; k++) {
            const off = (k - (_gAx - 1) / 2) * 2 * _bogPitch;
            const wck = [wc[0] + off, wc[1], wc[2]];
            pushTirePair(faces, wck, _mTR, _mHR, project, rotateNormal, litBr, _ax);
            const pk = project(wck); if (pk) ends.push(pk);
          }
          if (ends.length >= 2) { const e0 = ends[0], e1 = ends[ends.length - 1];
            faces.push({ avgD: (e0.d + e1.d) / 2, draw: () => { ctx.save(); drawStrutTube(ctx, e0, e1, dpr); ctx.restore(); } }); }
        } else {
          pushTirePair(faces, wc, _mTR, _mHR, project, rotateNormal, litBr, _ax);
        }
      }

      /* Center gear — bogie on centerline (A340 etc.); same 3-D oleo as the main legs:
         dark cylinder (75%) + gland collar + silver piston (25%), down the centerline. */
      if (_gearCfg.center && _gearP > 0.01) {
        const _cgX   = _gearCfg.center?.x ?? (_gMx - _mTR * 4);  // a bit aft of the mains (or measured)
        const _cgLen = _gearCfg.center?.len ?? 0.0032;           // fuselage→axle (measured or default)
        const _cgTop = [_cgX, 0, -_wbR];                          // belly attachment (pivot hinge)
        /* Retracts forward + up like the nose leg: the wheel swings forward about the
           belly hinge (forward throw ≈ leg length, so the leg length stays ~constant). */
        const _cgFwd = _cgLen * 0.94, _cgUp = _cgLen * 0.31;
        const _cgWhl = _lerpV3([_cgX + _cgFwd, 0, -_wbR + _cgUp], [_cgX, 0, -_wbR - _cgLen], _gearP);
        const _cgMid  = _lerpV3(_cgTop, _cgWhl, 0.75);
        const _cgColT = _lerpV3(_cgTop, _cgWhl, 0.67);
        pushTube3D(faces, _cgTop,  _cgMid, _mrU, _mrU, [70, 80, 96],    project, rotateNormal, litBr, 10, 0.16);
        pushTube3D(faces, _cgMid,  _cgWhl, _mrL, _mrL, [200, 212, 226], project, rotateNormal, litBr, 10, 0.20);
        pushTube3D(faces, _cgColT, _cgMid, _mrC, _mrC, [50, 58, 72],    project, rotateNormal, litBr, 10, 0.14, true);
        /* diagonal drag brace — kept 2-D for now, like the main side-stays */
        const cgPivotA = project([_cgX, 0, -_wbR * 0.50]);
        const cgPivotM = project(_midV3(_cgTop, _cgWhl));
        if (cgPivotA && cgPivotM)
          faces.push({ avgD: (cgPivotA.d+cgPivotM.d)/2, draw: () => { ctx.save(); drawStrutTube(ctx, cgPivotA, cgPivotM, dpr); ctx.restore(); } });
        /* center bogie tires + axle-beam cross tube */
        const _cbp = _bogPitch;
        const wcF = [_cgWhl[0]+_cbp, _cgWhl[1], _cgWhl[2]], wcA = [_cgWhl[0]-_cbp, _cgWhl[1], _cgWhl[2]];
        pushTirePair(faces, wcF, _mTR, _mHR, project, rotateNormal, litBr);
        pushTirePair(faces, wcA, _mTR, _mHR, project, rotateNormal, litBr);
        const pF = project(wcF), pA = project(wcA);
        if (pF && pA) faces.push({ avgD: (pF.d+pA.d)/2, draw: () => { ctx.save(); drawStrutTube(ctx, pF, pA, dpr); ctx.restore(); } });
      }
    }
  }

  /* (Legacy belly-hinged gear bay doors removed — superseded by the data-driven,
     fairing-conforming bay doors drawn in the gear block above.) */
}
