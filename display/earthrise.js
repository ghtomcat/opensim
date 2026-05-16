/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/earthrise.js
   Earthrise view (view mode 4): Moon horizon below, Earth above.
   Camera looks in velocity direction; up = anti-nadir (away from Moon).
   ═══════════════════════════════════════════════════════════════ */

import { S }       from '../core/state.js';
import { moonECI } from '../core/rocket.js';

const MOON_R  = 1_737_400;   // m
const EARTH_R = 6_371_000;   // m

const VIEW_PITCH = -10 * Math.PI / 180;  // tilt down — shows more Moon surface
const HALF_FOV_V =  45 * Math.PI / 180;  // ±45° vertical FOV

let _cvs = null;
let _ctx = null;

function _ensureCanvas() {
  if (_cvs) return;
  _cvs = document.getElementById('earthrise-canvas');
  _ctx = _cvs?.getContext('2d');
}

function _lcg(s) { return ((s * 1664525 + 1013904223) & 0xffffffff) >>> 0; }

export function renderEarthrise() {
  _ensureCanvas();
  if (!_cvs || !_ctx || !S.orbitVec) return;

  const DPR = window.devicePixelRatio || 1;
  const W   = Math.round(window.innerWidth  * DPR);
  const H   = Math.round(window.innerHeight * DPR);
  if (_cvs.width !== W || _cvs.height !== H) { _cvs.width = W; _cvs.height = H; }

  const ctx      = _ctx;
  const HALF_FOV_H = HALF_FOV_V * (W / H);
  const mT       = S.time ?? 0;

  const { rx, ry, rz, vx, vy, vz } = S.orbitVec;
  const { mx, my } = moonECI(mT);

  /* Camera basis vectors */
  const vm = Math.sqrt(vx*vx + vy*vy + vz*vz);
  const fw = [vx/vm, vy/vm, vz/vm];

  const dmx = rx - mx, dmy = ry - my, dmz = rz;
  const moonDist = Math.sqrt(dmx*dmx + dmy*dmy + dmz*dmz);
  const up = [dmx/moonDist, dmy/moonDist, dmz/moonDist];

  const rt = [
    fw[1]*up[2] - fw[2]*up[1],
    fw[2]*up[0] - fw[0]*up[2],
    fw[0]*up[1] - fw[1]*up[0],
  ];

  function project(dx, dy, dz) {
    const dUp = dx*up[0] + dy*up[1] + dz*up[2];
    const dRt = dx*rt[0] + dy*rt[1] + dz*rt[2];
    const dFw = dx*fw[0] + dy*fw[1] + dz*fw[2];
    return {
      az:   Math.atan2(dRt, dFw),
      elev: Math.asin(Math.max(-1, Math.min(1, dUp))),
    };
  }

  function elevToY(elev) { return H/2 - ((elev - VIEW_PITCH) / HALF_FOV_V) * (H/2); }
  function azToX(az)     { return W/2 + (az / HALF_FOV_H) * (W/2); }

  /* Moon horizon elevation (Moon is directly below — nadir) */
  const moonHorizElev = Math.asin(Math.min(1, MOON_R / moonDist)) - Math.PI/2;
  const hY = elevToY(moonHorizElev);

  /* Earth direction and canvas position */
  const em  = Math.sqrt(rx*rx + ry*ry + rz*rz);
  const ep  = project(-rx/em, -ry/em, -rz/em);
  const eY  = elevToY(ep.elev);
  const eX  = azToX(ep.az);

  const earthAngR = Math.asin(Math.min(1, EARTH_R / em));
  const eR = Math.max(11*DPR, (earthAngR / HALF_FOV_V) * (H/2));

  /* ── 1. Space background ── */
  ctx.fillStyle = '#000406';
  ctx.fillRect(0, 0, W, H);

  /* ── 2. Stars (clipped to space region above horizon) ── */
  if (hY > 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, Math.min(H, hY)); ctx.clip();
    let rng = 0x4a6e2c;
    for (let i = 0; i < 300; i++) {
      rng = _lcg(rng); const sx = rng % W;
      rng = _lcg(rng); const sy = rng % Math.max(1, Math.ceil(Math.min(H, hY)));
      rng = _lcg(rng); const sz = 0.35 + (rng & 0xff) / 380;
      rng = _lcg(rng); const sa = 0.45 + (rng & 0x7f) / 300;
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, sa).toFixed(2)})`;
      ctx.fillRect(sx, sy, sz*DPR, sz*DPR);
    }
    ctx.restore();
  }

  /* ── 3. Moon surface below horizon ── */
  if (hY < H) {
    const yTop = Math.max(0, hY);
    const grad = ctx.createLinearGradient(0, yTop, 0, H);
    grad.addColorStop(0,    '#c0b8a8');
    grad.addColorStop(0.06, '#989080');
    grad.addColorStop(0.30, '#686050');
    grad.addColorStop(1,    '#28201a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, yTop, W, H - yTop);

    /* Faint crater suggestions */
    ctx.save();
    ctx.beginPath(); ctx.rect(0, yTop, W, H - yTop); ctx.clip();
    let crng = 0xca1ab1e;
    for (let i = 0; i < 16; i++) {
      crng = _lcg(crng); const cx2 = crng % W;
      crng = _lcg(crng); const cy2 = yTop + (crng % Math.max(1, Math.ceil(H - yTop)));
      crng = _lcg(crng); const cr  = (5 + crng % 60) * DPR;
      crng = _lcg(crng); const al  = 0.08 + (crng & 0x1f) / 180;
      ctx.beginPath(); ctx.arc(cx2, cy2, cr, 0, 2*Math.PI);
      ctx.strokeStyle = `rgba(185,175,160,${al.toFixed(2)})`;
      ctx.lineWidth = DPR; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx2, cy2, cr * 0.65, 0, 2*Math.PI);
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fill();
    }
    ctx.restore();
  }

  /* ── 4. Horizon glow ── */
  {
    const glowH = 44 * DPR;
    const glow  = ctx.createLinearGradient(0, hY - glowH*0.75, 0, hY + glowH*0.6);
    glow.addColorStop(0,    'rgba(200,188,158,0)');
    glow.addColorStop(0.45, 'rgba(215,202,172,0.18)');
    glow.addColorStop(0.65, 'rgba(242,228,204,0.42)');
    glow.addColorStop(0.80, 'rgba(228,215,190,0.30)');
    glow.addColorStop(1,    'rgba(180,168,145,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, hY - glowH*0.75, W, glowH*1.35);
    ctx.beginPath(); ctx.moveTo(0, hY); ctx.lineTo(W, hY);
    ctx.strokeStyle = 'rgba(238,228,212,0.72)';
    ctx.lineWidth   = 1.2 * DPR; ctx.stroke();
  }

  /* ── 5. Earth disc (clipped above horizon) ── */
  if (eY < hY + eR) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, hY); ctx.clip();

    /* Atmosphere glow */
    const aR    = eR * 1.55;
    const aGrad = ctx.createRadialGradient(eX, eY, eR*0.88, eX, eY, aR);
    aGrad.addColorStop(0,   'rgba(90,155,255,0.45)');
    aGrad.addColorStop(0.5, 'rgba(90,155,255,0.12)');
    aGrad.addColorStop(1,   'rgba(90,155,255,0)');
    ctx.beginPath(); ctx.arc(eX, eY, aR, 0, 2*Math.PI);
    ctx.fillStyle = aGrad; ctx.fill();

    /* Ocean disc */
    const oGrad = ctx.createRadialGradient(
      eX - eR*0.28, eY - eR*0.28, 0,
      eX, eY, eR
    );
    oGrad.addColorStop(0,    '#74bcff');
    oGrad.addColorStop(0.42, '#2878dc');
    oGrad.addColorStop(0.88, '#0c3a7c');
    oGrad.addColorStop(1,    '#020c22');
    ctx.beginPath(); ctx.arc(eX, eY, eR, 0, 2*Math.PI);
    ctx.fillStyle = oGrad; ctx.fill();

    /* Land masses clipped to disc */
    ctx.save();
    ctx.beginPath(); ctx.arc(eX, eY, eR, 0, 2*Math.PI); ctx.clip();
    const land = (bx, by, brw, brh, rot) => {
      ctx.beginPath();
      ctx.ellipse(eX + bx*eR, eY + by*eR, brw*eR, brh*eR, rot, 0, 2*Math.PI);
      ctx.fillStyle = 'rgba(52,118,52,0.72)'; ctx.fill();
    };
    land(-0.22, -0.12, 0.30, 0.35,  0.20);   /* N. America */
    land(-0.12,  0.32, 0.14, 0.30,  0.10);   /* S. America */
    land( 0.12,  0.05, 0.20, 0.42,  0.15);   /* Europe / Africa */
    land( 0.40, -0.20, 0.24, 0.28, -0.30);   /* Asia */
    /* Antarctica */
    ctx.beginPath();
    ctx.ellipse(eX, eY + eR*0.80, eR*0.50, eR*0.13, 0, 0, 2*Math.PI);
    ctx.fillStyle = 'rgba(222,236,255,0.75)'; ctx.fill();
    /* Cloud bands */
    const cloud = (bx, by, brw, brh) => {
      ctx.beginPath();
      ctx.ellipse(eX + bx*eR, eY + by*eR, brw*eR, brh*eR, 0, 0, 2*Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.36)'; ctx.fill();
    };
    cloud(-0.05, -0.45, 0.55, 0.12);
    cloud( 0.30,  0.22, 0.32, 0.10);
    cloud(-0.40,  0.15, 0.28, 0.09);
    ctx.restore();

    /* Atmospheric limb brightening */
    const lGrad = ctx.createRadialGradient(eX, eY, eR*0.82, eX, eY, eR*1.06);
    lGrad.addColorStop(0,   'rgba(120,188,255,0)');
    lGrad.addColorStop(0.6, 'rgba(120,188,255,0.24)');
    lGrad.addColorStop(1,   'rgba(120,188,255,0)');
    ctx.beginPath(); ctx.arc(eX, eY, eR*1.06, 0, 2*Math.PI);
    ctx.fillStyle = lGrad; ctx.fill();

    ctx.restore();
  }

  /* ── 6. Porthole vignette + frame ── */
  {
    const pR = Math.min(W, H) * 0.52;
    const pX = W / 2, pY = H / 2;

    /* Soft radial falloff inside porthole */
    const vGrad = ctx.createRadialGradient(pX, pY, pR*0.52, pX, pY, pR);
    vGrad.addColorStop(0,    'rgba(0,0,0,0)');
    vGrad.addColorStop(0.72, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1,    'rgba(0,0,0,0.92)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, W, H);

    /* Outer dark panel */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(pX, pY, pR, 0, 2*Math.PI, true);
    ctx.fillStyle = '#04050a';
    ctx.fill('evenodd');
    /* Metal rim */
    ctx.beginPath(); ctx.arc(pX, pY, pR, 0, 2*Math.PI);
    ctx.strokeStyle = 'rgba(65,68,75,0.95)';
    ctx.lineWidth   = 11 * DPR; ctx.stroke();
    /* Inner rim highlight */
    ctx.beginPath(); ctx.arc(pX, pY, pR - 5.5*DPR, 0, 2*Math.PI);
    ctx.strokeStyle = 'rgba(115,118,125,0.40)';
    ctx.lineWidth   = 2 * DPR; ctx.stroke();
    ctx.restore();
  }

  /* ── 7. HUD readouts ── */
  {
    const altMoon    = Math.round((moonDist - MOON_R) / 1000);
    const spdKms     = (vm / 1000).toFixed(2);
    const earthDeg   = (ep.elev * 180 / Math.PI).toFixed(1);
    const pR = Math.min(W, H) * 0.52;
    const hX = W/2 - pR + 18*DPR;
    const hY0 = H/2 - pR + 22*DPR;

    ctx.font      = `bold ${9*DPR}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(90,200,255,0.90)';
    ctx.fillText('EARTHRISE',             hX, hY0);
    ctx.font      = `${9*DPR}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(90,200,255,0.70)';
    ctx.fillText(`ALT  ${altMoon} km`,    hX, hY0 + 15*DPR);
    ctx.fillText(`SPD  ${spdKms} km/s`,   hX, hY0 + 29*DPR);
    ctx.fillStyle = 'rgba(90,200,255,0.45)';
    ctx.fillText(`EARTH ${earthDeg}°`,    hX, hY0 + 43*DPR);
  }
}
