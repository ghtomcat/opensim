/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/velis_epsi.js
   Pipistrel Velis Electro HB-SYC — full canvas cockpit.

   Four zones (left → right):
     SWITCHES  Kanardia COM + master switches + breakers
     NESIS 4   Digital AH — primary flight instruments
     EPSI 570  Energy management display
     BACKUP    Analog ASI + altimeter

   Click handling: canvas click toggles switches in the left zone.
   COM swap: click the standby frequency.

   All HTML overlays (#panel, #fma, #metar-strip, #com-container,
   #warning-lights) are hidden by index.html when this panel is active.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }               from '../core/state.js';
import { getCOMState, comTransfer }  from './com.js';
import { updateVelisMapOverlay }     from './map.js';
import { startSound, stopSound }     from '../core/sound.js';

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

/* ── Hit regions for click handling — rebuilt each frame ── */
let _hitRegions = [];

/* Motor state follows switches: MASTER + BATT EN + PWR EN → running */
function _updateElectricEngine() {
  const sw = S.switches;
  const motorReady = sw.master && sw.battEn && sw.pwrEn;
  const running    = S.engineState === 'running';
  if (motorReady && !running) {
    setState({ engineState: 'running', enginePower: 1.0 });
    startSound('electric');
  } else if (!motorReady && running) {
    setState({ engineState: 'off', enginePower: 0 });
    stopSound();
  }
}

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderVelisEpsi(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  _hitRegions = [];   // reset click targets

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
  const swW  = W * 0.18;   // switches + COM
  const nhW  = W * 0.27;   // NESIS 4
  const epW  = W * 0.33;   // EPSI 570
  const bkW  = W * 0.22;   // backup gauges

  const swX  = swW  / 2;
  const nhX  = swW  + nhW / 2;
  const epX  = swW  + nhW + epW / 2;
  const bkX  = swW  + nhW + epW + bkW / 2;
  const cy   = H / 2;

  /* Instrument radii */
  const R  = Math.min(nhW, H) * 0.40;
  const Rs = Math.min(bkW * 0.44, H * 0.22);

  /* ── ZONE 1: Switches + COM ── */
  _drawSwitchPanel(ctx, swX, cy, swW, H, sc);

  /* ── ZONE 2: NESIS 4 ── */
  _drawNESIS(ctx, nhX, cy, R, sc);

  /* ── ZONE 3: EPSI 570 ── */
  _drawEPSI(ctx, canvas, epX, cy, epW * 0.88, H * 0.92, sc);

  /* ── ZONE 4: Backup gauges ── */
  _drawBackupASI(ctx, bkX, cy - Rs * 1.12, Rs, sc);
  _drawBackupAlt(ctx, bkX, cy + Rs * 1.12, Rs, sc);

  /* Paused */
  if (S.paused) {
    ctx.fillStyle    = 'rgba(0,200,224,0.92)';
    ctx.font         = `bold ${13*sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PAUSE  [P]', W / 2, H - 16*sc);
  }

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   CLICK HANDLER — call once from index.html
   ════════════════════════════════════════════════════════════ */
export function handleVelisClick(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const dpr  = devicePixelRatio;
  const cx   = (evt.clientX - rect.left) * dpr;
  const cy   = (evt.clientY - rect.top)  * dpr;

  for (const region of _hitRegions) {
    if (cx >= region.x && cx <= region.x + region.w &&
        cy >= region.y && cy <= region.y + region.h) {
      region.action();
      return;
    }
  }
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

/* ════════════════════════════════════════════════════════════
   ZONE 1: Switch panel + COM radio
   ════════════════════════════════════════════════════════════ */
function _drawSwitchPanel(ctx, cx, cy, zoneW, H, sc) {
  const pad  = 10 * sc;
  const x0   = cx - zoneW/2 + pad;
  const w    = zoneW - pad*2;

  /* ── COM radio (top half) ── */
  const comH = H * 0.46;
  const comY = cy - H/2 + pad;
  _drawCOMRadio(ctx, x0, comY, w, comH, sc);

  /* ── Master switches (bottom half) ── */
  const swY = comY + comH + pad;
  const swH = H - comY - comH - pad * 2;
  _drawMasterSwitches(ctx, x0, swY, w, swH, sc);
}

function _drawCOMRadio(ctx, x0, y0, w, h, sc) {
  const com = getCOMState();

  ctx.save();
  _roundRect(ctx, x0, y0, w, h, 6*sc);
  ctx.fillStyle   = P.recess;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,200,224,0.15)';
  ctx.lineWidth   = 1.2;
  ctx.stroke();
  ctx.clip();

  /* Header */
  ctx.fillStyle    = 'rgba(0,200,224,0.08)';
  ctx.fillRect(x0, y0, w, 22*sc);
  ctx.fillStyle    = P.cyan;
  ctx.font         = `bold ${8.5*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(com.title, x0 + w/2, y0 + 11*sc);

  /* Active freq */
  const actY = y0 + 38*sc;
  ctx.fillStyle    = P.dim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.textAlign    = 'left';
  ctx.fillText('ACTIVE', x0 + 8*sc, actY - 8*sc);
  ctx.fillStyle    = P.white;
  ctx.font         = `bold ${18*sc}px ${MONO}`;
  ctx.fillText(com.active, x0 + 8*sc, actY + 8*sc);

  /* Active label */
  ctx.fillStyle    = P.cyan;
  ctx.font         = `${7.5*sc}px ${SANS}`;
  ctx.fillText(com.activeLabel, x0 + 8*sc, actY + 22*sc);

  /* Divider */
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 8*sc, actY + 30*sc);
  ctx.lineTo(x0 + w - 8*sc, actY + 30*sc);
  ctx.stroke();

  /* Standby freq — clickable */
  const stbY = actY + 46*sc;
  ctx.fillStyle    = P.dim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.fillText('STANDBY', x0 + 8*sc, stbY - 8*sc);
  ctx.fillStyle    = 'rgba(232,237,242,0.6)';
  ctx.font         = `bold ${14*sc}px ${MONO}`;
  ctx.fillText(com.standby, x0 + 8*sc, stbY + 6*sc);
  ctx.fillStyle    = P.dim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.fillText(com.standbyLabel, x0 + 8*sc, stbY + 18*sc);

  /* FLIP button */
  const flipX = x0 + w - 28*sc;
  const flipY = stbY - 4*sc;
  const flipW = 22*sc;
  const flipH = 18*sc;
  _roundRect(ctx, flipX, flipY, flipW, flipH, 3*sc);
  ctx.fillStyle   = 'rgba(0,200,224,0.15)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,200,224,0.4)';
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.fillStyle    = P.cyan;
  ctx.font         = `bold ${9*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⇅', flipX + flipW/2, flipY + flipH/2);

  /* Register FLIP hit region */
  _hitRegions.push({
    x: flipX, y: flipY, w: flipW, h: flipH,
    action: () => comTransfer()
  });

  /* XPDR */
  const xpY = stbY + 34*sc;
  ctx.fillStyle    = P.dim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.textAlign    = 'left';
  ctx.fillText(com.xpdrLabel, x0 + 8*sc, xpY);
  ctx.fillStyle    = P.white;
  ctx.font         = `bold ${14*sc}px ${MONO}`;
  ctx.fillText(com.xpdrCode, x0 + 8*sc, xpY + 14*sc);
  ctx.fillStyle    = P.dim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.fillText(com.xpdrMode, x0 + 8*sc, xpY + 26*sc);

  ctx.restore();
}

function _drawMasterSwitches(ctx, x0, y0, w, h, sc) {
  const sw = S.switches;

  ctx.save();
  _roundRect(ctx, x0, y0, w, h, 6*sc);
  ctx.fillStyle   = P.recess;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.clip();

  /* Header */
  ctx.fillStyle    = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x0, y0, w, 20*sc);
  ctx.fillStyle    = P.dim;
  ctx.font         = `bold ${8*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MASTER SWITCHES', x0 + w/2, y0 + 10*sc);

  const switches = [
    { key: 'master',   label: 'MASTER'   },
    { key: 'battEn',   label: 'BATT EN'  },
    { key: 'pwrEn',    label: 'PWR EN'   },
    { key: 'avionics', label: 'AVIONICS' },
  ];

  const swH    = (h - 26*sc) / switches.length;
  const swPad  = swH * 0.15;

  switches.forEach((def, i) => {
    const sy     = y0 + 24*sc + i * swH;
    const on     = sw[def.key];
    const togX   = x0 + w - 36*sc;
    const togY   = sy + swH/2 - 9*sc;
    const togW   = 28*sc;
    const togH   = 18*sc;

    /* Label */
    ctx.fillStyle    = on ? P.white : P.dim;
    ctx.font         = `${8.5*sc}px ${SANS}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.label, x0 + 8*sc, sy + swH/2);

    /* Toggle track */
    _roundRect(ctx, togX, togY, togW, togH, togH/2);
    ctx.fillStyle = on ? 'rgba(0,200,224,0.25)' : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = on ? 'rgba(0,200,224,0.6)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    /* Toggle knob */
    const knobX = on ? togX + togW - togH/2 : togX + togH/2;
    const knobY  = togY + togH/2;
    ctx.beginPath();
    ctx.arc(knobX, knobY, togH/2 - 2*sc, 0, Math.PI*2);
    ctx.fillStyle = on ? P.cyan : 'rgba(255,255,255,0.3)';
    ctx.fill();

    /* Indicator dot */
    if (on) {
      ctx.beginPath();
      ctx.arc(knobX, knobY, 3*sc, 0, Math.PI*2);
      ctx.fillStyle = P.recess;
      ctx.fill();
    }

    /* Hit region for the whole row */
    _hitRegions.push({
      x: x0, y: sy, w: w, h: swH,
      action: () => {
        S.switches[def.key] = !S.switches[def.key];
        _updateElectricEngine();
      }
    });

    /* Row separator */
    if (i < switches.length - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 8*sc, sy + swH - 1);
      ctx.lineTo(x0 + w - 8*sc, sy + swH - 1);
      ctx.stroke();
    }
  });

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   ZONE 2: Kanardia NESIS 4 — digital AH
   ════════════════════════════════════════════════════════════ */
function _drawNESIS(ctx, x, y, r, sc) {
  const avionicsOn = S.switches.avionics;

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
   ZONE 3: EPSI 570 energy management
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
  const battOn   = S.switches.battEn;
  const pwrOn    = S.switches.pwrEn;
  const kw       = pwrOn
    ? (S.aircraft?.battery?.powerDrawKw ?? 25) * (S.enginePower ?? 0)
    : 0;
  const socColor = soc > 27 ? P.green : soc > 20 ? P.amber : soc > 10 ? '#ff8800' : P.red;
  const online   = masterOn && battOn;

  /* SOC % — large */
  const socY = y0 + 72*sc;
  ctx.fillStyle    = online ? socColor : P.dim;
  ctx.font         = `bold ${52*sc}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(online ? Math.round(soc) + '%' : '---', cx, socY);
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

  if (online) {
    const fillW = barW * Math.max(0, soc/100);
    ctx.fillStyle = socColor;
    _roundRect(ctx, barX, barY, fillW, barH, 4*sc); ctx.fill();
  }

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
  ctx.fillStyle = pwrOn && online ? P.cyan : P.dim;
  ctx.font      = `bold ${24*sc}px ${MONO}`;
  ctx.fillText(pwrOn && online ? Math.round(kw) + ' kW' : '---', cx - col/2, row2Y + 18*sc);

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
  const flapsLabel = flaps[flapsIdx]?.deg !== undefined
    ? flaps[flapsIdx].deg + '°'
    : (flaps[flapsIdx]?.label ?? 'UP');

  ctx.fillStyle = P.dim;   ctx.font = `${8*sc}px ${SANS}`;
  ctx.fillText('V/S', cx - col/2, row3Y);
  ctx.fillStyle = Math.abs(vs) > 1000 ? P.amber : P.white;
  ctx.font      = `bold ${20*sc}px ${MONO}`;
  ctx.fillText((vs >= 0 ? '+' : '') + Math.round(vs/10)*10 + ' fpm', cx - col/2, row3Y + 16*sc);

  ctx.fillStyle = P.dim;   ctx.font = `${8*sc}px ${SANS}`;
  ctx.fillText('FLAPS', cx + col/2, row3Y);
  ctx.fillStyle = flapsIdx === 0 ? P.white : P.cyan;
  ctx.font      = `bold ${20*sc}px ${MONO}`;
  ctx.fillText(flapsLabel, cx + col/2, row3Y + 16*sc);

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
    { label: 'BATT LOW',  active: online && soc <= 20 && soc > 10, color: P.amber },
    { label: 'BATT CRIT', active: online && soc <= 10,             color: P.red   },
    { label: 'GO-AROUND', active: online && soc <= 27 && soc > 10, color: P.amber },
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
   ZONE 4 TOP: Backup ASI — 0–140 kt
   ════════════════════════════════════════════════════════════ */
function _drawBackupASI(ctx, x, y, r, sc) {
  const s0 = 225, sw = 270, maxV = 140;
  _bezel(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 7, 5, sc);
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxV; v += 20) _num(ctx, x, y, r, s0+(v/maxV)*sw, String(v), 7.5, sc);
  ctx.textBaseline = 'alphabetic';

  /* Arcs */
  const arc = (a0, a1, color, width) => {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r*.95, _r(a0), _r(a1));
    ctx.strokeStyle = color; ctx.lineWidth = width*sc; ctx.stroke();
    ctx.restore();
  };
  arc(s0, s0+(48/maxV)*sw, '#cc2200', 5);                      // Vs0 red
  arc(s0+(65/maxV)*sw, s0+(108/maxV)*sw, '#338844', 5);        // normal green
  arc(s0+(108/maxV)*sw, s0+sw, '#cc2200', 5);                  // Vne red

  ctx.fillStyle    = P.markDim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('kt', x, y + r*.42);

  _needle(ctx, x, y, r, s0+Math.min(1,Math.max(0,(S.spd??0)/maxV))*sw, 0.78, 0.22, sc, P.ndl);
  _cap(ctx, x, y, 4.5*sc);
  _label(ctx, x, y, r, 'AIRSPEED', sc);
}

/* ════════════════════════════════════════════════════════════
   ZONE 4 BOTTOM: Backup altimeter — ×1000 ft
   ════════════════════════════════════════════════════════════ */
function _drawBackupAlt(ctx, x, y, r, sc) {
  const s0 = 225, sw = 270, maxA = 10000;
  _bezel(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 5, sc);
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 9; v++) _num(ctx, x, y, r, s0+(v/10)*sw, String(v), 8, sc);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle    = P.markDim;
  ctx.font         = `${7*sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('×1000 ft', x, y + r*.42);

  const alt      = S.alt ?? 0;
  const angFine  = s0 + ((alt % maxA) / maxA) * sw;
  const angCoarse = s0 + ((alt / 100000) % 1) * sw;

  /* Coarse stub */
  const ac = _r(angCoarse);
  ctx.strokeStyle = P.ndlBack; ctx.lineWidth = 2.5*sc;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x+Math.cos(ac)*r*.42, y+Math.sin(ac)*r*.42);
  ctx.stroke();

  _needle(ctx, x, y, r, angFine, 0.78, 0.22, sc, P.ndl);
  _cap(ctx, x, y, 4.5*sc);
  _label(ctx, x, y, r, 'ALTITUDE', sc);
}
