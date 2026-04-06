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

/* ── Peak telemetry trackers (reset on aircraft change) ── */
let _peakG    = 0;
let _peakQ    = 0;
let _peakAcId = null;

/* ── ISA speed of sound — for Mach calculation ── */
function _machAt(vel_ms, alt_m) {
  const T_K = alt_m < 11000 ? 288.15 - 6.5e-3 * alt_m : 216.65;
  return vel_ms / Math.sqrt(1.4 * 287 * T_K);
}

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

const GM_EARTH  = 3.986004418e14;   // m³/s²
const R_EARTH_M = 6_371_000;        // m

/* ── Main renderer ── */
export function renderRocket(canvas) {
  const DPR = devicePixelRatio || 1;
  const W   = canvas.width  = canvas.offsetWidth  * DPR;
  const H   = canvas.height = canvas.offsetHeight * DPR;
  const ctx = canvas.getContext('2d');

  const ac = S.aircraft;
  if (!ac || ac.vehicleType !== 'rocket') return;

  ctx.fillStyle = '#03060a';
  ctx.fillRect(0, 0, W, H);

  const mT    = S.time ?? 0;
  const ignT  = ac.ignitionTime ?? 0;
  const tLO   = mT - ignT;
  const stage = S.rocketStage ?? 1;
  const coast = S.rocketCoast ?? false;
  const fpa   = S.pitch ?? 90;

  /* Derived values */
  const altKm       = (S.alt ?? 0) * 0.3048 / 1000;
  const alt_m       = altKm * 1000;
  const velMs       = (S.spd ?? 0) * 0.5144;
  const velKms      = velMs / 1000;
  const velKmh      = velMs * 3.6;
  const vOrbKms     = Math.sqrt(GM_EARTH / (R_EARTH_M + alt_m)) / 1000;
  const orbitFrac   = Math.min(1, velKms / vOrbKms);
  const inOrbit     = velKms >= vOrbKms * 0.99 && Math.abs(fpa) < 8 && tLO > 0;

  const launch      = S.mission?.initialState ?? {};
  const dLatKm      = ((S.lat ?? 0) - (launch.lat ?? 0)) * 111.32;
  const dLonKm      = ((S.lon ?? 0) - (launch.lon ?? 0)) * 111.32 * Math.cos((launch.lat ?? 0) * DEG);
  const downrangeKm = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);

  /* ── Mission Timer ── */
  const absT  = Math.abs(tLO);
  const sign  = tLO >= 0 ? 'T+' : 'T\u2212';
  const mm    = Math.floor(absT / 60);
  const ss    = Math.floor(absT % 60);
  const timer = `${sign} ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `bold ${Math.round(H * 0.11)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = inOrbit ? '#5dd47e' : (tLO >= 0 ? '#e8edf2' : '#ffb74d');
  ctx.fillText(timer, W / 2, H * 0.10);
  ctx.restore();

  /* ── Stage / event label ── */
  const acStages  = ac.performance?.stages ?? [];
  const rawName   = acStages[stage - 1]?.name ?? `Stage ${stage}`;
  const engName   = rawName.replace(/^Stage \d+ — /i, '');
  const stageStr  = inOrbit     ? 'ORBIT ACHIEVED'
                  : coast       ? 'STAGE SEPARATION'
                  : `STAGE ${stage}  —  ${engName.toUpperCase()}`;
  const stageColor = inOrbit ? '#5dd47e' : coast ? '#ffb74d' : (stage === 1 ? '#4dc5dc' : '#5dd47e');

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `700 ${Math.round(H * 0.05)}px "Syne", sans-serif`;
  ctx.fillStyle    = stageColor;
  if (inOrbit) ctx.shadowColor = '#5dd47e', ctx.shadowBlur = 8;
  ctx.fillText(stageStr, W / 2, H * 0.20);
  ctx.restore();

  /* ── Peak trackers ── */
  if (_peakAcId !== ac.id) { _peakG = 0; _peakQ = 0; _peakAcId = ac.id; }
  _peakG = Math.max(_peakG, Math.abs(S.rocketG   ?? 0));
  _peakQ = Math.max(_peakQ, S.rocketDynQ ?? 0);

  /* ── Mach ── */
  const mach = _machAt(velMs, alt_m);

  /* ── Metrics layout — splits when booster is active ── */
  const lblFontSz  = Math.round(H * 0.037);
  const vFontSz    = Math.round(H * 0.078);
  const mTop       = H * 0.27;
  const boosterOn  = !!(S.booster?.active || S.booster?.landed);

  /* When booster is active: Stage 2 uses left 57%, booster panel uses right 43% */
  const s2Width    = boosterOn ? W * 0.57 : W;
  const mW         = s2Width * 0.20;   /* 4 metric cols share 80% of s2Width */

  const gVal   = S.rocketG ?? 0;
  const gColor = gVal > 6 ? '#ff4444' : gVal > 4 ? '#ffb74d' : '#e8edf2';

  const metrics = [
    { label: 'ALTITUDE',  value: altKm.toFixed(1),       unit: 'km',
      sub: null,                                                          color: '#e8edf2' },
    { label: 'VELOCITY',  value: velKms.toFixed(2),      unit: 'km/s',
      sub: `M ${mach.toFixed(2)}  ·  ${Math.round(velKmh).toLocaleString()} km/h`,  color: '#e8edf2' },
    { label: 'DOWNRANGE', value: downrangeKm.toFixed(0), unit: 'km',
      sub: null,                                                          color: '#e8edf2' },
    { label: 'G-FORCE',   value: gVal.toFixed(1),        unit: 'g',
      sub: `q ${Math.round((S.rocketDynQ ?? 0) / 1000)} kPa  · peak ${_peakG.toFixed(1)}g`, color: gColor },
  ];

  metrics.forEach((m, i) => {
    const cx = mW * i + mW / 2;
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font         = `700 ${lblFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = 'rgba(232,237,242,0.4)';
    ctx.textBaseline = 'top';
    ctx.fillText(m.label, cx, mTop);

    ctx.font         = `bold ${vFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = m.color;
    ctx.textBaseline = 'top';
    const valY = mTop + lblFontSz + 3;
    ctx.fillText(m.value, cx, valY);

    ctx.font         = `${lblFontSz}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = 'rgba(232,237,242,0.35)';
    ctx.textBaseline = 'top';
    ctx.fillText(m.unit, cx, valY + vFontSz + 1);

    if (m.sub) {
      ctx.font      = `${Math.round(lblFontSz * 0.85)}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = 'rgba(232,237,242,0.25)';
      ctx.fillText(m.sub, cx, valY + vFontSz + lblFontSz + 3);
    }

    ctx.restore();
  });

  /* ── Rocket orientation side view ── */
  const totalEnginesDisp = (ac.performance?.stages ?? [])[stage - 1]?.engineCount ?? 1;
  const orX  = s2Width * 0.82;
  const orY  = mTop;
  const orW  = s2Width * 0.16;
  const orH  = totalEnginesDisp > 1 ? H * 0.115 : H * 0.20;
  _drawOrientation(ctx, orX, orY, orW, orH, fpa, stageColor);

  /* ── Engine grid (multi-engine vehicles only) ── */
  if (totalEnginesDisp > 1) {
    const egY = orY + orH + Math.round(H * 0.005);
    const egH = H * 0.085;
    _drawEngineGrid(ctx, orX, egY, orW, egH,
      totalEnginesDisp,
      S.rocketActiveEngines ?? totalEnginesDisp,
      S.rocketFailedEngines ?? []);
  }

  /* ── Booster telemetry panel (right side, appears at stage sep) ── */
  if (boosterOn) {
    const bpX = s2Width + W * 0.01;
    const bpW = W - bpX;
    _drawBoosterPanel(ctx, bpX, mTop, bpW, H * 0.22, lblFontSz, vFontSz);
  }

  /* ── Orbital velocity bar ── */
  _drawOrbitalBar(ctx, W, H, velKms, vOrbKms, orbitFrac, inOrbit, fpa, lblFontSz);

  /* ── Propellant gauge ── */
  _drawPropGauge(ctx, W, H, lblFontSz, stage, ac);

  /* ── Trajectory profile ── */
  _drawProfile(ctx, W, H, tLO, ac);
}

/* ── Rocket orientation: side-view silhouette showing pitch / gravity turn ── */
function _drawOrientation(ctx, x, y, w, h, fpa, color) {
  const cx = x + w / 2;
  const cy = y + h / 2;

  /* Background box */
  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.03)';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();

  /* Label */
  ctx.save();
  ctx.font         = `${Math.round(h * 0.12)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(232,237,242,0.3)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('ATTITUDE', cx, y + h);
  ctx.restore();

  /* FPA angle: 90=vertical, 0=horizontal, negative=descending */
  /* Rotation from up-axis: 0° = vertical up, 90° = pointing right */
  const tiltRad = (90 - fpa) * DEG;

  const bodyLen = h * 0.52;
  const bodyW   = w * 0.10;
  const noseLen = h * 0.24;
  const bellLen = h * 0.10;
  const bellW   = bodyW * 1.8;
  const finH    = bodyLen * 0.22;
  const finW    = bodyW * 1.4;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tiltRad);

  /* Engine flame (at bottom of rocket = -bodyLen/2 going toward -Y before rotation) */
  if (fpa > -80) {
    const flameLen = bodyLen * 0.35;
    const grad = ctx.createLinearGradient(0, bodyLen / 2, 0, bodyLen / 2 + flameLen);
    grad.addColorStop(0, 'rgba(255,180,50,0.9)');
    grad.addColorStop(0.5, 'rgba(255,100,20,0.6)');
    grad.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-bellW / 2, bodyLen / 2);
    ctx.lineTo(0, bodyLen / 2 + flameLen);
    ctx.lineTo(bellW / 2, bodyLen / 2);
    ctx.closePath();
    ctx.fill();
  }

  /* Body */
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.roundRect(-bodyW / 2, -bodyLen / 2, bodyW, bodyLen, bodyW * 0.2);
  ctx.fill();
  ctx.globalAlpha = 1;

  /* Nose cone — ogive shape */
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2, -bodyLen / 2);
  ctx.quadraticCurveTo(-bodyW / 2, -bodyLen / 2 - noseLen * 0.7, 0, -bodyLen / 2 - noseLen);
  ctx.quadraticCurveTo( bodyW / 2, -bodyLen / 2 - noseLen * 0.7, bodyW / 2, -bodyLen / 2);
  ctx.closePath();
  ctx.fill();

  /* Grid fins / landing legs (swept triangles at base) */
  ctx.fillStyle = 'rgba(180,180,200,0.55)';
  /* left fin */
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2, bodyLen / 2);
  ctx.lineTo(-bodyW / 2 - finW, bodyLen / 2);
  ctx.lineTo(-bodyW / 2, bodyLen / 2 - finH);
  ctx.closePath();
  ctx.fill();
  /* right fin */
  ctx.beginPath();
  ctx.moveTo( bodyW / 2, bodyLen / 2);
  ctx.lineTo( bodyW / 2 + finW, bodyLen / 2);
  ctx.lineTo( bodyW / 2, bodyLen / 2 - finH);
  ctx.closePath();
  ctx.fill();

  /* Engine bell */
  ctx.fillStyle = 'rgba(180,180,190,0.6)';
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2, bodyLen / 2 - bellLen * 0.3);
  ctx.lineTo(-bellW / 2, bodyLen / 2 + bellLen * 0.5);
  ctx.lineTo( bellW / 2, bodyLen / 2 + bellLen * 0.5);
  ctx.lineTo( bodyW / 2, bodyLen / 2 - bellLen * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  /* FPA label */
  ctx.save();
  ctx.font         = `bold ${Math.round(h * 0.14)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = color;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(fpa)}°`, cx, y + h * 0.04);
  ctx.restore();
}

/* ── Orbital velocity progress bar ── */
function _drawOrbitalBar(ctx, W, H, velKms, vOrbKms, frac, inOrbit, fpa, lblFontSz) {
  const barTop = H * 0.495;
  const barH   = Math.round(H * 0.04);
  const padX   = Math.round(W * 0.04);
  const barW   = W - padX * 2;

  /* Label left */
  ctx.save();
  ctx.font         = `${lblFontSz}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(232,237,242,0.35)';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('ORBITAL VELOCITY', padX, barTop - 2);

  /* Values right */
  ctx.textAlign = 'right';
  const statusStr = inOrbit
    ? 'ORBIT ACHIEVED'
    : fpa < 0
      ? `DESCENT  ${velKms.toFixed(2)} / ${vOrbKms.toFixed(2)} km/s`
      : `${velKms.toFixed(2)} / ${vOrbKms.toFixed(2)} km/s`;
  ctx.fillStyle = inOrbit ? '#5dd47e' : fpa < 0 ? '#ffb74d' : 'rgba(232,237,242,0.35)';
  ctx.fillText(statusStr, W - padX, barTop - 2);

  /* Bar track */
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(padX, barTop, barW, barH);

  /* Bar fill */
  const fillColor = inOrbit ? '#5dd47e' : fpa < 0 ? '#ffb74d' : '#4dc5dc';
  ctx.fillStyle   = fillColor;
  ctx.fillRect(padX, barTop, barW * frac, barH);

  /* Thin accent line on top of fill */
  ctx.fillStyle = inOrbit ? 'rgba(93,212,126,0.5)' : 'rgba(77,197,220,0.4)';
  ctx.fillRect(padX, barTop, barW * frac, 2);

  ctx.restore();
}

/* ── Propellant gauge ── */
function _drawPropGauge(ctx, W, H, lblFontSz, stage, ac) {
  const perf    = ac?.performance ?? {};
  const stages  = perf.stages ?? [];
  const stgIdx  = stage - 1;
  const stg     = stages[stgIdx] ?? {};
  const mass    = S.rocketMass  ?? 0;
  const payload = perf.payload  ?? 0;

  let massAbove = payload;
  for (let i = stgIdx + 1; i < stages.length; i++) massAbove += stages[i].massWet ?? 0;
  const burnoutT = (stg.massDry ?? 0) + massAbove + 5;
  const initProp = (stg.massWet ?? 0) - (stg.massDry ?? 0) - 5;
  const frac     = initProp > 0 ? Math.max(0, Math.min(1, (mass - burnoutT) / initProp)) : 0;

  const coast  = S.rocketCoast ?? false;
  const seco   = S.rocketSECO  ?? false;
  const color  = stgIdx === 0 ? '#4dc5dc' : '#5dd47e';
  const padX   = Math.round(W * 0.04);
  const barW   = W - padX * 2;
  const gTop   = H * 0.548;
  const gH     = Math.round(H * 0.028);

  ctx.save();
  ctx.font         = `${lblFontSz}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = 'bottom';

  ctx.fillStyle = 'rgba(232,237,242,0.35)';
  ctx.textAlign = 'left';
  ctx.fillText(`STAGE ${stage} PROPELLANT`, padX, gTop - 2);

  const pctStr  = seco ? 'DEPLETED' : coast ? 'STAGING' : `${Math.round(frac * 100)}%`;
  ctx.fillStyle = seco ? 'rgba(255,255,255,0.25)' : coast ? '#ffb74d' : color;
  ctx.textAlign = 'right';
  ctx.fillText(pctStr, W - padX, gTop - 2);

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(padX, gTop, barW, gH);

  if (!seco) {
    ctx.fillStyle = coast ? 'rgba(255,183,77,0.35)' : color;
    ctx.fillRect(padX, gTop, barW * frac, gH);
    /* thin accent line */
    ctx.fillStyle = coast ? 'rgba(255,183,77,0.5)' : (stgIdx === 0 ? 'rgba(77,197,220,0.5)' : 'rgba(93,212,126,0.5)');
    ctx.fillRect(padX, gTop, barW * frac, 2);
  }
  ctx.restore();
}

/* ── Stage 1 booster telemetry panel ── */
function _drawBoosterPanel(ctx, x0, y0, w, h, lblFontSz, vFontSz) {
  const b = S.booster;
  if (!b) return;

  const ORANGE      = '#ff8c32';
  const ORANGE_DIM  = 'rgba(255,140,50,0.45)';
  const ORANGE_FAINT= 'rgba(255,140,50,0.18)';

  /* Vertical divider */
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x0 - 1, y0, 1, h);
  ctx.restore();

  /* Derived values */
  const bAlt_km  = (b.alt ?? 0) * 0.3048 / 1000;
  const bVVert   = b.vVert ?? 0;
  const bVDown   = b.vDown ?? 0;
  const bSpd_ms  = Math.sqrt(bVVert * bVVert + bVDown * bVDown);
  const bSpd_kms = bSpd_ms / 1000;
  const arrow    = b.landed ? '' : bVVert > 0 ? ' ↑' : ' ↓';

  const PHASE_LABELS = {
    flip:       'ORIENTING',
    boostback:  'BOOSTBACK BURN',
    coast:      'COASTING',
    glide:      'GRID FINS',
    landing:    'LANDING BURN',
    landed:     'TOUCHDOWN',
  };
  const phaseStr = PHASE_LABELS[b.phase] ?? (b.phase ?? '').toUpperCase();
  const phaseColor = b.landed ? '#5dd47e'
    : b.phase === 'boostback' || b.phase === 'landing' ? '#ffb74d'
    : ORANGE;

  /* Header — "STAGE 1 · BOOSTER" */
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.font         = `700 ${Math.round(lblFontSz * 0.95)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = ORANGE_DIM;
  ctx.fillText('STAGE 1  ·  BOOSTER', x0 + w / 2, y0);
  ctx.restore();

  /* Phase label */
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.font         = `bold ${Math.round(lblFontSz * 1.1)}px "Syne", sans-serif`;
  ctx.fillStyle    = phaseColor;
  if (b.landed) { ctx.shadowColor = '#5dd47e'; ctx.shadowBlur = 6; }
  ctx.fillText(phaseStr, x0 + w / 2, y0 + lblFontSz * 1.4);
  ctx.shadowBlur = 0;
  ctx.restore();

  /* Two metrics: ALT and VEL */
  const mY    = y0 + lblFontSz * 3.2;
  const halfW = w / 2;

  const bMetrics = [
    { label: 'ALTITUDE', value: bAlt_km.toFixed(1) + arrow, unit: 'km' },
    { label: 'VELOCITY', value: bSpd_kms.toFixed(2),        unit: 'km/s' },
  ];

  bMetrics.forEach((m, i) => {
    const cx = x0 + halfW * i + halfW / 2;
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font      = `700 ${Math.round(lblFontSz * 0.85)}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = ORANGE_DIM;
    ctx.textBaseline = 'top';
    ctx.fillText(m.label, cx, mY);

    ctx.font      = `bold ${Math.round(vFontSz * 0.85)}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = b.landed ? 'rgba(93,212,126,0.7)' : ORANGE;
    ctx.textBaseline = 'top';
    ctx.fillText(m.value, cx, mY + lblFontSz * 1.1);

    ctx.font      = `${Math.round(lblFontSz * 0.85)}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = ORANGE_FAINT;
    ctx.textBaseline = 'top';
    ctx.fillText(m.unit, cx, mY + lblFontSz * 1.1 + vFontSz * 0.85 + 2);

    ctx.restore();
  });

  /* Booster FPA indicator — tiny orientation */
  if (!b.landed) {
    const bFpa = bVVert !== 0 || bVDown !== 0
      ? Math.atan2(bVVert, Math.abs(bVDown)) / DEG
      : 90;
    const orX = x0 + w * 0.5 - w * 0.12;
    const orY2 = mY + lblFontSz * 1.1 + vFontSz + lblFontSz * 2;
    _drawOrientation(ctx, orX, orY2, w * 0.24, h - (orY2 - y0) - 4, bFpa, ORANGE);
  }
}

/* ── Engine status grid (multi-engine vehicles) ── */
function _drawEngineGrid(ctx, x, y, w, h, totalEngines, activeEngines, failedEngines) {
  ctx.save();

  /* Background */
  ctx.fillStyle   = 'rgba(255,255,255,0.03)';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);

  /* Count label */
  ctx.font         = `${Math.round(h * 0.20)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = activeEngines < totalEngines ? '#ffb74d' : 'rgba(232,237,242,0.4)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${activeEngines}/${totalEngines} ENG`, x + w / 2, y + h);

  /* Engine dots — Octaweb layout for 9, circle for others */
  const cx   = x + w / 2;
  const cy   = y + h * 0.42;
  const dotR = Math.min(w, h) * 0.072;
  const positions = [];

  if (totalEngines === 9) {
    /* 8 outer in octagon + 1 center (index 8) */
    const outerR = Math.min(w, h * 0.75) * 0.33;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      positions.push([cx + outerR * Math.cos(a), cy + outerR * Math.sin(a)]);
    }
    positions.push([cx, cy]);
  } else {
    /* Generic: evenly spaced in a single ring */
    const r = Math.min(w, h * 0.75) * 0.32;
    for (let i = 0; i < totalEngines; i++) {
      const a = (i / totalEngines) * Math.PI * 2 - Math.PI / 2;
      positions.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }

  for (let i = 0; i < positions.length; i++) {
    const [px, py] = positions[i];
    const failed   = failedEngines.includes(i);
    ctx.fillStyle  = failed ? '#ff4444' : '#5dd47e';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur  = failed ? 0 : 3;
    ctx.globalAlpha = failed ? 0.65 : 0.9;
    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
  ctx.restore();
}

function _drawProfile(ctx, W, H, tLO, ac) {
  const ref = _getRef(ac);
  if (!ref.length) return;

  const maxT   = ref[ref.length - 1].t;
  const maxAlt = 700;   /* km — orbital altitude ceiling for display */

  /* Profile bounding box */
  const padL  = Math.round(W * 0.07);
  const padR  = Math.round(W * 0.03);
  const padT  = Math.round(H * 0.615);
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

  /* Legend + export hint */
  ctx.save();
  ctx.font         = `${axisFontSz}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';
  ctx.fillStyle    = '#4dc5dc';
  ctx.fillText('── STAGE 1', padL + 4, padT + 4);
  ctx.fillStyle    = '#5dd47e';
  ctx.fillText('── STAGE 2', padL + 4 + Math.round(W * 0.14), padT + 4);
  ctx.fillStyle    = 'rgba(232,237,242,0.18)';
  ctx.textAlign    = 'right';
  ctx.fillText('Ctrl+Shift+T  ↓ CSV', padL + pw, padT + 4);
  ctx.restore();
}
