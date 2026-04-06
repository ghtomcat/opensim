/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/rocket_display.js
   SpaceX-style mission telemetry display.

   Layout (bottom half in combined view):
     Timer + stage name  — top
     ALT / VEL / DOWNRANGE — metrics row
     Altitude-vs-time profile — stage 1 (cyan) + stage 2 (green)
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const DEG = Math.PI / 180;
const G0  = 9.80665;

/* ── Reference trajectory cache ── */
let _refCache = null;
let _refAcId  = null;

function _getRef(ac) {
  if (_refCache && _refAcId === ac.id) return _refCache;
  _refCache = _buildRef(ac);
  _refAcId  = ac.id;
  return _refCache;
}

/* Linearly interpolate fpa profile (same logic as rocket.js) */
function _fpa(t, profile) {
  if (!profile?.length) return 90;
  if (t <= profile[0][0])                  return profile[0][1];
  if (t >= profile[profile.length - 1][0]) return profile[profile.length - 1][1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [t0, f0] = profile[i], [t1, f1] = profile[i + 1];
    if (t >= t0 && t < t1) return f0 + (f1 - f0) * (t - t0) / (t1 - t0);
  }
  return 90;
}

/* Build reference trajectory: array of { t (from liftoff), altKm, stage } */
function _buildRef(ac) {
  const perf    = ac.performance ?? {};
  const stages  = perf.stages ?? [];
  const profile = perf.fpaProfile ?? [];
  const ignT    = ac.ignitionTime ?? 0;
  const payload = perf.payload ?? 0;

  const s1 = stages[0] ?? {}, s2 = stages[1] ?? {};
  const massAbove1 = (s2.massWet ?? 0) + payload;
  const burnout1   = (s1.massDry ?? 0) + massAbove1 + 5;
  const burnout2   = (s2.massDry ?? 0) + payload + 5;

  const DT     = 1;   // 1s integration step
  const points = [];

  let spd = 0, altM = 0, mass = perf.massWet ?? 28000;
  let stg = 1, coasting = false, coastStart = 0;

  for (let mT = ignT; mT <= ignT + 750; mT += DT) {
    const fpaR = _fpa(mT, profile) * DEG;

    let thrust = 0, isp = 300;
    if (coasting) {
      if (mT - coastStart >= 6 && stg < stages.length) {
        mass    -= s1.massDry ?? 0;
        stg      = 2;
        coasting = false;
      }
    } else if (stg === 1 && mass > burnout1) {
      thrust = s1.thrustVac ?? 400000;
      isp    = s1.isp ?? 280;
    } else if (stg === 1 && mass <= burnout1) {
      coasting = true;
      coastStart = mT;
    } else if (stg === 2 && mass > burnout2) {
      thrust = s2.thrustVac ?? 31000;
      isp    = s2.isp ?? 317;
    }

    const mdot = thrust > 0 ? thrust / (isp * G0) : 0;
    mass   = Math.max(payload, mass - mdot * DT);
    const a = thrust / Math.max(1, mass) - G0 * Math.sin(fpaR);
    spd    = Math.max(0, spd + a * DT);
    altM   = Math.max(0, altM + spd * Math.sin(fpaR) * DT);

    points.push({ t: mT - ignT, altKm: altM / 1000, stage: stg });

    if (altM / 1000 > 680 && stg === 2) break;
  }

  return points;
}

/* ── Main renderer ── */
export function renderRocket(canvas) {
  const DPR = devicePixelRatio || 1;
  const W   = canvas.width  = canvas.offsetWidth  * DPR;
  const H   = canvas.height = canvas.offsetHeight * DPR;
  const ctx = canvas.getContext('2d');

  const ac = S.aircraft;
  if (!ac || ac.vehicleType !== 'rocket') return;

  /* Clear */
  ctx.fillStyle = '#03060a';
  ctx.fillRect(0, 0, W, H);

  const mT    = S.time ?? 0;
  const ignT  = ac.ignitionTime ?? 0;
  const tLO   = mT - ignT;          /* seconds from liftoff; negative = pre-launch */
  const stage = S.rocketStage ?? 1;
  const coast = S.rocketCoast ?? false;

  /* ── Mission Timer ── */
  const absT   = Math.abs(tLO);
  const sign   = tLO >= 0 ? 'T+' : 'T\u2212';
  const mm     = Math.floor(absT / 60);
  const ss     = Math.floor(absT % 60);
  const timer  = `${sign} ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const timerY = H * 0.10;

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `bold ${Math.round(H * 0.11)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = tLO >= 0 ? '#e8edf2' : '#ffb74d';
  ctx.fillText(timer, W / 2, timerY);
  ctx.restore();

  /* ── Stage / event label ── */
  const acStages  = ac.performance?.stages ?? [];
  const rawName   = acStages[stage - 1]?.name ?? `Stage ${stage}`;
  /* strip leading "Stage N — " prefix to get the engine name */
  const engName   = rawName.replace(/^Stage \d+ — /i, '');
  const stageStr  = coast ? 'STAGE SEPARATION' : `STAGE ${stage}  —  ${engName.toUpperCase()}`;
  const stageColor = coast ? '#ffb74d' : (stage === 1 ? '#4dc5dc' : '#5dd47e');

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `700 ${Math.round(H * 0.05)}px "Syne", sans-serif`;
  ctx.fillStyle    = stageColor;
  ctx.fillText(stageStr, W / 2, H * 0.20);
  ctx.restore();

  /* ── Metrics ── */
  const altKm       = (S.alt ?? 0) * 0.3048 / 1000;
  const velKms      = (S.spd ?? 0) * 0.5144 / 1000;
  const launch      = S.mission?.initialState ?? {};
  const dLatKm      = ((S.lat ?? 0) - (launch.lat ?? 0)) * 111.32;
  const dLonKm      = ((S.lon ?? 0) - (launch.lon ?? 0)) * 111.32 * Math.cos((launch.lat ?? 0) * DEG);
  const downrangeKm = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);

  const metrics = [
    { label: 'ALTITUDE',  value: altKm.toFixed(1),       unit: 'km'   },
    { label: 'VELOCITY',  value: velKms.toFixed(2),       unit: 'km/s' },
    { label: 'DOWNRANGE', value: downrangeKm.toFixed(0),  unit: 'km'   },
  ];

  const mW   = W / 3;
  const mTop = H * 0.28;
  const vFontSz  = Math.round(H * 0.085);
  const lblFontSz = Math.round(H * 0.038);

  metrics.forEach((m, i) => {
    const cx = mW * i + mW / 2;
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font         = `700 ${lblFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = 'rgba(232,237,242,0.4)';
    ctx.textBaseline = 'top';
    ctx.fillText(m.label, cx, mTop);

    ctx.font         = `bold ${vFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = '#e8edf2';
    ctx.textBaseline = 'top';
    ctx.fillText(m.value, cx, mTop + lblFontSz + 4);

    ctx.font         = `${lblFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = 'rgba(232,237,242,0.35)';
    ctx.textBaseline = 'top';
    ctx.fillText(m.unit, cx, mTop + lblFontSz + 4 + vFontSz + 2);

    ctx.restore();
  });

  /* ── Trajectory profile ── */
  _drawProfile(ctx, W, H, tLO, ac);
}

function _drawProfile(ctx, W, H, tLO, ac) {
  const ref = _getRef(ac);
  if (!ref.length) return;

  const maxT   = ref[ref.length - 1].t;
  const maxAlt = 700;   /* km — orbital altitude ceiling for display */

  /* Profile bounding box */
  const padL  = Math.round(W * 0.07);
  const padR  = Math.round(W * 0.03);
  const padT  = Math.round(H * 0.545);
  const padB  = Math.round(H * 0.09);
  const pw    = W - padL - padR;
  const ph    = H - padT - padB;

  if (pw < 20 || ph < 20) return;

  const tx = t   => padL + (Math.min(Math.max(t, 0), maxT) / maxT) * pw;
  const ty = alt => padT + ph - (Math.min(Math.max(alt, 0), maxAlt) / maxAlt) * ph;

  /* Horizontal grid lines */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 1;
  for (let a = 100; a < maxAlt; a += 100) {
    ctx.beginPath();
    ctx.moveTo(padL, ty(a));
    ctx.lineTo(padL + pw, ty(a));
    ctx.stroke();
  }
  ctx.restore();

  /* Axes */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + ph);
  ctx.lineTo(padL + pw, padT + ph);
  ctx.stroke();
  ctx.restore();

  /* Y axis labels */
  const axisFontSz = Math.round(H * 0.036);
  ctx.save();
  ctx.font         = `${axisFontSz}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(232,237,242,0.3)';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let a = 0; a <= maxAlt; a += 200) {
    ctx.fillText(`${a}`, padL - 5, ty(a));
  }
  ctx.fillText('km', padL - 5, padT - axisFontSz * 0.7);
  ctx.restore();

  /* Split ref into stage 1 / stage 2 */
  const sepIdx = ref.findIndex(p => p.stage === 2);
  const s1ref  = sepIdx >= 0 ? ref.slice(0, sepIdx + 1) : ref;
  const s2ref  = sepIdx >= 0 ? ref.slice(sepIdx)        : [];

  /* Reference paths (dim) */
  ctx.save();
  ctx.lineWidth = 1.5;

  ctx.strokeStyle = 'rgba(77,197,220,0.22)';
  ctx.beginPath();
  s1ref.forEach((p, i) => { const x = tx(p.t), y = ty(p.altKm); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.stroke();

  ctx.strokeStyle = 'rgba(93,212,126,0.22)';
  ctx.beginPath();
  s2ref.forEach((p, i) => { const x = tx(p.t), y = ty(p.altKm); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.stroke();
  ctx.restore();

  /* Flown trajectory */
  const curT    = Math.max(0, tLO);
  const flown1  = ref.filter(p => p.stage === 1 && p.t <= curT);
  const flown2  = ref.filter(p => p.stage === 2 && p.t <= curT);

  ctx.save();
  ctx.lineWidth = 2.5;

  if (flown1.length > 1) {
    ctx.strokeStyle = '#4dc5dc';
    ctx.beginPath();
    flown1.forEach((p, i) => { const x = tx(p.t), y = ty(p.altKm); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
  }
  if (flown2.length > 1) {
    ctx.strokeStyle = '#5dd47e';
    ctx.beginPath();
    flown2.forEach((p, i) => { const x = tx(p.t), y = ty(p.altKm); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
  }
  ctx.restore();

  /* Stage-separation marker */
  if (sepIdx >= 0) {
    const sepT = ref[sepIdx].t;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,183,77,0.4)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(tx(sepT), padT);
    ctx.lineTo(tx(sepT), padT + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font         = `${axisFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = 'rgba(255,183,77,0.55)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('SEP', tx(sepT), padT + 4);
    ctx.restore();
  }

  /* Current position — crosshairs + dot */
  const curAltKm = (S.alt ?? 0) * 0.3048 / 1000;
  const dotX     = Math.min(tx(curT), padL + pw - 4);
  const dotY     = Math.max(padT + 5, Math.min(padT + ph - 5, ty(curAltKm)));

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.moveTo(dotX, padT);     ctx.lineTo(dotX, padT + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padL, dotY);     ctx.lineTo(padL + pw, dotY); ctx.stroke();
  ctx.setLineDash([]);

  /* Dot */
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur  = 6;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* X axis labels */
  ctx.save();
  ctx.font         = `${axisFontSz}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(232,237,242,0.3)';
  ctx.textBaseline = 'top';
  const xLblY = padT + ph + 5;

  ctx.textAlign = 'left';
  ctx.fillText('T+0', padL, xLblY);

  if (sepIdx >= 0) {
    const sepT  = ref[sepIdx].t;
    const sepMm = Math.floor(sepT / 60);
    const sepSs = Math.floor(sepT % 60);
    ctx.textAlign = 'center';
    ctx.fillText(`T+${sepMm}:${String(sepSs).padStart(2, '0')}`, tx(sepT), xLblY);
  }

  const endMm = Math.floor(maxT / 60);
  const endSs = Math.floor(maxT % 60);
  ctx.textAlign = 'right';
  ctx.fillText(`SECO T+${endMm}:${String(endSs).padStart(2, '0')}`, padL + pw, xLblY);
  ctx.restore();

  /* Legend */
  ctx.save();
  ctx.font         = `${axisFontSz}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';
  ctx.fillStyle    = '#4dc5dc';
  ctx.fillText('── STAGE 1', padL + 4, padT + 4);
  ctx.fillStyle    = '#5dd47e';
  ctx.fillText('── STAGE 2', padL + 4 + Math.round(W * 0.14), padT + 4);
  ctx.restore();
}
