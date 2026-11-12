/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/velis_epsi.js
   Pipistrel Velis Electro HB-SYQ — full canvas cockpit.

   Three zones (left → right):
     NESIS 4   Digital AH — primary flight instruments
     EPSI 570  Energy management display
     BACKUP    Analog ASI + altimeter

   The switches — MASTER, AVIONICS, BATT EN, PWR EN — are on the centre console, as in HB-SYQ
   (Markus's photo, sources/velis-panel-notes.md): the pedestal view (D), display/pedestal.js.
   The radio is the COM panel on the pedestal (display/com.js), as on the other aircraft.
   (The layout itself is redone from the photo in the next piece of step 3.)

   All HTML overlays (#panel, #fma, #metar-strip, #com-container,
   #warning-lights) are hidden by index.html when this panel is active.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }               from '../core/state.js';
import { updateVelisMapOverlay, hideVelisMap } from './map.js';
import { flapLabel } from '../core/airframe.js';
import { operate } from './controls.js';

/* ── Palette ── */
const P = {
  panel:   '#1a1e24',
  rim:     '#2e3440',
  recess:  '#080c10',
  white:   '#e8edf2',
  dim:     'rgba(232,237,242,0.35)',
  cyan:    '#00c8e0',
  green:   '#5dd47e',
  amber:   '#ffb74d',
  red:     '#ff4444',
  ndl:     '#00c8e0',
  ndlBack: '#1a1e24',
  mark:    '#1c1c1c',
  markDim: '#888',
  shadow:  'rgba(0,0,0,0.7)',
};

const MONO = '"IBM Plex Mono","Courier New",monospace';
const SANS = '"Helvetica Neue",Helvetica,Arial,sans-serif';
const _r   = d => (d - 90) * Math.PI / 180;


/* The instruments (NESIS, EPSI) are on the avionics bus: MASTER connects the 14 V auxiliary
   battery to the main bus, AVIONICS the main bus to the avionics bus. BATT EN (the traction
   batteries) isn't needed: the start-up checklist reads the charge on the EPSI before it (POH 4-9,
   7-27). The same rule as the COM power in core/crew.js — a stand-in until the Velis is on the
   electrical solver (core/electrical.js) and they read its avionics bus. */
const _avionicsPowered = () => !!(S.switches?.master && S.switches?.avionics);

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderVelisEpsi(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();


  /* Panel background */
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, 0, W, H);

  /* Vignette */
  const vg = ctx.createRadialGradient(W/2, H/2, H*0.08, W/2, H/2, H*0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const sc = Math.min(W, H) / 700;

  /* Zone widths */
  const nhW  = W * 0.32;   // NESIS 4
  const epW  = W * 0.40;   // EPSI 570
  const bkW  = W * 0.28;   // backup gauges

  const nhX  = nhW / 2;
  const epX  = nhW + epW / 2;
  const bkX  = nhW + epW + bkW / 2;
  const cy   = H / 2;

  /* Instrument radii */
  const R  = Math.min(Math.min(nhW, H) * 0.40, H / 2 - _overlayBottom(canvas) - 8 * sc);   // clear of the mission clock and KEYS (top left)
  const Rs = Math.min(bkW * 0.44, H * 0.22);

  /* ── NESIS 4 ── */
  _drawNESIS(ctx, nhX, cy, R, sc);

  /* ── EPSI 570 ── */
  _drawEPSI(ctx, canvas, epX, cy, epW * 0.88, H * 0.92, sc);

  /* ── Backup gauges ── */
  _drawBackupASI(ctx, bkX, cy - Rs * 1.12, Rs);
  _drawBackupAlt(ctx, bkX, cy + Rs * 1.12, Rs);


  ctx.restore();
}


/* ════════════════════════════════════════════════════════════
   SHARED DRAW HELPERS
   ════════════════════════════════════════════════════════════ */
function _bezel(ctx, x, y, r, f0, f1) {
  const sh = ctx.createRadialGradient(x+r*.06, y+r*.08, r*.5, x, y, r*1.25);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, P.shadow);
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.arc(x, y, r*1.22, 0, Math.PI*2); ctx.fill();

  ctx.beginPath(); ctx.arc(x, y, r*1.06, 0, Math.PI*2);
  ctx.fillStyle = P.rim; ctx.fill();

  ctx.beginPath(); ctx.arc(x, y, r*1.01, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5; ctx.stroke();

  const face = ctx.createRadialGradient(x-r*.08, y-r*.10, r*.04, x, y, r);
  face.addColorStop(0,    f0 ?? '#f4f0e8');
  face.addColorStop(0.75, f1 ?? '#dbd5c2');
  face.addColorStop(1,    f1 ? f1 : '#c8c0a8');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = face; ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.42;
  const gl = ctx.createRadialGradient(x-r*.30, y-r*.36, r*.04, x-r*.16, y-r*.20, r*.72);
  gl.addColorStop(0,   'rgba(200,240,255,0.28)');
  gl.addColorStop(0.5, 'rgba(200,240,255,0.06)');
  gl.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function _cap(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r,     0, Math.PI*2); ctx.fillStyle = '#2a2e38'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r*.38, 0, Math.PI*2); ctx.fillStyle = '#3c4050'; ctx.fill();
}

function _needle(ctx, x, y, r, deg, fwd, bck, sc, color) {
  const a  = _r(deg);
  const aB = a + Math.PI;
  const w  = 2.2 * sc;
  const px = -Math.sin(a)*w, py = Math.cos(a)*w;
  const tx = x+Math.cos(a)*r*fwd,  ty = y+Math.sin(a)*r*fwd;
  const bx = x+Math.cos(aB)*r*bck, by = y+Math.sin(aB)*r*bck;
  ctx.beginPath();
  ctx.moveTo(x+px*2.2, y+py*2.2); ctx.lineTo(bx+px*1.5, by+py*1.5);
  ctx.lineTo(bx-px*1.5, by-py*1.5); ctx.lineTo(x-px*2.2, y-py*2.2);
  ctx.closePath(); ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x+px, y+py); ctx.lineTo(tx, ty); ctx.lineTo(x-px, y-py);
  ctx.closePath(); ctx.fillStyle = color ?? P.ndl; ctx.fill();
}

function _ticks(ctx, x, y, r, s0, sw, majN, minPer, sc, color) {
  const total = majN * minPer;
  for (let i = 0; i <= total; i++) {
    const deg = s0 + (i/total)*sw;
    const a   = _r(deg);
    const maj = i % minPer === 0;
    const len = maj ? r*0.13 : r*0.065;
    ctx.strokeStyle = color ?? P.mark;
    ctx.lineWidth   = maj ? 1.5*sc : 0.8*sc;
    ctx.beginPath();
    ctx.moveTo(x+Math.cos(a)*r,       y+Math.sin(a)*r);
    ctx.lineTo(x+Math.cos(a)*(r-len), y+Math.sin(a)*(r-len));
    ctx.stroke();
  }
}

function _num(ctx, x, y, r, deg, text, sz, sc, color) {
  const a  = _r(deg);
  const nr = r * 0.70;
  ctx.font         = `bold ${sz*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = color ?? P.mark;
  ctx.fillText(text, x+Math.cos(a)*nr, y+Math.sin(a)*nr);
}

function _label(ctx, x, y, r, text, sc) {
  ctx.fillStyle    = P.markDim;
  ctx.font         = `${8.5*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y + r*1.30);
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

/* The lowest edge of the HTML drawn over the panel's top left (the mission clock, the KEYS
   button), in canvas pixels — 0 when neither is shown. */
function _overlayBottom(canvas) {
  const top = canvas.getBoundingClientRect().top;
  const bottoms = ['mission-clock', 'btn-keys'].map(id => document.getElementById(id)?.getBoundingClientRect())
    .filter(r => r && r.height > 0).map(r => r.bottom);
  return bottoms.length ? Math.max(0, (Math.max(...bottoms) - top) * devicePixelRatio) : 0;
}

/* ════════════════════════════════════════════════════════════
   Kanardia NESIS 4 — digital AH
   ════════════════════════════════════════════════════════════ */
function _drawNESIS(ctx, x, y, r, sc) {
  const avionicsOn = _avionicsPowered();

  _bezel(ctx, x, y, r, '#0d1117', '#080c10');

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r*0.97, 0, Math.PI*2); ctx.clip();

  if (!avionicsOn) {
    /* Dark screen */
    ctx.fillStyle = '#000';
    ctx.fillRect(x-r, y-r, r*2, r*2);
    ctx.fillStyle    = 'rgba(255,255,255,0.12)';
    ctx.font         = `${10*sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AVIONICS OFF', x, y);
    ctx.restore();
    _label(ctx, x, y, r, 'NESIS 4  ·  AHRS', sc);
    return;
  }

  const pitch = S.pitch ?? 0;
  const roll  = (S.roll ?? 0) * Math.PI / 180;

  ctx.translate(x, y);
  ctx.rotate(-roll);

  const pxPerDeg = r / 22;
  const pitchOff = pitch * pxPerDeg;

  ctx.fillStyle = '#1a3a5c';
  ctx.fillRect(-r, -r*1.5, r*2, r*1.5 + pitchOff);
  ctx.fillStyle = '#3d2a14';
  ctx.fillRect(-r, pitchOff, r*2, r*1.5);

  ctx.strokeStyle = '#d4a843';
  ctx.lineWidth   = 2 * sc;
  ctx.beginPath(); ctx.moveTo(-r, pitchOff); ctx.lineTo(r, pitchOff); ctx.stroke();

  ctx.strokeStyle = 'rgba(212,168,67,0.6)';
  for (let d = -20; d <= 20; d += 5) {
    if (d === 0) continue;
    const py = pitchOff - d * pxPerDeg;
    const hw = (d % 10 === 0 ? 0.38 : 0.22) * r;
    ctx.lineWidth = d % 10 === 0 ? 1.5*sc : 1.0*sc;
    ctx.beginPath(); ctx.moveTo(-hw, py); ctx.lineTo(hw, py); ctx.stroke();
    if (d % 10 === 0) {
      ctx.fillStyle    = 'rgba(212,168,67,0.8)';
      ctx.font         = `${9*sc}px ${MONO}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.abs(d), hw+6*sc, py);
      ctx.textAlign    = 'right';
      ctx.fillText(Math.abs(d), -hw-6*sc, py);
    }
  }
  ctx.restore();

  /* Fixed aircraft symbol */
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = P.white;
  ctx.lineWidth   = 3*sc;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(-r*.52, 0); ctx.lineTo(-r*.18, 0); ctx.lineTo(-r*.08, r*.08); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r*.52, 0);  ctx.lineTo(r*.18,  0); ctx.lineTo(r*.08,  r*.08); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 3*sc, 0, Math.PI*2);
  ctx.fillStyle = P.white; ctx.fill();
  ctx.restore();

  /* Roll arc */
  ctx.save();
  ctx.translate(x, y);
  const rollRad = (S.roll ?? 0) * Math.PI / 180;
  for (const d of [-45,-30,-20,-10,10,20,30,45]) {
    const ra  = _r(d);
    const len = (Math.abs(d)===30||Math.abs(d)===45) ? r*.10 : r*.06;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 1.0*sc;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ra)*r*.97, Math.sin(ra)*r*.97);
    ctx.lineTo(Math.cos(ra)*(r*.97-len), Math.sin(ra)*(r*.97-len));
    ctx.stroke();
  }
  ctx.rotate(-rollRad);
  ctx.strokeStyle = P.cyan;
  ctx.lineWidth   = 2*sc;
  ctx.beginPath();
  ctx.moveTo(0, -r*.88);
  ctx.lineTo(-5*sc, -r*.97);
  ctx.lineTo(5*sc,  -r*.97);
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  /* Digital readout strip at bottom of gauge */
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r*.97, 0, Math.PI*2); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x-r, y+r*.55, r*2, r*.44);

  const midY = y + r * 0.72;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = P.dim;    ctx.font = `${7.5*sc}px ${SANS}`;
  ctx.fillText('IAS', x - r*.5, midY - 9*sc);
  ctx.fillStyle = P.white;  ctx.font = `bold ${15*sc}px ${MONO}`;
  ctx.fillText(Math.round(S.spd ?? 0) + ' kt', x - r*.5, midY + 6*sc);
  ctx.fillStyle = P.dim;    ctx.font = `${7.5*sc}px ${SANS}`;
  ctx.fillText('HDG', x + r*.5, midY - 9*sc);
  ctx.fillStyle = P.white;  ctx.font = `bold ${15*sc}px ${MONO}`;
  ctx.fillText(String(Math.round(S.hdg ?? 0)).padStart(3,'0') + '°', x + r*.5, midY + 6*sc);
  ctx.restore();

  _label(ctx, x, y, r, 'NESIS 4  ·  AHRS', sc);
}

/* ════════════════════════════════════════════════════════════
   EPSI 570 energy management
   ════════════════════════════════════════════════════════════ */
function _drawEPSI(ctx, canvas, cx, cy, w, h, sc) {
  const x0  = cx - w/2;
  const y0  = cy - h/2;
  const pad = 14*sc;

  ctx.save();
  _roundRect(ctx, x0, y0, w, h, 10*sc);
  ctx.fillStyle   = P.recess;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,200,224,0.18)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.clip();

  /* Without power the whole screen is dark, its map too — as the NESIS */
  if (!_avionicsPowered()) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle    = 'rgba(255,255,255,0.12)';
    ctx.font         = `${10*sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AVIONICS OFF', cx, cy);
    ctx.restore();
    hideVelisMap();
    return;
  }

  /* Header */
  ctx.fillStyle    = 'rgba(0,200,224,0.08)';
  ctx.fillRect(x0, y0, w, 28*sc);
  ctx.fillStyle    = P.cyan;
  ctx.font         = `bold ${9*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EPSI 570  ·  ENERGY MANAGEMENT', cx, y0 + 14*sc);

  ctx.strokeStyle = 'rgba(0,200,224,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(x0+pad, y0+28*sc); ctx.lineTo(x0+w-pad, y0+28*sc); ctx.stroke();

  const soc      = S.batteryCharge ?? 0;
  const masterOn = S.switches.master;
  const pwrOn    = S.switches.pwrEn;
  const kw       = pwrOn
    ? (S.aircraft?.battery?.powerDrawKw ?? 25) * (S.enginePower ?? 0)
    : 0;
  const socColor = soc > 27 ? P.green : soc > 20 ? P.amber : soc > 10 ? '#ff8800' : P.red;

  /* SOC % — large */
  const socY = y0 + 72*sc;
  ctx.fillStyle    = socColor;   // the BMS reports the charge with BATT EN off too — checked before it (POH 4-9)
  ctx.font         = `bold ${52*sc}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(soc) + '%', cx, socY);
  ctx.fillStyle    = P.dim;
  ctx.font         = `${8*sc}px ${SANS}`;
  ctx.fillText('STATE OF CHARGE', cx, socY + 34*sc);

  /* SOC bar */
  const barY = y0 + 124*sc;
  const barH = 20*sc;
  const barW = w - pad*2.5;
  const barX = cx - barW/2;

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  _roundRect(ctx, barX, barY, barW, barH, 4*sc); ctx.fill();

  ctx.fillStyle = socColor;
  _roundRect(ctx, barX, barY, barW * Math.max(0, soc/100), barH, 4*sc); ctx.fill();

  /* 27% marker */
  const m27x = barX + barW * 0.27;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth   = 1.5*sc;
  ctx.setLineDash([3*sc, 3*sc]);
  ctx.beginPath(); ctx.moveTo(m27x, barY-5*sc); ctx.lineTo(m27x, barY+barH+5*sc); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle    = 'rgba(255,255,255,0.40)';
  ctx.font         = `${7.5*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('27%', m27x, barY - 7*sc);

  /* Divider */
  const div1Y = barY + barH + 16*sc;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(x0+pad, div1Y); ctx.lineTo(x0+w-pad, div1Y); ctx.stroke();

  /* kW + ALT row */
  const row2Y = div1Y + 16*sc;
  const col   = w/2;

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = P.dim;    ctx.font = `${8*sc}px ${SANS}`;
  ctx.fillText('MOTOR POWER', cx - col/2, row2Y);
  ctx.fillStyle = pwrOn ? P.cyan : P.dim;
  ctx.font      = `bold ${24*sc}px ${MONO}`;
  ctx.fillText(pwrOn ? Math.round(kw) + ' kW' : '---', cx - col/2, row2Y + 18*sc);

  ctx.fillStyle = P.dim;    ctx.font = `${8*sc}px ${SANS}`;
  ctx.fillText('ALTITUDE', cx + col/2, row2Y);
  ctx.fillStyle = P.white;  ctx.font = `bold ${24*sc}px ${MONO}`;
  ctx.fillText(Math.round(S.alt ?? 0).toLocaleString() + ' ft', cx + col/2, row2Y + 18*sc);

  /* Divider */
  const div2Y = row2Y + 46*sc;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(x0+pad, div2Y); ctx.lineTo(x0+w-pad, div2Y); ctx.stroke();

  /* VS + Flaps row */
  const row3Y = div2Y + 16*sc;
  const vs    = S.vs ?? 0;
  const flaps = S.aircraft?.flaps ?? [];
  const flapsIdx   = S.flaps ?? 0;
  const flapsLabel = flapLabel(flaps[flapsIdx], flapsIdx);

  ctx.fillStyle = P.dim;   ctx.font = `${8*sc}px ${SANS}`;
  ctx.fillText('V/S', cx - col/2, row3Y);
  ctx.fillStyle = Math.abs(vs) > 1000 ? P.amber : P.white;
  ctx.font      = `bold ${20*sc}px ${MONO}`;
  ctx.fillText((vs >= 0 ? '+' : '') + Math.round(vs/10)*10 + ' fpm', cx - col/2, row3Y + 16*sc);

  ctx.fillStyle = P.dim;   ctx.font = `${8*sc}px ${SANS}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FLAPS', cx + col/2, row3Y);

  /* Segmented position indicator */
  const segW   = Math.min(col * 0.38, 28*sc);
  const segH   = 14*sc;
  const segGap = 3*sc;
  const segsW  = flaps.length * segW + (flaps.length - 1) * segGap;
  const segX0  = cx + col/2 - segsW/2;
  const segY   = row3Y + 11*sc;
  flaps.forEach((fp, i) => {
    const active = i === flapsIdx;
    const lbl    = flapLabel(fp, i);
    const sx     = segX0 + i * (segW + segGap);
    ctx.fillStyle = active
      ? (i > 0 ? 'rgba(0,200,224,0.18)' : 'rgba(255,255,255,0.08)')
      : 'rgba(0,0,0,0.35)';
    _roundRect(ctx, sx, segY, segW, segH, 2*sc); ctx.fill();
    ctx.strokeStyle = active
      ? (i > 0 ? P.cyan : 'rgba(255,255,255,0.28)')
      : 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.8;
    _roundRect(ctx, sx, segY, segW, segH, 2*sc); ctx.stroke();
    ctx.fillStyle = active ? (i > 0 ? P.cyan : P.white) : 'rgba(255,255,255,0.22)';
    ctx.font = `${active ? 'bold ' : ''}${Math.round(segH * 0.60)}px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, sx + segW/2, segY + segH/2);
  });

  /* Moving map — fills gap between data rows and annunciators */
  const mapTop    = row3Y + 36*sc;
  const mapBottom = y0 + h - 60*sc;
  const mapH      = mapBottom - mapTop;
  const mapS      = Math.min(w - pad*2, mapH);   // square, centered
  const mapX      = cx - mapS/2;
  if (mapH > 40*sc) updateVelisMapOverlay(canvas, mapX, mapTop, mapS, mapH);

  /* Warning annunciators */
  const warnY = y0 + h - 46*sc;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(x0+pad, warnY-10*sc); ctx.lineTo(x0+w-pad, warnY-10*sc); ctx.stroke();

  const warns = [
    { label: 'BATT LOW',  active: soc <= 20 && soc > 10, color: P.amber },
    { label: 'BATT CRIT', active: soc <= 10,             color: P.red   },
    { label: 'GO-AROUND', active: soc <= 27 && soc > 10, color: P.amber },
    { label: 'MOTOR OFF', active: masterOn && !pwrOn,              color: P.red   },
  ];
  const warnW = (w - pad*2) / warns.length;
  warns.forEach((warn, i) => {
    const wx = x0 + pad + warnW*i + warnW/2;
    ctx.fillStyle    = warn.active ? warn.color : 'rgba(255,255,255,0.10)';
    ctx.font         = `bold ${8*sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(warn.label, wx, warnY + 10*sc);
    if (warn.active) {
      ctx.strokeStyle = warn.color;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.22;
      _roundRect(ctx, wx-warnW/2+2*sc, warnY-0*sc, warnW-4*sc, 22*sc, 3*sc);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   ZONE 4 TOP: Backup ASI — 0–140 kt  (G1000-style dark face)
   ════════════════════════════════════════════════════════════ */
function _drawBackupASI(ctx, x, y, r) {
  const spd  = S.spd ?? 0;
  const s0   = Math.PI * (4 / 3);
  const rng  = Math.PI * 1.5;
  const maxV = 140;
  const ang  = v => s0 + (Math.max(0, Math.min(maxV, v)) / maxV) * rng;

  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0c12'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = r * 0.04; ctx.stroke();

  /* Speed arcs — Velis Electro limits */
  const arcs = [
    [50,  85,  '#d8d8d8'],   // white — flap range
    [60,  108, P.green],     // green — normal
    [108, maxV, P.amber],    // amber — caution
  ];
  ctx.lineWidth = r * 0.09;
  arcs.forEach(([lo, hi, col]) => {
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * 0.82, ang(lo), ang(hi)); ctx.stroke();
  });
  /* Vne radial at 135 kt */
  const vneA = ang(135);
  ctx.strokeStyle = P.red; ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(x + r*0.73*Math.cos(vneA), y + r*0.73*Math.sin(vneA));
  ctx.lineTo(x + r*0.90*Math.cos(vneA), y + r*0.90*Math.sin(vneA));
  ctx.stroke();

  /* Ticks + labels */
  for (let v = 0; v <= maxV; v += 10) {
    const a     = ang(v);
    const major = v % 20 === 0;
    ctx.strokeStyle = P.white; ctx.lineWidth = major ? r * 0.025 : r * 0.015;
    ctx.beginPath();
    ctx.moveTo(x + (major ? r*0.66 : r*0.74)*Math.cos(a), y + (major ? r*0.66 : r*0.74)*Math.sin(a));
    ctx.lineTo(x + r*0.88*Math.cos(a),                    y + r*0.88*Math.sin(a));
    ctx.stroke();
    if (major && v > 0) {
      ctx.fillStyle = P.white; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v, x + r*0.54*Math.cos(a), y + r*0.54*Math.sin(a));
    }
  }

  /* Needle */
  const na = ang(spd);
  ctx.strokeStyle = P.white; ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(x - r*0.14*Math.cos(na), y - r*0.14*Math.sin(na));
  ctx.lineTo(x + r*0.78*Math.cos(na), y + r*0.78*Math.sin(na));
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r*0.08, 0, Math.PI*2);
  ctx.fillStyle = '#b0b4be'; ctx.fill();

  ctx.fillStyle = P.dim; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('IAS', x, y + r * 0.40);
}

/* ════════════════════════════════════════════════════════════
   ZONE 4 BOTTOM: Backup altimeter — ft  (G1000-style dark face)
   ════════════════════════════════════════════════════════════ */
function _drawBackupAlt(ctx, x, y, r) {
  const alt = S.alt ?? 0;
  const s0  = Math.PI * (4 / 3);
  const rng = Math.PI * 1.5;

  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0c12'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = r * 0.04; ctx.stroke();

  /* 50 ticks — 10 major, each major = 1000 ft */
  for (let i = 0; i <= 50; i++) {
    const a     = s0 + (i / 50) * rng;
    const major = i % 5 === 0;
    ctx.strokeStyle = P.white; ctx.lineWidth = major ? r * 0.025 : r * 0.015;
    ctx.beginPath();
    ctx.moveTo(x + (major ? r*0.66 : r*0.76)*Math.cos(a), y + (major ? r*0.66 : r*0.76)*Math.sin(a));
    ctx.lineTo(x + r*0.88*Math.cos(a),                    y + r*0.88*Math.sin(a));
    ctx.stroke();
    if (major) {
      ctx.fillStyle = P.white; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((i / 5) % 10, x + r*0.54*Math.cos(a), y + r*0.54*Math.sin(a));
    }
  }

  /* Thousands needle (1 rev = 10 000 ft) */
  const bigA = s0 + ((alt % 10000) / 10000) * rng;
  ctx.strokeStyle = P.white; ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(x - r*0.12*Math.cos(bigA), y - r*0.12*Math.sin(bigA));
  ctx.lineTo(x + r*0.68*Math.cos(bigA), y + r*0.68*Math.sin(bigA));
  ctx.stroke();

  /* Hundreds needle (1 rev = 1 000 ft) */
  const smlA = s0 + ((alt % 1000) / 1000) * rng;
  ctx.strokeStyle = P.white; ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.moveTo(x - r*0.14*Math.cos(smlA), y - r*0.14*Math.sin(smlA));
  ctx.lineTo(x + r*0.82*Math.cos(smlA), y + r*0.82*Math.sin(smlA));
  ctx.stroke();

  ctx.beginPath(); ctx.arc(x, y, r*0.08, 0, Math.PI*2);
  ctx.fillStyle = '#b0b4be'; ctx.fill();

  ctx.fillStyle = P.dim; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ALT', x, y + r * 0.40);
}
