/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/pedestal.js
   Centre pedestal — slides up from below, covers all other views.
   Shows thrust levers, flap handle, speed brake.
   Toggle: D key.  Close: D key again.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';

let _el = null;

/* ── CSS ──────────────────────────────────────────────────────── */
const _CSS = `
  #ped {
    position: fixed; inset: 0; z-index: 180;
    background: #0d0f12;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 28px;
    padding: 24px 20px 20px;
    transform: translateY(100%);
    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
  }
  #ped.ped-visible { transform: translateY(0); }

  .ped-title {
    font: 600 10px/1 monospace; letter-spacing: 0.14em;
    color: #384050; text-transform: uppercase;
    align-self: flex-start; margin-left: 8px;
  }

  /* ── Thrust lever block ── */
  .ped-tl-block {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  .ped-tl-label {
    font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c;
  }
  .ped-tl-row {
    display: flex; gap: 22px; align-items: flex-end;
  }
  .ped-lever-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
  }
  .ped-lever-eng {
    font: 700 8px/1 monospace; letter-spacing: 0.06em; color: #3a4860;
  }
  /* Lever track */
  .ped-lever-track {
    position: relative;
    width: 28px; height: 160px;
    background: #141820;
    border: 1px solid #252c3c;
    border-radius: 4px;
    overflow: visible;
  }
  /* Detent marks */
  .ped-det {
    position: absolute; left: -1px; right: -1px;
    height: 1px; background: #2a3448;
    display: flex; align-items: center;
  }
  .ped-det-lbl {
    position: absolute; right: calc(100% + 5px);
    font: 600 7px/1 monospace; letter-spacing: 0.04em;
    color: #3a4860; white-space: nowrap;
  }
  /* Active detent label — highlighted when lever is at that position */
  .ped-det.ped-det-active { background: #3a5080; }
  .ped-det.ped-det-active .ped-det-lbl { color: #8ab0d8; }
  /* Lever head */
  .ped-lever-head {
    position: absolute; left: 50%; transform: translateX(-50%);
    width: 22px; height: 16px;
    background: linear-gradient(180deg, #50606e 0%, #303844 100%);
    border: 1px solid #6070880;
    border-radius: 3px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.6);
    cursor: ns-resize;
    transition: top 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    z-index: 2;
  }
  .ped-lever-head::after {
    content: '';
    position: absolute; left: 3px; right: 3px; top: 50%;
    height: 2px; border-radius: 1px;
    background: rgba(160,190,220,0.28);
    transform: translateY(-50%);
  }
  /* N1 readout under lever */
  .ped-n1 {
    font: 700 9px/1 monospace; letter-spacing: 0.04em;
    color: #40c080; width: 36px; text-align: center;
  }

  /* ── Flap handle ── */
  .ped-flap-block {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .ped-flap-label {
    font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c;
  }
  .ped-flap-gate {
    display: flex; gap: 0; border: 1px solid #252c3c;
    border-radius: 3px; overflow: hidden;
  }
  .ped-flap-pos {
    padding: 7px 14px;
    background: #141820;
    font: 700 9px/1 monospace; letter-spacing: 0.05em;
    color: #3a4860;
    cursor: pointer;
    border-right: 1px solid #252c3c;
    transition: background 0.08s, color 0.08s;
    user-select: none;
  }
  .ped-flap-pos:last-child { border-right: none; }
  .ped-flap-pos:hover { background: #1e2534; color: #6080a8; }
  .ped-flap-pos.ped-flap-sel {
    background: #1a2a40; color: #80b0e0;
    box-shadow: inset 0 -2px 0 #4070b0;
  }

  /* ── Speed brake ── */
  .ped-spdbk-block {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .ped-spdbk-label {
    font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c;
  }
  .ped-spdbk-gate {
    display: flex; gap: 0; border: 1px solid #252c3c;
    border-radius: 3px; overflow: hidden;
  }
  .ped-spdbk-pos {
    padding: 7px 14px;
    background: #141820;
    font: 700 9px/1 monospace; letter-spacing: 0.05em;
    color: #3a4860; cursor: pointer;
    border-right: 1px solid #252c3c;
    transition: background 0.08s, color 0.08s;
    user-select: none;
  }
  .ped-spdbk-pos:last-child { border-right: none; }
  .ped-spdbk-pos:hover { background: #1e2534; color: #6080a8; }
  .ped-spdbk-pos.ped-spdbk-sel {
    background: #2a1a14; color: #e09050;
    box-shadow: inset 0 -2px 0 #b06030;
  }

  /* ── Close hint ── */
  .ped-hint {
    font: 500 9px/1 monospace; letter-spacing: 0.08em;
    color: #28303c; margin-top: 4px;
  }

  /* ── Separator ── */
  .ped-sep {
    width: 200px; height: 1px; background: #181e28;
  }
`;

/* ── Helpers ──────────────────────────────────────────────────── */

/* Return 0-1 fraction for lever position: IDLE=0, TOGA=1 */
function _leverFrac() {
  const profiles = S.aircraft?.thrustProfiles;
  if (!profiles?.length) {
    const maxSpd = S.aircraft?.envelope?.maxSpd ?? 350;
    return Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  }
  const maxSpdT = Math.max(...profiles.map(p => p.spdT));
  return maxSpdT > 0 ? Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpdT)) : 0;
}

/* Return index of nearest thrust profile to current spdT */
function _activeProfileIdx() {
  const profiles = S.aircraft?.thrustProfiles;
  if (!profiles?.length) return -1;
  let best = 0, bestD = Infinity;
  profiles.forEach((p, i) => {
    const d = Math.abs((S.spdT ?? 0) - p.spdT);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/* ── HTML builder ─────────────────────────────────────────────── */

function _buildHTML() {
  const profiles  = S.aircraft?.thrustProfiles ?? [
    { label: 'IDLE', spdT: 0 },
    { label: 'CLB',  spdT: 175 },
    { label: 'MCT',  spdT: 280 },
    { label: 'TOGA', spdT: 350 },
  ];
  const engCount  = S.aircraft?.engine?.count ?? 2;
  const flapCfgs  = S.aircraft?.flaps ?? [
    { label: '0' }, { label: '1+F' }, { label: '2' }, { label: '3' },
  ];

  /* ── Thrust levers ── */
  /* Detent positions top-to-bottom: TOGA at top (0%), IDLE at bottom (100%) */
  const detentPcts = profiles.map((_, i) => {
    const frac = i / Math.max(1, profiles.length - 1);
    return (1 - frac) * 82 + 4;   // 4% (top) … 86% (bottom), leaving head room
  }).reverse();  // reverse: TOGA first = top

  let leverCols = '';
  for (let e = 0; e < engCount; e++) {
    leverCols += `
      <div class="ped-lever-wrap">
        <div class="ped-lever-eng">${e + 1}</div>
        <div class="ped-lever-track" data-eng="${e}">
          ${profiles.map((p, i) => `
            <div class="ped-det" data-det="${i}" style="top:${detentPcts[profiles.length-1-i]}%">
              ${e === 0 ? `<span class="ped-det-lbl">${p.label}</span>` : ''}
            </div>
          `).join('')}
          <div class="ped-lever-head" id="ped-lh-${e}"></div>
        </div>
        <div class="ped-n1" id="ped-n1-${e}">—</div>
      </div>`;
  }

  /* ── Flap handle ── */
  const flapBtns = flapCfgs.map((f, i) =>
    `<div class="ped-flap-pos" data-flap="${i}">${f.label}</div>`
  ).join('');

  /* ── Speed brake ── */
  const sbPositions = ['RET', 'ARM', 'FULL'];
  const sbBtns = sbPositions.map((lbl, i) =>
    `<div class="ped-spdbk-pos" data-sb="${i}">${lbl}</div>`
  ).join('');

  return `
    <div class="ped-title">CENTRE PEDESTAL</div>

    <div class="ped-tl-block">
      <div class="ped-tl-label">THRUST</div>
      <div class="ped-tl-row">${leverCols}</div>
    </div>

    <div class="ped-sep"></div>

    <div style="display:flex;gap:36px;align-items:flex-start;">
      <div class="ped-flap-block">
        <div class="ped-flap-label">FLAPS</div>
        <div class="ped-flap-gate">${flapBtns}</div>
      </div>
      <div class="ped-spdbk-block">
        <div class="ped-spdbk-label">SPD BRK</div>
        <div class="ped-spdbk-gate">${sbBtns}</div>
      </div>
    </div>

    <div class="ped-hint">D · CLOSE</div>
  `;
}

/* ── Event handlers ────────────────────────────────────────────── */

function _attachHandlers() {
  if (!_el) return;

  /* Thrust profile detents — click any track to jump to nearest profile */
  _el.querySelectorAll('.ped-lever-track').forEach(track => {
    track.addEventListener('click', e => {
      const rect = track.getBoundingClientRect();
      const frac = 1 - (e.clientY - rect.top) / rect.height;   // 0=IDLE 1=TOGA
      const profiles = S.aircraft?.thrustProfiles ?? [
        { label: 'IDLE', spdT: 0 }, { label: 'CLB', spdT: 175 },
        { label: 'MCT', spdT: 280 }, { label: 'TOGA', spdT: 350 },
      ];
      const maxSpdT  = Math.max(...profiles.map(p => p.spdT));
      const targetSpd = frac * maxSpdT;
      /* Snap to nearest detent */
      const snapped = profiles.reduce((best, p) =>
        Math.abs(p.spdT - targetSpd) < Math.abs(best.spdT - targetSpd) ? p : best
      );
      setState({ spdT: snapped.spdT });
    });
  });

  /* Flap handle */
  _el.querySelectorAll('.ped-flap-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ flaps: +btn.dataset.flap });
    });
  });

  /* Speed brake — RET=0, ARM=1, FULL=2 */
  _el.querySelectorAll('.ped-spdbk-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ speedBrake: +btn.dataset.sb });
    });
  });
}

/* ── Live update ───────────────────────────────────────────────── */

function _update() {
  if (!_el || !_el.classList.contains('ped-visible')) return;

  const engCount   = S.aircraft?.engine?.count ?? 2;
  const frac       = _leverFrac();
  const activeIdx  = _activeProfileIdx();
  const profiles   = S.aircraft?.thrustProfiles ?? [];

  /* Lever heads: top% = (1-frac)*82+4, inverted so TOGA is near top */
  const leverPct = (1 - frac) * 82 + 4;
  for (let e = 0; e < engCount; e++) {
    const head = document.getElementById(`ped-lh-${e}`);
    if (head) head.style.top = `${leverPct}%`;
    const n1el = document.getElementById(`ped-n1-${e}`);
    if (n1el) {
      const n1 = S.N1 ?? (S.enginePower != null ? (S.aircraft?.engine?.idleN1 ?? 22) + (100 - (S.aircraft?.engine?.idleN1 ?? 22)) * S.enginePower : null);
      n1el.textContent = n1 != null ? `${n1.toFixed(1)}%` : '—';
    }
  }

  /* Detent highlights */
  _el.querySelectorAll('.ped-det').forEach(det => {
    const i = +det.dataset.det;
    det.classList.toggle('ped-det-active', i === activeIdx);
  });

  /* Flap handle */
  const curFlap = S.flaps ?? 0;
  _el.querySelectorAll('.ped-flap-pos').forEach(btn => {
    btn.classList.toggle('ped-flap-sel', +btn.dataset.flap === curFlap);
  });

  /* Speed brake */
  const curSB = S.speedBrake ?? 0;
  _el.querySelectorAll('.ped-spdbk-pos').forEach(btn => {
    btn.classList.toggle('ped-spdbk-sel', +btn.dataset.sb === curSB);
  });
}

/* ── Public API ────────────────────────────────────────────────── */

export function initPedestal() {
  document.getElementById('ped')?.remove();
  if (!document.getElementById('ped-style')) {
    const s = document.createElement('style');
    s.id = 'ped-style';
    s.textContent = _CSS;
    document.head.appendChild(s);
  }
  _el = document.createElement('div');
  _el.id = 'ped';
  document.body.appendChild(_el);
  _el.innerHTML = _buildHTML();
  _attachHandlers();
}

export function togglePedestal() {
  const next = S.cockpitView === 'pedestal' ? 'forward' : 'pedestal';
  setState({ cockpitView: next });
}

export function renderPedestal() {
  if (!_el) return;
  const visible   = S.cockpitView === 'pedestal';
  const wasVisible = _el.classList.contains('ped-visible');
  _el.classList.toggle('ped-visible', visible);
  if (visible && !wasVisible) {
    _el.innerHTML = _buildHTML();
    _attachHandlers();
  }
  if (visible) _update();
}
