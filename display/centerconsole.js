/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/centerconsole.js
   Centre cockpit view — the pedestal/centre instrument panel. Toggle: M.
   Data-driven: shown when the aircraft declares 'center' in its views.

   Contents (real Airbus centre panel):
     · the two ECAM screens — E/WD (upper) + SD (lower), via the canonical
       drawECAMUpper/drawECAMLower (same engine display as the forward ECAM)
     · landing-gear lever + gear indicator (nose / left / right)
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }     from '../core/state.js';
import { drawECAMUpper, drawECAMLower } from './pfd_instruments.js';
import { pushButtonHTML, setPushButton } from './pushbutton.js';
import { bbEvent }         from '../core/blackbox.js';

const _AB_LEVELS = ['LO', 'MED', 'MAX'];

let _el = null, _ecamCanvas = null;

/* Panel style (skin) — loaded per aircraft, like panel_renderer, so the centre ECAM uses the
   same colours as the forward displays. */
let _style = null, _styleKey = null;
function _ensureStyle() {
  const panel = S.aircraft?.panel;
  if (!panel || _styleKey === panel) return;
  _styleKey = panel;
  _style = null;
  fetch(`panels/styles/${panel}.json?v=${Date.now()}`).then(r => r.json()).then(s => { _style = s; })
    .catch(() => fetch(`panels/styles/airbus.json?v=${Date.now()}`).then(r => r.json()).then(s => { _style = s; }).catch(() => {}));
}

/* ── CSS ──────────────────────────────────────────────────────── */
const _CSS = `
  #ccon {
    position: fixed; inset: 0; z-index: 180;
    background: #0a0c10;
    display: flex; align-items: stretch;
    opacity: 0; pointer-events: none;
    transition: opacity 0.22s ease;
  }
  #ccon.ccon-visible { opacity: 1; pointer-events: auto; }

  /* ECAM stack — both screens on one canvas (upper E/WD + lower SD) */
  #ccon-ecam-wrap { flex: 1 1 64%; display: flex; align-items: center; justify-content: center; padding: 3vh 2vw; }
  #ccon-ecam { width: 100%; height: 100%; max-width: min(46vw, 620px);
               background: #030609; border: 1px solid #1a1e26; border-radius: 5px; }

  /* Gear panel */
  #ccon-gear { flex: 0 0 32%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px;
               border-left: 1px solid #20242a; padding: 4vh 3vw; }
  .ccon-title { font: 600 11px/1 monospace; letter-spacing: 0.16em; color: #6a7a8a; text-transform: uppercase; }

  .ccon-lever { width: 92px; height: 156px; background: #14171c; border: 1px solid #2a2f38; border-radius: 8px;
                position: relative; cursor: pointer; }
  .ccon-lever-slot { position: absolute; left: 50%; top: 16px; bottom: 16px; width: 6px; transform: translateX(-50%);
                     background: #05070a; border-radius: 3px; }
  .ccon-lever-knob { position: absolute; left: 50%; width: 48px; height: 48px; transform: translateX(-50%);
                     border-radius: 50%; background: radial-gradient(circle at 38% 34%, #444c56, #15181c);
                     border: 2px solid #545d68; top: 16px;
                     transition: top 0.32s cubic-bezier(0.4, 0, 0.2, 1); }
  .ccon-lever.down .ccon-lever-knob { top: calc(100% - 64px); }
  .ccon-lever-labels { position: absolute; right: -30px; top: 14px; bottom: 14px;
                       display: flex; flex-direction: column; justify-content: space-between;
                       font: 600 9px/1 monospace; color: #5a6470; letter-spacing: 0.06em; }

  /* Gear indicators — side by side. Each: UNLK flag (red when unlocked / in transit) over a
     green down-triangle (lit when down & locked). UNLK later ties to a gear failure status. */
  .ccon-gear-ind { display: flex; gap: 18px; }
  .ccon-gi { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ccon-gi-unlk { font: 700 10px/1 monospace; letter-spacing: 0.10em; padding: 3px 6px; border-radius: 2px;
                  color: #241010; background: #130f0d; border: 1px solid #221712; }
  .ccon-gi.transit .ccon-gi-unlk { color: #ff5a3a; background: #3a1410; border-color: #7a2a1a; }
  .ccon-gi-tri { width: 0; height: 0; border-left: 18px solid transparent; border-right: 18px solid transparent;
                 border-top: 26px solid #181d18; }
  .ccon-gi.dn .ccon-gi-tri { border-top-color: #4ad86a; }
  .ccon-gi-lbl { font: 600 9px/1 monospace; letter-spacing: 0.06em; color: #5a6470; }

  /* AUTO BRK — LO / MED / MAX pushbuttons (DECEL upper, ON lower). No OFF: press a level to
     arm it, press again to disarm. On the centre panel like the real Airbus. */
  .ccon-ab-block { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .ccon-ab-label { font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c; }
  .ccon-ab-row { display: flex; gap: 14px; }
  .ccon-ab-btn { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .ccon-ab-cap { font: 600 9px/1 monospace; letter-spacing: 0.06em; color: #5a6470; }

  .ccon-hint { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
               font: 500 10px/1 monospace; color: #3a4450; letter-spacing: 0.10em; }
`;

/* Gear indicator class from the animated position (one model → all three read alike).
   down & locked → green ▼ ; in transit → UNLK (red) ; up & locked → both off.
   Later: also UNLK on a gear failure status (stuck unlocked). */
function _gearClass() {
  const a = S.gearAnim ?? (S.gear ? 1 : 0);
  if (a >= 0.98) return 'ccon-gi dn';
  if (a <= 0.02) return 'ccon-gi';
  return 'ccon-gi transit';
}

function _buildHTML() {
  return `
    <div id="ccon-ecam-wrap"><canvas id="ccon-ecam"></canvas></div>
    <div id="ccon-gear">
      <div class="ccon-title">Landing Gear</div>
      <div class="ccon-lever" id="ccon-lever">
        <div class="ccon-lever-slot"></div>
        <div class="ccon-lever-knob"></div>
        <div class="ccon-lever-labels"><span>UP</span><span>DN</span></div>
      </div>
      <div class="ccon-gear-ind">
        <div class="ccon-gi"><div class="ccon-gi-unlk">UNLK</div><div class="ccon-gi-tri"></div><div class="ccon-gi-lbl">NOSE</div></div>
        <div class="ccon-gi"><div class="ccon-gi-unlk">UNLK</div><div class="ccon-gi-tri"></div><div class="ccon-gi-lbl">LEFT</div></div>
        <div class="ccon-gi"><div class="ccon-gi-unlk">UNLK</div><div class="ccon-gi-tri"></div><div class="ccon-gi-lbl">RIGHT</div></div>
      </div>
      <div class="ccon-ab-block">
        <div class="ccon-ab-label">AUTO BRK</div>
        <div class="ccon-ab-row">${_AB_LEVELS.map(l => `
          <div class="ccon-ab-btn">
            ${pushButtonHTML(`ab-${l.toLowerCase()}`, { upper: 'DECEL', upperColor: '#4ad86a', lowerColor: '#4ab0e0' })}
            <div class="ccon-ab-cap">${l}</div>
          </div>`).join('')}</div>
      </div>
    </div>
    <div class="ccon-hint">M · close</div>
  `;
}

/* ── Public API ────────────────────────────────────────────────── */
export function initCenterConsole() {
  document.getElementById('ccon')?.remove();
  if (!document.getElementById('ccon-style')) {
    const s = document.createElement('style');
    s.id = 'ccon-style';
    s.textContent = _CSS;
    document.head.appendChild(s);
  }
  _el = document.createElement('div');
  _el.id = 'ccon';
  _el.innerHTML = _buildHTML();
  document.body.appendChild(_el);
  _ecamCanvas = _el.querySelector('#ccon-ecam');
  /* Click the lower (SD) screen → toggle the ELEC/HYD synoptic. */
  _ecamCanvas.addEventListener('click', (e) => {
    const rect = _ecamCanvas.getBoundingClientRect();
    if ((e.clientY - rect.top) / rect.height > 0.5) {
      setState({ ecamPage: S.ecamPage === 'hyd' ? 'elec' : 'hyd' });
    }
  });

  /* AUTO BRK — press a level to arm it (ON), press the armed level again to disarm. No OFF. */
  _AB_LEVELS.forEach(lvl => {
    _el.querySelector(`#pb-ab-${lvl.toLowerCase()}`)?.addEventListener('click', () => {
      setState({ autobrake: S.autobrake === lvl ? 'OFF' : lvl });
    });
  });

  /* Gear lever → toggle gear. Squat lock: no gear-up on the ground (matches the G key). */
  _el.querySelector('#ccon-lever').addEventListener('click', () => {
    if (S.aircraft?.fixedGear) return;
    const next = !S.gear;
    if (next || !S.wow) {
      setState({ prevGear: S.gear, gear: next });
      bbEvent({ type: 'gear', gear: next ? 'down' : 'up' });
    }
  });
}

export function toggleCenter() {
  if (!S.aircraft?.views?.includes('center')) return;   // aircraft declares no centre view
  setState({ cockpitView: S.cockpitView === 'center' ? 'forward' : 'center' });
}

export function renderCenterConsole() {
  if (!_el) return;
  const visible = S.cockpitView === 'center';
  _el.classList.toggle('ccon-visible', visible);
  if (!visible) return;

  /* Both ECAM screens via the canonical renderer (same engine display as the forward ECAM):
     upper E/WD (engines + warnings + memo), lower SD (elec/hyd synoptic). */
  _ensureStyle();
  if (_ecamCanvas && _style) {
    const DPR = devicePixelRatio || 1;
    const W = _ecamCanvas.width  = _ecamCanvas.offsetWidth  * DPR;
    const H = _ecamCanvas.height = _ecamCanvas.offsetHeight * DPR;
    const ctx = _ecamCanvas.getContext('2d');
    ctx.fillStyle = '#030609'; ctx.fillRect(0, 0, W, H);
    const half = Math.round(H / 2);
    drawECAMUpper(ctx, { x: 0, y: 0,    w: W, h: half     }, _style);
    drawECAMLower(ctx, { x: 0, y: half, w: W, h: H - half }, _style);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, half); ctx.lineTo(W, half); ctx.stroke();
  }

  const lever = _el.querySelector('#ccon-lever');
  lever.classList.toggle('down', !!S.gear);
  const cls = _gearClass();
  _el.querySelectorAll('.ccon-gi').forEach(gi => { gi.className = cls; });

  /* AUTO BRK — ON (lower) lit on the armed level; DECEL (upper) lit when it's actually braking.
     Hidden for aircraft without autobrake. */
  const abBlock = _el.querySelector('.ccon-ab-block');
  if (abBlock) abBlock.style.display = S.aircraft?.autobrake ? '' : 'none';
  const curAB = S.autobrake ?? 'OFF';
  const abEng = !!S.autobrakeActive;
  _AB_LEVELS.forEach(lvl => {
    setPushButton(`ab-${lvl.toLowerCase()}`, { lower: curAB === lvl, upper: abEng && curAB === lvl });
  });
}
