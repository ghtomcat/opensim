/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/controls-canvas.js
   The canvas looks of the controls — one drawing per kind and look, given the
   control's state (never reading the sim), sized to where the panel puts it. The
   definitions and what a click does are display/controls.js; the click areas
   display/hit.js. docs/issues.md, *Instruments, controls and mixed panels*, step 2b.

     drawToggle    a bat-handle toggle: housing, lever up = on, LED, label — the one
                   toggle design (the Velis, the DR400; the C172 pedestal's HTML twin)
     drawKey       a key switch OFF ↔ RUN — a look of the toggle kind (the Velis MASTER)
     drawRocker    a lit annunciator pad, with a red guard where the panel has one (the DR400 strip)
     drawMagneto   the magneto rotary OFF R L BOTH START
     drawSelector  the fuel selector rotary
   ═══════════════════════════════════════════════════════════════ */

const MONO = '"IBM Plex Mono", "Courier New", monospace';

/* the key's palette (the Velis's), the rotaries' (the G1000 family's) */
const KEY = { white: '#e8edf2', green: '#5dd47e', dim: 'rgba(232,237,242,0.35)' };
const R   = { white: '#e8f0f8', green: '#44dd66', amber: '#ffb74d', red: '#ff3333', dim: 'rgba(232,240,248,0.38)' };

function _rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

export function drawToggle(ctx, cx, y, w, h, on, label, fs = Math.round(Math.min(w * 0.46, h * 0.115))) {
  /* Housing (recessed dark plate) */
  const hw = w * 0.60, hh = h * 0.38;
  const hx = cx - hw / 2, hy = y + h * 0.18;
  _rr(ctx, hx, hy, hw, hh, hw * 0.14);
  ctx.fillStyle = '#0c1018'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.8; ctx.stroke();

  /* Lever — thin bat-handle: UP = ON, DOWN = OFF */
  const lw = hw * 0.30, lh = h * 0.44;
  const pvY = hy + hh * 0.50;
  const levY = on ? pvY - lh : pvY;

  _rr(ctx, cx - lw / 2, levY, lw, lh, lw * 0.30);
  ctx.fillStyle = on ? '#9eaabf' : '#2c3038'; ctx.fill();

  /* Lever highlight (left-side sheen) */
  ctx.fillStyle = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.04)';
  ctx.fillRect(cx - lw / 2 + lw * 0.14, levY + lh * 0.12, lw * 0.26, lh * 0.76);

  /* LED indicator dot below housing */
  const dotR = Math.min(hw, hh) * 0.12;
  const dotY = hy + hh + dotR * 2.0;
  ctx.beginPath(); ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#38d060' : '#101810'; ctx.fill();
  if (on) {
    ctx.beginPath(); ctx.arc(cx, dotY, dotR * 1.9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56,208,96,0.22)'; ctx.lineWidth = dotR * 0.8; ctx.stroke();
  }

  /* Label */
  ctx.fillStyle    = on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)';
  ctx.font         = `${fs}px ${MONO}`;
  ctx.textAlign    = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(label, cx, y + h);
}

export function drawKey(ctx, cx, cy, r, on, fs = Math.round(r * 0.34), label = 'MASTER') {
  const P = KEY;
  const degOFF = 225, degRUN = 315;
  const curDeg = on ? degRUN : degOFF;

  /* Outer housing plate */
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.58, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0c12'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.8; ctx.stroke();

  /* Arc guide between OFF and RUN */
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.30, (degOFF - 90) * Math.PI / 180, (degRUN - 90) * Math.PI / 180);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5; ctx.stroke();

  /* Position labels */
  [{ text: 'OFF', deg: degOFF }, { text: 'RUN', deg: degRUN }].forEach(({ text, deg }) => {
    const a = (deg - 90) * Math.PI / 180;
    ctx.fillStyle = curDeg === deg ? P.white : 'rgba(255,255,255,0.28)';
    ctx.font      = `${Math.round(r * 0.31)}px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cx + Math.cos(a) * r * 1.30, cy + Math.sin(a) * r * 1.30);
  });

  /* Knob body */
  const kg = ctx.createRadialGradient(cx - r * 0.24, cy - r * 0.24, r * 0.06, cx, cy, r);
  kg.addColorStop(0, '#2c3040');
  kg.addColorStop(1, '#141820');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = kg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();

  /* Knurling lines (grip texture) */
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
  }

  /* Key slot (rectangular notch toward current position) */
  const pAng = (curDeg - 90) * Math.PI / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pAng);
  ctx.fillStyle = '#040508';
  ctx.fillRect(-r * 0.11, r * 0.06, r * 0.22, r * 0.68);
  ctx.restore();

  /* Pointer dot */
  ctx.beginPath();
  ctx.arc(cx + Math.cos(pAng) * r * 0.74, cy + Math.sin(pAng) * r * 0.74, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = on ? P.green : 'rgba(255,255,255,0.36)';
  ctx.fill();

  /* Center cap */
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = '#b8bcc8'; ctx.fill();

  /* MASTER label below */
  ctx.fillStyle    = on ? 'rgba(255,255,255,0.55)' : P.dim;
  ctx.font         = `${fs}px ${MONO}`;
  ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(label, cx, cy + r * 1.70);
}

const ROCKER = {
  /* ON colors — face glows in this color */
  red:   { top: '#e02010', bot: '#801008', rim: '#ff4030', glow: 'rgba(220,30,10,0.35)'  },
  amber: { top: '#d07010', bot: '#784008', rim: '#ffa030', glow: 'rgba(200,110,0,0.35)'  },
  beige: { top: '#c8b870', bot: '#786830', rim: '#e8d890', glow: 'rgba(180,160,80,0.3)'  },
  green: { top: '#20b050', bot: '#0a6028', rim: '#40e070', glow: 'rgba(30,160,60,0.3)'   },
};

export function drawRocker(ctx, rx, ry, rw, rh, { on, label, color, guarded = false, guardIsOpen = false }) {
  const pal = ROCKER[color];
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
    _rr(ctx, rx, ry, rw, rh, cr);
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
    ctx.fillText(label, rx + rw / 2, ry + rh * 0.72);

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
      _rr(ctx, rx, ry, rw, rh * 0.72, cr);
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
      _rr(ctx, rx + rw * 0.15, ry - tabH + 1, rw * 0.70, tabH, 2);
      ctx.fillStyle = tg; ctx.fill();
      ctx.strokeStyle = '#e02818'; ctx.lineWidth = 0.7; ctx.stroke();
    }
}

export function drawMagneto(ctx, cx, cy, r, state) {
  const pos = { OFF: -120, R: -60, L: 0, BOTH: 60, START: 120 };

  /* outer plate */
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1016'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();

  /* position labels */
  Object.entries(pos).forEach(([p, deg]) => {
    const a  = (deg - 90) * Math.PI / 180;
    const mr = r * 1.28;
    ctx.fillStyle    = p === state ? R.white : 'rgba(255,255,255,0.30)';
    ctx.font         = `${Math.round(r * 0.30)}px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p, cx + Math.cos(a) * mr, cy + Math.sin(a) * mr);
  });

  /* knob */
  const kg = ctx.createRadialGradient(cx - r * 0.24, cy - r * 0.24, r * 0.06, cx, cy, r);
  kg.addColorStop(0, '#2c3040');
  kg.addColorStop(1, '#141820');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = kg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();

  /* knurling */
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
  }

  /* pointer */
  const pAng = ((pos[state] ?? 0) - 90) * Math.PI / 180;
  ctx.strokeStyle = state === 'OFF' ? R.red : state === 'START' ? R.amber : R.white;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(pAng) * r * 0.76, cy + Math.sin(pAng) * r * 0.76);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = R.white; ctx.fill();

  /* label */
  ctx.fillStyle = R.dim; ctx.font = `${Math.round(r * 0.30)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('MAG', cx, cy + r * 1.62);
}

export function drawSelector(ctx, x, y, w, h, sel) {
  const angles = { LEFT: -60, BOTH: 0, RIGHT: 60, OFF: 180 };

  const kR  = Math.min(w * 0.28, h * 0.28);
  const kCx = x + w / 2;
  const kCy = y + h * 0.46;

  ctx.fillStyle    = R.dim;
  ctx.font         = `${Math.round(h * 0.13)}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('FUEL SEL', kCx, y + h * 0.03);

  ctx.beginPath();
  ctx.arc(kCx, kCy, kR, 0, Math.PI * 2);
  ctx.fillStyle   = '#1a1e26';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  const pAng = (angles[sel] - 90) * Math.PI / 180;
  ctx.strokeStyle = sel === 'OFF' ? R.red : R.green;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(kCx, kCy);
  ctx.lineTo(kCx + Math.cos(pAng) * kR * 0.78, kCy + Math.sin(pAng) * kR * 0.78);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(kCx, kCy, kR * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = R.white;
  ctx.fill();

  ctx.fillStyle    = sel === 'OFF' ? R.red : R.white;
  ctx.font         = `bold ${Math.round(h * 0.15)}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sel, kCx, y + h * 0.82);

  ctx.fillStyle    = 'rgba(255,255,255,0.15)';
  ctx.font         = `${Math.round(h * 0.10)}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('[Q]', kCx, y + h * 0.98);
}
