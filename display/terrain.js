/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/terrain.js
   3D terrain renderer. Flat-earth pinhole projection, canvas 2D.

   Aircraft body frame (fwd/right/up), relative to aircraft:
     fwd   = nm along heading
     right = nm to starboard
     up    = nm above aircraft (ground = -altNm)

   Projection verified:
     pitch rotates in fwd/up plane (nose up → ground drops on screen)
     roll  rotates in right/up plane (right bank → right side drops)
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const DEG   = Math.PI / 180;
const FT_NM = 1 / 6076.12;
const M_NM  = 1 / 1852;
const FOV_H = 70;     /* horizontal field of view, degrees */

const ROWS = 30;      /* depth slices */
const COLS = 26;      /* lateral divisions */

/* Forward distances per row — log-spaced 0.1 to ~18 nm */
const ROW_DIST = Array.from({ length: ROWS + 1 }, (_, i) => 0.1 * Math.pow(1.32, i));

export function renderTerrain(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');

  const pitch = (S.pitch ?? 0) * DEG;
  const roll  = (S.roll  ?? 0) * DEG;
  const hdg   = (S.hdg   ?? 0) * DEG;
  const elevFt = S.mission?.arrival?.elevation ?? S.mission?.departure?.elevation ?? 0;
  const agl    = Math.max(1, (S.alt ?? 1000) - elevFt);
  const altNm  = agl * FT_NM;

  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG);
  const cosP  = Math.cos(pitch), sinP = Math.sin(pitch);
  const cosR  = Math.cos(roll),  sinR = Math.sin(roll);
  const cosH  = Math.cos(hdg),   sinH = Math.sin(hdg);
  const cx = W / 2, cy = H / 2;

  /* ── Project (fwd, right) aircraft-frame nm to screen pixels ──
     up = 0 means ground level; aircraft is at +altNm above ground.
     Returns [sx, sy] or null if behind camera.                   */
  function proj(fwd, right, upAdd) {
    const up = (upAdd ?? 0) - altNm;
    const cf = fwd * cosP + up * sinP;
    const cu = up  * cosP - fwd * sinP;
    if (cf < 1e-4) return null;
    const cr2 = right * cosR + cu * sinR;
    const cu2 = cu    * cosR - right * sinR;
    return [cx + cr2 / cf * focal, cy - cu2 / cf * focal];
  }

  /* ── Project world NE offset (nm from aircraft) to screen ── */
  function projNE(dN, dE, upAdd) {
    return proj(dN * cosH + dE * sinH, dE * cosH - dN * sinH, upAdd);
  }

  /* ── Mission flags ── */
  const isArctic = S.mission?.id === 'wolfskopf-1942';
  const isWater  = S.mission?.water === true;

  /* ── Time of day / sun ── */
  const timeOfDay   = S.mission?.timeOfDay ?? 12;
  const sunAlt      = Math.sin((timeOfDay - 6) / 12 * Math.PI);   // -1 midnight … +1 noon
  const sunAzDeg    = (180 + (timeOfDay - 12) * 15 + 360) % 360;  // south at noon (NH)
  const sunAltRad   = Math.asin(Math.max(-1, Math.min(1, sunAlt)));
  const sunRelAzRad = ((sunAzDeg - (S.hdg ?? 0) + 540) % 360 - 180) * DEG;
  const dayFrac     = Math.max(0, Math.min(1, (sunAlt + 0.15) / 0.25));  // 0=night 1=day
  const goldenFrac  = Math.max(0, 1 - Math.abs(sunAlt) / 0.18);          // peak at sunrise/set

  /* ── Sky gradient ── */
  const isRocket   = S.aircraft?.vehicleType === 'rocket';
  const altScale   = isRocket ? 500_000 : 35_000;   // ft: rockets reach space, aircraft don't
  const spaceFrac  = isRocket ? Math.min(1, (S.alt ?? 0) / 350_000) : 0;  // 0=atmo 1=space
  const t = Math.min(1, (S.alt ?? 1000) / altScale);  // altitude tint 0=low 1=high

  let skyTopR, skyTopG, skyTopB;
  let skyBotR, skyBotG, skyBotB;

  if (isArctic) {
    /* Arctic overcast — grey, dimmed at night */
    skyTopR = Math.round(_lerp(25, _c(70,120,t), dayFrac));
    skyTopG = Math.round(_lerp(30, _c(80,130,t), dayFrac));
    skyTopB = Math.round(_lerp(40, _c(90,140,t), dayFrac));
    skyBotR = Math.round(_lerp(40, _c(140,170,t), dayFrac));
    skyBotG = Math.round(_lerp(45, _c(150,180,t), dayFrac));
    skyBotB = Math.round(_lerp(55, _c(160,190,t), dayFrac));
  } else {
    /* Day sky (altitude-tinted blue) */
    const dayTopR = _c(8,  100, t), dayTopG = _c(18, 180, t), dayTopB = _c(38, 230, t);
    const dayBotR = _c(32, 165, t), dayBotG = _c(90, 210, t), dayBotB = _c(145,245, t);
    /* Night sky */
    const nightTopR = 3,  nightTopG = 5,  nightTopB = 18;
    const nightBotR = 8,  nightBotG = 12, nightBotB = 35;
    /* Golden hour horizon */
    const goldR = 255, goldG = 130, goldB = 40;

    skyTopR = Math.round(_lerp(nightTopR, dayTopR, dayFrac));
    skyTopG = Math.round(_lerp(nightTopG, dayTopG, dayFrac));
    skyTopB = Math.round(_lerp(nightTopB, dayTopB, dayFrac));

    const baseR = Math.round(_lerp(nightBotR, dayBotR, dayFrac));
    const baseG = Math.round(_lerp(nightBotG, dayBotG, dayFrac));
    const baseB = Math.round(_lerp(nightBotB, dayBotB, dayFrac));
    skyBotR = Math.round(_lerp(baseR, goldR, goldenFrac));
    skyBotG = Math.round(_lerp(baseG, goldG, goldenFrac));
    skyBotB = Math.round(_lerp(baseB, goldB, goldenFrac));
  }

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `rgb(${skyTopR},${skyTopG},${skyTopB})`);
  sky.addColorStop(1, `rgb(${skyBotR},${skyBotG},${skyBotB})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  /* ── Stars (night or space) ── */
  const effectiveDayFrac = dayFrac * (1 - spaceFrac);  // space overrides time of day
  if (effectiveDayFrac < 0.95 && !isArctic) {
    const starAlpha = Math.max(0, 1 - effectiveDayFrac) * 0.85;
    ctx.save();
    /* Clip to sky half — approximate: above horizon */
    const horizonY = cy + Math.tan(pitch) * focal;
    ctx.beginPath();
    ctx.rect(0, 0, W, horizonY);
    ctx.clip();

    ctx.fillStyle = `rgba(255,255,255,${starAlpha})`;
    /* Deterministic star field — fixed seed via simple LCG */
    let rx = 0x12345678;
    const _rand = () => { rx = (rx * 1664525 + 1013904223) & 0xffffffff; return (rx >>> 0) / 0xffffffff; };
    const STAR_COUNT = 180;
    for (let i = 0; i < STAR_COUNT; i++) {
      const sx = _rand() * W;
      const sy = _rand() * (horizonY * 0.95);
      const sr = (_rand() * 1.2 + 0.3) * devicePixelRatio;
      /* Twinkle: vary alpha slightly per star */
      const tw = 0.7 + _rand() * 0.3;
      ctx.globalAlpha = starAlpha * tw;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ── Sun disc ── */
  if (sunAlt > -0.05) {
    const sunFwd    = Math.cos(sunAltRad) * Math.cos(sunRelAzRad);
    const sunRight  = Math.cos(sunAltRad) * Math.sin(sunRelAzRad);
    const sunUp     = Math.sin(sunAltRad);
    const scf  = sunFwd  * cosP + sunUp   * sinP;
    const scu  = sunUp   * cosP - sunFwd  * sinP;
    const scr2 = sunRight * cosR + scu * sinR;
    const scu2 = scu      * cosR - sunRight * sinR;

    if (scf > 0.01) {
      const sx = cx + scr2 / scf * focal;
      const sy = cy - scu2 / scf * focal;
      if (sx > -200 && sx < W + 200 && sy > -200 && sy < H + 200) {
        const isLow   = sunAlt < 0.15;
        const sunR    = isLow ? 255 : 255;
        const sunG    = isLow ? 150 :  220;
        const sunB    = isLow ?  40 :  120;
        const radius  = 18 * devicePixelRatio;

        /* Glow */
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 4);
        glow.addColorStop(0,   `rgba(${sunR},${sunG},${sunB},0.30)`);
        glow.addColorStop(0.4, `rgba(${sunR},${sunG},${sunB},0.12)`);
        glow.addColorStop(1,   `rgba(${sunR},${sunG},${sunB},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, radius * 4, 0, Math.PI * 2);
        ctx.fill();

        /* Disc */
        ctx.fillStyle = `rgb(${sunR},${sunG},${sunB})`;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ── Ground grid — pre-project all vertices ── */
  const pts = [];
  for (let r = 0; r <= ROWS; r++) {
    const d    = ROW_DIST[r];
    const half = d * 1.5;
    const row  = [];
    for (let c = 0; c <= COLS; c++) {
      const right = (c / COLS - 0.5) * 2 * half;
      row.push(proj(d, right));
    }
    pts.push(row);
  }

  /* Terrain / water fill */
  const terrainNear = isArctic ? '#cdd4d8' : isWater ? '#1a3f66' : '#3d6e30';
  const terrainFar  = isArctic ? '#b8c2c8' : isWater ? '#162f50' : '#2d5a22';

  ctx.beginPath();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const tl = pts[r][c],     tr = pts[r][c + 1];
      const bl = pts[r + 1][c], br = pts[r + 1][c + 1];
      if (!tl || !tr || !bl || !br) continue;
      ctx.moveTo(tl[0], tl[1]);
      ctx.lineTo(tr[0], tr[1]);
      ctx.lineTo(br[0], br[1]);
      ctx.lineTo(bl[0], bl[1]);
      ctx.closePath();
    }
  }
  /* Gradient fill front→back */
  const frontPt = pts[0][Math.floor(COLS / 2)];
  const backPt  = pts[ROWS][Math.floor(COLS / 2)];
  if (frontPt && backPt) {
    const tg = ctx.createLinearGradient(0, frontPt[1], 0, backPt[1]);
    tg.addColorStop(0, terrainNear);
    tg.addColorStop(1, terrainFar);
    ctx.fillStyle = tg;
  } else {
    ctx.fillStyle = terrainNear;
  }
  ctx.fill();

  /* ── World-fixed ground grid ── */
  const GRID_NM         = 0.5;
  const GRID_RANGE_FWD  = 18;
  const GRID_RANGE_SIDE = 20;
  const GRID_RANGE_BACK =  3;

  const acLatNm = (S.lat ?? 0) * 60;
  const acLonNm = (S.lon ?? 0) * 60 * Math.cos((S.lat ?? 0) * DEG);

  const gridColor = isArctic ? '#b0bcc4' : isWater ? '#1e4a78' : '#2d5a22';
  ctx.strokeStyle = gridColor;
  ctx.lineWidth   = 1 * devicePixelRatio;
  ctx.setLineDash([]);

  const firstLatNm = Math.ceil((acLatNm  - GRID_RANGE_BACK) / GRID_NM) * GRID_NM;
  const lastLatNm  = Math.floor((acLatNm + GRID_RANGE_FWD)  / GRID_NM) * GRID_NM;
  ctx.beginPath();
  for (let lnm = firstLatNm; lnm <= lastLatNm; lnm += GRID_NM) {
    const dN = lnm - acLatNm;
    const p1 = projNE(dN, -GRID_RANGE_SIDE);
    const p2 = projNE(dN,  GRID_RANGE_SIDE);
    if (p1 && p2) { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
  }
  ctx.stroke();

  const firstLonNm = Math.ceil((acLonNm  - GRID_RANGE_SIDE) / GRID_NM) * GRID_NM;
  const lastLonNm  = Math.floor((acLonNm + GRID_RANGE_SIDE) / GRID_NM) * GRID_NM;
  ctx.beginPath();
  for (let lnm = firstLonNm; lnm <= lastLonNm; lnm += GRID_NM) {
    const dE = lnm - acLonNm;
    const p1 = projNE(-GRID_RANGE_BACK, dE);
    const p2 = projNE( GRID_RANGE_FWD,  dE);
    if (p1 && p2) { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
  }
  ctx.stroke();

  /* ── Atmospheric haze at horizon ── */
  const horizonY = cy + Math.tan(pitch) * focal;
  const hazeTop  = Math.max(0, horizonY - 8 * devicePixelRatio);
  const hazeH    = Math.min(70 * devicePixelRatio, H - hazeTop);
  if (hazeH > 0) {
    const hazeGrad = ctx.createLinearGradient(0, hazeTop, 0, hazeTop + hazeH);
    hazeGrad.addColorStop(0, `rgba(${skyBotR},${skyBotG},${skyBotB},0.72)`);
    hazeGrad.addColorStop(1, `rgba(${skyBotR},${skyBotG},${skyBotB},0)`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, hazeTop, W, hazeH);
  }

  /* ── Water specular shimmer (horizontal bands near horizon) ── */
  if (isWater && agl > 200) {
    const shimmerAlpha = Math.min(0.18, agl / 8000 * 0.18);
    ctx.save();
    ctx.globalAlpha = shimmerAlpha;
    ctx.strokeStyle = `rgb(${Math.min(255, skyBotR + 60)},${Math.min(255, skyBotG + 60)},${Math.min(255, skyBotB + 40)})`;
    ctx.lineWidth = devicePixelRatio;
    for (let i = 0; i < 6; i++) {
      const frac = 0.3 + i * 0.12;
      const wDist = frac * GRID_RANGE_FWD;
      const p1 = projNE(wDist, -GRID_RANGE_SIDE * 0.6);
      const p2 = projNE(wDist,  GRID_RANGE_SIDE * 0.6);
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ── Runway ── */
  const arr = S.mission?.arrival;
  if (arr?.rwyLat != null) {
    const dN = (arr.rwyLat - (S.lat ?? 0)) * 60;
    const dE = (arr.rwyLon - (S.lon ?? 0)) * 60 * Math.cos((S.lat ?? 0) * DEG);

    const rh  = arr.rwyHdg * DEG;
    const hl  = (arr.rwyLengthM ?? 600) / 2 * M_NM;
    const hw  = (arr.rwyWidthM  ?? 20)  / 2 * M_NM;

    const axN =  Math.cos(rh) * hl,  axE = Math.sin(rh) * hl;
    const wpN = -Math.sin(rh) * hw,  wpE = Math.cos(rh) * hw;

    const c4 = [
      projNE(dN + axN + wpN, dE + axE + wpE),
      projNE(dN + axN - wpN, dE + axE - wpE),
      projNE(dN - axN - wpN, dE - axE - wpE),
      projNE(dN - axN + wpN, dE - axE + wpE),
    ].filter(Boolean);

    if (c4.length === 4) {
      ctx.fillStyle = '#b8b8b8';
      ctx.beginPath();
      ctx.moveTo(c4[0][0], c4[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(c4[i][0], c4[i][1]);
      ctx.closePath();
      ctx.fill();

      const p1 = projNE(dN + axN * 0.9, dE + axE * 0.9);
      const p2 = projNE(dN - axN * 0.9, dE - axE * 0.9);
      if (p1 && p2) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2 * devicePixelRatio);
        ctx.setLineDash([20 * devicePixelRatio, 20 * devicePixelRatio]);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /* ── NIFLHEIM — das Tiefenwesen, Wolfskopf T+108 to T+124 ── */
  if (isArctic) {
    const mT = S.time ?? 0;
    if (mT >= 108 && mT < 124) {
      const phase = (mT - 108) / 16;

      let alpha;
      if      (phase < 0.25) alpha = phase / 0.25;
      else if (phase < 0.65) alpha = 1.0;
      else                   alpha = 1 - (phase - 0.65) / 0.35;

      const rise    = Math.min(1, phase / 0.5);
      const maxH    = 380 * FT_NM;
      const dist    = 1.8;
      const offR    = 0.18;

      const b1 = projNE(dist - 0.12, offR - 0.08);
      const b2 = projNE(dist + 0.10, offR + 0.16);
      const m1 = projNE(dist - 0.06, offR - 0.02, maxH * rise * 0.45);
      const m2 = projNE(dist + 0.08, offR + 0.12, maxH * rise * 0.60);
      const t1 = projNE(dist + 0.02, offR + 0.04, maxH * rise);
      const t2 = projNE(dist - 0.04, offR - 0.01, maxH * rise * 0.85);

      if (b1 && b2 && t1) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.82;

        ctx.fillStyle = 'rgba(6, 14, 20, 0.95)';
        ctx.beginPath();
        ctx.moveTo(b1[0], b1[1]);
        if (m1)  ctx.bezierCurveTo(b1[0], b1[1] - 10, m1[0] - 8, m1[1] + 6, m1[0], m1[1]);
        if (t2)  ctx.bezierCurveTo(m1[0] + 4, m1[1] - 8, t2[0] - 6, t2[1] + 4, t2[0], t2[1]);
        ctx.bezierCurveTo(t2 ? t2[0] + 5 : t1[0] - 5, (t2 ? t2[1] : t1[1]) - 4, t1[0] - 4, t1[1] + 3, t1[0], t1[1]);
        if (m2)  ctx.bezierCurveTo(t1[0] + 6, t1[1] + 5, m2[0] + 4, m2[1] - 6, m2[0], m2[1]);
        ctx.bezierCurveTo(m2 ? m2[0] + 2 : b2[0], (m2 ? m2[1] : b2[1]) + 8, b2[0] + 4, b2[1] - 4, b2[0], b2[1]);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = alpha * 0.18;
        ctx.strokeStyle = 'rgba(40, 200, 180, 1.0)';
        ctx.lineWidth   = 1.5 * devicePixelRatio;
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  /* ── Vehicle silhouette HUD (rocket missions only) — rendered by map.js ── */
}

/* Lerp colour channel: low-alt value a, high-alt value b */
function _c(a, b, t) { return Math.round(a + (b - a) * (1 - t)); }

/* Linear interpolation */
function _lerp(a, b, t) { return a + (b - a) * t; }
