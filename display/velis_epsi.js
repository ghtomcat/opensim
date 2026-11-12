/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/velis_epsi.js
   Pipistrel Velis Electro HB-SYQ — its own displays, as glass widgets:
     drawVelisEfis   the round EFIS (attitude, airspeed, heading — drawn as the NESIS 4)
     drawVelisEpsi   the EPSI energy display (today's page — redrawn as the real 570C next)
     drawVelisMap    the GPS moving map, a screen of its own
   The panel's layout is panels/velis-epsi.json, as HB-SYQ's (Markus's photo,
   sources/velis-panel-notes.md); its round gauges come from the analog registry
   (display/analog_panel.js, the widget `analog`). The switches — MASTER, AVIONICS,
   BATT EN, PWR EN — are on the centre console: the pedestal view (D). The radio is the COM
   panel on the pedestal (display/com.js).

   All HTML overlays (#panel, #fma, #metar-strip, #com-container,
   #warning-lights) are hidden by index.html when this panel is active.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }               from '../core/state.js';
import { updateVelisMapOverlay, hideVelisMap } from './map.js';
import { flapLabel } from '../core/airframe.js';

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
/* ── The Velis's own displays as glass widgets — the layout is panels/velis-epsi.json (display/panel_renderer.js),
   as HB-SYQ's panel (Markus's photo, sources/velis-panel-notes.md). A widget draws into its box. ── */

/** The round EFIS (today's NESIS drawing) — centred in its box */
export function drawVelisEfis(ctx, box) {
  const r = Math.min(box.w, box.h) / 2 * 0.86;
  _drawNESIS(ctx, box.x + box.w / 2, box.y + box.h / 2, r, r / 160);
}

/** The EPSI — today's energy page, scaled to its box (its map is a screen of its own: drawVelisMap) */
export function drawVelisEpsi(ctx, box) {
  const h = box.h * 0.94, w = Math.min(box.w * 0.94, h * 0.9);
  _drawEPSI(ctx, ctx.canvas, box.x + box.w / 2, box.y + box.h / 2, w, h, h / 644);
}

/** The GPS moving map — a screen of its own (the HTML map overlay, placed in the box); dark without avionics power */
export function drawVelisMap(ctx, box) {
  const pad = Math.min(box.w, box.h) * 0.05;
  const x = box.x + pad, y = box.y + pad, w = box.w - 2 * pad, h = box.h - 2 * pad;
  ctx.save();
  _roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 8);
  ctx.fillStyle = '#05070a'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  if (_avionicsPowered()) updateVelisMapOverlay(ctx.canvas, x, y, w, h);
  else hideVelisMap();
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

  /* (the moving map is a screen of its own now — drawVelisMap) */

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

/* ════════════════════════════════════════════════════════════
   ZONE 4 BOTTOM: Backup altimeter — ft  (G1000-style dark face)
   ════════════════════════════════════════════════════════════ */
