/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/pfd.js
   Primary Flight Display canvas renderer.
   Call renderPFD(canvas) each frame; reads from S.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { managedSpeed } from '../core/managed-speed.js';

const C = {
  sky:     '#1a3a5c',
  ground:  '#4a3520',
  horizon: '#d4a843',
  cyan:    '#4dc5dc',
  green:   '#5dd47e',
  amber:   '#ffb74d',
  red:     '#ff4444',
  white:   '#e8edf2',
  dim:     'rgba(232,237,242,0.45)',
  bg:      'rgba(3,6,10,0.88)',
  tape:    'rgba(3,6,10,0.72)',
  grid:    'rgba(255,255,255,0.06)',
};

const FONT_MONO = '"IBM Plex Mono", "Courier New", monospace';
const FONT_UI   = '"Syne", "Helvetica Neue", sans-serif';

export function renderPFD(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  const cx = W / 2;
  const cy = H / 2;
  const scale = Math.min(W, H) / 800;

  /* ── Background ── */
  ctx.fillStyle = '#030609';
  ctx.fillRect(0, 0, W, H);

  /* ── Attitude (pitch ladder + horizon + roll) ── */
  _drawAttitude(ctx, cx, cy, W, H, scale);

  /* ── Tapes ── */
  _drawSpeedTape(ctx, W, H, scale);
  _drawAltTape(ctx, W, H, scale);
  _drawHeadingTape(ctx, W, H, scale);
  _drawVSI(ctx, W, H, scale);

  /* ── ILS needles ── */
  _drawILS(ctx, cx, cy, scale);

  /* ── FPV Bird ── */
  _drawFPV(ctx, cx, cy, scale);

  /* ── Bank indicator arc ── */
  _drawBankArc(ctx, cx, cy, scale);

  /* ── Overlay info ── */
  _drawOverlayInfo(ctx, W, H, scale);

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   ATTITUDE
   ════════════════════════════════════════════════════════════ */
function _drawAttitude(ctx, cx, cy, W, H, scale) {
  const pitch = S.pitch;
  const roll  = S.roll;

  const pitchPx = pitch * 12 * scale;   // 12px per degree
  const rollRad = (roll * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-rollRad);

  /* Clip to circular viewport */
  const r = 320 * scale;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  /* Sky */
  const skyH = H * 0.5 + pitchPx;
  ctx.fillStyle = C.sky;
  ctx.fillRect(-W, -H, W * 2, H + skyH);

  /* Ground */
  ctx.fillStyle = C.ground;
  ctx.fillRect(-W, skyH, W * 2, H);

  /* Horizon line */
  ctx.strokeStyle = C.horizon;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(-W, skyH);
  ctx.lineTo(W, skyH);
  ctx.stroke();

  /* Pitch ladder */
  _drawPitchLadder(ctx, pitchPx, scale);

  ctx.restore();
}

function _drawPitchLadder(ctx, pitchPx, scale) {
  ctx.font = `${10 * scale}px ${FONT_MONO}`;
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';

  for (let deg = -30; deg <= 30; deg += 5) {
    if (deg === 0) continue;
    const y = pitchPx - deg * 12 * scale;
    const w = (deg % 10 === 0 ? 80 : 40) * scale;

    ctx.strokeStyle = deg > 0 ? C.white : C.amber;
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();

    if (deg % 10 === 0) {
      ctx.fillStyle = deg > 0 ? C.white : C.amber;
      ctx.fillText(Math.abs(deg), -w / 2 - 20 * scale, y + 4 * scale);
      ctx.fillText(Math.abs(deg),  w / 2 + 20 * scale, y + 4 * scale);
    }
  }
}

/* ════════════════════════════════════════════════════════════
   BANK ARC
   ════════════════════════════════════════════════════════════ */
function _drawBankArc(ctx, cx, cy, scale) {
  const r    = 290 * scale;
  const roll = S.roll;

  ctx.save();
  ctx.translate(cx, cy);

  /* Tick marks at 10/20/30/45/60° */
  ctx.strokeStyle = C.white;
  ctx.lineWidth   = 1.5 * scale;

  for (const deg of [10, 20, 30, 45, 60, -10, -20, -30, -45, -60]) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const len = (Math.abs(deg) % 30 === 0 ? 14 : 8) * scale;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * r, Math.sin(rad) * r);
    ctx.lineTo(Math.cos(rad) * (r - len), Math.sin(rad) * (r - len));
    ctx.stroke();
  }

  /* Bank pointer */
  const ptr = ((-roll - 90) * Math.PI) / 180;
  ctx.strokeStyle = C.amber;
  ctx.lineWidth   = 2.5 * scale;
  ctx.beginPath();
  const px = Math.cos(ptr) * (r - 2 * scale);
  const py = Math.sin(ptr) * (r - 2 * scale);
  ctx.moveTo(px - Math.sin(ptr) * 8 * scale, py + Math.cos(ptr) * 8 * scale);
  ctx.lineTo(px + Math.sin(ptr) * 8 * scale, py - Math.cos(ptr) * 8 * scale);
  ctx.lineTo(Math.cos(ptr) * (r - 20 * scale), Math.sin(ptr) * (r - 20 * scale));
  ctx.closePath();
  ctx.strokeStyle = C.amber;
  ctx.fillStyle   = C.amber;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   FPV BIRD
   ════════════════════════════════════════════════════════════ */
function _drawFPV(ctx, cx, cy, scale) {
  const fpvY  = cy - S.vs * 0.004 * scale;
  const fpvX  = cx + S.roll * 0.5 * scale;
  const r     = 10 * scale;

  ctx.save();
  ctx.strokeStyle = C.green;
  ctx.lineWidth   = 2 * scale;

  ctx.beginPath();
  ctx.arc(fpvX, fpvY, r, 0, Math.PI * 2);
  ctx.stroke();

  /* Wings */
  ctx.beginPath();
  ctx.moveTo(fpvX + r, fpvY);
  ctx.lineTo(fpvX + r + 18 * scale, fpvY);
  ctx.moveTo(fpvX - r, fpvY);
  ctx.lineTo(fpvX - r - 18 * scale, fpvY);
  ctx.stroke();

  /* Tail */
  ctx.beginPath();
  ctx.moveTo(fpvX, fpvY - r);
  ctx.lineTo(fpvX, fpvY - r - 10 * scale);
  ctx.stroke();

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   ILS NEEDLES
   ════════════════════════════════════════════════════════════ */
function _drawILS(ctx, cx, cy, scale) {
  const dotR  = 4  * scale;
  const dotSp = 30 * scale;

  ctx.save();
  ctx.globalAlpha = 0.85;

  /* LOC dots (horizontal row) — vertical needle shows left/right deviation */
  const locY = cy + 120 * scale;
  ctx.strokeStyle = C.dim;
  ctx.lineWidth   = 1.5 * scale;
  for (const d of [-2, -1, 1, 2]) {
    _circle(ctx, cx + d * dotSp, locY, dotR);
  }

  /* LOC needle */
  ctx.fillStyle = C.green;
  _disc(ctx, cx + S.ilsLoc * dotSp, locY, 6 * scale);

  /* GS dots (vertical column) — horizontal needle shows up/down deviation */
  const gsX = cx + 150 * scale;
  for (const d of [-2, -1, 1, 2]) {
    _circle(ctx, gsX, cy + d * dotSp, dotR);
  }

  /* GS needle */
  _disc(ctx, gsX, cy - S.ilsGs * dotSp, 6 * scale);

  ctx.restore();

  /* ── ILS scratchpad (bottom-left, Airbus magenta): what's "tuned" for the approach.
     Display-only for now — freq/course come from the mission; manual tuning is a TODO. ── */
  const _ils = S.mission?.arrival?.ils;
  if (_ils) {
    const lines = [{ t: `ILS ${S.mission?.arrival?.runway ?? ''}`.trim(), bold: true }];
    if (_ils.ident)         lines.push({ t: String(_ils.ident) });
    if (_ils.freq != null)  lines.push({ t: String(_ils.freq) });
    if (_ils.course != null) lines.push({ t: `CRS ${String(_ils.course).padStart(3, '0')}` });
    const x0 = cx - 168 * scale; let y = locY + 34 * scale; const lh = 19 * scale;
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#d96ec8';
    for (const ln of lines) {
      ctx.font = `${ln.bold ? '700 ' : ''}${15 * scale}px ui-monospace, monospace`;
      ctx.fillText(ln.t, x0, y); y += lh;
    }
    ctx.restore();
  }
}

function _circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
function _disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ════════════════════════════════════════════════════════════
   SPEED TAPE
   ════════════════════════════════════════════════════════════ */
function _drawSpeedTape(ctx, W, H, scale) {
  const tapeW = 72 * scale;
  const tapeH = 260 * scale;
  const x     = W * 0.18;
  const cy    = H / 2;

  /* Background */
  ctx.fillStyle = C.tape;
  ctx.fillRect(x, cy - tapeH / 2, tapeW, tapeH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, cy - tapeH / 2, tapeW, tapeH);
  ctx.clip();

  const spd = S.spd;
  ctx.fillStyle = C.white;
  ctx.font = `${13 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'right';

  for (let v = Math.floor(spd / 10) * 10 - 50; v <= spd + 50; v += 10) {
    if (v < 0) continue;
    const y = cy + (spd - v) * 4.8 * scale;
    ctx.fillText(v, x + tapeW - 6 * scale, y + 4 * scale);
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(x + tapeW - 16 * scale, y);
    ctx.lineTo(x + tapeW, y);
    ctx.stroke();
  }
  ctx.restore();

  /* Bug */
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.moveTo(x + tapeW, cy);
  ctx.lineTo(x + tapeW + 8 * scale, cy - 8 * scale);
  ctx.lineTo(x + tapeW + 8 * scale, cy + 8 * scale);
  ctx.closePath();
  ctx.fill();

  /* Label */
  ctx.fillStyle = C.amber;
  ctx.font = `bold ${16 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(spd), x + tapeW + 42 * scale, cy + 6 * scale);

  /* Target speed bug — managed approach/descent flies the speed schedule (VAPP near the
     ground), so the cyan bug tracks managedSpeed(); selected speed otherwise. */
  const _mgT = (S.spdManaged && S.athr) ? managedSpeed() : null;
  const _tgt = (_mgT != null) ? _mgT : (S.spdT ?? spd);
  const tgtY = cy + (spd - _tgt) * 4.8 * scale;
  ctx.fillStyle = C.cyan;
  ctx.fillRect(x + tapeW - 4 * scale, tgtY - 1.5 * scale, tapeW * 0.4, 3 * scale);
}

/* ════════════════════════════════════════════════════════════
   ALTITUDE TAPE
   ════════════════════════════════════════════════════════════ */
function _drawAltTape(ctx, W, H, scale) {
  const tapeW = 80 * scale;
  const tapeH = 260 * scale;
  const x     = W * 0.74;
  const cy    = H / 2;

  ctx.fillStyle = C.tape;
  ctx.fillRect(x, cy - tapeH / 2, tapeW, tapeH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, cy - tapeH / 2, tapeW, tapeH);
  ctx.clip();

  const alt = S.alt;
  ctx.fillStyle = C.white;
  ctx.font = `${13 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'left';

  for (let v = Math.floor(alt / 100) * 100 - 600; v <= alt + 600; v += 100) {
    if (v < 0) continue;
    const y = cy + (alt - v) * 0.43 * scale;
    ctx.fillText(v, x + 8 * scale, y + 4 * scale);
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 14 * scale, y);
    ctx.stroke();
  }
  ctx.restore();

  /* Bug */
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.moveTo(x, cy);
  ctx.lineTo(x - 8 * scale, cy - 8 * scale);
  ctx.lineTo(x - 8 * scale, cy + 8 * scale);
  ctx.closePath();
  ctx.fill();

  /* Readout */
  ctx.fillStyle = C.amber;
  ctx.font = `bold ${16 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(Math.round(alt), x - 70 * scale, cy + 6 * scale);

  /* Target alt */
  const tgtY = cy + (alt - S.altT) * 0.43 * scale;
  ctx.fillStyle = C.cyan;
  ctx.fillRect(x, tgtY - 1.5 * scale, tapeW * 0.25, 3 * scale);
}

/* ════════════════════════════════════════════════════════════
   HEADING TAPE
   ════════════════════════════════════════════════════════════ */
function _drawHeadingTape(ctx, W, H, scale) {
  const tapeH = 36 * scale;
  const tapeW = 280 * scale;
  const cx    = W / 2;
  const y     = H - 80 * scale;

  ctx.fillStyle = C.tape;
  ctx.fillRect(cx - tapeW / 2, y, tapeW, tapeH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - tapeW / 2, y, tapeW, tapeH);
  ctx.clip();

  const hdg = S.hdg;
  ctx.fillStyle = C.white;
  ctx.font = `${11 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'center';

  for (let h = -30; h <= 30; h += 5) {
    const v  = ((hdg + h + 360) % 360);
    const px = cx + h * 4.5 * scale;
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + 8 * scale);
    ctx.stroke();
    if (h % 10 === 0) {
      const label = v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : Math.round(v);
      ctx.fillText(label, px, y + 26 * scale);
    }
  }
  ctx.restore();

  /* Bug */
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx - 7 * scale, y - 8 * scale);
  ctx.lineTo(cx + 7 * scale, y - 8 * scale);
  ctx.closePath();
  ctx.fill();

  /* Readout */
  ctx.fillStyle = C.amber;
  ctx.font = `bold ${15 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', cx, y - 12 * scale);
}

/* ════════════════════════════════════════════════════════════
   VSI
   ════════════════════════════════════════════════════════════ */
function _drawVSI(ctx, W, H, scale) {
  const x  = W * 0.86;
  const cy = H / 2;
  const h  = 200 * scale;

  const vsCapped = Math.max(-4000, Math.min(4000, S.vs));
  const barH = (vsCapped / 4000) * (h / 2);

  ctx.fillStyle = C.tape;
  ctx.fillRect(x, cy - h / 2, 14 * scale, h);

  /* VS bar */
  ctx.fillStyle = vsCapped >= 0 ? C.green : C.amber;
  if (barH >= 0) ctx.fillRect(x, cy - barH, 14 * scale, barH);
  else           ctx.fillRect(x, cy, 14 * scale, -barH);

  /* Readout */
  if (Math.abs(S.vs) > 50) {
    const sign  = S.vs >= 0 ? '+' : '';
    ctx.fillStyle = S.vs >= 0 ? C.green : C.amber;
    ctx.font = `${11 * scale}px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(sign + Math.round(S.vs / 100) * 100, x + 18 * scale, cy - barH + 4 * scale);
  }
}

/* ════════════════════════════════════════════════════════════
   OVERLAY INFO — altitude window, speed mode, etc.
   ════════════════════════════════════════════════════════════ */
function _drawOverlayInfo(ctx, W, H, scale) {
  ctx.font = `${11 * scale}px ${FONT_MONO}`;
  ctx.textAlign = 'center';

  /* Paused indicator */
  if (S.paused) {
    ctx.fillStyle = 'rgba(255,180,0,0.9)';
    ctx.font = `bold ${18 * scale}px ${FONT_UI}`;
    ctx.fillText('PAUSED  [P] to resume', W / 2, H / 2 + 200 * scale);
  }

  /* A/P status */
  ctx.fillStyle  = S.ap ? C.green : C.amber;
  ctx.textAlign  = 'left';
  ctx.font       = `${11 * scale}px ${FONT_MONO}`;
  ctx.fillText(S.ap ? 'AP1' : 'AP OFF', 20 * scale, 20 * scale);

  /* Role badge */
  ctx.fillStyle = C.cyan;
  ctx.textAlign = 'right';
  ctx.fillText(S.role, W - 20 * scale, 20 * scale);
}
