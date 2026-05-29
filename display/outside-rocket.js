/* OpenSim — display/outside-rocket.js
   Self-contained rocket/Starship draw helpers extracted from outside.js.
   These are pure ctx/canvas painters (no module-state coupling) called by
   the camera renderers and _drawWireframe, which remain in outside.js. */
import { S } from '../core/state.js';
import { buildTube, _buildRocket } from './outside-shared.js';
import { _svcr, _svcr2 } from './outside-space.js';

const DEG   = Math.PI / 180;
const FT_NM = 1 / 6076.12;
const FOV_H = 70;

/* Rocket geometry cache for Starship / data-driven rocket vehicles */
export const _ssRocketCache_mut = {};

/* ── Starship reentry plasma sheath overlay ───────────────────────
   Draws ionised-air glow after terrain but before the wireframe.
   Active 80→10 km after SECO.  Real hypersonic plasma is pink/magenta
   (ionised N₂/O₂), not orange.  Side cam gets an elongated ellipse
   spanning the full belly; chase cam gets a circular halo. */
export function _drawSSReentryPlasma(canvas, cx, cy, camBackNm, bellySide = false) {
  if (S.aircraft?.id !== 'starship' || !S.rocketSECO) return;
  const altKm = (S.alt ?? 0) * 0.0003048;
  if (altKm < 10 || altKm > 80) return;

  const heat = Math.min(1, (altKm - 10) / 45);  // 0 at 10 km, 1 at 55 km
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.save();

  if (bellySide) {
    /* Side cam: elongated ellipse along body axis, biased toward belly.
       Screen-fraction sizing is immune to wireframe auto-fit scaling.  */
    const halfLen = W * 0.28 * heat;
    const halfWid = H * 0.09 * heat;
    if (halfLen < 2 || halfWid < 2) { ctx.restore(); return; }
    const bellyOff = H * 0.04;
    ctx.translate(cx, cy + bellyOff);
    ctx.scale(halfLen / halfWid, 1);           // stretch circle → ellipse

    const cA = 0.55 + heat * 0.30;
    const g  = ctx.createRadialGradient(0, 0, halfWid * 0.10, 0, 0, halfWid);
    g.addColorStop(0,    `rgba(255,240,255,${cA.toFixed(2)})`);
    g.addColorStop(0.20, `rgba(255,130,210,${(cA * 0.75).toFixed(2)})`);
    g.addColorStop(0.45, `rgba(230,50,160,${(cA * 0.40).toFixed(2)})`);
    g.addColorStop(0.72, 'rgba(180,10,100,0.08)');
    g.addColorStop(1,    'rgba(140,0,60,0)');

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, halfWid, 0, Math.PI * 2);
    ctx.fill();
  } else {
    /* Chase cam: circular halo centred on body.                        */
    const focal  = (W / 2) / Math.tan(FOV_H / 2 * DEG);
    const bodyR  = Math.max(8 * devicePixelRatio, 0.00243 / camBackNm * focal);
    const outerR = Math.max(bodyR * 8, H * 0.16 * heat);

    const cA = 0.52 + heat * 0.35;
    const g  = ctx.createRadialGradient(cx, cy, bodyR * 0.4, cx, cy, outerR);
    g.addColorStop(0,    `rgba(255,240,255,${cA.toFixed(2)})`);
    g.addColorStop(0.20, `rgba(255,130,210,${(cA * 0.70).toFixed(2)})`);
    g.addColorStop(0.48, `rgba(230,50,160,${(cA * 0.32).toFixed(2)})`);
    g.addColorStop(0.76, 'rgba(180,10,100,0.06)');
    g.addColorStop(1,    'rgba(140,0,60,0)');

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ── CSM orbit-mode detail — windows, panel seams, RCS, soot streaks ─
   Called from _drawWireframe when isSV && S.rocketOrbit is true.
   Uses the live project() closure and already-computed pts array.    */
export function _drawCSMOrbitDetail(ctx, pts, project, dpr, camSide) {
  if (camSide <= 0) return;   // side cam only; chase-cam depth check doesn't apply

  const smBase = 0.024, cmBase = 0.027, cmTop = 0.030;

  const smDamaged  = S.smDamaged ?? false;
  const smAge      = smDamaged ? Math.max(0, (S.time ?? 0) - (S.smExplosionT ?? 0)) : Infinity;
  const _o2BayAng  = Math.PI / 3;   // 60° — bay 1, O₂ tank 2 location

  /* CM cone radius at a given longitudinal position */
  function cmR(vF) {
    const t = (vF - cmBase) / (cmTop - cmBase);
    return _svcr * (1 - t) + _svcr2 * t;
  }

  /* Body-frame vertex on the CM cone at angle theta and longitudinal vF.
     Angle convention: π/2 = top (+z), 0 = right (+y), matching buildTube. */
  function cv(vF, theta) {
    const r = cmR(vF);
    return [vF, r * Math.cos(theta), r * Math.sin(theta)];
  }

  /* Draw a 4-corner quad as a glass window.
     Skips back-facing quads (2D winding check) and sub-pixel quads. */
  function drawWindow(q) {
    const ps = q.map(project);
    if (ps.some(p => !p)) return;
    const cross = (ps[1].x-ps[0].x)*(ps[2].y-ps[0].y) - (ps[1].y-ps[0].y)*(ps[2].x-ps[0].x);
    if (cross < 0) return;
    if (Math.hypot(ps[2].x-ps[0].x, ps[2].y-ps[0].y) < 2 * dpr) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ps[0].x, ps[0].y); ctx.lineTo(ps[1].x, ps[1].y);
    ctx.lineTo(ps[2].x, ps[2].y); ctx.lineTo(ps[3].x, ps[3].y);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(12, 22, 44, 0.93)'; ctx.fill();
    ctx.strokeStyle = 'rgba(155, 210, 250, 0.28)';
    ctx.lineWidth   = 0.8 * dpr; ctx.stroke();
    ctx.restore();
  }

  /* Visibility check: surface point at angle ang is on the front side if its
     projected depth is less than the SM axis centre depth. Valid for camSide > 0. */
  const smMidF  = (smBase + cmBase) * 0.5;
  const pCenter = project([smMidF, 0, 0]);
  function frontSide(ang) {
    const p = project([smMidF, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    return p && pCenter && p.d < pCenter.d;
  }

  /* ── CM windows (5 total) ──────────────────────────────────────── */
  const wF0 = cmBase + 0.0005;
  const wF1 = cmBase + 0.0014;

  /* Two forward crew windows: upper-right (θ ≈ +45°) and upper-left (θ ≈ +135°) */
  for (const [th, s] of [[Math.PI / 4, 1], [Math.PI * 3 / 4, -1]]) {
    if (!frontSide(th)) continue;
    drawWindow([cv(wF0, th - 0.13 * s), cv(wF0, th + 0.13 * s),
                cv(wF1, th + 0.13 * s), cv(wF1, th - 0.13 * s)]);
  }

  /* Two rendezvous windows: +y and -y sides (smaller) */
  const rvF1 = wF0 + 0.0008;
  for (const th of [0, Math.PI]) {
    if (!frontSide(th)) continue;
    drawWindow([cv(wF0, th - 0.09), cv(wF0, th + 0.09),
                cv(rvF1, th + 0.09), cv(rvF1, th - 0.09)]);
  }

  /* Top hatch window: centred on +z (top of CM) */
  if (frontSide(Math.PI / 2)) {
    drawWindow([cv(cmBase + 0.0003, Math.PI / 2 - 0.07), cv(cmBase + 0.0003, Math.PI / 2 + 0.07),
                cv(cmBase + 0.0010, Math.PI / 2 + 0.07), cv(cmBase + 0.0010, Math.PI / 2 - 0.07)]);
  }

  /* ── CM nose endcap — flat disc at Ring 9 (vF=0.030) after LES jettison ── */
  if (S.lesJettisoned) {
    const N16 = 16;
    const nosePts = [];
    for (let si = 0; si < N16; si++) {
      const theta = (si / N16) * Math.PI * 2;
      const p = project([cmTop, _svcr2 * Math.cos(theta), _svcr2 * Math.sin(theta)]);
      nosePts.push(p);
    }
    if (nosePts.every(p => p)) {
      const cross = (nosePts[1].x - nosePts[0].x) * (nosePts[2].y - nosePts[0].y)
                  - (nosePts[1].y - nosePts[0].y) * (nosePts[2].x - nosePts[0].x);
      if (cross > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(nosePts[0].x, nosePts[0].y);
        for (let si = 1; si < N16; si++) ctx.lineTo(nosePts[si].x, nosePts[si].y);
        ctx.closePath();
        ctx.fillStyle   = '#c4c0b8';
        ctx.fill();
        ctx.strokeStyle = 'rgba(145, 138, 128, 0.60)';
        ctx.lineWidth   = 0.7 * dpr; ctx.stroke();
        ctx.restore();
        /* Docking probe collar nub */
        const probP = project([cmTop + 0.00025, 0, 0]);
        if (probP) {
          ctx.save();
          ctx.beginPath(); ctx.arc(probP.x, probP.y, 2.0 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = '#9a948a'; ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  /* ── SM panel seams — 6 bays at 60° intervals ───────────────────── */
  ctx.save();
  ctx.strokeStyle = 'rgba(78, 60, 26, 0.36)';
  ctx.lineWidth   = 0.65 * dpr;
  for (let s = 0; s < 6; s++) {
    if (smDamaged && s === 1) continue;  // bay 1 panel blown off
    const ang = (s / 6) * Math.PI * 2;
    if (!frontSide(ang)) continue;
    const p7 = project([smBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    const p8 = project([cmBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    if (!p7 || !p8) continue;
    ctx.beginPath(); ctx.moveTo(p7.x, p7.y); ctx.lineTo(p8.x, p8.y); ctx.stroke();
  }
  ctx.restore();

  /* ── SM RCS — 4 quad pods at 45°/135°/225°/315° ────────────────── */
  const rcsvF  = smBase + 0.0020;   // mid-SM, upper region
  const rcsOut = _svcr * 1.18;      // outer face (protruding ~0.35 m from SM skin)
  const da     = 0.12;              // angular half-width of pod  (≈ 14°)
  const dvF    = 0.00028;           // axial half-height of pod

  /* Nozzle bell dimensions (frustum = 6-sided, cone-shaped) */
  const bellR   = _svcr * 0.070;   // bell mouth radius
  const throatR = bellR  * 0.50;   // throat (inner) radius
  const bellD   = _svcr  * 0.12;   // how far bell protrudes beyond pod face

  for (let q = 0; q < 4; q++) {
    const ang = q * Math.PI / 2 + Math.PI / 4;
    if (!frontSide(ang)) continue;

    /* Build pod corners — outer face at rcsOut, inner face at _svcr */
    const Co = (a, f) => [f, rcsOut  * Math.cos(a), rcsOut  * Math.sin(a)];
    const Ci = (a, f) => [f, _svcr   * Math.cos(a), _svcr   * Math.sin(a)];
    const oc = [Co(ang-da, rcsvF-dvF), Co(ang+da, rcsvF-dvF),
                Co(ang+da, rcsvF+dvF), Co(ang-da, rcsvF+dvF)];
    const ic = [Ci(ang-da, rcsvF-dvF), Ci(ang+da, rcsvF-dvF),
                Ci(ang+da, rcsvF+dvF), Ci(ang-da, rcsvF+dvF)];
    const po = oc.map(project), pi = ic.map(project);
    if (!po.every(p => p) || !pi.every(p => p)) continue;

    /* Front face */
    const fwc = (po[1].x-po[0].x)*(po[2].y-po[0].y) - (po[1].y-po[0].y)*(po[2].x-po[0].x);
    if (fwc > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(po[0].x, po[0].y); ctx.lineTo(po[1].x, po[1].y);
      ctx.lineTo(po[2].x, po[2].y); ctx.lineTo(po[3].x, po[3].y);
      ctx.closePath();
      ctx.fillStyle = '#12151d'; ctx.fill();
      ctx.strokeStyle = 'rgba(130, 148, 170, 0.45)'; ctx.lineWidth = 0.7 * dpr; ctx.stroke();
      ctx.restore();
    }

    /* Side walls — 4 faces connecting outer face to SM skin */
    ctx.save();
    const walls = [
      [po[3], po[0], pi[0], pi[3]],   // aft-vF wall
      [po[1], po[2], pi[2], pi[1]],   // fwd-vF wall
      [po[0], po[1], pi[1], pi[0]],   // ang- wall
      [po[2], po[3], pi[3], pi[2]],   // ang+ wall
    ];
    for (const w of walls) {
      if (w.some(p => !p)) continue;
      const wc = (w[1].x-w[0].x)*(w[2].y-w[0].y) - (w[1].y-w[0].y)*(w[2].x-w[0].x);
      if (wc <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(w[0].x, w[0].y); ctx.lineTo(w[1].x, w[1].y);
      ctx.lineTo(w[2].x, w[2].y); ctx.lineTo(w[3].x, w[3].y);
      ctx.closePath();
      ctx.fillStyle = '#1c2130'; ctx.fill();
      ctx.strokeStyle = 'rgba(110, 128, 150, 0.30)'; ctx.lineWidth = 0.5 * dpr; ctx.stroke();
    }
    ctx.restore();

    /* 4 nozzle bells — 2×2 grid; each is a truncated-cone frustum (6-sided) */
    const Np = 6;
    for (const nda of [-da * 0.52, da * 0.52]) {
      for (const ndvF of [-dvF * 0.52, dvF * 0.52]) {
        const a = ang + nda;
        /* Tangent axes perpendicular to the radial nozzle-axis [0, cos(a), sin(a)] */
        const ax1 = [1, 0, 0];                                 /* vF direction */
        const ax2 = [0, -Math.sin(a), Math.cos(a)];           /* circumferential */

        /* Throat sits at pod face; bell rim is bellD further outward */
        const tc = [rcsvF + ndvF,  rcsOut * Math.cos(a),               rcsOut * Math.sin(a)];
        const bc = [tc[0],         tc[1] + bellD * Math.cos(a),        tc[2] + bellD * Math.sin(a)];

        const bPts = [], tPts = [];
        for (let k = 0; k < Np; k++) {
          const phi = k * Math.PI * 2 / Np;
          const cp = Math.cos(phi), sp = Math.sin(phi);
          const off = (r, ctr) => [
            ctr[0] + r * (cp * ax1[0] + sp * ax2[0]),
            ctr[1] + r * (cp * ax1[1] + sp * ax2[1]),
            ctr[2] + r * (cp * ax1[2] + sp * ax2[2]),
          ];
          bPts.push(off(bellR,   bc));
          tPts.push(off(throatR, tc));
        }
        const bp = bPts.map(project), tp = tPts.map(project);
        if (!bp.every(p => p) || !tp.every(p => p)) continue;

        /* Skip if bell mouth faces away from camera */
        const bwc = (bp[1].x-bp[0].x)*(bp[2].y-bp[0].y) - (bp[1].y-bp[0].y)*(bp[2].x-bp[0].x);
        if (bwc <= 0) continue;

        ctx.save();
        /* Bell mouth face — dark interior */
        ctx.beginPath();
        ctx.moveTo(bp[0].x, bp[0].y);
        for (let k = 1; k < Np; k++) ctx.lineTo(bp[k].x, bp[k].y);
        ctx.closePath();
        ctx.fillStyle = '#050608'; ctx.fill();
        ctx.strokeStyle = 'rgba(140, 165, 190, 0.72)'; ctx.lineWidth = 0.55 * dpr; ctx.stroke();

        /* Frustum sides (bell rim → throat) */
        ctx.fillStyle = 'rgba(28, 34, 46, 0.90)';
        ctx.strokeStyle = 'rgba(90, 110, 140, 0.38)'; ctx.lineWidth = 0.4 * dpr;
        for (let k = 0; k < Np; k++) {
          const k1 = (k + 1) % Np;
          const sc = (bp[k1].x-bp[k].x)*(tp[k].y-bp[k].y) - (bp[k1].y-bp[k].y)*(tp[k].x-bp[k].x);
          if (sc <= 0) continue;
          ctx.beginPath();
          ctx.moveTo(bp[k].x, bp[k].y); ctx.lineTo(tp[k].x, tp[k].y);
          ctx.lineTo(tp[k1].x, tp[k1].y); ctx.lineTo(bp[k1].x, bp[k1].y);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* ── CM RCS — 12 thrusters in 6 pairs around aft CM section ─────── */
  const cmRcsVF = cmBase - 0.0006;
  const cmRcsR  = _svcr * 1.012;
  const cmNozR  = Math.max(0.8, 1.0 * dpr);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    if (!frontSide(ang)) continue;
    /* Two thrusters per position (subsystem A and B), offset axially */
    for (const [dA, dVF] of [[-0.009, -0.00015], [0.009, 0.00015]]) {
      const n = project([cmRcsVF + dVF, cmRcsR * Math.cos(ang + dA), cmRcsR * Math.sin(ang + dA)]);
      if (!n) continue;
      ctx.beginPath(); ctx.arc(n.x, n.y, cmNozR, 0, Math.PI * 2);
      ctx.fillStyle   = '#0e1115'; ctx.fill();
      ctx.strokeStyle = 'rgba(108, 125, 148, 0.45)';
      ctx.lineWidth   = 0.5 * dpr; ctx.stroke();
    }
  }

  /* ── Soot streaks on SM gold Mylar — gradient lines along SM axis ─ */
  let rng = 0x6b4d2e;
  const lcg = s => ((s * 1664525 + 1013904223) & 0xffffffff) >>> 0;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    rng = lcg(rng); const ang = (rng % 10000) / 10000 * Math.PI * 2;
    if (!frontSide(ang)) { rng = lcg(rng); rng = lcg(rng); continue; }
    rng = lcg(rng); const alpha = 0.07 + (rng % 100) / 1000 * 0.11;
    rng = lcg(rng); const wid   = (1.3 + (rng % 100) / 55) * dpr;
    const pS = project([cmBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    const pE = project([smBase, _svcr * Math.cos(ang), _svcr * Math.sin(ang)]);
    if (!pS || !pE) continue;
    const g = ctx.createLinearGradient(pS.x, pS.y, pE.x, pE.y);
    g.addColorStop(0,    `rgba(8,6,2,${alpha.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(6,5,1,${(alpha * 0.5).toFixed(3)})`);
    g.addColorStop(1,    'rgba(4,3,1,0)');
    ctx.strokeStyle = g; ctx.lineWidth = wid;
    ctx.beginPath(); ctx.moveTo(pS.x, pS.y); ctx.lineTo(pE.x, pE.y); ctx.stroke();
  }
  ctx.restore();

  /* ── O₂ tank 2 explosion damage — bay 1 at 60° ──────────────────── */
  if (smDamaged && frontSide(_o2BayAng)) {
    /* 1. Scorch mark — permanent dark burn around the bay */
    const pScorch = project([smMidF + 0.001, _svcr * Math.cos(_o2BayAng), _svcr * Math.sin(_o2BayAng)]);
    if (pScorch) {
      const sr = 14 * dpr;
      const sg = ctx.createRadialGradient(pScorch.x, pScorch.y, 0, pScorch.x, pScorch.y, sr);
      sg.addColorStop(0,   'rgba(18,12,4,0.92)');
      sg.addColorStop(0.3, 'rgba(30,18,6,0.60)');
      sg.addColorStop(1,   'rgba(50,35,12,0)');
      ctx.save(); ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(pScorch.x, pScorch.y, sr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    /* 2. Bent panel — dark scorched quad sticking outward from bay */
    const da = Math.PI / 6.5;
    const panelOut = _svcr * 0.26;
    const pq = [
      project([smBase + 0.0005, _svcr * Math.cos(_o2BayAng - da * 0.5), _svcr * Math.sin(_o2BayAng - da * 0.5)]),
      project([smBase + 0.0005, _svcr * Math.cos(_o2BayAng + da * 0.5), _svcr * Math.sin(_o2BayAng + da * 0.5)]),
      project([cmBase - 0.0005, (_svcr + panelOut) * Math.cos(_o2BayAng + da * 0.2), (_svcr + panelOut) * Math.sin(_o2BayAng + da * 0.2)]),
      project([cmBase - 0.0005, (_svcr + panelOut) * Math.cos(_o2BayAng - da * 0.2), (_svcr + panelOut) * Math.sin(_o2BayAng - da * 0.2)]),
    ];
    if (pq.every(p => p)) {
      const cross = (pq[1].x - pq[0].x) * (pq[2].y - pq[0].y) - (pq[1].y - pq[0].y) * (pq[2].x - pq[0].x);
      if (cross > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pq[0].x, pq[0].y); ctx.lineTo(pq[1].x, pq[1].y);
        ctx.lineTo(pq[2].x, pq[2].y); ctx.lineTo(pq[3].x, pq[3].y);
        ctx.closePath();
        ctx.fillStyle   = 'rgba(55,42,18,0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,100,35,0.65)';
        ctx.lineWidth   = 0.8 * dpr; ctx.stroke();
        ctx.restore();
      }
    }

    /* 3. Persistent O₂ vent — thin gas trail, fades over 10 minutes */
    if (smAge < 600) {
      const rampIn  = smAge < 1 ? smAge : 1;
      const ventA   = 0.45 * rampIn * Math.max(0, 1 - smAge / 600);
      if (ventA > 0.005) {
        const pVBase = project([smMidF, (_svcr + 0.00005) * Math.cos(_o2BayAng), (_svcr + 0.00005) * Math.sin(_o2BayAng)]);
        const pVTip  = project([smMidF + 0.003, (_svcr + 0.0012) * Math.cos(_o2BayAng + 0.08), (_svcr + 0.0012) * Math.sin(_o2BayAng + 0.08)]);
        if (pVBase && pVTip) {
          const vg = ctx.createLinearGradient(pVBase.x, pVBase.y, pVTip.x, pVTip.y);
          vg.addColorStop(0,   `rgba(210,225,255,${ventA.toFixed(3)})`);
          vg.addColorStop(0.5, `rgba(190,210,255,${(ventA * 0.55).toFixed(3)})`);
          vg.addColorStop(1,   'rgba(180,200,255,0)');
          ctx.save();
          ctx.strokeStyle = vg;
          ctx.lineWidth   = Math.max(1.5, 2.8 * dpr);
          ctx.lineCap     = 'round';
          ctx.beginPath(); ctx.moveTo(pVBase.x, pVBase.y); ctx.lineTo(pVTip.x, pVTip.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* 4. Initial explosion puff — expanding cloud, first 5 seconds */
    if (smAge < 5) {
      const pBay = project([smMidF, _svcr * Math.cos(_o2BayAng), _svcr * Math.sin(_o2BayAng)]);
      if (pBay) {
        const frac  = smAge / 5;
        const puffR = frac * 80 * dpr;
        const puffA = Math.max(0, 1 - frac * frac);
        const pg = ctx.createRadialGradient(pBay.x, pBay.y, 0, pBay.x, pBay.y, Math.max(1, puffR));
        pg.addColorStop(0,    `rgba(255,215,130,${(puffA * 0.95).toFixed(2)})`);
        pg.addColorStop(0.15, `rgba(230,200,160,${(puffA * 0.70).toFixed(2)})`);
        pg.addColorStop(0.45, `rgba(180,185,200,${(puffA * 0.35).toFixed(2)})`);
        pg.addColorStop(1,    'rgba(160,170,200,0)');
        ctx.save();
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(pBay.x, pBay.y, Math.max(1, puffR), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

/* ── Orbital cloud patches — world-space ECEF projection, matches terrain.js projGlobe.
   Clouds sit at fixed lat/lon on Earth's surface so they drift as the spacecraft moves.
   camLat/camLon/camAltFt/camHdgDeg: terrain camera state (may differ from aircraft for
   side/chase cams which render terrain from an offset position).                        */
export function _drawOrbitalClouds(ctx, W, H, pitchDeg, camAltFt, camLat, camLon, camHdgDeg, focalScale = 1) {
  const R_E      = 3438.19;
  const camAltNm = camAltFt * FT_NM;
  if (camAltNm < 30) return;
  const R_ac = R_E + camAltNm;
  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG) * focalScale;
  const cx = W / 2, cy = H / 2;

  /* ECEF basis at camera position — mirrors terrain.js globe setup */
  const aLatR  = camLat * DEG, aLonR = camLon * DEG;
  const sinALat = Math.sin(aLatR), cosALat = Math.cos(aLatR);
  const cosALon = Math.cos(aLonR), sinALon = Math.sin(aLonR);
  const upEx = cosALat*cosALon, upEy = cosALat*sinALon, upEz = sinALat;  // nadir→cam
  const nEx  = -sinALat*cosALon, nEy = -sinALat*sinALon, nEz = cosALat;
  const eEx  = -sinALon, eEy = cosALon, eEz = 0;
  const cH   = camHdgDeg * DEG;
  const cosH = Math.cos(cH), sinH = Math.sin(cH);
  const fEx  = nEx*cosH+eEx*sinH, fEy = nEy*cosH+eEy*sinH, fEz = nEz*cosH+eEz*sinH;
  const rEx  = eEx*cosH-nEx*sinH, rEy = eEy*cosH-nEy*sinH, rEz = eEz*cosH-nEz*sinH;
  const acX  = R_ac*upEx, acY = R_ac*upEy, acZ = R_ac*upEz;
  const pitch = pitchDeg * DEG;
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

  /* Iterate over a world grid at fixed 12° spacing */
  const GSTEP    = 12;
  const maxAng   = Math.acos(Math.min(1, R_E / R_ac)) / DEG + 6;
  const nCells   = Math.ceil(maxAng / GSTEP) + 1;
  const latC     = Math.round(camLat / GSTEP) * GSTEP;
  const lonC     = Math.round(camLon / GSTEP) * GSTEP;

  for (let di = -nCells; di <= nCells; di++) {
    const gLat = latC + di * GSTEP;
    if (gLat < -84 || gLat > 84) continue;

    for (let dj = -nCells; dj <= nCells; dj++) {
      const gLon = ((lonC + dj * GSTEP) % 360 + 540) % 360 - 180;

      /* Stable integer key per cell — consistent across lon ±180 wrap */
      const iLat = (Math.round(gLat / GSTEP) + 8) & 0xFF;
      const iLon = Math.round(((gLon + 180) / GSTEP)) % 30;
      const h1   = (Math.imul(iLat * 137 + iLon, 2654435761) ^ 0xABCD1234) >>> 0;

      if ((h1 & 0xFF) > 76) continue;       // ~30 % cloud cover

      const h2 = (Math.imul(h1, 1234567891) ^ 0xDEAD5678) >>> 0;

      /* Cloud centre jittered within cell */
      const cloudLat = gLat + ((h1 >>  8) & 0xFF) / 255 * GSTEP;
      const cloudLon = ((gLon + ((h1 >> 16) & 0xFF) / 255 * GSTEP) + 360) % 360 - 180;

      const lr  = cloudLat * DEG, lnr = cloudLon * DEG;
      const cLt = Math.cos(lr),  sLt = Math.sin(lr);
      const cLn = Math.cos(lnr), sLn = Math.sin(lnr);

      /* Skip far hemisphere (same guard as terrain.js projGlobe) */
      if (cLt*cLn*upEx + cLt*sLn*upEy + sLt*upEz < 0) continue;

      /* Vector from camera to cloud point on Earth's surface */
      const px = R_E*cLt*cLn - acX;
      const py = R_E*cLt*sLn - acY;
      const pz = R_E*sLt      - acZ;

      /* Project — mirrors terrain.js proj() with roll=0 */
      const fwd   = px*fEx + py*fEy + pz*fEz;
      const right = px*rEx + py*rEy + pz*rEz;
      const up_   = px*upEx + py*upEy + pz*upEz;   // upAdd − altNm in terrain.js notation
      const cf    = fwd*cosP + up_*sinP;
      if (cf < 1e-4) continue;
      const cu    = up_*cosP - fwd*sinP;

      const sx = cx + right/cf * focal;
      const sy = cy - cu/cf * focal;
      if (sx < -W*0.3 || sx > W*1.3 || sy < -H*0.3 || sy > H*1.3) continue;

      /* Screen radius from angular size (2°–5.5° per blob) */
      const angRad = 2.0 + ((h2 & 0xFF) / 255) * 3.5;
      const pxR    = focal * Math.tan(angRad * DEG);

      /* Foreshortening: squarer near nadir, flattened near limb */
      const dist     = Math.sqrt(px*px + py*py + pz*pz);
      const ndot     = -(px*upEx + py*upEy + pz*upEz) / dist;  // 1=nadir 0=limb
      const rx = pxR;
      const ry = pxR * (0.20 + Math.max(0, ndot) * 0.80);
      if (rx < 2 || ry < 1) continue;

      const pa = 0.16 + ((h1 >> 24) & 0xFF) / 255 * 0.42;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(1, ry / rx);
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      grd.addColorStop(0,    `rgba(240,247,255,${pa.toFixed(2)})`);
      grd.addColorStop(0.52, `rgba(235,244,255,${(pa * 0.55).toFixed(2)})`);
      grd.addColorStop(1,    'rgba(228,242,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ── Starship body cam hull overlay ──
   SIDE VIEW: camera on leeward fore body flap (vF=0.030), looking radially outward.
   Ship axis VERTICAL: near/metallic at top, engine end at bottom.
   Large fX makes the hull a wide curved surface (~38% of frame), matching IFT-3 footage. */
export function _drawSSBodyHull(ctx, W, H, dpr) {
  const id = S.aircraft?.id;
  const rg = S.aircraft?.rocketGeometry;
  if (!id || !rg) return;
  if (!_ssRocketCache_mut[id]) _ssRocketCache_mut[id] = _buildRocket(rg);
  const geo    = _ssRocketCache_mut[id];
  const COLORS_ = geo.COLORS_;

  const rBody  = 0.00243;
  const vF_cam = 0.030;
  const vF_far = 0.013;
  const camH   = 2.0;
  const fX     = H * 0.55;   // wide focal → hull silhouette spans ~38% of frame width
  const fY     = H * 0.19;   // vertical focal — hull bottom at ~63% H
  const cx     = W * 0.20;   // leeward center x
  const cy     = H * 0.03;   // near edge at top of frame
  const zClip  = 0.05;
  const zDF    = 0.10;        // axial depth factor → hull tapers toward engine end

  const z_ax_max = (vF_cam - vF_far) / rBody;  // ≈ 7.0

  /* Side-view projection with axial perspective.
     depth = (camH − cos a) + z_ax × zDF
     sin(a) → screen X,  z_ax → screen Y */
  const proj = (sinA, cosA, z_ax) => {
    const depth = (camH - cosA) + z_ax * zDF;
    if (depth < zClip) return null;
    return [
      (sinA  / depth) * fX + cx,
      (z_ax  / depth) * fY + cy,
    ];
  };

  /* Silhouette: cos(a_sil) = 1/camH = 0.5 */
  const cosSil = 1.0 / camH;
  const sinSil = Math.sqrt(1.0 - cosSil * cosSil);  // 0.866

  /* z_ax list */
  const zList = [0];
  for (const ring of (rg.bodyRings ?? [])) {
    if (ring.vF >= vF_far - 0.001 && ring.vF <= vF_cam + 0.001) {
      const z = (vF_cam - ring.vF) / rBody;
      if (!zList.some(zz => Math.abs(zz - z) < 0.12)) zList.push(z);
    }
  }
  for (let z = 0.35; z <= z_ax_max + 0.05; z += 0.35) {
    if (!zList.some(zz => Math.abs(zz - z) < 0.12)) zList.push(z);
  }
  zList.sort((a, b) => a - b);

  const projL = zList.map(z => proj( sinSil, cosSil, z)).filter(Boolean);
  const projR = zList.map(z => proj(-sinSil, cosSil, z)).filter(Boolean);
  if (projL.length < 2) return;

  const sy_near  = cy;
  const sy_far   = proj(sinSil, cosSil, z_ax_max)?.[1] ?? H * 0.88;
  const t_hs     = 0.50;

  const [mr, mg, mb] = COLORS_[1] ?? [206, 211, 218];
  const [hr, hg, hb] = COLORS_[4] ?? [16, 18, 26];

  const drawHullPath = () => {
    ctx.beginPath();
    ctx.moveTo(projL[0][0], projL[0][1]);
    for (let i = 1; i < projL.length; i++) ctx.lineTo(projL[i][0], projL[i][1]);
    for (let i = projR.length - 1; i >= 0; i--) ctx.lineTo(projR[i][0], projR[i][1]);
    ctx.closePath();
  };

  /* ── Axial gradient: metallic (top/near) → heat-shield (bottom/far) ── */
  ctx.save();
  drawHullPath();
  const syBot = Math.min(H * 1.05, sy_far);
  const axGrad = ctx.createLinearGradient(0, sy_near, 0, syBot);
  axGrad.addColorStop(0,                       `rgba(${Math.min(255,mr+20)},${Math.min(255,mg+18)},${Math.min(255,mb+16)},0.97)`);
  axGrad.addColorStop(Math.max(0.02, t_hs - 0.12), `rgba(${mr},${mg},${mb},0.96)`);
  axGrad.addColorStop(t_hs,                    `rgba(${(mr*2+hr)/3|0},${(mg*2+hg)/3|0},${(mb*2+hb)/3|0},0.96)`);
  axGrad.addColorStop(Math.min(0.98, t_hs + 0.08), `rgba(${hr+28},${hg+24},${hb+30},0.97)`);
  axGrad.addColorStop(1,                       `rgba(${hr},${hg},${hb},0.98)`);
  ctx.fillStyle = axGrad;
  ctx.fill();
  ctx.restore();

  /* ── Circumferential shading — physically-based Lambert darkening ──
     At camH=2 the silhouette is at ±60°.  Brightness = (camH·cos a − 1)/(camH−1).
     Stop t-positions are derived from the angle→screen mapping, not linear in a. */
  const sxL_n = projL[0][0], sxR_n = projR[0][0];
  ctx.save();
  drawHullPath();
  const edgeGrad = ctx.createLinearGradient(sxR_n, 0, sxL_n, 0);
  // t=0 / 1.0  → a=±60° (silhouette, tangent)  brightness=0
  // t≈0.026/0.974 → a=±45°                     brightness=0.41
  // t≈0.118/0.882 → a=±30°                     brightness=0.73
  // t≈0.283/0.717 → a=±15°                     brightness=0.93
  // t=0.50        → a=0° (leeward centre)       brightness=1.0
  edgeGrad.addColorStop(0,     'rgba(0,0,0,0.93)');
  edgeGrad.addColorStop(0.026, 'rgba(0,0,0,0.58)');
  edgeGrad.addColorStop(0.118, 'rgba(0,0,0,0.27)');
  edgeGrad.addColorStop(0.283, 'rgba(0,0,0,0.07)');
  edgeGrad.addColorStop(0.50,  'rgba(255,255,255,0.10)');
  edgeGrad.addColorStop(0.717, 'rgba(0,0,0,0.07)');
  edgeGrad.addColorStop(0.882, 'rgba(0,0,0,0.27)');
  edgeGrad.addColorStop(0.974, 'rgba(0,0,0,0.58)');
  edgeGrad.addColorStop(1,     'rgba(0,0,0,0.93)');
  ctx.fillStyle = edgeGrad;
  ctx.fill();
  ctx.restore();

  /* ── Specular highlight along leeward spine ── */
  {
    const spineHW = Math.abs(sxL_n - sxR_n) * 0.10;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - spineHW, sy_near, spineHW * 2, Math.min(H, sy_far) - sy_near);
    const sg = ctx.createLinearGradient(cx - spineHW, 0, cx + spineHW, 0);
    sg.addColorStop(0,   'rgba(245,252,255,0)');
    sg.addColorStop(0.5, 'rgba(245,252,255,0.20)');
    sg.addColorStop(1,   'rgba(245,252,255,0)');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();
  }

  /* ── Aft body flap (after SECO, stage ≥ 2) ── */
  if ((S.rocketSECO ?? false) && (S.rocketStage ?? 1) >= 2) {
    const aftFlap = (rg.bodyFlaps ?? []).find(f => f.vFBot < 0.028);
    const vFBot  = aftFlap?.vFBot ?? 0.016;
    const vFTop  = aftFlap?.vFTop ?? 0.024;
    const rTipN  = Math.min((aftFlap?.rTip ?? 0.0049) / rBody, 1.10);
    const z_bot  = (vF_cam - vFBot) / rBody;
    const z_top  = (vF_cam - vFTop) / rBody;
    const q0 = proj( sinSil,       cosSil,       z_bot);
    const q1 = proj( sinSil,       cosSil,       z_top);
    const q2 = proj( sinSil*rTipN, cosSil*rTipN, z_top);
    const q3 = proj( sinSil*rTipN, cosSil*rTipN, z_bot);
    if (q0 && q1 && q2 && q3) {
      const [fc, fg, fb] = COLORS_[3] ?? [70, 74, 86];
      ctx.beginPath();
      ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]);
      ctx.lineTo(q2[0], q2[1]); ctx.lineTo(q3[0], q3[1]);
      ctx.closePath();
      ctx.fillStyle   = `rgba(${fc},${fg},${fb},0.88)`;
      ctx.strokeStyle = 'rgba(16,22,36,0.80)';
      ctx.lineWidth   = Math.max(1.5, 2 * dpr);
      ctx.fill(); ctx.stroke();
    }
  }
}
