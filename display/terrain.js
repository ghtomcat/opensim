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
  const agl    = Math.max(1, (S.alt ?? 1000) - elevFt);   // height above ground (ft)
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

    /* Pitch (rotate around right/X axis) */
    const cf = fwd * cosP + up * sinP;   /* cam depth  */
    const cu = up  * cosP - fwd * sinP;  /* cam up     */

    if (cf < 1e-4) return null;

    /* Roll (rotate around fwd/Z axis) */
    const cr2 = right * cosR + cu * sinR;
    const cu2 = cu    * cosR - right * sinR;

    return [cx + cr2 / cf * focal, cy - cu2 / cf * focal];
  }

  /* ── Project world NE offset (nm from aircraft) to screen ── */
  function projNE(dN, dE, upAdd) {
    return proj(dN * cosH + dE * sinH, dE * cosH - dN * sinH, upAdd);
  }

  /* ── Sky gradient ── */
  const t   = Math.min(1, alt / 35000);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `rgb(${_c(8,  100, t)},${_c(18, 180, t)},${_c(38, 230, t)})`);
  sky.addColorStop(1, `rgb(${_c(32, 165, t)},${_c(90, 210, t)},${_c(145,245, t)})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  /* ── Ground grid — pre-project all vertices ── */
  const pts = [];
  for (let r = 0; r <= ROWS; r++) {
    const d    = ROW_DIST[r];
    const half = d * 1.5;    /* lateral half-width: covers FOV + buffer */
    const row  = [];
    for (let c = 0; c <= COLS; c++) {
      const right = (c / COLS - 0.5) * 2 * half;
      row.push(proj(d, right));
    }
    pts.push(row);
  }

  /* Draw all quads in one path fill */
  ctx.fillStyle = '#3d6e30';
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
  ctx.fill();

  /* ── World-fixed ground grid ── */
  /* Snap to 0.5 nm intervals in lat/lon so lines scroll as aircraft moves */
  const GRID_NM   = 0.5;
  const GRID_RANGE_FWD  = 18;   /* nm forward  */
  const GRID_RANGE_SIDE = 20;   /* nm sideways */
  const GRID_RANGE_BACK =  3;   /* nm behind   */

  /* Aircraft position in nm */
  const acLatNm = (S.lat ?? 0) * 60;
  const acLonNm = (S.lon ?? 0) * 60 * Math.cos((S.lat ?? 0) * DEG);

  ctx.strokeStyle = '#2d5a22';
  ctx.lineWidth   = 1 * devicePixelRatio;
  ctx.setLineDash([]);

  /* E-W lines (constant latitude) */
  const firstLatNm = Math.ceil((acLatNm - GRID_RANGE_BACK)  / GRID_NM) * GRID_NM;
  const lastLatNm  = Math.floor((acLatNm + GRID_RANGE_FWD) / GRID_NM) * GRID_NM;
  ctx.beginPath();
  for (let lnm = firstLatNm; lnm <= lastLatNm; lnm += GRID_NM) {
    const dN = lnm - acLatNm;
    const p1 = projNE(dN, -GRID_RANGE_SIDE);
    const p2 = projNE(dN,  GRID_RANGE_SIDE);
    if (p1 && p2) { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
  }
  ctx.stroke();

  /* N-S lines (constant longitude) */
  const firstLonNm = Math.ceil((acLonNm - GRID_RANGE_SIDE) / GRID_NM) * GRID_NM;
  const lastLonNm  = Math.floor((acLonNm + GRID_RANGE_SIDE) / GRID_NM) * GRID_NM;
  ctx.beginPath();
  for (let lnm = firstLonNm; lnm <= lastLonNm; lnm += GRID_NM) {
    const dE = lnm - acLonNm;
    const p1 = projNE(-GRID_RANGE_BACK, dE);
    const p2 = projNE( GRID_RANGE_FWD,  dE);
    if (p1 && p2) { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
  }
  ctx.stroke();

  /* ── Runway ── */
  const arr = S.mission?.arrival;
  if (arr?.rwyLat != null) {
    const dN = (arr.rwyLat - (S.lat ?? 0)) * 60;
    const dE = (arr.rwyLon - (S.lon ?? 0)) * 60 * Math.cos((S.lat ?? 0) * DEG);

    const rh  = arr.rwyHdg * DEG;
    const hl  = (arr.rwyLengthM ?? 600) / 2 * M_NM;
    const hw  = (arr.rwyWidthM  ?? 20)  / 2 * M_NM;

    /* Runway axis and perpendicular in NE */
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

      /* Centreline dashes */
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
}

/* Lerp colour channel: low-alt value a, high-alt value b */
function _c(a, b, t) { return Math.round(a + (b - a) * (1 - t)); }
