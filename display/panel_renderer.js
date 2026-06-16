/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/panel_renderer.js
   Data-driven PFD/ND compositor + universal cockpit renderer.

   renderPanel(canvas, screenIdx, specOverride?) — Airbus PFD/ND
   renderFCU(canvas)                            — Airbus FCU
   renderCockpit(canvas)                        — DR-400 & future GA
   handleCockpitClick(canvas, evt)              — hit-test GA panels
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';
import {
  drawFMA, drawAI, drawSpeedTape, drawAltTape,
  drawVSI, drawHdgTape, drawNDMap, drawFCU, drawECAM, drawEICAS,
} from './pfd_instruments.js';
import { drawG1000PFD, drawG1000MFD, drawG1000Bezel, drawMagRotary, drawFuelSel } from './g1000.js';
import { hideG1000Map } from './map.js';
import { startFuelPump, stopFuelPump, startEngineLifecycle, stopEngineLifecycle } from '../core/sound.js';

/* ── Hit regions (rebuilt each cockpit frame) ── */
let _hitRegions  = [];
let _currentCanvas = null;

/* ── Guard state: keys whose protective cover has been lifted ── */
let _guardOpen = new Set();

/* ── Default style fallback for cockpit specs ── */
const _DEFAULT_STYLE = {
  colors: { bg: '#0e1014', white: '#e8edf4', dim: 'rgba(220,230,240,0.38)' },
};

/* ═══════════════════════════════════════════════════════════════
   WIDGET REGISTRY
   ═══════════════════════════════════════════════════════════════ */

const MONO = '"IBM Plex Mono", "Courier New", monospace';

/* Speed limits (kt) */
const V = { Vs0: 44, Vs1: 53, Vfe: 85, Vno: 128, Vne: 163 };

/* Analog gauge colors */
const AG = {
  bg:    '#0a0c12',
  ring:  'rgba(255,255,255,0.28)',
  white: '#e8f0f8',
  dim:   'rgba(232,240,248,0.38)',
  green: '#44dd66',
  amber: '#ffb74d',
  red:   '#ff3333',
};

function _line(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x,     y + h, x,     y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ── analog_asi ── */
function _drawAnalogASI(ctx, box) {
  const r  = Math.min(box.w, box.h) * 0.42;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const spd = S.spd ?? 0;
  const s0  = Math.PI * (4 / 3);
  const rng = Math.PI * 1.5;
  const ang = v => s0 + (Math.max(0, Math.min(200, v)) / 200) * rng;

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = AG.bg; ctx.fill();
  ctx.strokeStyle = AG.ring; ctx.lineWidth = r * 0.04; ctx.stroke();

  /* coloured arcs */
  const arcs = [
    [V.Vs0, V.Vfe, '#d8d8d8'],
    [V.Vs1, V.Vno, AG.green],
    [V.Vno, V.Vne, AG.amber],
  ];
  ctx.lineWidth = r * 0.09;
  arcs.forEach(([lo, hi, col]) => {
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, ang(lo), ang(hi)); ctx.stroke();
  });
  const vneA = ang(V.Vne);
  ctx.strokeStyle = AG.red; ctx.lineWidth = r * 0.04;
  _line(ctx, cx + r*0.73*Math.cos(vneA), cy + r*0.73*Math.sin(vneA),
             cx + r*0.90*Math.cos(vneA), cy + r*0.90*Math.sin(vneA));

  /* ticks & labels */
  for (let v = 0; v <= 200; v += 20) {
    const a = ang(v); const major = v % 40 === 0;
    ctx.strokeStyle = AG.white; ctx.lineWidth = major ? r * 0.025 : r * 0.015;
    _line(ctx, cx+(major?r*0.66:r*0.76)*Math.cos(a), cy+(major?r*0.66:r*0.76)*Math.sin(a),
               cx+r*0.88*Math.cos(a),                cy+r*0.88*Math.sin(a));
    if (major) {
      ctx.fillStyle = AG.white;
      ctx.font = `${Math.round(r*0.15)}px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v, cx + r*0.52*Math.cos(a), cy + r*0.52*Math.sin(a));
    }
  }

  /* needle */
  const na = ang(spd);
  ctx.strokeStyle = AG.white; ctx.lineWidth = r * 0.035;
  ctx.beginPath();
  ctx.moveTo(cx - r*0.14*Math.cos(na), cy - r*0.14*Math.sin(na));
  ctx.lineTo(cx + r*0.72*Math.cos(na), cy + r*0.72*Math.sin(na)); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r*0.08, 0, Math.PI*2);
  ctx.fillStyle = AG.dim; ctx.fill();

  ctx.fillStyle = AG.dim; ctx.font = `${Math.round(r*0.15)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('KIAS', cx, cy + r * 0.40);
}

/* ── analog_ai ── */
function _drawAnalogAI(ctx, box) {
  const r     = Math.min(box.w, box.h) * 0.42;
  const cx    = box.x + box.w / 2;
  const cy    = box.y + box.h / 2;
  const pitch = S.pitch ?? 0;
  const roll  = S.roll  ?? 0;
  const pxPD  = r / 22;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2); ctx.clip();

  ctx.translate(cx, cy); ctx.rotate(-roll * Math.PI / 180); ctx.translate(-cx, -cy);

  const hy   = cy + pitch * pxPD;
  const skyG = ctx.createLinearGradient(0, hy - r, 0, hy);
  skyG.addColorStop(0, '#1a3e80'); skyG.addColorStop(1, '#4a80c8');
  ctx.fillStyle = skyG; ctx.fillRect(cx - r, cy - r, r*2, hy-(cy-r)+1);
  const gndG = ctx.createLinearGradient(0, hy, 0, hy + r);
  gndG.addColorStop(0, '#7a4e28'); gndG.addColorStop(1, '#3e2208');
  ctx.fillStyle = gndG; ctx.fillRect(cx - r, hy, r*2, r*2);
  ctx.strokeStyle = AG.white; ctx.lineWidth = r * 0.025;
  _line(ctx, cx - r, hy, cx + r, hy);

  for (const p of [-20, -10, 10, 20]) {
    const py = hy - p * pxPD; if (py < cy-r || py > cy+r) continue;
    const len = r * (Math.abs(p) === 20 ? 0.24 : 0.16);
    ctx.lineWidth = r * 0.018;
    _line(ctx, cx - len, py, cx + len, py);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = r * 0.04;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2); ctx.stroke();

  /* wing bars */
  const wl = r * 0.20;
  ctx.strokeStyle = '#ffb74d'; ctx.lineWidth = r * 0.035;
  ctx.beginPath(); ctx.moveTo(cx-wl*1.8,cy); ctx.lineTo(cx-wl*0.4,cy);
  ctx.lineTo(cx-wl*0.4, cy+wl*0.28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+wl*1.8,cy); ctx.lineTo(cx+wl*0.4,cy);
  ctx.lineTo(cx+wl*0.4, cy+wl*0.28); ctx.stroke();

  ctx.fillStyle = AG.dim; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('ATT', cx, cy + r * 0.94);
}

/* ── analog_alt ── */
function _drawAnalogALT(ctx, box) {
  const r  = Math.min(box.w, box.h) * 0.42;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const alt = S.alt ?? 0;
  const s0  = Math.PI * (4 / 3);
  const rng = Math.PI * 1.5;

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = AG.bg; ctx.fill();
  ctx.strokeStyle = AG.ring; ctx.lineWidth = r * 0.04; ctx.stroke();

  /* ticks — 50 total, labeled every 5 (0–9) */
  for (let i = 0; i <= 50; i++) {
    const a = s0 + (i / 50) * rng; const major = i % 5 === 0;
    ctx.strokeStyle = AG.white; ctx.lineWidth = major ? r * 0.025 : r * 0.015;
    _line(ctx, cx+(major?r*0.66:r*0.76)*Math.cos(a), cy+(major?r*0.66:r*0.76)*Math.sin(a),
               cx+r*0.88*Math.cos(a),                cy+r*0.88*Math.sin(a));
    if (major) {
      ctx.fillStyle = AG.white;
      ctx.font = `${Math.round(r*0.14)}px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((i / 5) % 10, cx + r*0.54*Math.cos(a), cy + r*0.54*Math.sin(a));
    }
  }

  /* hundreds needle (1 rev = 1000ft) */
  const hunA = s0 + ((alt % 1000) / 1000) * rng;
  ctx.strokeStyle = AG.white; ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx - r*0.10*Math.cos(hunA), cy - r*0.10*Math.sin(hunA));
  ctx.lineTo(cx + r*0.80*Math.cos(hunA), cy + r*0.80*Math.sin(hunA)); ctx.stroke();

  /* thousands needle (1 rev = 10000ft) */
  const bigA = s0 + ((alt % 10000) / 10000) * rng;
  ctx.strokeStyle = AG.white; ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx - r*0.12*Math.cos(bigA), cy - r*0.12*Math.sin(bigA));
  ctx.lineTo(cx + r*0.60*Math.cos(bigA), cy + r*0.60*Math.sin(bigA)); ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, cy, r*0.08, 0, Math.PI*2);
  ctx.fillStyle = '#b0b4be'; ctx.fill();

  ctx.fillStyle = AG.dim; ctx.font = `${Math.round(r*0.15)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ALT FT', cx, cy + r * 0.40);
}

/* ── rocker_strip toggle action ── */
const MAG_STATES = ['OFF', 'R', 'L', 'BOTH', 'START'];

function _toggleSwitch(key) {
  if (key === 'fuelPump') {
    const next = !S.fuelPump;
    setState({ fuelPump: next });
    if (next) startFuelPump(); else stopFuelPump();
    return;
  }
  if (key === 'magnetos') {
    const cur  = S.magnetos ?? 'BOTH';
    const idx  = MAG_STATES.indexOf(cur);
    const next = MAG_STATES[(idx + 1) % MAG_STATES.length];
    setState({ magnetos: next });
    if (next === 'START') startEngineLifecycle();
    if (next === 'OFF')   stopEngineLifecycle();
    return;
  }
  /* dot-path e.g. "lights.nav" */
  if (key.includes('.')) {
    const [top, sub] = key.split('.');
    const group = S[top] ?? {};
    setState({ [top]: { ...group, [sub]: !group[sub] } });
    return;
  }
  setState({ [key]: !S[key] });
}

function _getState(key) {
  if (key.includes('.')) {
    const [top, sub] = key.split('.');
    return !!(S[top]?.[sub]);
  }
  return !!S[key];
}

/* ── rocker_strip — large illuminated annunciator pads ── */
const _ANN_PALETTE = {
  /* ON colors — face glows in this color */
  red:   { top: '#e02010', bot: '#801008', rim: '#ff4030', glow: 'rgba(220,30,10,0.35)'  },
  amber: { top: '#d07010', bot: '#784008', rim: '#ffa030', glow: 'rgba(200,110,0,0.35)'  },
  beige: { top: '#c8b870', bot: '#786830', rim: '#e8d890', glow: 'rgba(180,160,80,0.3)'  },
  green: { top: '#20b050', bot: '#0a6028', rim: '#40e070', glow: 'rgba(30,160,60,0.3)'   },
};

function _drawRockerStrip(ctx, box, style, cfg) {
  const switches = cfg.switches ?? [];
  if (!switches.length) return;

  /* strip background */
  ctx.fillStyle = '#0c0d11';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const sw   = box.w / switches.length;
  const padX = sw * 0.035;
  const padY = box.h * 0.10;

  switches.forEach((s, i) => {
    const on         = _getState(s.state);
    const guarded    = !!s.guarded;
    const guardIsOpen = guarded && _guardOpen.has(s.state);
    const pal        = _ANN_PALETTE[s.color];

    const rx = box.x + i * sw + padX;
    const ry = box.y + padY;
    const rw = sw - padX * 2;
    const rh = box.h - padY * 2;
    const cr = Math.min(rw, rh) * 0.08;

    /* glow behind face when ON */
    if (on && pal) {
      ctx.shadowColor = pal.glow;
      ctx.shadowBlur  = rw * 0.6;
    }

    /* face fill */
    const grad = ctx.createLinearGradient(rx, ry, rx, ry + rh);
    if (on && pal) {
      grad.addColorStop(0, pal.top);
      grad.addColorStop(1, pal.bot);
    } else {
      grad.addColorStop(0, '#252830');
      grad.addColorStop(1, '#141620');
    }
    _roundRect(ctx, rx, ry, rw, rh, cr);
    ctx.fillStyle = grad; ctx.fill();

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

    /* rim */
    ctx.strokeStyle = (on && pal) ? pal.rim : 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    /* label — bottom third of face */
    const fs = Math.max(6, Math.round(rh * 0.22));
    ctx.fillStyle    = on ? '#ffffff' : 'rgba(180,190,200,0.35)';
    ctx.font         = `bold ${fs}px ${MONO}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.label, rx + rw / 2, ry + rh * 0.72);

    /* indicator dot — upper area */
    const dotR  = Math.max(2, rw * 0.08);
    const dotCx = rx + rw / 2;
    const dotCy = ry + rh * 0.32;
    ctx.beginPath(); ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
    if (on && pal) {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = dotR * 2;
    } else {
      ctx.fillStyle = 'rgba(100,110,120,0.3)';
    }
    ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

    /* guard overlay */
    if (guarded && !on && !guardIsOpen) {
      /* closed: red cover over top ~72% of face */
      const gg = ctx.createLinearGradient(rx, ry, rx, ry + rh * 0.72);
      gg.addColorStop(0, '#c01810');
      gg.addColorStop(1, '#700c08');
      _roundRect(ctx, rx, ry, rw, rh * 0.72, cr);
      ctx.fillStyle = gg; ctx.fill();
      ctx.strokeStyle = '#e02818'; ctx.lineWidth = 0.8; ctx.stroke();
      /* hinge crease */
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx + 3, ry + rh * 0.72);
      ctx.lineTo(rx + rw - 3, ry + rh * 0.72);
      ctx.stroke();
    } else if (guarded && (on || guardIsOpen)) {
      /* open: small red tab folded back above the face */
      const tabH = rh * 0.20;
      const tg = ctx.createLinearGradient(rx, ry - tabH, rx, ry);
      tg.addColorStop(0, '#c01810');
      tg.addColorStop(1, '#700c08');
      _roundRect(ctx, rx + rw * 0.15, ry - tabH + 1, rw * 0.70, tabH, 2);
      ctx.fillStyle = tg; ctx.fill();
      ctx.strokeStyle = '#e02818'; ctx.lineWidth = 0.7; ctx.stroke();
    }

    _hitRegions.push({
      x: rx, y: ry, w: rw, h: rh,
      action: () => {
        if (!guarded) { _toggleSwitch(s.state); return; }
        const isOn = _getState(s.state);
        if (isOn) {
          /* turning off: guard closes automatically */
          _guardOpen.delete(s.state);
          _toggleSwitch(s.state);
        } else if (_guardOpen.has(s.state)) {
          /* guard already lifted — throw the switch */
          _guardOpen.delete(s.state);
          _toggleSwitch(s.state);
        } else {
          /* first click: lift the guard */
          _guardOpen.add(s.state);
        }
      },
    });
  });
}

/* ── bottom_switches (bat-handle toggles) ── */
function _drawBottomSwitches(ctx, box, style, cfg) {
  const switches = cfg.switches ?? [];
  if (!switches.length) return;
  const sw = box.w / switches.length;
  const padX = sw * 0.15;
  const padY = box.h * 0.06;

  switches.forEach((s, i) => {
    const on  = _getState(s.state);
    const rx  = box.x + i * sw + padX;
    const ry  = box.y + padY;
    const rw  = sw - padX * 2;
    const rh  = box.h - padY * 2;

    /* housing */
    ctx.fillStyle = '#060810';
    _roundRect(ctx, rx, ry, rw, rh, rw * 0.16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* lever */
    const lw   = rw * 0.32;
    const lh   = rh * 0.38;
    const lcx  = rx + rw / 2;
    /* UP = ON, DOWN = OFF */
    const lTop = on
      ? ry + rh * 0.08
      : ry + rh * 0.08 + lh * 0.7;
    const lg = ctx.createLinearGradient(lcx - lw/2, lTop, lcx + lw/2, lTop);
    lg.addColorStop(0, on ? '#484c5c' : '#2a2e3c');
    lg.addColorStop(1, on ? '#2a2e3c' : '#484c5c');
    _roundRect(ctx, lcx - lw/2, lTop, lw, lh, lw * 0.25);
    ctx.fillStyle = lg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.8; ctx.stroke();

    /* label */
    const fs = Math.max(7, Math.round(rh * 0.14));
    ctx.fillStyle = on ? '#e8f0f8' : 'rgba(200,210,220,0.5)';
    ctx.font = `${fs}px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.label, lcx, ry + rh * 0.78);

    /* LED */
    const ledR  = Math.max(2, rw * 0.09);
    const ledCy = ry + rh * 0.90;
    ctx.beginPath(); ctx.arc(lcx, ledCy, ledR, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#44dd66' : 'rgba(30,60,30,0.5)';
    ctx.fill();

    /* hit region */
    _hitRegions.push({
      x: rx, y: ry, w: rw, h: rh,
      action: () => _toggleSwitch(s.state),
    });
  });
}

/* ── g1000_screen (dual PFD | placard | MFD, C172) ── */
function _drawG1000Screen(ctx, box, style, cfg) {
  const powered = S.masterBat !== false && S.avionicsOn !== false;
  const { x, y, w, h } = box;

  const centerW = Math.round(w * 0.055);          /* avionics-stack placard */
  const scrTot  = w - centerW;
  const pfdW = Math.round(scrTot * 0.52);
  const mfdW = scrTot - pfdW;
  const cenX = x + pfdW;
  const mfdX = cenX + centerW;
  const bzP  = Math.round(w * 0.004);
  const bzT  = Math.round(h * 0.03);

  drawG1000Bezel(ctx, x,    y, pfdW, h);
  drawG1000Bezel(ctx, mfdX, y, mfdW, h);

  if (powered) {
    drawG1000PFD(ctx, x + bzP,        y + bzT, pfdW - bzP*2, h - bzT*2);
    drawG1000MFD(ctx, _currentCanvas, mfdX + bzP, y + bzT, mfdW - bzP*2, h - bzT*2);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(x + bzP,    y + bzT, pfdW - bzP*2, h - bzT*2);
    ctx.fillRect(mfdX + bzP, y + bzT, mfdW - bzP*2, h - bzT*2);
    hideG1000Map();
  }

  _drawCenterPlacard(ctx, cenX, y, centerW, h);
}

/* Centre placard — aircraft name + registration, between the two screens */
function _drawCenterPlacard(ctx, x, y, w, h) {
  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#08090c'; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  const name = S.aircraft?.name ?? '';
  const reg  = S.aircraft?.registration ?? S.aircraft?.callsign ?? '';

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-Math.PI / 2);                       /* read bottom-to-top */
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(232,240,248,0.82)';       /* registration — bold, bright */
  ctx.font = `bold ${Math.round(w * 0.30)}px ${MONO}`;
  ctx.fillText(reg, 0, -w * 0.16);

  ctx.fillStyle = 'rgba(232,240,248,0.30)';        /* name — smaller, dim */
  ctx.font = `${Math.round(w * 0.17)}px ${MONO}`;
  ctx.fillText(name, 0, w * 0.24);

  ctx.restore();
}

/* ── garmin_gtn (single-screen GTN/G5xx, DR-400) ── */
function _drawGarminGTN(ctx, box, style, cfg) {
  const powered = S.masterBat !== false && S.avionicsOn !== false;
  const { x, y, w, h } = box;

  /* outer bezel */
  const bezelGrad = ctx.createLinearGradient(x, y, x, y + h);
  bezelGrad.addColorStop(0, '#2a2c32');
  bezelGrad.addColorStop(1, '#18191e');
  _roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = bezelGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

  /* Garmin label top-left of bezel */
  const lfs = Math.max(6, Math.round(h * 0.028));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = `bold ${lfs}px ${MONO}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('GARMIN', x + 8, y + 4);

  /* screen inset */
  const bzX = Math.round(w * 0.03);
  const bzY = Math.round(h * 0.055);
  const sx = x + bzX;
  const sy = y + bzY;
  const sw = w - bzX * 2;
  const sh = h - bzY * 2;

  if (!powered) {
    ctx.fillStyle = '#000';
    ctx.fillRect(sx, sy, sw, sh);
    hideG1000Map();
    return;
  }

  /* use the MFD content for the single screen (map + engine sidebar) */
  drawG1000MFD(ctx, _currentCanvas, sx, sy, sw, sh);
}

/* ── magneto_knob ── */
function _drawMagnetoKnob(ctx, box, style, cfg) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r  = Math.min(box.w, box.h) * 0.28;

  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  drawMagRotary(ctx, cx, cy, r, S.magnetos ?? 'BOTH');

  _hitRegions.push({
    x: box.x, y: box.y, w: box.w, h: box.h,
    action: () => {
      const cur  = S.magnetos ?? 'BOTH';
      const idx  = MAG_STATES.indexOf(cur);
      const next = MAG_STATES[(idx + 1) % MAG_STATES.length];
      setState({ magnetos: next });
      if (next === 'START') startEngineLifecycle();
      if (next === 'OFF')   stopEngineLifecycle();
    },
  });
}

/* ── fuel_selector ── */
const FUEL_STATES = ['LEFT', 'BOTH', 'RIGHT'];

function _drawFuelSelector(ctx, box, style, cfg) {
  drawFuelSel(ctx, box.x, box.y, box.w, box.h);

  _hitRegions.push({
    x: box.x, y: box.y, w: box.w, h: box.h,
    action: () => {
      const cur  = S.fuelSelector ?? 'BOTH';
      const idx  = FUEL_STATES.indexOf(cur);
      const next = FUEL_STATES[(idx + 1) % FUEL_STATES.length];
      setState({ fuelSelector: next });
    },
  });
}

/* ── radio_stack ── */
function _drawRadioStack(ctx, box, style, cfg) {
  ctx.fillStyle = '#0a0c12';
  _roundRect(ctx, box.x + 2, box.y + 2, box.w - 4, box.h - 4, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  ctx.stroke();

  const devices = [
    { label: 'COM', val: '122.275' },
    { label: 'XPDR', val: '7000' },
  ];
  const slotH = (box.h - 8) / (devices.length + 1);
  devices.forEach((d, i) => {
    const dy = box.y + 4 + slotH * (i + 0.4);
    const dh = slotH * 0.72;
    ctx.fillStyle = '#111318';
    _roundRect(ctx, box.x + 8, dy, box.w - 16, dh, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.8; ctx.stroke();

    const fs = Math.max(8, Math.round(dh * 0.38));
    ctx.fillStyle = 'rgba(180,200,210,0.45)';
    ctx.font = `${fs}px ${MONO}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(d.label, box.x + 14, dy + dh / 2);
    ctx.textAlign = 'right';
    ctx.fillText(d.val, box.x + box.w - 14, dy + dh / 2);
  });
}

/* ── grid (recursive sub-layout) ── */
function _drawGrid(ctx, box, style, cfg) {
  let rowY = box.y;
  for (const row of (cfg.layout ?? [])) {
    const rowH = row.h * box.h;
    let colX   = box.x;
    for (const col of row.cols) {
      const colW = col.w * box.w;
      const sub  = { x: colX, y: rowY, w: colW, h: rowH };
      const fn   = _WIDGETS[col.widget];
      if (fn) fn(ctx, sub, style, col.config ?? {});
      colX += colW;
    }
    rowY += rowH;
  }
}

/* ── aircraft_tag — type / callsign plate ── */
function _drawAircraftTag(ctx, box, style, cfg) {
  const aircraft = S.aircraft ?? {};
  const type     = aircraft.icaoType  ?? '';
  const name     = aircraft.name      ?? '';
  const callsign = aircraft.callsign  ?? '';

  /* dark plate */
  const { x, y, w, h } = box;
  ctx.fillStyle = '#0a0b0e';
  _roundRect(ctx, x + 4, y + h * 0.15, w - 8, h * 0.70, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 0.8; ctx.stroke();

  /* type line */
  const fsT = Math.max(7, Math.round(h * 0.30));
  ctx.fillStyle   = 'rgba(220,225,235,0.75)';
  ctx.font        = `bold ${fsT}px ${MONO}`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(callsign, x + w / 2, y + h * 0.38);

  /* name/type sub-line */
  const fsN = Math.max(6, Math.round(h * 0.20));
  ctx.fillStyle = 'rgba(160,170,185,0.50)';
  ctx.font      = `${fsN}px ${MONO}`;
  /* shorten name to fit: use icaoType + short model fragment */
  const shortName = name.length > 22 ? name.slice(0, 22) : name;
  ctx.fillText(shortName, x + w / 2, y + h * 0.66);
}

/* ═══════════════════════════════════════════════════════════════
   WIDGET MAP
   ═══════════════════════════════════════════════════════════════ */

const _WIDGETS = {
  /* Airbus PFD/ND widgets */
  fma:        (ctx, box, style, cfg) => drawFMA(ctx, box, style),
  ai:         (ctx, box, style, cfg) => drawAI(ctx, box, style, cfg),
  speed_tape: (ctx, box, style, cfg) => drawSpeedTape(ctx, box, style),
  alt_tape:   (ctx, box, style, cfg) => drawAltTape(ctx, box, style),
  vsi:        (ctx, box, style, cfg) => drawVSI(ctx, box, style),
  hdg_tape:   (ctx, box, style, cfg) => drawHdgTape(ctx, box, style),
  nd_map:     (ctx, box, style, cfg) => drawNDMap(ctx, box, style, cfg),
  ecam_ewd:   (ctx, box, style, cfg) =>            // manufacturer seam: Boeing → EICAS, else Airbus ECAM
    (S.aircraft?.manufacturer === 'boeing' ? drawEICAS : drawECAM)(ctx, box, style),
  spacer:     () => {},

  /* GA cockpit widgets */
  grid:            _drawGrid,
  analog_asi:      (ctx, box) => _drawAnalogASI(ctx, box),
  analog_ai:       (ctx, box) => _drawAnalogAI(ctx, box),
  analog_alt:      (ctx, box) => _drawAnalogALT(ctx, box),
  rocker_strip:    _drawRockerStrip,
  bottom_switches: _drawBottomSwitches,
  g1000_screen:    _drawG1000Screen,
  garmin_gtn:      _drawGarminGTN,
  magneto_knob:    _drawMagnetoKnob,
  fuel_selector:   _drawFuelSelector,
  radio_stack:     _drawRadioStack,
  aircraft_tag:    _drawAircraftTag,
};

/* ═══════════════════════════════════════════════════════════════
   AIRBUS CACHE (keyed by aircraft id)
   ═══════════════════════════════════════════════════════════════ */

const _cache = {
  aircraftId: null,
  style:      null,
  specs:      {},
  loading:    false,
};

/* ═══════════════════════════════════════════════════════════════
   COCKPIT CACHE (DR-400 etc.)
   ═══════════════════════════════════════════════════════════════ */

const _cpCache = {
  aircraftId: null,
  spec:       null,
  style:      null,
  loading:    false,
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════ */

export function renderPanel(canvas, screenIdx = 0, specOverride = null) {
  const aircraft = S.aircraft;
  if (!aircraft?.displays?.length) return;

  const aid = aircraft.id;

  if (_cache.aircraftId !== aid) {
    if (!_cache.loading) {
      _cache.loading    = true;
      _cache.aircraftId = aid;
      _cache.specs      = {};
      _cache.style      = null;

      const names = [...new Set(
        aircraft.displays
          .flatMap(d => d.pages ?? [d.spec])
          .filter(Boolean)
      )];
      Promise.all([
        fetch(`panels/styles/${aircraft.panel}.json?v=${Date.now()}`).then(r => r.json()),
        ...names.map(n => fetch(`panels/${n}.json?v=${Date.now()}`).then(r => r.json())),
      ]).then(([style, ...loaded]) => {
        _cache.style = style;
        names.forEach((n, i) => { _cache.specs[n] = loaded[i]; });
        _cache.loading = false;
      }).catch(() => { _cache.loading = false; });
    }
    _blank(canvas);
    return;
  }

  if (!_cache.style) return;

  const display = aircraft.displays.find(d => d.screen === screenIdx);
  if (!display) return;

  const specName = specOverride ?? display.spec;
  const spec = _cache.specs[specName];
  if (!spec) return;

  _render(canvas, spec, _cache.style, true);   // PFD/ND screens: boost fonts when squished (outside view)
}

export function renderFCU(canvas) {
  if (!_cache.style) return;
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();
  drawFCU(ctx, W, H, _cache.style);
  ctx.restore();
}

export function renderCockpit(canvas) {
  const aircraft = S.aircraft;
  if (!aircraft?.panel) return;

  const aid = aircraft.id;

  if (_cpCache.aircraftId !== aid) {
    if (!_cpCache.loading) {
      _cpCache.loading    = true;
      _cpCache.aircraftId = aid;
      _cpCache.spec       = null;
      _cpCache.style      = null;

      const panel = aircraft.panel;
      Promise.all([
        fetch(`panels/${panel}.json?v=${Date.now()}`).then(r => r.json()),
        fetch(`panels/styles/${panel}.json?v=${Date.now()}`).then(r => r.json()).catch(() => _DEFAULT_STYLE),
      ]).then(([spec, style]) => {
        _cpCache.spec  = spec;
        _cpCache.style = style;
        _cpCache.loading = false;
      }).catch(() => { _cpCache.loading = false; });
    }
    _blank(canvas);
    return;
  }

  if (!_cpCache.spec) return;

  _hitRegions    = [];
  _currentCanvas = canvas;
  _render(canvas, _cpCache.spec, _cpCache.style ?? _DEFAULT_STYLE);
}

export function handleCockpitClick(canvas, evt) {
  const DPR  = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const x    = (evt.clientX - rect.left) * DPR;
  const y    = (evt.clientY - rect.top)  * DPR;
  for (const h of _hitRegions) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      h.action();
      return;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   INTERNAL HELPERS
   ═══════════════════════════════════════════════════════════════ */

function _blank(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  canvas.getContext('2d').fillStyle = '#020408';
  canvas.getContext('2d').fillRect(0, 0, W, H);
}

/* Run fn with every `ctx.font` px size multiplied by fk — one place to keep panel text legible
   when the display is squished (the outside view halves the height; the width stays). Intercepts
   the font setter on the instance, then restores the prototype accessor. */
const _FONT_DESC = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
function _scaledFont(ctx, fk, fn) {
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return _FONT_DESC.get.call(ctx); },
    set(v) { _FONT_DESC.set.call(ctx, String(v).replace(/(\d*\.?\d+)px/, (_, n) => (parseFloat(n) * fk) + 'px')); },
  });
  try { fn(); } finally { delete ctx.font; }
}

function _render(canvas, spec, style, squish = false) {
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');

  /* portrait-design displays squished into a short box → boost the fonts (geometry stays) */
  const fk = squish ? Math.max(1, Math.min(W, H * 1.7) / H) : 1;

  ctx.save();
  ctx.fillStyle = style.colors?.bg ?? '#0e1014';
  ctx.fillRect(0, 0, W, H);

  let rowY = 0;
  for (const row of spec.layout) {
    const rowH = row.h * H;
    let colX   = 0;
    for (const col of row.cols) {
      const colW = col.w * W;
      const box  = { x: colX, y: rowY, w: colW, h: rowH, fk };   // fk: widgets scale text-boxes to match the font
      const fn   = _WIDGETS[col.widget];
      if (fn) {
        if (fk !== 1 && col.widget === 'ecam_ewd') {
          /* The ECAM/EWD is a connected schematic (boxes + lines + labels). Don't font-boost it
             piecemeal — scale it as a whole: draw into a taller box (h·fk, a fuller aspect that
             uses the wide outside-view width), vertically centred and clipped to the real box,
             so text + boxes + lines grow together. */
          ctx.save();
          ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
          /* the schematic spans ~0.10–0.78 of its height (GENs at the top, ESS bus at the
             bottom), so cap the stretch at 1.4 to keep it all on-screen, and align its content
             centre (~0.44) on the box centre. Text + boxes + lines still grow ~1.4×. */
          const hB = box.h * Math.min(fk, 1.4);
          fn(ctx, { x: box.x, y: box.y + box.h * 0.5 - hB * 0.44, w: box.w, h: hB }, style, col.config ?? {});
          ctx.restore();
        } else if (fk !== 1 && col.widget !== 'nd_map') {   // isolated text → boost fonts; the ND scales its own
          _scaledFont(ctx, fk, () => fn(ctx, box, style, col.config ?? {}));
        } else {
          fn(ctx, box, style, col.config ?? {});
        }
      }
      colX += colW;
    }
    rowY += rowH;
  }

  ctx.restore();
}
