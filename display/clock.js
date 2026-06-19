/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/clock.js
   Shared analog cockpit clock. Used by the warbird panel renderers
   (F4U, Bf 109) as a top-left instrument, and previously the only
   home of the time-of-day overlay in terrain.js.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

/* Wall-clock time of day in hours [0,24), from mission TOD + elapsed sim time. */
export function clockHours() {
  const msnTOD = S.mission?.timeOfDay ?? 12;
  const todH   = msnTOD < 1 ? msnTOD * 24 : msnTOD;   // rocket missions store 0-1; GA uses 0-24
  const simH   = (S.time ?? 0) / 3600;
  return ((todH + simH) % 24 + 24) % 24;
}

/* Analog clock face centred at (cx,cy), radius R (device pixels).
   Line weights scale off R so it reads at any size. */
export function drawAnalogClock(ctx, cx, cy, R) {
  const u = R / 18;                     // unit — terrain overlay was R=18·DPR, lw≈1..2.5·DPR
  const t = clockHours();
  const _h = t % 12, _m = (t * 60) % 60, _s = (t * 3600) % 60;
  const hAng = (_h / 12) * Math.PI * 2 - Math.PI / 2;
  const mAng = (_m / 60) * Math.PI * 2 - Math.PI / 2;
  const sAng = (_s / 60) * Math.PI * 2 - Math.PI / 2;

  ctx.save();

  /* Face */
  ctx.fillStyle = 'rgba(18,18,22,0.92)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

  /* Bezel */
  ctx.strokeStyle = 'rgba(160,155,140,0.8)';
  ctx.lineWidth   = 1.5 * u;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

  /* Tick marks */
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const major = i % 3 === 0;
    ctx.strokeStyle = major ? 'rgba(220,215,200,0.9)' : 'rgba(150,145,130,0.7)';
    ctx.lineWidth   = (major ? 1.5 : 1.0) * u;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * (major ? 0.72 : 0.82), cy + Math.sin(a) * R * (major ? 0.72 : 0.82));
    ctx.lineTo(cx + Math.cos(a) * (R - 1.5 * u),             cy + Math.sin(a) * (R - 1.5 * u));
    ctx.stroke();
  }

  /* Hour hand */
  ctx.strokeStyle = 'rgba(235,228,210,0.95)';
  ctx.lineWidth   = 2.5 * u;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(hAng) * R * 0.12, cy - Math.sin(hAng) * R * 0.12);
  ctx.lineTo(cx + Math.cos(hAng) * R * 0.55, cy + Math.sin(hAng) * R * 0.55);
  ctx.stroke();

  /* Minute hand */
  ctx.lineWidth = 1.8 * u;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(mAng) * R * 0.12, cy - Math.sin(mAng) * R * 0.12);
  ctx.lineTo(cx + Math.cos(mAng) * R * 0.78, cy + Math.sin(mAng) * R * 0.78);
  ctx.stroke();

  /* Second hand */
  ctx.strokeStyle = 'rgba(220,60,40,0.9)';
  ctx.lineWidth   = 1.0 * u;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(sAng) * R * 0.25, cy - Math.sin(sAng) * R * 0.25);
  ctx.lineTo(cx + Math.cos(sAng) * R * 0.88, cy + Math.sin(sAng) * R * 0.88);
  ctx.stroke();

  /* Centre dot */
  ctx.fillStyle = 'rgba(220,60,40,0.9)';
  ctx.beginPath(); ctx.arc(cx, cy, 2 * u, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}
