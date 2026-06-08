/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/pedestal.js
   Centre pedestal — slides up from below, covers all other views.
   Shows thrust levers, flap handle, speed brake.
   Toggle: D key.  Close: D key again.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';
import { startEngineLifecycle, stopEngineLifecycle } from '../core/sound.js';

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

  /* ── Parking brake ── */
  .ped-park-block { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ped-park-label { font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c; }
  .ped-park-gate { display: flex; gap: 0; border: 1px solid #252c3c; border-radius: 3px; overflow: hidden; }
  .ped-park-pos {
    padding: 7px 16px; background: #141820;
    font: 700 9px/1 monospace; letter-spacing: 0.05em;
    color: #3a4860; cursor: pointer; border-right: 1px solid #252c3c;
    transition: background 0.08s, color 0.08s; user-select: none;
  }
  .ped-park-pos:last-child { border-right: none; }
  .ped-park-pos:hover { background: #1e2534; color: #6080a8; }
  .ped-park-pos.ped-park-sel-on  { background: #3a1414; color: #ff5a4a; box-shadow: inset 0 -2px 0 #c02020; }
  .ped-park-pos.ped-park-sel-off { background: #14241a; color: #5ad08a; box-shadow: inset 0 -2px 0 #2a8050; }

  /* ── Parking-brake annunciator (visible in any view when set) ── */
  #parkbrk-ind {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 170; display: none;
    padding: 4px 12px; border-radius: 4px;
    background: rgba(58,10,10,0.86); border: 1px solid #c02020;
    font: 700 12px/1 monospace; letter-spacing: 0.14em; color: #ff5a4a;
    box-shadow: 0 0 10px rgba(192,32,32,0.4);
  }
  #parkbrk-ind.pb-on { display: block; }

  /* ── Close hint ── */
  .ped-hint {
    font: 500 9px/1 monospace; letter-spacing: 0.08em;
    color: #28303c; margin-top: 4px;
  }

  /* ── Separator ── */
  .ped-sep {
    width: 200px; height: 1px; background: #181e28;
  }

  /* ── Engine start ── */
  .ped-eng-block {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  .ped-eng-block-label {
    font: 600 9px/1 monospace; letter-spacing: 0.12em; color: #50607c;
  }

  /* Master flip toggle switches */
  .ped-masters-row { display: flex; gap: 8px; }
  .ped-flip-wrap   { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .ped-flip-top-label {
    font: 600 7px/1 monospace; letter-spacing: 0.06em; color: #384858;
  }
  .ped-flip-track {
    width: 48px; height: 24px;
    background: #0c1016; border: 1px solid #1c2530; border-radius: 2px;
    position: relative; cursor: pointer; user-select: none;
  }
  .ped-flip-off-lbl, .ped-flip-on-lbl {
    position: absolute; top: 50%; transform: translateY(-50%);
    font: 600 6px/1 monospace; color: #283848; pointer-events: none;
  }
  .ped-flip-off-lbl { left: 3px; }
  .ped-flip-on-lbl  { right: 3px; }
  .ped-flip-lever {
    position: absolute; top: 2px; bottom: 2px; width: 20px; left: 3px;
    background: linear-gradient(160deg, #606878 0%, #404858 100%);
    border: 1px solid #5a6878; border-radius: 2px;
    display: flex; align-items: center; justify-content: center;
    transition: left 0.14s ease;
  }
  .ped-flip-track.flip-on .ped-flip-lever { left: calc(100% - 23px); }
  .ped-flip-lever-txt {
    font: 700 6px/1.2 monospace; color: #9ab0c0; text-align: center; pointer-events: none;
  }
  /* ON state — lever brighter, track lit */
  .ped-flip-track.flip-on { background: #0c1a12; border-color: #1e3a28; }
  .ped-flip-track.flip-on .ped-flip-lever {
    background: linear-gradient(160deg, #4a8060 0%, #2a5040 100%);
    border-color: #4a7060;
  }
  .ped-flip-track.flip-on .ped-flip-lever-txt { color: #80d0a0; }

  /* Rotary mode knob */
  .ped-rotary-wrap  { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .ped-rotary-area  {
    position: relative; width: 110px; height: 72px;
    display: flex; align-items: center; justify-content: center;
  }
  .ped-rotary-knob {
    width: 46px; height: 46px; border-radius: 50%;
    background: radial-gradient(circle at 34% 34%, #808898 0%, #50586a 45%, #282834 100%);
    border: 2px solid #484858;
    cursor: pointer; user-select: none;
    box-shadow: 0 3px 10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08);
    transition: transform 0.20s ease;
    position: relative; z-index: 1;
  }
  /* White indicator line, points up at 0° */
  .ped-rotary-knob::after {
    content: '';
    position: absolute; top: 5px; left: 50%;
    width: 3px; height: 13px;
    background: #d8dce0; border-radius: 1px;
    transform: translateX(-50%);
  }
  .ped-rot-lbl-crank, .ped-rot-lbl-norm, .ped-rot-lbl-ign {
    position: absolute;
    font: 700 6px/1.3 monospace; letter-spacing: 0.05em;
    color: #506878; text-align: center; pointer-events: none; white-space: nowrap;
  }
  .ped-rot-lbl-crank { bottom: 0; left: 2px; }
  .ped-rot-lbl-norm  { top: 0;    left: 50%; transform: translateX(-50%); }
  .ped-rot-lbl-ign   { bottom: 0; right: 2px; }
  .ped-rotary-sub {
    font: 600 8px/1 monospace; letter-spacing: 0.10em; color: #485868;
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

  /* ── ENG START section (turbofan only) ── */
  const turbofan = S.aircraft?.engine?.type === 'turbofan';
  const engStartSection = turbofan ? (() => {
    const flips = Array.from({ length: engCount }, (_, i) => `
      <div class="ped-flip-wrap">
        <div class="ped-flip-top-label">MASTER</div>
        <div class="ped-flip-track" id="ped-master-${i + 1}">
          <span class="ped-flip-off-lbl">OFF</span>
          <div class="ped-flip-lever">
            <span class="ped-flip-lever-txt">ENG<br>${i + 1}</span>
          </div>
          <span class="ped-flip-on-lbl">ON</span>
        </div>
      </div>`).join('');
    return `
      <div class="ped-sep"></div>
      <div class="ped-eng-block">
        <div class="ped-eng-block-label">ENGINE START</div>
        <div class="ped-masters-row">${flips}</div>
        <div class="ped-rotary-wrap">
          <div class="ped-rotary-area">
            <span class="ped-rot-lbl-crank">CRANK</span>
            <div class="ped-rotary-knob" id="ped-rotary-knob"></div>
            <span class="ped-rot-lbl-norm">NORM</span>
            <span class="ped-rot-lbl-ign">IGN<br>START</span>
          </div>
          <div class="ped-rotary-sub">ENG MODE</div>
        </div>
      </div>`;
  })() : '';

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
      <div class="ped-park-block">
        <div class="ped-park-label">PARK BRK</div>
        <div class="ped-park-gate">
          <div class="ped-park-pos" data-pb="1">ON</div>
          <div class="ped-park-pos" data-pb="0">OFF</div>
        </div>
      </div>
    </div>

    ${engStartSection}

    <div class="ped-hint">D · CLOSE</div>
  `;
}

/* ── Event handlers ────────────────────────────────────────────── */

function _attachHandlers() {
  if (!_el) return;

  /* Rotary mode knob — click cycles CRANK → NORM → IGN+START */
  const MODES = ['CRANK', 'NORM', 'IGN+START'];
  const ANGLES = { 'CRANK': -120, 'NORM': 0, 'IGN+START': 120 };
  document.getElementById('ped-rotary-knob')?.addEventListener('click', () => {
    const cur  = S.engMode ?? 'NORM';
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    setState({ engMode: next });
    const knob = document.getElementById('ped-rotary-knob');
    if (knob) knob.style.transform = `rotate(${ANGLES[next]}deg)`;
  });

  /* Engine master flip switches */
  const n = S.aircraft?.engine?.count ?? 2;
  for (let i = 1; i <= n; i++) {
    document.getElementById(`ped-master-${i}`)?.addEventListener('click', () => {
      const mode    = S.engMode ?? 'NORM';
      const masters = [...(S.engMasters ?? Array(n).fill(false))];
      const wasOn   = masters[i - 1];
      masters[i - 1] = !wasOn;
      setState({ engMasters: masters });

      if (!wasOn && mode === 'IGN+START') {
        if (!(S.acBusPowered ?? false)) {
          masters[i - 1] = false;
          setState({ engMasters: masters });
          return;
        }
        startEngineLifecycle();
      } else if (wasOn) {
        stopEngineLifecycle();
      }
    });
  }

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

  /* Parking brake — ON / OFF */
  _el.querySelectorAll('.ped-park-pos').forEach(btn => {
    btn.addEventListener('click', () => setState({ parkBrake: btn.dataset.pb === '1' }));
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

  /* Parking brake — ON red (warning), OFF green */
  const pbOn = !!S.parkBrake;
  _el.querySelectorAll('.ped-park-pos').forEach(btn => {
    const isOn = btn.dataset.pb === '1';
    btn.classList.toggle('ped-park-sel-on',  isOn && pbOn);
    btn.classList.toggle('ped-park-sel-off', !isOn && !pbOn);
  });

  /* Engine master flip switches */
  const masters  = S.engMasters ?? Array(engCount).fill(false);
  const running  = S.engineState === 'running';
  for (let i = 1; i <= engCount; i++) {
    const track = document.getElementById(`ped-master-${i}`);
    if (track) track.classList.toggle('flip-on', !!(masters[i - 1] || running));
  }
  /* Rotary knob angle */
  const ANGLES = { 'CRANK': -120, 'NORM': 0, 'IGN+START': 120 };
  const knob = document.getElementById('ped-rotary-knob');
  if (knob) knob.style.transform = `rotate(${ANGLES[S.engMode ?? 'NORM']}deg)`;
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

  /* Parking-brake annunciator — persists across all views while the brake is set */
  if (!document.getElementById('parkbrk-ind')) {
    const pb = document.createElement('div');
    pb.id = 'parkbrk-ind';
    pb.textContent = 'PARK BRK';
    document.body.appendChild(pb);
  }
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
  /* Persistent parking-brake annunciator (any view) */
  document.getElementById('parkbrk-ind')?.classList.toggle('pb-on', !!S.parkBrake);
}
