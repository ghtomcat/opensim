/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view: simple sky/ground canvas split.
   Horizon position driven by pitch; tilt driven by roll.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

let _canvas = null;

export function initOutside() {
  _canvas = document.getElementById('outside-canvas');
}

export function outsideInvalidate() { /* no-op for canvas renderer */ }

export function tickOutside() {
  if (!_canvas || !_canvas.offsetWidth || !_canvas.offsetHeight) return;

  const W = _canvas.width  = _canvas.offsetWidth  * devicePixelRatio;
  const H = _canvas.height = _canvas.offsetHeight * devicePixelRatio;
  const ctx = _canvas.getContext('2d');

  const pitch = S.pitch ?? 0;
  const roll  = S.roll  ?? 0;
  const alt   = S.alt   ?? 1000;

  /* Vertical FOV: 50°. Each pitch degree shifts horizon by H/50 px. */
  const horizonY = H / 2 - pitch * (H / 50);

  /* Sky colour: bright at low alt, deep blue at altitude */
  const t      = Math.min(1, alt / 35000);
  const skyTop = _rgb(_lerp([100, 180, 230], [8,  18,  38],  t));
  const skyBot = _rgb(_lerp([165, 210, 245], [32, 90,  145], t));

  /* Pad so rotated rect covers canvas corners */
  const pad = H;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-roll * Math.PI / 180);
  ctx.translate(-W / 2, -H / 2);

  /* Sky */
  const sg = ctx.createLinearGradient(0, horizonY - pad, 0, horizonY);
  sg.addColorStop(0, skyTop);
  sg.addColorStop(1, skyBot);
  ctx.fillStyle = sg;
  ctx.fillRect(-pad, -pad, W + pad * 2, horizonY + pad);

  /* Ground */
  const gg = ctx.createLinearGradient(0, horizonY, 0, horizonY + pad);
  gg.addColorStop(0, '#4a7a38');
  gg.addColorStop(1, '#2b5020');
  ctx.fillStyle = gg;
  ctx.fillRect(-pad, horizonY, W + pad * 2, H - horizonY + pad);

  /* Horizon line */
  ctx.strokeStyle = 'rgba(220,210,160,0.5)';
  ctx.lineWidth   = 1.5 * devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(-pad, horizonY);
  ctx.lineTo(W + pad, horizonY);
  ctx.stroke();

  ctx.restore();
}

function _lerp(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
function _rgb([r, g, b]) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
