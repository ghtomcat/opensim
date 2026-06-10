/* Engine face draw helpers — nacelle intake lip + black strip, turbofan fan
   disk (with module-local spin state), perspective fan ellipse fit, and the
   thrust-reverser / chevron overlays. Extracted from outside.js. */
import { S } from '../core/state.js';

/* ── Nacelle inlet lip ring — polished metal leading edge at intake face ─────
   Drawn as a thick silver stroke at the outer rim of the fan face projection.
   Uses the same hub/rim as the fan disk so it's always co-centred with the fan. */
export function _drawIntakeLip(ctx, hubPt, rimPt, dpr, foreshorten = 1, fsAngle = 0) {
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  ctx.save();
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));   // ellipse off-axis, sliver edge-on
  ctx.strokeStyle = 'rgba(218, 224, 232, 0.90)';
  ctx.lineWidth = Math.max(2.5, r * 0.11);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* Black strip just inside the intake lip — the dark annular band between
   the silver lip and the fan blade area visible on real turbofan engines. */
export function _drawIntakeBlackStrip(ctx, hubPt, rimPt, dpr, foreshorten = 1, fsAngle = 0) {
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const stripW = Math.max(1.5, r * 0.13);
  const rInner = r - stripW * 0.5;
  ctx.save();
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.88)';
  ctx.lineWidth = stripW;
  ctx.beginPath();
  ctx.arc(0, 0, rInner, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ── Generic turbofan fan-face renderer (screen-space) ───────────────────────
   hubPt  projected center of fan disk  {x, y, d}
   rimPt  projected rim vertex (sets disk radius in pixels)
   power  enginePower 0→1 (0=static blades, <0.30=slow, ≥0.30=blur disk)
   nBlades  fan blade count (22 typical CFM56 / LEAP)                        */
let _fanAngle = 0;

/* Advance fan rotation angle — capped so it doesn't spin during static frames */
export function advanceFanAngle() {
  _fanAngle = (_fanAngle + ((S.engineState === 'off' || S.engineState === 'shutdown')
                ? 0 : Math.min(0.06, (S.enginePower ?? 0) * 0.35))) % (Math.PI * 2);
}

export function _drawTurbofanFace(ctx, hubPt, rimPt, power, dpr, nBlades = 22, foreshorten = 1, fsAngle = 0) {
  if (!hubPt || !rimPt) return;
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const hubR = r * 0.28, tipR = r * 0.94;
  ctx.save();
  /* Draw the disk in an origin-centred frame, then squash it along the engine
     axis so the fan reads as a foreshortened ellipse from oblique views (and
     collapses to a sliver edge-on) rather than a billboard always facing us. */
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));

  if (power < 0.05) {
    /* Static — N tapered blade quads */
    ctx.fillStyle = 'rgba(96,110,126,0.92)';
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.085, aR = a + 0.085;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(aL), hubR * Math.sin(aL));
      ctx.lineTo(tipR * Math.cos(aL - 0.10), tipR * Math.sin(aL - 0.10));
      ctx.lineTo(tipR * Math.cos(aR - 0.14), tipR * Math.sin(aR - 0.14));
      ctx.lineTo(hubR * Math.cos(aR), hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
  } else if (power < 0.30) {
    /* Slow rotation — blades + translucent blur overlay */
    const t     = power / 0.30;
    const alpha = (0.72 - t * 0.48).toFixed(2);
    ctx.fillStyle = `rgba(90,104,120,${alpha})`;
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.10, aR = a + 0.10;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(aL), hubR * Math.sin(aL));
      ctx.lineTo(tipR * Math.cos(aL - 0.12), tipR * Math.sin(aL - 0.12));
      ctx.lineTo(tipR * Math.cos(aR - 0.16), tipR * Math.sin(aR - 0.16));
      ctx.lineTo(hubR * Math.cos(aR), hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
    /* Blur wash */
    const bGrad = ctx.createRadialGradient(0, 0, hubR, 0, 0, tipR);
    bGrad.addColorStop(0, `rgba(138,152,168,${(t * 0.32).toFixed(2)})`);
    bGrad.addColorStop(1, `rgba(78,90,106,${(t * 0.20).toFixed(2)})`);
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(0, 0, tipR, 0, Math.PI*2); ctx.fill();
  } else {
    /* Running — solid blur disk + faint streaks */
    const bGrad = ctx.createRadialGradient(0, 0, hubR, 0, 0, tipR);
    bGrad.addColorStop(0,   'rgba(152,165,180,0.58)');
    bGrad.addColorStop(0.5, 'rgba(112,124,140,0.44)');
    bGrad.addColorStop(1,   'rgba(72,84,100,0.32)');
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(0, 0, tipR, 0, Math.PI*2); ctx.fill();
    /* Radial streaks */
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = 'rgba(210,222,235,1)';
    ctx.lineWidth   = Math.max(0.5, dpr * 0.4);
    for (let i = 0; i < 9; i++) {
      const a = _fanAngle + i / 9 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(a), hubR * Math.sin(a));
      ctx.lineTo(tipR * Math.cos(a), tipR * Math.sin(a));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* Spinner cone — radial highlight reads as a 3-D nose cone, plus the spinning
     warning swirl you see on turbofan spinners (rotates with the fan). */
  const _spG = ctx.createRadialGradient(-hubR*0.32, -hubR*0.32, hubR*0.08, 0, 0, hubR);
  _spG.addColorStop(0, 'rgba(120,128,140,0.98)');
  _spG.addColorStop(1, 'rgba(36,42,54,0.98)');
  ctx.fillStyle = _spG;
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(232,236,242,0.80)';
  ctx.lineWidth   = Math.max(0.5, dpr * 0.45);
  ctx.beginPath();
  for (let t = 0; t <= 1.001; t += 0.06) {
    const a = _fanAngle + t * Math.PI * 2.2, rr = hubR * 0.88 * t;
    const x = rr * Math.cos(a), y = rr * Math.sin(a);
    t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  /* Outer cowl ring */
  ctx.strokeStyle = 'rgba(158,172,188,0.78)';
  ctx.lineWidth   = Math.max(0.8, dpr * 0.7);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();

  ctx.restore();
}

/* Fit an ellipse to a circular ring's projected vertices (perspective image of
   a circle ≈ ellipse). Returns centroid, major/minor screen radii and the
   major-axis angle — used to draw the recessed fan foreshortened. */
export function _fanEllipse(ringPts) {
  let cx = 0, cy = 0;
  for (const p of ringPts) { cx += p.x; cy += p.y; }
  cx /= ringPts.length; cy /= ringPts.length;
  let majorR = 0, angle = 0, minorR = Infinity;
  for (const p of ringPts) {
    const dx = p.x - cx, dy = p.y - cy, rr = Math.hypot(dx, dy);
    if (rr > majorR) { majorR = rr; angle = Math.atan2(dy, dx); }
    if (rr < minorR) minorR = rr;
  }
  return { cx, cy, majorR, minorR, angle };
}

/* ── Engine overlays: thrust-reverser cascade + nozzle chevrons ── */
export function _engineOverlays(pts, faces, acEng, _b = 162) {
  const trOn  = !!(S.thrustReverser);
  const chev  = !!(acEng?.chevrons);

  /* R/L nozzle exit rings and TR zone ring indices (b-relative: R TR_fwd=b+36, TR_aft=b+44, noz=b+52) */
  const engines = [
    { trFwd: _b+36, trAft: _b+44, noz: _b+52, sign:  1 },  // R engine
    { trFwd: _b+76, trAft: _b+84, noz: _b+92, sign: -1 },  // L engine
  ];

  for (const { trFwd, trAft, noz, sign } of engines) {
    /* Collect projected ring points — bail if any missing */
    const pFwd  = Array.from({length: 8}, (_, i) => pts[trFwd + i]);
    const pAft  = Array.from({length: 8}, (_, i) => pts[trAft + i]);
    const pNoz  = Array.from({length: 8}, (_, i) => pts[noz   + i]);
    if (pFwd.some(p => !p) || pAft.some(p => !p) || pNoz.some(p => !p)) continue;

    /* Thrust-reverser cascade: replace C→D faces with lighter cascade panels */
    if (trOn) {
      const cascadeCol = [130, 120, 110];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const ps = [pFwd[i], pFwd[j], pAft[j], pAft[i]];
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: 0.85, avgD: avgD + 0.0001, col: cascadeCol });
      }
      /* Blocker door: partial cap at nozzle exit (blocks ~40% of flow) */
      const nozPts = pNoz.filter(Boolean);
      if (nozPts.length >= 3) {
        const cx = nozPts.reduce((s, p) => s + p.x, 0) / nozPts.length;
        const cy = nozPts.reduce((s, p) => s + p.y, 0) / nozPts.length;
        const avgD = nozPts.reduce((s, p) => s + p.d, 0) / nozPts.length;
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 8;
          const half = { x: cx, y: cy, d: avgD };
          faces.push({ ps: [pNoz[i*2], pNoz[j*2], half], br: 0.6, avgD: avgD + 0.0002, col: cascadeCol });
        }
      }
    }

    /* Chevron tabs at nozzle exit — each tab is a triangle pointing inward */
    if (chev) {
      const chevCol = [30, 32, 38];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const pA = pNoz[i], pB = pNoz[j];
        /* Tip: midpoint pushed slightly toward engine center (inward) */
        const mx = (pA.x + pB.x) * 0.5, my = (pA.y + pB.y) * 0.5;
        /* Engine center in screen is midpoint of all nozzle pts */
        const ex = pNoz.reduce((s, p) => s + p.x, 0) / 8;
        const ey = pNoz.reduce((s, p) => s + p.y, 0) / 8;
        const tip = { x: mx + (ex - mx) * 0.28, y: my + (ey - my) * 0.28, d: (pA.d + pB.d) * 0.5 };
        const avgD = (pA.d + pB.d + tip.d) / 3;
        faces.push({ ps: [pA, pB, tip], br: 0.55, avgD: avgD + 0.00005, col: chevCol });
      }
    }
  }
}
