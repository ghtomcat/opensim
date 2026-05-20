/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/overhead.js
   Overhead panel — slides in from above, covers all other views.
   Toggle: O key. Close: O key again.

   Section order (top of panel → closest to pilot):
     ELECTRICAL  BAT 1 / BAT 2 / EXT PWR
     APU         MASTER / BLEED
     FUEL        X FEED / pumps per engine
     ENG START   mode rotary + engine masters
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }                             from '../core/state.js';
import { startEngineLifecycle, stopEngineLifecycle, startApuSound, stopApuSound } from '../core/sound.js';
import { apuMasterSet, apuStartPress, apuFirePull } from '../core/electrical.js';

/* ── DOM node ─────────────────────────────────────────────────── */
let _el = null;

/* ── CSS ──────────────────────────────────────────────────────── */
const _CSS = `
  #ohp {
    position: fixed; inset: 0; z-index: 180;
    background: #0f1014;
    display: flex; flex-direction: column;
    align-items: center; justify-content: flex-end;
    gap: 0;
    padding: 12px 16px 16px;
    transform: translateY(-100%);
    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
    perspective: 800px;
  }
  #ohp.ohp-visible { transform: translateY(0); }

  /* Pushbutton cell */
  .ohp-pb {
    display: flex; flex-direction: column;
    align-items: center; gap: 5px;
    cursor: pointer; user-select: none;
  }
  .ohp-pb-body {
    width: 52px; height: 40px;
    background: #1c2030;
    border: 1px solid #303548;
    border-radius: 3px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px;
    position: relative;
    transition: background 0.08s, border-color 0.08s;
  }
  .ohp-pb:hover .ohp-pb-body   { background: #22273a; border-color: #404868; }
  .ohp-pb:active .ohp-pb-body  { background: #283050; }
  .ohp-pb-body.ohp-pb-on       { background: #182828; border-color: #304840; }
  .ohp-pb-body.ohp-pb-disabled { opacity: 0.35; cursor: not-allowed; }

  /* LED */
  .ohp-pb-led {
    width: 7px; height: 7px; border-radius: 50%;
    background: #1a281a;
    transition: background 0.15s, box-shadow 0.15s;
  }
  .ohp-pb-led.on    { background: #00c840; box-shadow: 0 0 5px #00c840; }
  .ohp-pb-led.amber { background: #d09000; box-shadow: 0 0 5px #d09000; }
  .ohp-pb-led.blue  { background: #40a0ff; box-shadow: 0 0 5px #40a0ff; }

  .ohp-pb-legend {
    font: 700 8px/1 monospace; letter-spacing: 0.06em;
    color: #b0bcd0; text-align: center;
  }
  .ohp-pb-sub {
    font: 500 7px/1 monospace; letter-spacing: 0.04em;
    color: #5868a0; text-align: center;
  }
  .ohp-pb-label {
    font: 500 9px/1 monospace; letter-spacing: 0.08em;
    color: #60708c;
  }

  /* APU FIRE section */
  .ohp-fire-group {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  .ohp-fire-wrap {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 0;
  }
  .ohp-fire-btn {
    width: 52px; height: 40px;
    background: #5a0808;
    border: 2px solid #c02020;
    border-radius: 3px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 3px;
    cursor: pointer; user-select: none;
    transition: background 0.1s;
  }
  .ohp-fire-btn:hover { background: #6e0e0e; }
  .ohp-fire-btn.armed { background: #8a0000; border-color: #ff4040;
                         box-shadow: 0 0 8px rgba(255,60,60,0.5); }
  .ohp-fire-led {
    width: 8px; height: 8px; border-radius: 50%;
    background: #3a1010;
    transition: background 0.15s, box-shadow 0.15s;
  }
  .ohp-fire-led.on { background: #ff3030; box-shadow: 0 0 6px #ff3030; }
  .ohp-fire-legend {
    font: 700 8px/1 monospace; letter-spacing: 0.06em; color: #e08080;
  }
  .ohp-fire-label {
    font: 500 9px/1 monospace; letter-spacing: 0.08em; color: #904040;
  }
  /* Guard cover that lifts */
  .ohp-guard-cover {
    position: absolute; inset: -3px; z-index: 2;
    background: #7a1212;
    border: 1px solid #b03030;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: transform 0.22s ease, opacity 0.22s;
    transform-origin: top center;
  }
  .ohp-guard-cover span {
    font: 700 7px/1 monospace; letter-spacing: 0.08em; color: #f09090;
  }
  .ohp-guard-cover.lifted {
    transform: perspective(120px) rotateX(-75deg);
    opacity: 0.30; pointer-events: none;
  }
  /* Small TEST button */
  .ohp-test-btn {
    width: 28px; height: 14px;
    background: #1c2030; border: 1px solid #303548; border-radius: 2px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; user-select: none; margin-top: 2px;
    font: 700 6px/1 monospace; letter-spacing: 0.06em; color: #708090;
    transition: background 0.08s;
  }
  .ohp-test-btn:active { background: #283050; color: #c0d0e0; }

  /* Rotary mode selector */
  .ohp-rotary { display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .ohp-rot-row { display: flex; gap: 2px; }
  .ohp-rot-opt {
    padding: 5px 8px;
    background: #1c2030; border: 1px solid #303548;
    border-radius: 2px;
    color: #50607c; font: 600 8px/1.2 monospace; letter-spacing: 0.05em;
    cursor: pointer; text-align: center;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    white-space: nowrap;
  }
  .ohp-rot-opt:hover  { background: #22283a; color: #7080a0; }
  .ohp-rot-opt.active { background: #1a2848; border-color: #3a5898; color: #80a8e0; }
  .ohp-rot-label {
    font: 500 9px/1 monospace; letter-spacing: 0.1em; color: #60708c;
  }

  /* Section container */
  .ohp-section {
    width: 100%; max-width: 700px;
    border: 1px solid #222638;
    border-radius: 4px;
    padding: 10px 14px 12px;
    background: #12141a;
    margin-bottom: 8px;
  }
  .ohp-section-hdr {
    font: 500 9px/1 monospace; letter-spacing: 0.14em; color: #40506c;
    display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  }
  .ohp-section-hdr::before, .ohp-section-hdr::after {
    content: ''; flex: 1; height: 1px; background: #222638;
  }
  .ohp-row {
    display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
  }
  .ohp-divider {
    width: 1px; align-self: stretch; background: #222638; margin: 0 4px;
  }

  /* Charge bar under battery button */
  .ohp-charge-bar {
    width: 52px; height: 3px; background: #1c2030;
    border-radius: 2px; overflow: hidden; margin-top: -2px;
  }
  .ohp-charge-fill {
    height: 100%; border-radius: 2px;
    background: #00c840;
    transition: width 1s linear, background 0.4s;
  }

  /* 7-segment voltage readout */
  .ohp-volt-disp {
    width: 52px; height: 15px;
    background: #060b04;
    border: 1px solid #182418;
    border-radius: 2px;
    display: flex; align-items: center; justify-content: center;
    font: 700 9px/1 'Courier New', monospace;
    letter-spacing: 0.04em;
    color: #7ac840;
    margin-top: 2px;
    text-shadow: 0 0 4px #4a9020;
  }
  .ohp-volt-disp.low   { color: #d09000; text-shadow: 0 0 4px #906000; }
  .ohp-volt-disp.crit  { color: #c83030; text-shadow: 0 0 4px #801818; }

  /* Panel title + hint */
  .ohp-panel-title {
    width: 100%; max-width: 700px;
    font: 500 9px/1 monospace; letter-spacing: 0.16em; color: #303848;
    text-align: center; padding: 8px 0 4px;
    margin-bottom: auto;
  }
  .ohp-hint {
    width: 100%; max-width: 700px;
    font: 500 9px/1 monospace; letter-spacing: 0.12em; color: #283040;
    text-align: center; padding-top: 10px;
  }
`;

/* ── Helpers ──────────────────────────────────────────────────── */
function _pb(id, legend, sub = '') {
  return `<div class="ohp-pb" id="${id}" tabindex="-1">
    <div class="ohp-pb-body" id="${id}-body">
      <div class="ohp-pb-led" id="${id}-led"></div>
      <div class="ohp-pb-legend">${legend}</div>
      ${sub !== '' ? `<div class="ohp-pb-sub" id="${id}-sub">${sub}</div>` : `<div class="ohp-pb-sub" id="${id}-sub"></div>`}
    </div>
    <div class="ohp-pb-label">${legend.replace('<br>', ' ')}</div>
  </div>`;
}

function _batPb(id, legend) {
  return `<div class="ohp-pb" id="${id}" tabindex="-1">
    <div class="ohp-pb-body" id="${id}-body">
      <div class="ohp-pb-led" id="${id}-led"></div>
      <div class="ohp-pb-legend">${legend}</div>
      <div class="ohp-pb-sub" id="${id}-sub">100%</div>
    </div>
    <div class="ohp-pb-label">${legend}</div>
    <div class="ohp-charge-bar">
      <div class="ohp-charge-fill" id="${id}-fill" style="width:100%"></div>
    </div>
    <div class="ohp-volt-disp" id="${id}-volt">28.5V</div>
  </div>`;
}

function _batVoltage(charge, charging) {
  /* NiCd 24V battery: 20.0V flat-dead → 28.5V full charge */
  const v = 20.0 + (charge / 100) * 8.5;
  /* Slight bump when actively charging */
  return Math.min(28.5, charging ? v + 0.2 : v).toFixed(1);
}

function _engCount() { return S.aircraft?.engine?.count ?? 2; }
function _isTurbofan() { return S.aircraft?.engine?.type === 'turbofan'; }

/* ── Build inner HTML ─────────────────────────────────────────── */
function _buildHTML() {
  const n = _engCount();
  const turbofan = _isTurbofan();

  /* Electrical section — turbofan only */
  const elecSection = turbofan ? `<div class="ohp-section">
    <div class="ohp-section-hdr">ELECTRICAL</div>
    <div class="ohp-row">
      ${_batPb('ohp-bat1', 'BAT 1')}
      ${_batPb('ohp-bat2', 'BAT 2')}
      <div class="ohp-divider"></div>
      ${_pb('ohp-ext-pwr', 'EXT<br>PWR', '')}
    </div>
  </div>` : '';

  /* Engine mode rotary */
  const modeRotary = `<div class="ohp-rotary">
    <div class="ohp-rot-row" id="ohp-eng-mode">
      <button class="ohp-rot-opt" data-val="CRANK">CRANK</button>
      <button class="ohp-rot-opt active" data-val="NORM">NORM</button>
      <button class="ohp-rot-opt" data-val="IGN+START">IGN<br>START</button>
    </div>
    <div class="ohp-rot-label">ENG MODE</div>
  </div>`;

  /* Engine master switches */
  const engMasters = Array.from({ length: n }, (_, i) =>
    _pb(`ohp-eng-${i + 1}`, `ENG ${i + 1}`, 'MASTER')
  ).join('');

  /* APU section */
  const apuSection = `<div class="ohp-section">
    <div class="ohp-section-hdr">APU</div>
    <div class="ohp-row" style="align-items:flex-start; gap:10px;">
      ${_pb('ohp-apu-master', 'MASTER', 'APU')}
      ${_pb('ohp-apu-start',  'START',  'APU')}
      ${_pb('ohp-apu-bleed',  'BLEED',  'APU')}
      <div class="ohp-divider"></div>
      <div class="ohp-fire-group">
        <div class="ohp-fire-wrap">
          <div class="ohp-fire-btn" id="ohp-apu-fire">
            <div class="ohp-fire-led" id="ohp-apu-fire-led"></div>
            <div class="ohp-fire-legend">FIRE</div>
          </div>
          <div class="ohp-guard-cover" id="ohp-apu-fire-guard"><span>GUARD</span></div>
        </div>
        <div class="ohp-fire-label">APU FIRE</div>
        <div class="ohp-test-btn" id="ohp-apu-fire-test">TEST</div>
      </div>
    </div>
  </div>`;

  /* Fuel section */
  const fuelPumps = Array.from({ length: n }, (_, i) =>
    _pb(`ohp-fuel-${i + 1}`, `PMP ${i + 1}`, 'FUEL')
  ).join('');
  const fuelSection = `<div class="ohp-section">
    <div class="ohp-section-hdr">FUEL</div>
    <div class="ohp-row">
      ${_pb('ohp-xfeed', 'X FEED', '')}
      <div class="ohp-divider"></div>
      ${fuelPumps}
    </div>
  </div>`;

  /* Hydraulics section — turbofan only */
  const hydSection = turbofan ? `<div class="ohp-section">
    <div class="ohp-section-hdr">HYDRAULICS</div>
    <div class="ohp-row">
      ${_pb('ohp-hyd-green-elec',  'ELEC', 'GREEN')}
      ${_pb('ohp-hyd-blue-elec',   'ELEC', 'BLUE')}
      ${_pb('ohp-hyd-yellow-elec', 'ELEC', 'YELLOW')}
    </div>
  </div>` : '';

  /* Engine start section */
  const engSection = `<div class="ohp-section">
    <div class="ohp-section-hdr">ENGINE START</div>
    <div class="ohp-row">
      ${modeRotary}
      <div class="ohp-divider"></div>
      ${engMasters}
    </div>
  </div>`;

  return `
    <div class="ohp-panel-title">OVERHEAD PANEL</div>
    ${elecSection}
    ${apuSection}
    ${hydSection}
    ${fuelSection}
    ${engSection}
    <div class="ohp-hint">O · RETURN TO INSTRUMENTS</div>
  `;
}

/* ── Handlers ─────────────────────────────────────────────────── */
function _attachHandlers() {
  const n = _engCount();
  const turbofan = _isTurbofan();

  /* Engine mode rotary */
  document.querySelectorAll('#ohp-eng-mode .ohp-rot-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ohp-eng-mode .ohp-rot-opt')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setState({ engMode: btn.dataset.val });
    });
  });

  /* Engine master switches */
  for (let i = 1; i <= n; i++) {
    const pb = document.getElementById(`ohp-eng-${i}`);
    if (!pb) continue;
    pb.addEventListener('click', () => {
      const mode    = S.engMode ?? 'NORM';
      const masters = [...(S.engMasters ?? Array(n).fill(false))];
      const wasOn   = masters[i - 1];
      masters[i - 1] = !wasOn;
      setState({ engMasters: masters });

      if (!wasOn && mode === 'IGN+START') {
        /* Engine start requires AC bus (APU or ext power must be on first) */
        if (turbofan && !(S.acBusPowered ?? false)) {
          masters[i - 1] = false;
          setState({ engMasters: masters });
          return;
        }
        startEngineLifecycle();
      } else if (wasOn) {
        stopEngineLifecycle();
      }
      _updateSwitches();
    });
  }

  /* APU MASTER — latching switch */
  document.getElementById('ohp-apu-master')?.addEventListener('click', () => {
    const wasOn = S.apuMasterOn ?? false;
    apuMasterSet(!wasOn);
    if (wasOn) stopApuSound();   // master off = shutdown
    _updateSwitches();
  });

  /* APU START — momentary, triggers startup + sound */
  document.getElementById('ohp-apu-start')?.addEventListener('click', () => {
    const wasOff = (S.apuState ?? 'off') === 'off';
    apuStartPress();
    if (wasOff && (S.apuState ?? 'off') === 'starting') startApuSound();
    _updateSwitches();
  });

  /* APU BLEED — only when APU running */
  document.getElementById('ohp-apu-bleed')?.addEventListener('click', () => {
    if (turbofan && (S.apuState ?? 'off') !== 'running') return;
    setState({ apuBleedOn: !(S.apuBleedOn ?? false) });
    _updateSwitches();
  });

  /* APU FIRE guard — lift before pulling handle */
  document.getElementById('ohp-apu-fire-guard')?.addEventListener('click', () => {
    document.getElementById('ohp-apu-fire-guard')?.classList.toggle('lifted');
  });

  /* APU FIRE handle — pull (only when guard lifted) */
  document.getElementById('ohp-apu-fire')?.addEventListener('click', () => {
    const guard = document.getElementById('ohp-apu-fire-guard');
    if (!guard?.classList.contains('lifted')) return;   // guard must be lifted first
    apuFirePull();
    stopApuSound();
    _updateSwitches();
  });

  /* APU FIRE TEST — momentarily lights the fire LED */
  document.getElementById('ohp-apu-fire-test')?.addEventListener('mousedown', () => {
    document.getElementById('ohp-apu-fire-led')?.classList.add('on');
  });
  document.getElementById('ohp-apu-fire-test')?.addEventListener('mouseup', () => {
    if (!(S.apuFireArmed ?? false)) {
      document.getElementById('ohp-apu-fire-led')?.classList.remove('on');
    }
  });

  /* X-feed */
  document.getElementById('ohp-xfeed')?.addEventListener('click', () => {
    setState({ xfeedOpen: !(S.xfeedOpen ?? false) });
    _updateSwitches();
  });

  /* Fuel pumps */
  for (let i = 1; i <= n; i++) {
    document.getElementById(`ohp-fuel-${i}`)?.addEventListener('click', () => {
      const pumps = [...(S.fuelPumps ?? Array(n).fill(true))];
      pumps[i - 1] = !pumps[i - 1];
      setState({ fuelPumps: pumps });
      _updateSwitches();
    });
  }

  /* Hydraulic electric pumps */
  for (const [id, key] of [
    ['ohp-hyd-green-elec',  'hydGreenElecOn'],
    ['ohp-hyd-blue-elec',   'hydBlueElecOn'],
    ['ohp-hyd-yellow-elec', 'hydYellowElecOn'],
  ]) {
    document.getElementById(id)?.addEventListener('click', () => {
      setState({ [key]: !(S[key] ?? false) });
      _updateSwitches();
    });
  }

  if (!turbofan) return;

  /* Battery switches */
  document.getElementById('ohp-bat1')?.addEventListener('click', () => {
    setState({ bat1On: !(S.bat1On ?? false) });
    _updateSwitches();
  });
  document.getElementById('ohp-bat2')?.addEventListener('click', () => {
    setState({ bat2On: !(S.bat2On ?? false) });
    _updateSwitches();
  });

  /* External power — only available on ground */
  document.getElementById('ohp-ext-pwr')?.addEventListener('click', () => {
    if (!(S.wow ?? false)) return;
    setState({ extPwrOn: !(S.extPwrOn ?? false) });
    _updateSwitches();
  });
}

/* ── Switch state render ──────────────────────────────────────── */
function _led(id, on, amber = false, blue = false) {
  const el = document.getElementById(`${id}-led`);
  if (!el) return;
  el.classList.toggle('on',    !!on && !amber && !blue);
  el.classList.toggle('amber', !!amber);
  el.classList.toggle('blue',  !!blue);
}

function _pbOn(id, on) {
  document.getElementById(`${id}-body`)?.classList.toggle('ohp-pb-on', !!on);
}

function _pbDisabled(id, disabled) {
  document.getElementById(`${id}-body`)?.classList.toggle('ohp-pb-disabled', !!disabled);
}

function _sub(id, text) {
  const el = document.getElementById(`${id}-sub`);
  if (el) el.textContent = text;
}

function _updateSwitches() {
  const n        = _engCount();
  const turbofan = _isTurbofan();
  const masters  = S.engMasters  ?? Array(n).fill(false);
  const fuelPumps = S.fuelPumps  ?? Array(n).fill(true);
  const isRunning = ['running', 'starting'].includes(S.engineState ?? '');

  /* Engine masters */
  for (let i = 1; i <= n; i++) {
    const on = masters[i - 1] || (isRunning && i === 1);
    _led(`ohp-eng-${i}`, on);
    _pbOn(`ohp-eng-${i}`, masters[i - 1]);
  }

  /* APU */
  const apuState    = S.apuState ?? 'off';
  const apuMasterOn = S.apuMasterOn ?? false;
  /* MASTER — on when switch is latched, LED green when APU running */
  _led('ohp-apu-master', apuState === 'running', false);
  _pbOn('ohp-apu-master', apuMasterOn);
  /* START — lit amber while starting, dims when running or off */
  _led('ohp-apu-start', false, apuState === 'starting');
  _pbDisabled('ohp-apu-start', !apuMasterOn || apuState !== 'off');
  /* BLEED */
  _led('ohp-apu-bleed',  S.apuBleedOn ?? false);
  _pbOn('ohp-apu-bleed', S.apuBleedOn ?? false);
  _pbDisabled('ohp-apu-bleed', turbofan && apuState !== 'running');
  /* FIRE */
  const fireArmed = S.apuFireArmed ?? false;
  document.getElementById('ohp-apu-fire')?.classList.toggle('armed', fireArmed);
  const fireLed = document.getElementById('ohp-apu-fire-led');
  if (fireLed) fireLed.classList.toggle('on', fireArmed);

  /* Fuel */
  _led('ohp-xfeed', S.xfeedOpen ?? false);
  for (let i = 1; i <= n; i++) {
    _led(`ohp-fuel-${i}`, fuelPumps[i - 1] ?? true);
    _pbOn(`ohp-fuel-${i}`, fuelPumps[i - 1] ?? true);
  }

  /* Engine mode rotary */
  const mode = S.engMode ?? 'NORM';
  document.querySelectorAll('#ohp-eng-mode .ohp-rot-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === mode);
  });

  /* Hydraulics */
  for (const [id, key] of [
    ['ohp-hyd-green-elec',  'hydGreenElecOn'],
    ['ohp-hyd-blue-elec',   'hydBlueElecOn'],
    ['ohp-hyd-yellow-elec', 'hydYellowElecOn'],
  ]) {
    _led(id, S[key] ?? false);
    _pbOn(id, S[key] ?? false);
  }

  if (!turbofan) return;

  /* Batteries */
  for (const [k, id] of [['bat1', 'ohp-bat1'], ['bat2', 'ohp-bat2']]) {
    const on      = S[`${k}On`] ?? false;
    const charge  = S[`${k}Charge`] ?? 100;
    const pct     = Math.round(charge);
    const charging = (S.acBusPowered ?? false) && on;
    _led(id, on);
    _pbOn(id, on);
    _sub(id, `${pct}%`);
    const fill = document.getElementById(`${id}-fill`);
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.style.background = pct > 20 ? '#00c840' : pct > 10 ? '#d09000' : '#c83030';
    }
    const voltEl = document.getElementById(`${id}-volt`);
    if (voltEl) {
      voltEl.textContent = on ? `${_batVoltage(charge, charging)}V` : '--.-V';
      voltEl.classList.toggle('low',  pct <= 20 && pct > 10);
      voltEl.classList.toggle('crit', pct <= 10);
      voltEl.classList.toggle('ohp-volt-disp', true);  // ensure class remains
    }
  }

  /* External power */
  const onGround = S.wow ?? false;
  const extOn    = S.extPwrOn ?? false;
  _led('ohp-ext-pwr', extOn, false, false);
  _pbOn('ohp-ext-pwr', extOn);
  _pbDisabled('ohp-ext-pwr', !onGround);
  _sub('ohp-ext-pwr', onGround ? (extOn ? 'ON' : 'AVAIL') : '');
}

/* ── Public API ───────────────────────────────────────────────── */
export function initOverhead() {
  document.getElementById('ohp')?.remove();

  if (!document.getElementById('ohp-style')) {
    const s = document.createElement('style');
    s.id = 'ohp-style';
    s.textContent = _CSS;
    document.head.appendChild(s);
  }

  _el = document.createElement('div');
  _el.id = 'ohp';
  document.body.appendChild(_el);
  _el.innerHTML = _buildHTML();
  _attachHandlers();
}

export function toggleOverhead() {
  const next = S.cockpitView === 'overhead' ? 'forward' : 'overhead';
  setState({ cockpitView: next });
}

export function renderOverhead() {
  if (!_el) return;
  const visible    = S.cockpitView === 'overhead';
  const wasVisible = _el.classList.contains('ohp-visible');
  _el.classList.toggle('ohp-visible', visible);
  if (visible && !wasVisible) {
    _el.innerHTML = _buildHTML();
    _attachHandlers();
  }
  if (visible) _updateSwitches();
}
