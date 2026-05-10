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

  /* Burnout threshold per stage: own dry mass + all upper stages (wet) + payload */
  const burnouts = stages.map((stg, idx) => {
    let above = payload;
    for (let i = idx + 1; i < stages.length; i++) above += stages[i].massWet ?? 0;
    return (stg.massDry ?? 0) + above + 5;
  });

  const DT     = 1;
  const maxRun = ignT + Math.max(800, stages.length * 350);
  const points = [];

  let spd = 0, altM = 0, mass = perf.massWet ?? 28000;
  let si = 0, coasting = false, coastStart = 0;

  for (let mT = ignT; mT <= maxRun; mT += DT) {
    const fpaR = _fpa(mT, profile) * DEG;

    let thrust = 0, isp = 300;
    if (coasting) {
      if (mT - coastStart >= 6) {
        if (si < stages.length - 1) {
          mass -= stages[si].massDry ?? 0;
          si   += 1;
          coasting = false;
        } else break;
      }
    } else if (si < stages.length && mass > burnouts[si]) {
      thrust = stages[si].thrustVac ?? 0;
      isp    = stages[si].isp ?? 300;
    } else if (si < stages.length) {
      if (si < stages.length - 1) { coasting = true; coastStart = mT; }
      else break;
    }

    const mdot = thrust > 0 ? thrust / (isp * G0) : 0;
    mass  = Math.max(payload, mass - mdot * DT);
    const a = thrust / Math.max(1, mass) - G0 * Math.sin(fpaR);
    spd   = Math.max(0, spd + a * DT);
    altM  = Math.max(0, altM + spd * Math.sin(fpaR) * DT);

    points.push({ t: mT - ignT, altKm: altM / 1000, stage: si + 1 });
    if (altM / 1000 > 700) break;
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
  const inOrbit     = !!(S.rocketOrbit) || (velKms >= vOrbKms * 0.99 && Math.abs(fpa) < 8 && tLO > 0);

  const launch      = S.mission?.initialState ?? {};
  const dLatKm      = ((S.lat ?? 0) - (launch.lat ?? 0)) * 111.32;
  const dLonKm      = ((S.lon ?? 0) - (launch.lon ?? 0)) * 111.32 * Math.cos((launch.lat ?? 0) * DEG);
  const downrangeKm = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);

  /* ── Split layout — must be known before timer/label drawing ── */
  const boosterOn  = !!(S.booster?.active && !S.booster?.landed);
  const s2Width    = boosterOn ? W * 0.43 : W;

  /* ── Mission Timer ── */
  const absT  = Math.abs(tLO);
  const sign  = tLO >= 0 ? 'T+' : 'T\u2212';
  const mm    = Math.floor(absT / 60);
  const ss    = Math.floor(absT % 60);
  const timer = `${sign} ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  /* When split, center labels within Stage 2 panel (left 43%) */
  const labelCX = boosterOn ? s2Width / 2 : W / 2;

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `bold ${Math.round(H * 0.11)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = inOrbit ? '#5dd47e' : (tLO >= 0 ? '#e8edf2' : '#ffb74d');
  ctx.fillText(timer, labelCX, H * 0.10);
  ctx.restore();

  /* ── Stage / event label ── */
  const acStages  = ac.performance?.stages ?? [];
  const rawName   = acStages[stage - 1]?.name ?? `Stage ${stage}`;
  const engName   = rawName.replace(/^Stage \d+ — /i, '');
  const orbitPass = S.orbitPass ?? 0;
  const orbPeriodS = S.orbitPeriod ?? 0;
  const orbMM  = Math.floor(orbPeriodS / 60);
  const orbSS  = Math.floor(orbPeriodS % 60);
  const orbPeriodStr = orbPeriodS > 0 ? `  ·  T ${orbMM}:${String(orbSS).padStart(2,'0')}` : '';
  const stageStr  = (boosterOn && !S.rocketSECO) ? 'STAGE 2  ·  MVac'
                  : (boosterOn && S.rocketSECO)  ? 'DRAGON  ·  TRUNK'
                  : inOrbit && orbitPass > 0
                                    ? `ORBIT ${orbitPass}${orbPeriodStr}`
                  : inOrbit         ? `ORBIT ACHIEVED${orbPeriodStr}`
                  : coast           ? 'STAGE SEPARATION'
                  :                   `STAGE ${stage}  —  ${engName.toUpperCase()}`;
  const stageColor = inOrbit ? '#5dd47e' : coast ? '#ffb74d' : boosterOn ? '#4dc5dc' : (stage === 1 ? '#4dc5dc' : '#5dd47e');

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `700 ${Math.round(H * 0.05)}px "Syne", sans-serif`;
  ctx.fillStyle    = stageColor;
  if (inOrbit) ctx.shadowColor = '#5dd47e', ctx.shadowBlur = 8;
  ctx.fillText(stageStr, labelCX, H * 0.20);
  ctx.restore();

  /* ── Peak trackers ── */
  if (_peakAcId !== ac.id) { _peakG = 0; _peakQ = 0; _peakAcId = ac.id; }
  _peakG = Math.max(_peakG, Math.abs(S.rocketG   ?? 0));
  _peakQ = Math.max(_peakQ, S.rocketDynQ ?? 0);

  /* ── Mach ── */
  const mach = _machAt(velMs, alt_m);

  /* ── Metrics layout ── */
  const lblFontSz  = Math.round(H * 0.037);
  const vFontSz    = Math.round(H * 0.078);
  const mTop       = H * 0.27;
  const mW         = s2Width * 0.20;   /* 4 metric cols share 80% of s2Width */

  const gVal   = S.rocketG ?? 0;
  const gColor = gVal > 6 ? '#ff4444' : gVal > 4 ? '#ffb74d' : '#e8edf2';

  /* In orbit: replace G-FORCE with PERIOD */
  const lastMetric = inOrbit
    ? { label: 'PERIOD',
        value: orbPeriodS > 0 ? `${orbMM}:${String(orbSS).padStart(2,'0')}` : '—',
        unit: 'min:sec',
        sub: orbitPass > 0 ? `ORBIT  ${orbitPass}` : 'ORBIT  0',
        color: '#5dd47e' }
    : { label: 'G-FORCE',   value: gVal.toFixed(1),        unit: 'g',
        sub: `q ${Math.round((S.rocketDynQ ?? 0) / 1000)} kPa  · peak ${_peakG.toFixed(1)}g`,
        color: gColor };

  const metrics = [
    { label: 'ALTITUDE',  value: altKm.toFixed(1),       unit: 'km',
      sub: null,                                                          color: '#e8edf2' },
    { label: 'VELOCITY',  value: velKms.toFixed(2),      unit: 'km/s',
      sub: `M ${mach.toFixed(2)}  ·  ${Math.round(velKmh).toLocaleString()} km/h`,  color: '#e8edf2' },
    { label: 'DOWNRANGE', value: downrangeKm.toFixed(0), unit: 'km',
      sub: null,                                                          color: '#e8edf2' },
    lastMetric,
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

  /* ── Engine grid (multi-engine vehicles only) ── */
  const totalEnginesDisp = (ac.performance?.stages ?? [])[stage - 1]?.engineCount ?? 1;
  if (totalEnginesDisp > 1) {
    const egX = s2Width * 0.82;
    const egY = mTop;
    const egW = s2Width * 0.16;
    const egH = H * 0.20;
    _drawEngineGrid(ctx, egX, egY, egW, egH,
      totalEnginesDisp,
      S.rocketActiveEngines ?? totalEnginesDisp,
      S.rocketFailedEngines  ?? [],
      S.rocketCECOEngines    ?? []);
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

}

/* ── Engine status grid (multi-engine vehicles) ── */
function _drawEngineGrid(ctx, x, y, w, h, totalEngines, activeEngines, failedEngines, cecoEngines = []) {
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
    const failed = failedEngines.includes(i);
    const ceco   = cecoEngines.includes(i);
    ctx.fillStyle   = failed ? '#ff4444' : ceco ? '#ffb74d' : '#5dd47e';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur  = (failed || ceco) ? 0 : 3;
    ctx.globalAlpha = (failed || ceco) ? 0.60 : 0.9;
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

  /* Stage colors — cyan S1 / green S2 / amber S3 */
  const STGC = ['#4dc5dc', '#5dd47e', '#ffb74d'];
  const STGD = ['rgba(77,197,220,0.22)', 'rgba(93,212,126,0.22)', 'rgba(255,183,77,0.22)'];

  const numStages = Math.max(...ref.map(p => p.stage));
  const stagePts  = Array.from({ length: numStages }, (_, i) => ref.filter(p => p.stage === i + 1));

  /* Reference paths (dim) */
  ctx.save();
  ctx.lineWidth = 1.5;
  stagePts.forEach((seg, i) => {
    if (seg.length < 2) return;
    ctx.strokeStyle = STGD[i] ?? STGD[STGD.length - 1];
    ctx.beginPath();
    seg.forEach((p, j) => { const x = tx(p.t), y = ty(p.altKm); j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
  });
  ctx.restore();

  /* Flown trajectory */
  const curT = Math.max(0, tLO);
  ctx.save();
  ctx.lineWidth = 2.5;
  stagePts.forEach((seg, i) => {
    const flown = seg.filter(p => p.t <= curT);
    if (flown.length < 2) return;
    ctx.strokeStyle = STGC[i] ?? STGC[STGC.length - 1];
    ctx.beginPath();
    flown.forEach((p, j) => { const x = tx(p.t), y = ty(p.altKm); j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
  });
  ctx.restore();

  /* Stage-separation markers — one per transition */
  for (let s = 2; s <= numStages; s++) {
    const sepPt = ref.find(p => p.stage === s);
    if (!sepPt) continue;
    const sepT = sepPt.t;
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
    ctx.fillText(`SEP ${s - 1}`, tx(sepT), padT + 4);
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

  for (let s = 2; s <= numStages; s++) {
    const sepPt = ref.find(p => p.stage === s);
    if (!sepPt) continue;
    const sepT  = sepPt.t;
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
  for (let i = 0; i < numStages; i++) {
    ctx.fillStyle = STGC[i] ?? STGC[STGC.length - 1];
    ctx.fillText(`── STAGE ${i + 1}`, padL + 4 + Math.round(W * 0.14) * i, padT + 4);
  }
  ctx.fillStyle    = 'rgba(232,237,242,0.18)';
  ctx.textAlign    = 'right';
  ctx.fillText('Ctrl+Shift+T  ↓ CSV', padL + pw, padT + 4);
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   Apollo CM instrument panel — role-based display
   CDR: FDAI attitude ball + digital readouts
   CMP: altimeter arc gauge + velocity / orbit
   LMP: G-meter arc gauge + stage / propellant / dyn-Q
   Tabs at bottom allow switching role.
   Crew names driven by S.mission.crew — no hardcoding.
   ══════════════════════════════════════════════════════════════ */

const APOLLO_ROLES = ['CDR', 'CMP', 'LMP', 'TELEM'];
let _apolloRole     = 'CDR';
let _apolloTabRects = [];

export function setApolloRole(r)      { if (APOLLO_ROLES.includes(r)) _apolloRole = r; }
export function isApolloTelemetry()   { return _apolloRole === 'TELEM'; }

export function handleApolloClick(canvas, evt) {
  const DPR  = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const x    = (evt.clientX - rect.left) * DPR;
  const y    = (evt.clientY - rect.top)  * DPR;
  for (const t of _apolloTabRects) {
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
      _apolloRole = t.role;
      return true;
    }
  }
  return false;
}

/* ── Helpers ── */

function _apolloText(ctx, text, x, y, { font = '14px "IBM Plex Mono",monospace', color = '#a0aab8', align = 'left', base = 'alphabetic' } = {}) {
  ctx.save();
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function _apolloBar(ctx, x, y, w, h, frac, color, bgColor = '#1a2030') {
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round(w * Math.min(1, Math.max(0, frac))), h);
}

/* ── Tab row at bottom ── */
function _drawApolloTabs(ctx, W, H, crew) {
  _apolloTabRects = [];
  const tabH = Math.round(H * 0.072);
  const tabY = H - tabH;
  const tabW = W / APOLLO_ROLES.length;

  APOLLO_ROLES.forEach((r, i) => {
    const x      = i * tabW;
    const active = r === _apolloRole;
    const isTelem = r === 'TELEM';
    const name   = (!isTelem && crew?.[r]) ? `${r}  ${crew[r].toUpperCase()}` : r;
    ctx.fillStyle   = active ? (isTelem ? '#1a1200' : '#1a2a1a') : '#080f0a';
    ctx.fillRect(x, tabY, tabW - 2, tabH);
    ctx.fillStyle   = active ? (isTelem ? '#ffb74d' : '#c8d4bc') : (isTelem ? '#2a1a00' : '#3a4a3a');
    ctx.font        = `bold ${Math.round(H * 0.028)}px "IBM Plex Mono", monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x + tabW / 2, tabY + tabH / 2);
    _apolloTabRects.push({ role: r, x, y: tabY, w: tabW - 2, h: tabH });
  });

  ctx.strokeStyle = '#1e2c20';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, tabY);
  ctx.lineTo(W, tabY);
  ctx.stroke();
}

/* ── FDAI attitude ball (CDR) ── */
function _drawFDAI(ctx, cx, cy, r, pitchDeg, rollDeg) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate(-rollDeg * DEG);

  /* positive pitch → nose up → horizon below center (all sky) */
  const horizY = (pitchDeg / 90) * r;

  ctx.fillStyle = '#0d1e3e'; /* sky */
  ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2 + horizY);
  ctx.fillStyle = '#3a1f08'; /* earth */
  ctx.fillRect(-r * 2, horizY, r * 4, r * 2);

  /* Horizon line */
  ctx.strokeStyle = '#d4a840';
  ctx.lineWidth   = Math.max(1.5, r * 0.016);
  ctx.beginPath();
  ctx.moveTo(-r * 1.2, horizY);
  ctx.lineTo(r * 1.2, horizY);
  ctx.stroke();

  /* Pitch ladder every 10°, labeled at ±30° */
  for (let p = -60; p <= 60; p += 10) {
    if (Math.abs(p) < 5) continue;
    const lineY  = horizY - (p * r / 90);
    const halfW  = Math.abs(p) % 30 === 0 ? r * 0.38 : r * 0.22;
    const alpha  = Math.abs(p) % 30 === 0 ? 0.7 : 0.4;
    ctx.strokeStyle = `rgba(212,168,64,${alpha})`;
    ctx.lineWidth   = Math.abs(p) % 30 === 0 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(-halfW, lineY);
    ctx.lineTo(halfW, lineY);
    ctx.stroke();
    if (Math.abs(p) % 30 === 0) {
      ctx.font         = `${Math.round(r * 0.18)}px "IBM Plex Mono",monospace`;
      ctx.fillStyle    = 'rgba(212,168,64,0.65)';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.abs(p)), -halfW - r * 0.06, lineY);
    }
  }

  ctx.restore();

  /* Fixed aircraft reference wings (not rotated) */
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = Math.max(2, r * 0.025);
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.38, 0); ctx.lineTo(-r * 0.12, 0);
  ctx.moveTo( r * 0.12, 0); ctx.lineTo( r * 0.38, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  /* Roll index marks around rim */
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const rad = (a - 90) * DEG;
    const len = Math.abs(a) % 30 === 0 ? r * 0.10 : r * 0.06;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * r, Math.sin(rad) * r);
    ctx.lineTo(Math.cos(rad) * (r - len), Math.sin(rad) * (r - len));
    ctx.strokeStyle = `rgba(180,200,200,${Math.abs(a) % 30 === 0 ? 0.55 : 0.30})`;
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();
  }

  /* Roll pointer triangle (moves with roll) */
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-rollDeg * DEG);
  ctx.beginPath();
  ctx.moveTo(0, -r + 2);
  ctx.lineTo(-r * 0.055, -r + r * 0.11);
  ctx.lineTo( r * 0.055, -r + r * 0.11);
  ctx.closePath();
  ctx.fillStyle = '#d4a840';
  ctx.fill();
  ctx.restore();

  /* Outer ring */
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#3a4a4a';
  ctx.lineWidth   = Math.max(2, r * 0.02);
  ctx.stroke();
}

/* ── Altimeter arc gauge (CMP) — 0 to maxKm ── */
function _drawAltimeterArc(ctx, cx, cy, r, altKm, maxKm = 600) {
  const startA = (210 - 90) * DEG;
  const sweep  = 300 * DEG;
  const frac   = Math.min(1, Math.max(0, altKm / maxKm));

  ctx.save();
  ctx.translate(cx, cy);

  /* Background disc */
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0a1218';
  ctx.fill();

  /* Track arc */
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, startA, startA + sweep);
  ctx.strokeStyle = '#1e2c38';
  ctx.lineWidth   = r * 0.09;
  ctx.stroke();

  /* Filled progress arc */
  if (frac > 0.001) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.84, startA, startA + sweep * frac);
    ctx.strokeStyle = '#4dc5dc';
    ctx.lineWidth   = r * 0.09;
    ctx.stroke();
  }

  /* Tick marks at each 100 km */
  for (let km = 0; km <= maxKm; km += 50) {
    const f   = km / maxKm;
    const ang = startA + sweep * f;
    const big = km % 100 === 0;
    const r0  = r;
    const r1  = big ? r * 0.74 : r * 0.80;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
    ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
    ctx.strokeStyle = `rgba(160,210,230,${big ? 0.55 : 0.25})`;
    ctx.lineWidth   = big ? 1.5 : 1;
    ctx.stroke();
    if (big && km > 0 && km < maxKm) {
      const tr = r * 0.63;
      ctx.font         = `${Math.round(r * 0.14)}px "IBM Plex Mono",monospace`;
      ctx.fillStyle    = 'rgba(140,190,210,0.55)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(km / 100), Math.cos(ang) * tr, Math.sin(ang) * tr);
    }
  }

  /* Needle */
  const needleA = startA + sweep * frac;
  ctx.beginPath();
  ctx.moveTo(Math.cos(needleA) * r * 0.1, Math.sin(needleA) * r * 0.1);
  ctx.lineTo(Math.cos(needleA) * r * 0.80, Math.sin(needleA) * r * 0.80);
  ctx.strokeStyle = '#e8edf2';
  ctx.lineWidth   = Math.max(2, r * 0.025);
  ctx.lineCap     = 'round';
  ctx.stroke();

  /* Hub */
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = '#4dc5dc';
  ctx.fill();

  /* Digital readout */
  const altStr  = altKm >= 1 ? `${altKm.toFixed(0)}` : `${Math.round(altKm * 1000)}`;
  const unitStr = altKm >= 1 ? 'km' : 'm';
  ctx.font         = `bold ${Math.round(r * 0.26)}px "IBM Plex Mono",monospace`;
  ctx.fillStyle    = '#e8edf2';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(altStr, 0, r * 0.22);
  ctx.font      = `${Math.round(r * 0.14)}px "IBM Plex Mono",monospace`;
  ctx.fillStyle = '#607080';
  ctx.fillText(unitStr, 0, r * 0.42);

  ctx.restore();
}

/* ── G-meter arc gauge (LMP) — 0 to 4 g ── */
function _drawGMeterArc(ctx, cx, cy, r, gLoad) {
  const startA    = (210 - 90) * DEG;
  const sweep     = 300 * DEG;
  const frac      = Math.min(1, Math.max(0, gLoad / 4));
  const cecoFrac  = 2.3 / 4;
  const redFrac   = 3.5 / 4;

  ctx.save();
  ctx.translate(cx, cy);

  /* Background disc */
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0a1218';
  ctx.fill();

  /* Track arc */
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, startA, startA + sweep);
  ctx.strokeStyle = '#1e2c38';
  ctx.lineWidth   = r * 0.09;
  ctx.stroke();

  /* Color zones */
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, startA, startA + sweep * cecoFrac);
  ctx.strokeStyle = '#4dc5dc';
  ctx.lineWidth   = r * 0.09;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, startA + sweep * cecoFrac, startA + sweep * redFrac);
  ctx.strokeStyle = '#f0c040';
  ctx.lineWidth   = r * 0.09;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, startA + sweep * redFrac, startA + sweep);
  ctx.strokeStyle = '#ff4040';
  ctx.lineWidth   = r * 0.09;
  ctx.stroke();

  /* Tick marks */
  for (let g = 0; g <= 4; g += 0.5) {
    const f   = g / 4;
    const ang = startA + sweep * f;
    const big = Number.isInteger(g);
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
    ctx.lineTo(Math.cos(ang) * (big ? r * 0.74 : r * 0.80), Math.sin(ang) * (big ? r * 0.74 : r * 0.80));
    ctx.strokeStyle = `rgba(160,210,230,${big ? 0.55 : 0.25})`;
    ctx.lineWidth   = big ? 1.5 : 1;
    ctx.stroke();
    if (big) {
      const tr = r * 0.63;
      ctx.font         = `${Math.round(r * 0.15)}px "IBM Plex Mono",monospace`;
      ctx.fillStyle    = 'rgba(140,190,210,0.55)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(g), Math.cos(ang) * tr, Math.sin(ang) * tr);
    }
  }

  /* CECO marker line */
  const cecoA = startA + sweep * cecoFrac;
  ctx.beginPath();
  ctx.moveTo(Math.cos(cecoA) * r * 0.74, Math.sin(cecoA) * r * 0.74);
  ctx.lineTo(Math.cos(cecoA) * r * 0.60, Math.sin(cecoA) * r * 0.60);
  ctx.strokeStyle = '#f0c040';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  /* Needle */
  const needleA = startA + sweep * frac;
  const gCol    = gLoad >= 3.5 ? '#ff4040' : gLoad >= 2.3 ? '#f0c040' : '#e8edf2';
  ctx.beginPath();
  ctx.moveTo(Math.cos(needleA) * r * 0.1, Math.sin(needleA) * r * 0.1);
  ctx.lineTo(Math.cos(needleA) * r * 0.80, Math.sin(needleA) * r * 0.80);
  ctx.strokeStyle = gCol;
  ctx.lineWidth   = Math.max(2, r * 0.028);
  ctx.lineCap     = 'round';
  ctx.stroke();

  /* Hub */
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = '#4a5a6a';
  ctx.fill();

  /* Digital G value */
  ctx.font         = `bold ${Math.round(r * 0.30)}px "IBM Plex Mono",monospace`;
  ctx.fillStyle    = gCol;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(gLoad.toFixed(1), 0, r * 0.18);
  ctx.font      = `${Math.round(r * 0.14)}px "IBM Plex Mono",monospace`;
  ctx.fillStyle = '#607080';
  ctx.fillText('g', 0, r * 0.38);

  ctx.restore();
}

export function renderApollo(canvas) {
  const DPR = devicePixelRatio || 1;

  /* TELEM mode: renderRocket already painted the canvas — just overlay tabs */
  if (_apolloRole === 'TELEM') {
    const W   = canvas.width;
    const H   = canvas.height;
    const ctx = canvas.getContext('2d');
    _drawApolloTabs(ctx, W, H, S.mission?.crew ?? {});
    return;
  }

  const W   = canvas.width  = canvas.offsetWidth  * DPR;
  const H   = canvas.height = canvas.offsetHeight * DPR;
  const ctx = canvas.getContext('2d');

  const ac   = S.aircraft;
  const msn  = S.mission;
  ctx.fillStyle = '#03060a';
  ctx.fillRect(0, 0, W, H);
  if (!ac) return;

  /* Role: tab selection overrides S.role */
  const role = _apolloRole;
  const crew = msn?.crew ?? {};
  const crewName = crew[role] ? crew[role].toUpperCase() : '';

  const mT   = S.time ?? 0;
  const ignT = ac.ignitionTime ?? 0;
  const tLO  = mT - ignT;

  /* Derived state */
  const altM    = (S.alt ?? 0) * 0.3048;
  const altKm   = altM / 1000;
  const velMs   = (S.spd ?? 0) * 0.5144;
  const velFps  = velMs * 3.28084;
  const gLoad   = S.rocketG     ?? 0;
  const dynQ    = S.rocketDynQ  ?? 0;
  const stage   = S.rocketStage ?? 1;
  const mass    = S.rocketMass  ?? (ac.performance?.massWet ?? 1);
  const coast   = S.rocketCoast ?? false;
  const pitch   = S.pitch ?? 90;
  const rollDeg = S.roll  ?? 0;
  const engines = S.rocketActiveEngines ?? (ac.performance?.stages?.[stage - 1]?.engineCount ?? 0);

  const stageNames = ac.performance?.stages?.map(s => s.name) ?? ['S-IC', 'S-II', 'S-IVB'];
  const stageName  = stageNames[stage - 1] ?? `STAGE ${stage}`;

  const massWet   = ac.performance?.massWet ?? 1;
  const propFrac  = Math.max(0, Math.min(1, mass / massWet));
  const abortMode = altKm < 45 ? '1' : altKm < 150 ? '1-BRAVO' : '2-BRAVO';

  const vOrbMs    = Math.sqrt(GM_EARTH / (R_EARTH_M + altM));
  const orbitFrac = Math.min(1, velMs / vOrbMs);
  const inOrbit   = !!(S.rocketOrbit);

  /* MET clock */
  const absT = Math.abs(tLO);
  const hh   = Math.floor(absT / 3600);
  const mm   = Math.floor((absT % 3600) / 60);
  const ss   = Math.floor(absT % 60);
  const met  = `${tLO >= 0 ? 'T+' : 'T−'} ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;

  /* Layout zones */
  const tabH  = Math.round(H * 0.072);
  const hdH   = Math.round(H * 0.10);   /* header height */
  const pad   = Math.round(W * 0.025);
  const mainT = hdH + Math.round(H * 0.015);
  const mainH = H - tabH - mainT;

  const gaugeCol  = Math.round(W * 0.42);
  const rightX    = gaugeCol + pad;
  const rightW    = W - rightX - pad;

  /* Gauge: centred in left column */
  const gaugeR = Math.round(Math.min(gaugeCol, mainH) * 0.42);
  const gaugeCX = Math.round(gaugeCol / 2);
  const gaugeCY = mainT + Math.round(mainH / 2);

  /* Font sizes */
  const lSz  = `${Math.round(H * 0.028)}px "IBM Plex Mono",monospace`;
  const vSz  = `${Math.round(H * 0.068)}px "IBM Plex Mono",monospace`;
  const mSz  = `${Math.round(H * 0.050)}px "IBM Plex Mono",monospace`;

  /* ── Header ── */
  const callsign  = (ac.callsign ?? 'APOLLO').toUpperCase();
  const roleLabel = crewName ? `${role}  ${crewName}` : role;
  _apolloText(ctx, callsign,  pad,     Math.round(hdH * 0.6), { font: `${Math.round(H*0.042)}px "IBM Plex Mono",monospace`, color: '#c8d4bc', base: 'middle' });
  _apolloText(ctx, roleLabel, W / 2,   Math.round(hdH * 0.6), { font: lSz, color: '#7a8a72', align: 'center', base: 'middle' });
  _apolloText(ctx, met,       W - pad, Math.round(hdH * 0.6), { font: `${Math.round(H*0.040)}px "IBM Plex Mono",monospace`, color: '#5dd47e', align: 'right', base: 'middle' });

  ctx.strokeStyle = '#1e2c20'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, hdH); ctx.lineTo(W - pad, hdH); ctx.stroke();

  /* Vertical divider between gauge and data columns */
  ctx.beginPath(); ctx.moveTo(gaugeCol, mainT + mainH * 0.05); ctx.lineTo(gaugeCol, mainT + mainH * 0.95); ctx.stroke();

  /* ── Right-column row helper ── */
  let _rowY = mainT + Math.round(mainH * 0.06);
  function _row(label, value, { color = '#e8edf2', font = vSz, gap = mainH * 0.02 } = {}) {
    _apolloText(ctx, label, rightX, _rowY, { font: lSz, color: '#607080', base: 'top' });
    _rowY += Math.round(H * 0.028) + 2;
    _apolloText(ctx, value, rightX, _rowY, { font, color, base: 'top' });
    _rowY += Math.round(parseFloat(font)) + Math.round(gap);
  }
  function _bar(frac, color, w = rightW, note = '') {
    const barH = Math.round(H * 0.022);
    _apolloBar(ctx, rightX, _rowY, w, barH, frac, color);
    _rowY += barH + 2;
    if (note) {
      _apolloText(ctx, note, rightX, _rowY, { font: `${Math.round(H*0.022)}px "IBM Plex Mono",monospace`, color: '#4a6050', base: 'top' });
      _rowY += Math.round(H * 0.024) + Math.round(mainH * 0.02);
    }
  }
  function _gap(h = 0.04) { _rowY += Math.round(mainH * h); }

  /* ═══ CDR: FDAI + attitude / stage / abort ═══ */
  if (role === 'CDR') {
    _drawFDAI(ctx, gaugeCX, gaugeCY, gaugeR, pitch, rollDeg);
    _row('PITCH', `${pitch >= 0 ? '+' : ''}${Math.round(pitch)}°`);
    _row('ROLL',  `${rollDeg >= 0 ? '+' : ''}${Math.round(rollDeg)}°`);
    _gap(0.03);
    _row('STAGE', stageName, { color: '#c8d4bc', font: mSz });
    _gap(0.04);
    const gStr = gLoad.toFixed(2) + ' g';
    const gCol = gLoad >= 3.5 ? '#ff4040' : gLoad >= 2.3 ? '#f0c040' : '#e8edf2';
    _row('G-LOAD', gStr, { color: gCol });
    _gap(0.03);
    _row('ABORT MODE', abortMode, { color: '#f0c040', font: mSz });
  }

  /* ═══ CMP: Altimeter arc + velocity / orbit / abort ═══ */
  else if (role === 'CMP') {
    _drawAltimeterArc(ctx, gaugeCX, gaugeCY, gaugeR, altKm);
    _row('VELOCITY', `${(velMs / 1000).toFixed(2)} km/s`);
    _apolloText(ctx, `${Math.round(velFps).toLocaleString()} fps`, rightX, _rowY, { font: `${Math.round(H*0.028)}px "IBM Plex Mono",monospace`, color: '#506060', base: 'top' });
    _rowY += Math.round(H * 0.030) + Math.round(mainH * 0.02);
    _bar(orbitFrac, inOrbit ? '#5dd47e' : '#4dc5dc', rightW, inOrbit ? 'ORBIT ACHIEVED' : `${Math.round(orbitFrac * 100)}% ORBITAL VEL`);
    _gap(0.03);
    _row('FPA', `${Math.round(pitch)}°`, { color: '#c8d4bc', font: mSz });
    _gap(0.04);
    _row('ABORT MODE', abortMode, { color: '#f0c040', font: mSz });
  }

  /* ═══ LMP: G-meter arc + stage / propellant / dyn-Q ═══ */
  else {
    _drawGMeterArc(ctx, gaugeCX, gaugeCY, gaugeR, gLoad);
    _row('STAGE', stageName, { color: '#c8d4bc', font: mSz });
    _apolloText(ctx, coast ? 'COAST' : `${engines} ENG FIRING`, rightX, _rowY, { font: lSz, color: coast ? '#f0c040' : '#5dd47e', base: 'top' });
    _rowY += Math.round(H * 0.030) + Math.round(mainH * 0.04);
    _row('PROPELLANT', `${Math.round(propFrac * 100)} %`, { color: propFrac < 0.15 ? '#ff4040' : '#e8edf2' });
    _bar(propFrac, propFrac < 0.15 ? '#ff4040' : '#4dc5dc');
    _gap(0.02);
    _row('DYN Q', `${(dynQ / 1000).toFixed(1)} kPa`, { color: '#e8edf2', font: mSz });
    _gap(0.03);
    _row('ABORT MODE', abortMode, { color: '#f0c040', font: mSz });
  }

  _drawApolloTabs(ctx, W, H, crew);
}
