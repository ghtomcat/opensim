/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/cislunar.js
   Earth-Moon navigation map. Top-down view of the cislunar space:
   Earth, Moon, past trail (amber), future projected path (dashed
   blue), spacecraft dot. Shown as view mode 3 for rockets.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { moonECI } from '../core/rocket.js';

const GM_EARTH   = 3.986004418e14;
const GM_MOON    = 4.9048695e12;
const MOON_SMA   = 384_400_000;
const MOON_R     = 1_737_000;    // Moon mean radius, m
const MOON_R_MIN = 1_747_000;    // Moon radius + 10 km — clamp display path at surface
const FUTURE_MAX_T    = 432_000; // 120 h total window
const FUTURE_MAX_PTS  = 600;     // cap to keep display fast

let _cvs = null;
let _ctx = null;
let _zoom = 1.0;
let _ox   = 0;     // canvas-pixel offset from Earth-centred origin
let _oy   = 0;
let _wheelAttached = false;

export function resetCislunar() { _zoom = 1.0; _ox = 0; _oy = 0; }

function _ensureCanvas() {
  if (_cvs) return;
  _cvs = document.getElementById('cislunar-canvas');
  _ctx = _cvs?.getContext('2d');
}

function _attachWheel() {
  if (_wheelAttached || !_cvs) return;
  _wheelAttached = true;
  _cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.90 : 1 / 0.90;
    _zoom = Math.max(0.04, _zoom * f);
  }, { passive: false });
}

/* ── Seeded LCG for deterministic star field ── */
function _lcg(s) { return ((s * 1664525 + 1013904223) & 0xffffffff) >>> 0; }

/* ── Next upcoming mission event ── */
function _nextEvent() {
  const mT = S.time ?? 0;
  const events = [...(S.mission?.events ?? [])];
  const loiT = S.mission?.loiT;
  if (loiT && !S.rocketLOI) events.push({ t: loiT, label: 'LOI' });
  const teiT = S.mission?.teiT;
  if (teiT && !S.rocketTEI) events.push({ t: teiT, label: 'TEI' });
  return events.filter(e => e.t > mT).sort((a, b) => a.t - b.t)[0] ?? null;
}

/* ── Project ECI XY to canvas coords ── */
function _px(rx, ry, cx, cy, scale) {
  return { px: cx + rx * scale + _ox, py: cy - ry * scale + _oy };
}

/* ── Propagate future path using Velocity Verlet (Earth + Moon) ── */
/* Adaptive step: 120 s near Moon (<50 000 km), 3600 s otherwise.   */
function _propagate(v, mT) {
  let { rx, ry, rz, vx, vy, vz } = v;
  const pts = [{ rx, ry }];
  let t = mT;
  let elapsed = 0;

  while (elapsed < FUTURE_MAX_T && pts.length < FUTURE_MAX_PTS) {
    const { mx, my } = moonECI(t);
    const moonR = Math.sqrt((rx - mx) ** 2 + (ry - my) ** 2 + rz*rz);
    const DT = moonR < 10_000_000 ? 30 : moonR < 50_000_000 ? 120 : 3_600;
    const step = Math.min(DT, FUTURE_MAX_T - elapsed);

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

    const dt2 = step * step;
    const nrx = rx + vx * step + 0.5 * ax * dt2;
    const nry = ry + vy * step + 0.5 * ay * dt2;
    const nrz = rz + vz * step + 0.5 * az * dt2;

    t += step;
    const { mx: nmx, my: nmy } = moonECI(t);
    const nr2  = nrx*nrx + nry*nry + nrz*nrz;
    const nr3  = nr2 * Math.sqrt(nr2);
    const nke  = -GM_EARTH / nr3;
    const ndmx = nrx - nmx, ndmy = nry - nmy;
    const nmr2 = ndmx*ndmx + ndmy*ndmy + nrz*nrz;
    if (nmr2 < MOON_R_MIN * MOON_R_MIN) break;  // hit Moon surface — stop before point-mass blowup
    const nmr3 = nmr2 * Math.sqrt(nmr2);
    const nkm  = -GM_MOON  / nmr3;
    const nax  = nke * nrx + nkm * ndmx;
    const nay  = nke * nry + nkm * ndmy;
    const naz  = nke * nrz + nkm * nrz;

    vx += 0.5 * (ax + nax) * step;
    vy += 0.5 * (ay + nay) * step;
    vz += 0.5 * (az + naz) * step;
    rx = nrx; ry = nry; rz = nrz;

    elapsed += step;
    pts.push({ rx, ry });
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

  _attachWheel();

  const ctx = _ctx;
  const cx  = W / 2;
  const cy  = H / 2;
  const mT  = S.time ?? 0;

  const scale = (Math.min(W, H) * 0.40) / MOON_SMA * _zoom;

  /* Pin spacecraft to canvas centre when in orbit — _ox/_oy shift Earth/Moon.
     _px(rx, ry) = cx + rx*scale + _ox, cy - ry*scale + _oy
     Spacecraft at (scRx, scRy) → canvas (cx, cy)  iff  _ox = -scRx*scale, _oy = +scRy*scale */
  if (S.orbitVec) {
    _ox = -S.orbitVec.rx * scale;
    _oy =  S.orbitVec.ry * scale;
  } else {
    _ox = 0;
    _oy = 0;
  }

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

  /* Earth — at ECI origin, offset by _ox/_oy */
  const ex     = cx + _ox;
  const ey     = cy + _oy;
  const earthR = Math.max(5 * DPR, 9 * DPR);
  {
    const g = ctx.createRadialGradient(ex - earthR*0.35, ey - earthR*0.35, 0, ex, ey, earthR);
    g.addColorStop(0, '#7bcfff');
    g.addColorStop(0.5, '#2d7abf');
    g.addColorStop(1, '#0d3b66');
    ctx.beginPath();
    ctx.arc(ex, ey, earthR, 0, 2 * Math.PI);
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

  /* Moon SOI — 66 000 km sphere of influence (matches LOI proximity trigger) */
  const soiR = 66_000_000 * scale;
  if (soiR > 4 * DPR) {
    ctx.beginPath();
    ctx.setLineDash([3 * DPR, 5 * DPR]);
    ctx.arc(mp.px, mp.py, soiR, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.20)';
    ctx.lineWidth   = DPR;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Moon orbit ring — faint guide circle, centred on Earth */
  ctx.beginPath();
  ctx.arc(ex, ey, MOON_SMA * scale, 0, 2 * Math.PI);
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
  ctx.fillText('EARTH', ex + earthR + 4 * DPR, ey + 4 * DPR);
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

  /* Next event countdown — top right */
  const ev = _nextEvent();
  if (ev) {
    const dt  = Math.max(0, ev.t - mT);
    const hh  = Math.floor(dt / 3600);
    const mm  = Math.floor((dt % 3600) / 60);
    const ss  = Math.floor(dt % 60);
    const pad = (n) => String(n).padStart(2, '0');
    const countdown = `T-${pad(hh)}:${pad(mm)}:${pad(ss)}`;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#8ef';
    ctx.font      = `bold ${10 * DPR}px "IBM Plex Mono", monospace`;
    ctx.fillText(ev.label,   W - 12 * DPR, 18 * DPR);
    ctx.font      = `${9 * DPR}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = '#5bd';
    ctx.fillText(countdown,  W - 12 * DPR, 30 * DPR);
    ctx.textAlign = 'left';
  }

}

/* ═══════════════════════════════════════════════════════════════
   renderMoonMap — Moon-centred view for LM instrument panel (view 3).
   Auto-scales: Moon fills 28% of screen in orbit; zooms out to keep
   spacecraft visible during approach / free-return flyby.
   ═══════════════════════════════════════════════════════════════ */
export function renderMoonMap() {
  _ensureCanvas();
  if (!_cvs || !_ctx || !S.orbitVec) return;

  const DPR = window.devicePixelRatio || 1;
  const W   = Math.round(window.innerWidth  * DPR);
  const H   = Math.round(window.innerHeight * DPR);
  if (_cvs.width !== W || _cvs.height !== H) { _cvs.width = W; _cvs.height = H; }

  const ctx = _ctx;
  const mT  = S.time ?? 0;
  const { rx: srx, ry: sry, vx, vy, vz } = S.orbitVec;
  const { mx, my } = moonECI(mT);
  const moonDist = Math.sqrt((srx - mx) ** 2 + (sry - my) ** 2);

  /* Auto-zoom: keep both Moon and spacecraft on-screen */
  const cx = W / 2, cy = H / 2;
  const orbitScale = Math.min(W, H) * 0.28 / MOON_R;  // px/m  — orbit view
  const fitScale   = Math.min(W, H) * 0.42 / Math.max(moonDist, MOON_R * 1.5);
  const scale = Math.min(orbitScale, fitScale);
  const moonPxR = MOON_R * scale;

  function mpx(rx, ry) {
    return { px: cx + (rx - mx) * scale, py: cy - (ry - my) * scale };
  }

  /* Background */
  ctx.fillStyle = '#02040a';
  ctx.fillRect(0, 0, W, H);

  /* Stars */
  let rng = 0x3c2a4f;
  for (let i = 0; i < 160; i++) {
    rng = _lcg(rng); const sx = rng % W;
    rng = _lcg(rng); const sy = rng % H;
    rng = _lcg(rng);
    const alpha = 0.35 + (rng & 0x7f) / 400;
    const sz = (0.3 + (rng & 3) * 0.15) * DPR;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    ctx.fillRect(sx, sy, sz, sz);
  }

  /* Moon disk — lit from upper-left */
  {
    const ldx = -0.52, ldy = -0.42;
    const g = ctx.createRadialGradient(
      cx + ldx * moonPxR * 0.55, cy + ldy * moonPxR * 0.55, moonPxR * 0.04,
      cx, cy, moonPxR
    );
    g.addColorStop(0,    '#dfdad0');
    g.addColorStop(0.38, '#b2aea4');
    g.addColorStop(0.72, '#78746e');
    g.addColorStop(1,    '#1c1a18');
    ctx.beginPath();
    ctx.arc(cx, cy, moonPxR, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
  }

  /* Craters — visible when Moon is large enough */
  if (moonPxR > 38 * DPR) {
    const CRATERS = [
      [ 0.55, -0.32, 0.085], [ 0.22,  0.58, 0.062], [-0.42,  0.18, 0.092],
      [-0.18, -0.60, 0.055], [ 0.68,  0.40, 0.072], [-0.60, -0.22, 0.088],
      [ 0.08,  0.14, 0.040], [-0.28,  0.62, 0.058], [ 0.48, -0.52, 0.044],
      [-0.50,  0.46, 0.050], [ 0.18, -0.28, 0.032], [-0.08,  0.36, 0.036],
      [ 0.32,  0.22, 0.028], [-0.35, -0.42, 0.044],
    ];
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, moonPxR * 0.985, 0, Math.PI * 2); ctx.clip();
    for (const [nx, ny, nr] of CRATERS) {
      const cpx = cx + nx * moonPxR, cpy = cy + ny * moonPxR, cr = nr * moonPxR;
      ctx.beginPath(); ctx.arc(cpx, cpy, cr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(185,180,172,0.26)'; ctx.lineWidth = cr * 0.13; ctx.stroke();
      const ig = ctx.createRadialGradient(cpx, cpy, 0, cpx, cpy, cr * 0.88);
      ig.addColorStop(0, 'rgba(28,26,22,0.30)'); ig.addColorStop(1, 'rgba(28,26,22,0)');
      ctx.beginPath(); ctx.arc(cpx, cpy, cr * 0.88, 0, Math.PI * 2);
      ctx.fillStyle = ig; ctx.fill();
    }
    ctx.restore();
  }

  /* Moon limb */
  ctx.beginPath();
  ctx.arc(cx, cy, moonPxR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180,175,165,0.48)'; ctx.lineWidth = 1.2 * DPR; ctx.stroke();

  /* MOON label */
  ctx.font = `${9 * DPR}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = 'rgba(180,175,165,0.55)'; ctx.textAlign = 'left';
  ctx.fillText('MOON', cx + moonPxR + 5 * DPR, cy + 4 * DPR);

  /* Past trail (Moon-centred; subtract current Moon position — sufficient for short stays) */
  const trail = S.cislunarTrail ?? [];
  if (trail.length > 1) {
    ctx.save();
    ctx.beginPath();
    const t0 = mpx(trail[0].rx, trail[0].ry);
    ctx.moveTo(t0.px, t0.py);
    for (let i = 1; i < trail.length; i++) {
      const tp = mpx(trail[i].rx, trail[i].ry);
      ctx.lineTo(tp.px, tp.py);
    }
    ctx.strokeStyle = 'rgba(255,175,55,0.65)';
    ctx.lineWidth = 1.8 * DPR; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }

  /* Future path */
  const future = _propagate(S.orbitVec, mT);
  if (future.length > 1) {
    ctx.save();
    ctx.setLineDash([3 * DPR, 4 * DPR]);
    ctx.beginPath();
    const f0 = mpx(future[0].rx, future[0].ry);
    ctx.moveTo(f0.px, f0.py);
    for (let i = 1; i < future.length; i++) {
      const fp = mpx(future[i].rx, future[i].ry);
      ctx.lineTo(fp.px, fp.py);
    }
    ctx.strokeStyle = 'rgba(95,200,255,0.65)'; ctx.lineWidth = 1.8 * DPR; ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* Periapsis / pericynthion marker — lowest altitude on future path */
  let periPt = null, periAlt = null;
  {
    let minD = Infinity;
    for (const fp of future) {
      const d = Math.sqrt((fp.rx - mx) ** 2 + (fp.ry - my) ** 2);
      if (d < minD) { minD = d; periPt = mpx(fp.rx, fp.ry); periAlt = Math.round((d - MOON_R) / 1000); }
    }
  }
  if (periPt && periAlt !== null && periAlt >= 0) {
    ctx.save();
    ctx.beginPath(); ctx.arc(periPt.px, periPt.py, 4 * DPR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(95,220,255,0.90)'; ctx.fill();
    ctx.font = `${9 * DPR}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(95,220,255,0.78)'; ctx.textAlign = 'left';
    ctx.fillText(`PCA  ${periAlt} km`, periPt.px + 7 * DPR, periPt.py + 4 * DPR);
    ctx.restore();
  }

  /* Spacecraft dot + velocity tick */
  const sp  = mpx(srx, sry);
  const spd = Math.sqrt(vx*vx + vy*vy + (vz ?? 0)**2);
  const vm  = Math.sqrt(vx*vx + vy*vy);
  ctx.beginPath(); ctx.arc(sp.px, sp.py, 5 * DPR, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  if (vm > 0) {
    const tl = 18 * DPR;
    ctx.beginPath(); ctx.moveTo(sp.px, sp.py);
    ctx.lineTo(sp.px + (vx/vm) * tl, sp.py - (vy/vm) * tl);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.5 * DPR; ctx.stroke();
  }

  /* Readouts — top left */
  const alt_km   = Math.max(0, Math.round((moonDist - MOON_R) / 1000));
  const spd_kms  = (spd / 1000).toFixed(2);
  /* Orbital period from vis-viva, Moon-relative (approximate: Moon moves slowly) */
  const orbE     = spd*spd/2 - GM_MOON / moonDist;
  const period_min = orbE < 0
    ? Math.round(2 * Math.PI * Math.sqrt((-GM_MOON / (2 * orbE)) ** 3 / GM_MOON) / 60)
    : null;

  ctx.textAlign = 'left'; ctx.fillStyle = '#7ec8e8';
  ctx.font = `${10 * DPR}px "IBM Plex Mono", monospace`;
  ctx.fillText(`ALT  ${alt_km.toLocaleString()} km`, 12 * DPR, 20 * DPR);
  ctx.fillText(`SPD  ${spd_kms} km/s`,               12 * DPR, 35 * DPR);
  if (period_min !== null) {
    ctx.fillText(`PRD  ${period_min} min`,            12 * DPR, 50 * DPR);
  }

  /* Callsign + GET — top right */
  const callsign = (S.mission?.id === 'apollo13' ? 'AQUARIUS'
                  : (S.aircraft?.callsign ?? 'LM')).toUpperCase();
  const ignT = S.aircraft?.ignitionTime ?? 0;
  const absT = Math.abs(mT - ignT);
  const hh = Math.floor(absT/3600), mm = Math.floor((absT%3600)/60), ss = Math.floor(absT%60);
  const met = `T+ ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#b0d890';
  ctx.font = `bold ${11 * DPR}px "IBM Plex Mono", monospace`;
  ctx.fillText(callsign, W - 12 * DPR, 20 * DPR);
  ctx.fillStyle = '#5dd47e';
  ctx.font = `${9 * DPR}px "IBM Plex Mono", monospace`;
  ctx.fillText(met, W - 12 * DPR, 34 * DPR);

  /* Next event countdown — top right */
  const ev = _nextEvent();
  if (ev) {
    const dt = Math.max(0, ev.t - mT);
    const eh = Math.floor(dt/3600), em = Math.floor((dt%3600)/60), es = Math.floor(dt%60);
    const pad = n => String(n).padStart(2, '0');
    ctx.fillStyle = '#8ef';
    ctx.font = `bold ${10 * DPR}px "IBM Plex Mono", monospace`;
    ctx.fillText(ev.label, W - 12 * DPR, 52 * DPR);
    ctx.fillStyle = '#5bd';
    ctx.font = `${9 * DPR}px "IBM Plex Mono", monospace`;
    ctx.fillText(`T-${pad(eh)}:${pad(em)}:${pad(es)}`, W - 12 * DPR, 64 * DPR);
  }

  /* MOON MAP label — bottom left */
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(100,120,140,0.48)';
  ctx.font = `${8 * DPR}px "IBM Plex Mono", monospace`;
  ctx.fillText('MOON  MAP', 12 * DPR, H - 12 * DPR);

  /* Scale bar — bottom right (200 km fixed) */
  const barKm = 200, barPx = barKm * 1000 * scale;
  if (barPx > 15 * DPR && barPx < W * 0.35) {
    const bx = W - 12 * DPR - barPx, by = H - 14 * DPR;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by);
    ctx.strokeStyle = 'rgba(130,155,175,0.52)'; ctx.lineWidth = 1.5 * DPR; ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(130,155,175,0.52)';
    ctx.fillText(`${barKm} km`, W - 12 * DPR, H - 20 * DPR);
  }
}
