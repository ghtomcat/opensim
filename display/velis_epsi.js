/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/velis_epsi.js
   Pipistrel Velis Electro HB-SYQ — its own displays, as glass widgets:
     drawVelisEfis   the round EFIS (attitude, airspeed, heading — drawn as the NESIS 4)
     drawVelisEpsi   the EPSI 570C's FLIGHT page (its values core/epsi.js's — stand-ins marked there)
     drawVelisMap    the GPS moving map, a screen of its own
   The panel's layout is panels/velis-epsi.json, as HB-SYQ's (Markus's photo,
   sources/velis-panel-notes.md); its round gauges come from the analog registry
   (display/analog_panel.js, the widget `analog`). The switches — MASTER, AVIONICS,
   BATT EN, PWR EN — are on the centre console: the pedestal view (D). The radio is the COM
   panel on the pedestal (display/com.js).

   All HTML overlays (#panel, #fma, #metar-strip, #com-container,
   #warning-lights) are hidden by index.html when this panel is active.
   ═══════════════════════════════════════════════════════════════ */

import { S }                         from '../core/state.js';
import { updateVelisMapOverlay, hideVelisMap } from './map.js';
import { epsiValues } from '../core/epsi.js';

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

/** The EPSI 570C — its FLIGHT page, in its box (the map is a screen of its own: drawVelisMap) */
export function drawVelisEpsi(ctx, box) {
  const w = Math.min(box.w * 0.94, box.h * 0.94 * 1.45), h = w / 1.45;   // a landscape screen, 1.45 : 1
  _drawEPSI(ctx, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
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
/* ── The EPSI 570C's FLIGHT page, as on Markus's photo of HB-SYQ: the tabs FLIGHT / SYSTEM; TACHOMETER (an arc), the two
   flight batteries F / R (bars, the reserve marked), POWER (an arc); hh:mm; four temperatures (motor, controller, battery F,
   battery R); AUX BATTERY (V) and HOBBS. The values are core/epsi.js's — its stand-ins marked there. ── */
function _drawEPSI(ctx, x0, y0, w, h) {
  const v = epsiValues(), u = Math.min(w / 1.45, h);   // one unit: the page's height in a 1.45 : 1 screen
  const G = '#5dd47e', Y = '#d8c040', R = '#d04030', W = '#e8edf2', D = 'rgba(232,237,242,0.45)';
  ctx.save();
  _roundRect(ctx, x0, y0, w, h, u * 0.03); ctx.fillStyle = '#05070a'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.clip();
  if (!_avionicsPowered()) {                                           // dark without avionics power
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.font = `${u * 0.05}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AVIONICS OFF', x0 + w / 2, y0 + h / 2); ctx.restore(); return;
  }
  const txt = (s, x, y, size, col = W, bold = false, align = 'center') => {
    ctx.fillStyle = col; ctx.font = `${bold ? 'bold ' : ''}${u * size}px ${SANS}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
  };
  /* the tabs */
  const tx = x0 + w * 0.5, ty = y0 + h * 0.055;
  ctx.strokeStyle = W; ctx.lineWidth = u * 0.006;
  ctx.beginPath(); ctx.moveTo(tx - w * 0.2, ty - h * 0.04); ctx.lineTo(tx - w * 0.18, ty + h * 0.035); ctx.lineTo(tx - w * 0.02, ty + h * 0.035); ctx.lineTo(tx, ty - h * 0.04); ctx.stroke();
  txt('FLIGHT', tx - w * 0.1, ty, 0.045, W, true); txt('SYSTEM', tx + w * 0.1, ty, 0.045, 'rgba(232,237,242,0.18)', true);
  /* an arc gauge: green, then yellow, then red; a triangle at the value; the number and its unit in the middle */
  const arc = (cx, cy, rr, frac, bands, value, unit, name) => {
    const a0 = 220, sw = 250, ang = f => (a0 + f * sw - 90) * Math.PI / 180;
    ctx.lineWidth = u * 0.035; ctx.lineCap = 'butt';
    for (const [f0, f1, col] of bands) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, rr, ang(f0), ang(f1)); ctx.stroke(); }
    const a = ang(Math.max(0, Math.min(1, frac))), c = Math.cos(a), s = Math.sin(a);
    ctx.fillStyle = W; ctx.beginPath();
    ctx.moveTo(cx + c * (rr - u * 0.03), cy + s * (rr - u * 0.03));
    ctx.lineTo(cx + c * (rr - u * 0.085) - s * u * 0.025, cy + s * (rr - u * 0.085) + c * u * 0.025);
    ctx.lineTo(cx + c * (rr - u * 0.085) + s * u * 0.025, cy + s * (rr - u * 0.085) - c * u * 0.025); ctx.fill();
    txt(String(Math.round(value)), cx, cy - u * 0.01, 0.1, W, true);
    txt(unit, cx, cy + u * 0.075, 0.04, W, true);
    txt(name, cx, cy + rr * 0.95, 0.042, D);
  };
  const ay = y0 + h * 0.33, ar = u * 0.19;
  arc(x0 + w * 0.19, ay, ar, v.rpm / v.maxRpm, [[0, 0.88, G], [0.88, 0.96, Y], [0.96, 1, R]], v.rpm, 'RPM', 'TACHOMETER');
  const kwTop = v.maxKw * 1.08;
  arc(x0 + w * 0.81, ay, ar, v.kw / kwTop, [[0, v.contKw / kwTop, G], [v.contKw / kwTop, v.maxKw / kwTop, Y], [v.maxKw / kwTop, 1, R]], v.kw, 'KW', 'POWER');
  /* the two flight batteries */
  const bw = w * 0.07, bh = h * 0.30, by = y0 + h * 0.16;
  [['F', v.batF, x0 + w * 0.445], ['R', v.batR, x0 + w * 0.555]].forEach(([n, pct, bx]) => {
    const col = pct > v.reserve ? G : pct > 10 ? Y : R;
    txt(`${Math.round(pct)}%`, bx, by - h * 0.035, 0.05, W, true);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx - bw / 2, by, bw, bh);
    ctx.fillStyle = col; ctx.fillRect(bx - bw / 2, by + bh * (1 - pct / 100), bw, bh * pct / 100);
    txt(n, bx, by + bh * 0.45, 0.06, 'rgba(255,255,255,0.75)', true);
    ctx.strokeStyle = W; ctx.lineWidth = u * 0.006;                    // the reserve mark beside the bar
    const ry = by + bh * (1 - v.reserve / 100);
    ctx.beginPath(); ctx.moveTo(bx - bw / 2 - u * 0.03, ry); ctx.lineTo(bx - bw / 2 - u * 0.01, ry); ctx.moveTo(bx + bw / 2 + u * 0.01, ry); ctx.lineTo(bx + bw / 2 + u * 0.03, ry); ctx.stroke();
  });
  const hh = Math.floor(v.endurance), mm = Math.floor((v.endurance - hh) * 60);
  txt(`${String(hh).padStart(2, '0')} : ${String(mm).padStart(2, '0')}`, x0 + w * 0.5, y0 + h * 0.54, 0.065, W, true);
  txt('hh', x0 + w * 0.465, y0 + h * 0.59, 0.03, D); txt('mm', x0 + w * 0.535, y0 + h * 0.59, 0.03, D);
  /* the lower row: the temperatures; the aux battery and the hobbs */
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  _roundRect(ctx, x0 + w * 0.02, y0 + h * 0.63, w * 0.33, h * 0.34, u * 0.02); ctx.stroke();
  _roundRect(ctx, x0 + w * 0.37, y0 + h * 0.63, w * 0.25, h * 0.34, u * 0.02); ctx.stroke();
  _roundRect(ctx, x0 + w * 0.64, y0 + h * 0.63, w * 0.34, h * 0.34, u * 0.02); ctx.stroke();
  const tw = w * 0.035, tb = y0 + h * 0.90, tH = h * 0.18;
  v.temps.forEach((t, i) => {
    const cx = x0 + w * (0.07 + i * 0.075);
    txt(String(Math.round(t.c)), cx, y0 + h * 0.68, 0.05, W, true);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(cx - tw / 2, tb - tH, tw, tH);
    const f = Math.max(0, Math.min(1, t.c / 80));                      // a bar scale to 80 °C — to confirm
    ctx.fillStyle = G; ctx.fillRect(cx - tw / 2, tb - tH * f, tw, tH * f);
    txt(t.what === 'motor' ? 'MOT' : t.what === 'controller' ? 'CTL' : t.what, cx, tb + h * 0.035, 0.03, D);
  });
  txt('°C', x0 + w * 0.335, y0 + h * 0.68, 0.035, W);
  txt(`${v.auxV.toFixed(1)} V`, x0 + w * 0.495, y0 + h * 0.71, 0.06, W, true);
  txt('AUX BATTERY', x0 + w * 0.495, y0 + h * 0.77, 0.028, D);
  const hmin = Math.round(v.hobbs * 60), hb = Math.floor(hmin / 60), hm = hmin % 60;   // whole minutes — 210:32, not 210:31
  txt(`${hb} : ${String(hm).padStart(2, '0')}`, x0 + w * 0.495, y0 + h * 0.86, 0.05, W, true);
  txt('HOBBS', x0 + w * 0.495, y0 + h * 0.92, 0.028, D);
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   ZONE 4 TOP: Backup ASI — 0–140 kt  (G1000-style dark face)
   ════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   ZONE 4 BOTTOM: Backup altimeter — ft  (G1000-style dark face)
   ════════════════════════════════════════════════════════════ */
