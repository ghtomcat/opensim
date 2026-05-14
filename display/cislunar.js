/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/cislunar.js
   Earth-Moon navigation map. Top-down view of the cislunar space:
   Earth, Moon, past trail (amber), future projected path (dashed
   blue), spacecraft dot. Shown as view mode 3 for rockets.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { moonECI } from '../core/rocket.js';

const GM_EARTH = 3.986004418e14;
const GM_MOON  = 4.9048695e12;
const MOON_SMA = 384_400_000;
const FUTURE_STEPS    = 120;    // steps ahead
const FUTURE_DT       = 3_600;  // seconds per step → 120 h

let _cvs = null;
let _ctx = null;

function _ensureCanvas() {
  if (_cvs) return;
  _cvs = document.getElementById('cislunar-canvas');
  _ctx = _cvs?.getContext('2d');
}

/* ── Seeded LCG for deterministic star field ── */
function _lcg(s) { return ((s * 1664525 + 1013904223) & 0xffffffff) >>> 0; }

/* ── Project ECEF XY to canvas coords ── */
function _px(rx, ry, cx, cy, scale) {
  return { px: cx + rx * scale, py: cy - ry * scale };
}

/* ── Propagate future path using Velocity Verlet (Earth + Moon) ── */
function _propagate(v, mT) {
  let { rx, ry, rz, vx, vy, vz } = v;
  const pts = [{ rx, ry }];
  let t = mT;

  for (let i = 0; i < FUTURE_STEPS; i++) {
    const { mx, my } = moonECI(t);

    /* Accelerations at current position */
    const r2  = rx*rx + ry*ry + rz*rz;
    const r3  = r2 * Math.sqrt(r2);
    const ke  = -GM_EARTH / r3;
    const dmx = rx - mx, dmy = ry - my;
    const mr2 = dmx*dmx + dmy*dmy + rz*rz;
    const mr3 = mr2 * Math.sqrt(mr2);
    const km  = -GM_MOON  / mr3;
    const ax  = ke * rx + km * dmx;
    const ay  = ke * ry + km * dmy;
    const az  = ke * rz + km * rz;

    const dt2 = FUTURE_DT * FUTURE_DT;
    const nrx = rx + vx * FUTURE_DT + 0.5 * ax * dt2;
    const nry = ry + vy * FUTURE_DT + 0.5 * ay * dt2;
    const nrz = rz + vz * FUTURE_DT + 0.5 * az * dt2;

    t += FUTURE_DT;
    const { mx: nmx, my: nmy } = moonECI(t);
    const nr2  = nrx*nrx + nry*nry + nrz*nrz;
    const nr3  = nr2 * Math.sqrt(nr2);
    const nke  = -GM_EARTH / nr3;
    const ndmx = nrx - nmx, ndmy = nry - nmy;
    const nmr2 = ndmx*ndmx + ndmy*ndmy + nrz*nrz;
    const nmr3 = nmr2 * Math.sqrt(nmr2);
    const nkm  = -GM_MOON  / nmr3;
    const nax  = nke * nrx + nkm * ndmx;
    const nay  = nke * nry + nkm * ndmy;
    const naz  = nke * nrz + nkm * nrz;

    vx += 0.5 * (ax + nax) * FUTURE_DT;
    vy += 0.5 * (ay + nay) * FUTURE_DT;
    vz += 0.5 * (az + naz) * FUTURE_DT;
    rx = nrx; ry = nry; rz = nrz;

    pts.push({ rx, ry });
    /* Stop propagating if we've re-entered Earth's atmosphere */
    if (Math.sqrt(rx*rx + ry*ry + rz*rz) < 6_371_000) break;
  }
  return pts;
}

export function renderCislunar() {
  _ensureCanvas();
  if (!_cvs || !_ctx) return;

  const DPR = window.devicePixelRatio || 1;
  const W   = Math.round(window.innerWidth  * DPR);
  const H   = Math.round(window.innerHeight * DPR);
  if (_cvs.width !== W || _cvs.height !== H) { _cvs.width = W; _cvs.height = H; }

  const ctx = _ctx;
  const cx  = W / 2;
  const cy  = H / 2;
  const mT  = S.time ?? 0;

  /* Scale: show ±1.2 × MOON_SMA — Moon fits with comfortable margin */
  const scale = (Math.min(W, H) * 0.40) / MOON_SMA;

  /* Background */
  ctx.fillStyle = '#030810';
  ctx.fillRect(0, 0, W, H);

  /* Stars */
  let rng = 0x4a6e2c;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 240; i++) {
    rng = _lcg(rng); const sx = rng % W;
    rng = _lcg(rng); const sy = rng % H;
    rng = _lcg(rng); const sz = 0.4 + (rng & 0xff) / 420;
    ctx.fillRect(sx, sy, sz * DPR, sz * DPR);
  }

  /* Earth */
  const earthR = Math.max(5 * DPR, 9 * DPR);
  {
    const g = ctx.createRadialGradient(cx - earthR*0.35, cy - earthR*0.35, 0, cx, cy, earthR);
    g.addColorStop(0, '#7bcfff');
    g.addColorStop(0.5, '#2d7abf');
    g.addColorStop(1, '#0d3b66');
    ctx.beginPath();
    ctx.arc(cx, cy, earthR, 0, 2 * Math.PI);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* Moon */
  const { mx, my } = moonECI(mT);
  const mp = _px(mx, my, cx, cy, scale);
  const moonR = Math.max(3 * DPR, 5 * DPR);
  {
    const g = ctx.createRadialGradient(mp.px - moonR*0.35, mp.py - moonR*0.35, 0, mp.px, mp.py, moonR);
    g.addColorStop(0, '#e8e8e8');
    g.addColorStop(1, '#666');
    ctx.beginPath();
    ctx.arc(mp.px, mp.py, moonR, 0, 2 * Math.PI);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* Moon orbit ring — faint guide circle */
  ctx.beginPath();
  ctx.arc(cx, cy, MOON_SMA * scale, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = DPR;
  ctx.stroke();

  /* Past trail */
  const trail = S.cislunarTrail ?? [];
  if (trail.length > 1) {
    ctx.beginPath();
    const t0 = _px(trail[0].rx, trail[0].ry, cx, cy, scale);
    ctx.moveTo(t0.px, t0.py);
    for (let i = 1; i < trail.length; i++) {
      const tp = _px(trail[i].rx, trail[i].ry, cx, cy, scale);
      ctx.lineTo(tp.px, tp.py);
    }
    ctx.strokeStyle = 'rgba(255, 180, 60, 0.75)';
    ctx.lineWidth   = 1.5 * DPR;
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }

  /* Spacecraft position */
  if (!S.orbitVec) return;
  const { rx, ry } = S.orbitVec;
  const sc = _px(rx, ry, cx, cy, scale);

  /* Future path */
  const future = _propagate(S.orbitVec, mT);
  if (future.length > 1) {
    ctx.beginPath();
    ctx.setLineDash([4 * DPR, 4 * DPR]);
    const f0 = _px(future[0].rx, future[0].ry, cx, cy, scale);
    ctx.moveTo(f0.px, f0.py);
    for (let i = 1; i < future.length; i++) {
      const fp = _px(future[i].rx, future[i].ry, cx, cy, scale);
      ctx.lineTo(fp.px, fp.py);
    }
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.60)';
    ctx.lineWidth   = 1.5 * DPR;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Spacecraft dot */
  ctx.beginPath();
  ctx.arc(sc.px, sc.py, 4 * DPR, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  /* Heading tick */
  if (S.orbitVec) {
    const { vx, vy } = S.orbitVec;
    const vm = Math.sqrt(vx*vx + vy*vy);
    if (vm > 0) {
      const tickLen = 12 * DPR;
      ctx.beginPath();
      ctx.moveTo(sc.px, sc.py);
      ctx.lineTo(sc.px + (vx / vm) * tickLen, sc.py - (vy / vm) * tickLen);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth   = DPR;
      ctx.stroke();
    }
  }

  /* Labels */
  ctx.font      = `${10 * DPR}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#aac';
  ctx.fillText('EARTH', cx + earthR + 4 * DPR, cy + 4 * DPR);
  ctx.fillText('MOON',  mp.px + moonR + 4 * DPR, mp.py + 4 * DPR);

  /* Readouts — distance from Earth and Moon */
  const dEarth_km = Math.round(Math.sqrt(rx*rx + ry*ry) / 1000).toLocaleString();
  const dx = rx - mx, dy = ry - my;
  const dMoon_km  = Math.round(Math.sqrt(dx*dx + dy*dy) / 1000).toLocaleString();
  const spd_kms   = (Math.sqrt(S.orbitVec.vx**2 + S.orbitVec.vy**2 + S.orbitVec.vz**2) / 1000).toFixed(2);

  ctx.fillStyle = '#5bd';
  ctx.font      = `${9 * DPR}px "IBM Plex Mono", monospace`;
  ctx.fillText(`${dEarth_km} km  ↔ Earth`,  12 * DPR, 18 * DPR);
  ctx.fillText(`${dMoon_km}  km  ↔ Moon`,   12 * DPR, 30 * DPR);
  ctx.fillText(`${spd_kms}  km/s`,           12 * DPR, 42 * DPR);

  /* Phase label */
  const phase = S.rocketTEI ? 'TRANS-EARTH' : S.rocketLOI ? 'LUNAR ORBIT' : S.rocketTLI ? 'TRANS-LUNAR' : 'EARTH ORBIT';
  ctx.fillStyle = '#8ef';
  ctx.font      = `bold ${10 * DPR}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(phase, (W - 12 * DPR), 18 * DPR);
  ctx.textAlign = 'left';
}
