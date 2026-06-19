/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/rightconsole.js
   Right cockpit console — slides in from the right. Toggle: R key.
   Data-driven from aircraft.right = [tokens]. First user: Bf 109.
     radio     — surfaces the complete comm panel module (#com-container,
                 FuG 16 frequencies + FuG 25a IFF transponder)
     oxygen    — Sauerstoffanlage  → decorative (pressure + flow blinker)
     breakers  — Sicherungskasten  → decorative
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';

let _el = null;

/* ── CSS ──────────────────────────────────────────────────────── */
const _CSS = `
  #rcon {
    position: fixed; right: 0; top: 0; bottom: 0; width: min(38vw, 500px); z-index: 180;
    background: #14161a; border-left: 1px solid #20242a;
    display: flex; flex-direction: column;
    align-items: center; justify-content: flex-end;   /* content low — clear of the top-right minimap */
    gap: 22px; padding: 28px 30px 44px;
    transform: translateX(100%);
    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #rcon.rcon-visible { transform: translateX(0); }
  /* Wide variant — airliner/transport FO station covers the full screen */
  #rcon.rcon-wide { width: 100vw; align-items: flex-start; justify-content: center; padding: 24px 48px; }

  .rc-title { font: 600 10px/1 monospace; letter-spacing: 0.14em; color: #44504a; text-transform: uppercase; }
  .rc-row   { display: flex; gap: 28px; align-items: flex-start; }
  .rc-ctrl  { display: flex; flex-direction: column; align-items: center; gap: 11px; }
  .rc-label { font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #6a7a66; }
  .rc-val   { font: 700 10px/1 monospace; letter-spacing: 0.04em; color: #9ab088; min-height: 11px; }
  .rc-hint  { font: 500 9px/1 monospace; letter-spacing: 0.08em; color: #28302a; margin-top: 4px; }

  /* The complete comm panel module docks into the left of the console (above the overlay).
     !important everywhere — beats any inline left/bottom left over from a pedestal aircraft. */
  body.rightconsole-active #com-container {
    display: block !important; z-index: 185 !important;
    right: 5vw !important; left: auto !important;
    top: 58% !important; bottom: auto !important; transform: translateY(-50%) !important;
  }

  /* ── Sauerstoff (oxygen) — pressure gauge + flow blinker, decorative ── */
  .rc-oxy { display: flex; align-items: center; gap: 14px; }
  .rc-oxy-gauge {
    position: relative; width: 50px; height: 50px; border-radius: 50%;
    background: radial-gradient(circle at 40% 38%, #20241e 0%, #0e100c 75%);
    border: 2px solid #3a4234;
  }
  .rc-oxy-needle {
    position: absolute; left: 50%; bottom: 50%; width: 2px; height: 19px;
    background: #aebf9e; transform-origin: bottom center;
    transform: translateX(-50%) rotate(125deg);   /* ~full bottle */
  }
  .rc-oxy-blink {
    width: 13px; height: 13px; border-radius: 3px;
    background: #1a2016; border: 1px solid #3a4234;
    animation: rc-oxy-breathe 4.2s ease-in-out infinite;
  }
  @keyframes rc-oxy-breathe {
    0%, 100% { background: #1a2016; }
    50%      { background: #cfe0c0; }
  }

  /* ── Sicherungen (breakers) — decorative grid ── */
  .rc-brk-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; }
  .rc-brk-grid i {
    width: 9px; height: 9px; border-radius: 50%;
    background: radial-gradient(circle at 36% 34%, #2c322a 0%, #16180f 70%);
    border: 1px solid #3a4234; display: block;
  }
`;

/* ── Build ─────────────────────────────────────────────────────── */
function _buildHTML() {
  const tokens = S.aircraft?.right ?? [];
  const has = (t) => tokens.includes(t);
  /* Cockpit language — liquid-cooled = Bf 109 (German), else American/English (proxy) */
  const _de = S.aircraft?.coolingSystem === 'liquid';

  /* radio token has no inline DOM — it surfaces the shared #com-container (see render) */
  const oxygen = has('oxygen') ? `
        <div class="rc-ctrl">
          <div class="rc-label">${_de ? 'SAUERSTOFF' : 'OXYGEN'}</div>
          <div class="rc-oxy">
            <div class="rc-oxy-gauge"><div class="rc-oxy-needle"></div></div>
            <div class="rc-oxy-blink"></div>
          </div>
          <div class="rc-val">${_de ? '150 atü' : '400 psi'}</div>
        </div>` : '';
  const breakers = has('breakers') ? `
        <div class="rc-ctrl">
          <div class="rc-label">${_de ? 'SICHERUNGEN' : 'CIRCUIT BREAKERS'}</div>
          <div class="rc-brk-grid">${Array.from({ length: 15 }, () => '<i></i>').join('')}</div>
        </div>` : '';

  return `
    <div class="rc-title">${_de ? 'Rechte Konsole' : 'Right Console'}</div>
    <div class="rc-row">${oxygen}${breakers}</div>
    <div class="rc-hint">R · ${_de ? 'schliessen' : 'close'}</div>
  `;
}

/* ── Public API ────────────────────────────────────────────────── */
export function initRightConsole() {
  document.getElementById('rcon')?.remove();
  if (!document.getElementById('rcon-style')) {
    const s = document.createElement('style');
    s.id = 'rcon-style';
    s.textContent = _CSS;
    document.head.appendChild(s);
  }
  _el = document.createElement('div');
  _el.id = 'rcon';
  document.body.appendChild(_el);
  _el.innerHTML = _buildHTML();
}

export function toggleRightConsole() {
  if (!S.aircraft?.views?.includes('right')) return;   // aircraft declares no right console
  setState({ cockpitView: S.cockpitView === 'right' ? 'forward' : 'right' });
}

export function renderRightConsole() {
  if (!_el) return;
  const visible    = S.cockpitView === 'right';
  const wasVisible = _el.classList.contains('rcon-visible');
  /* Airliners/transports get the full-screen FO station; fighters a narrow side console */
  _el.classList.toggle('rcon-wide', !!S.aircraft?.views?.includes('overhead'));
  _el.classList.toggle('rcon-visible', visible);
  if (visible && !wasVisible) _el.innerHTML = _buildHTML();

  /* Dock the complete comm panel module when this console carries the radio */
  const hasRadio = (S.aircraft?.right ?? []).includes('radio');
  document.body.classList.toggle('rightconsole-active', visible && hasRadio);
}
