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
import { stopEngine, apuMaster, apuStart, apuFire } from '../core/engine.js';
import { electricalLayout, elecCtl, elecCharge, elecSwitch, elecIdgDisconnect, elecBusTie, elecBusTieAuto } from '../core/electrical.js';
import { pushButtonHTML, setPushButton }          from './pushbutton.js';

/* ── DOM node ─────────────────────────────────────────────────── */
let _el = null;

/* ── Test-lit flags (prevent _updateSwitches overriding LED) ─── */
let _testLitAPU = false;
const _testLitEng = {};

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
  .ohp-pb-body.ohp-pb-on::after {
    content: 'ON';
    position: absolute; bottom: 3px; right: 4px;
    font: 700 6px/1 monospace; letter-spacing: 0.05em; color: #d8e8d8;
  }
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

  /* Generic-pushbutton system control + placard */
  .ohp-syspb { display: flex; flex-direction: column; align-items: center; gap: 5px; }

  /* APU FIRE section */
  .ohp-fire-group {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  .ohp-fire-wrap {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 0;
  }
  /* Fire button — dark so it reads as "behind the guard" */
  .ohp-fire-btn {
    width: 52px; height: 40px;
    background: #100808;
    border: 1px solid #401818;
    border-radius: 3px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 3px;
    cursor: pointer; user-select: none;
  }
  .ohp-fire-btn:hover { background: #1c0a0a; }
  .ohp-fire-btn.armed { background: #3a0000; border-color: #ff4040;
                         box-shadow: 0 0 8px rgba(255,60,60,0.5); }
  .ohp-fire-led {
    width: 10px; height: 10px; border-radius: 50%;
    background: #2a0808;
    border: 1px solid #401010;
  }
  .ohp-fire-led.on { background: #ff3030; box-shadow: 0 0 8px #ff3030, 0 0 16px rgba(255,50,50,0.5); border-color: #ff6060; }
  .ohp-fire-legend {
    font: 700 8px/1 monospace; letter-spacing: 0.06em; color: #804040;
  }
  .ohp-fire-label {
    font: 500 9px/1 monospace; letter-spacing: 0.08em; color: #904040;
  }
  /* Guard cover — nearly clear, red outline only; hinge and lever via pseudo-elements */
  .ohp-guard-cover {
    position: absolute; inset: -3px; z-index: 2;
    background: rgba(200, 30, 30, 0.07);
    border: 2px solid #c02020;
    border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; overflow: visible;
    transition: transform 0.28s ease, opacity 0.28s;
    transform-origin: top center;
  }
  /* Black hinge bar across the top */
  .ohp-guard-cover::before {
    content: '';
    position: absolute; top: -6px; left: -4px; right: -4px; height: 6px;
    background: #111; border: 1px solid #2a2a2a; border-radius: 2px 2px 0 0;
  }
  /* Small lift lever at the bottom center */
  .ohp-guard-cover::after {
    content: '';
    position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%);
    width: 14px; height: 8px;
    background: #b01818; border: 1px solid #d02020;
    border-top: none; border-radius: 0 0 4px 4px;
    pointer-events: none;
  }
  .ohp-guard-cover span {
    font: 700 7px/1 monospace; letter-spacing: 0.08em; color: #c05050;
  }
  .ohp-guard-cover.lifted {
    transform: perspective(200px) rotateX(-80deg);
    opacity: 0.15; pointer-events: none;
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
  /* AGENT discharge buttons */
  .ohp-agent-row { display: flex; gap: 3px; margin-top: 3px; }
  .ohp-agent-btn {
    padding: 3px 5px;
    background: #081408; border: 1px solid #1a3a20; border-radius: 2px;
    font: 700 6px/1 monospace; letter-spacing: 0.04em; color: #2a6040;
    cursor: pointer; user-select: none;
    transition: background 0.08s, color 0.08s;
  }
  .ohp-agent-btn:hover { background: #0e2016; color: #40a060; }
  .ohp-agent-btn.discharged { background: #0e2a18; color: #50d080; border-color: #28804a; }
  .ohp-agent-btn.unavail { opacity: 0.28; cursor: not-allowed; pointer-events: none; }

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
    width: 100%; max-width: 900px;
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

  /* IDG disconnect button + amber guard */
  .ohp-gen-pair { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .ohp-idg-wrap { position: relative; display: flex; flex-direction: column; align-items: center; }
  .ohp-idg-btn {
    width: 52px; height: 28px;
    background: #180a08; border: 1px solid #501818; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font: 700 7px/1 monospace; letter-spacing: 0.06em; color: #804040;
    cursor: pointer; user-select: none;
    transition: background 0.1s;
  }
  .ohp-idg-btn:hover { background: #221010; }
  .ohp-idg-btn.disconnected { background: #3a0000; border-color: #ff4040; color: #ff6060; }
  .ohp-idg-guard {
    position: absolute; inset: -3px; z-index: 2;
    background: rgba(180, 130, 20, 0.07); border: 2px solid #907020; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; overflow: visible;
    transition: transform 0.28s ease, opacity 0.28s;
    transform-origin: top center;
  }
  .ohp-idg-guard::before {
    content: ''; position: absolute; top: -6px; left: -4px; right: -4px; height: 6px;
    background: #111; border: 1px solid #2a2a2a; border-radius: 2px 2px 0 0;
  }
  .ohp-idg-guard::after {
    content: ''; position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%);
    width: 14px; height: 8px;
    background: #907018; border: 1px solid #b09020;
    border-top: none; border-radius: 0 0 4px 4px; pointer-events: none;
  }
  .ohp-idg-guard span { font: 700 6px/1 monospace; letter-spacing: 0.08em; color: #a08030; }
  .ohp-idg-guard.lifted { transform: perspective(200px) rotateX(-80deg); opacity: 0.15; pointer-events: none; }
  .ohp-idg-label { font: 500 8px/1 monospace; letter-spacing: 0.06em; color: #60708c; margin-top: 2px; }

  /* Panel title + hint */
  .ohp-panel-title {
    width: 100%; max-width: 900px;
    font: 500 9px/1 monospace; letter-spacing: 0.16em; color: #303848;
    text-align: center; padding: 8px 0 4px;
    margin-bottom: auto;
  }
  .ohp-hint {
    width: 100%; max-width: 900px;
    font: 500 9px/1 monospace; letter-spacing: 0.12em; color: #283040;
    text-align: center; padding-top: 10px;
  }
`;

/* ── Helpers ──────────────────────────────────────────────────── */
/* System pushbutton (generic Airbus pushbutton) + a name placard below. */
function _sysPb(id, caption, opts = {}) {
  return `<div class="ohp-syspb">${pushButtonHTML(id, opts)}<div class="ohp-pb-label">${caption}</div></div>`;
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

/* An engine generator's controls: its IDG disconnect (guarded) over its GEN pushbutton */
function _genPair(el) {
  const n = el.driver.replace('eng', '');
  return `<div class="ohp-gen-pair">
    <div class="ohp-idg-wrap">
      <div class="ohp-idg-btn" id="ohp-idg-${el.id}">IDG ${n}</div>
      <div class="ohp-idg-guard" id="ohp-idg-guard-${el.id}"><span>DISC</span></div>
    </div>
    ${_sysPb(`el-${el.id}`, el.label ?? `GEN ${n}`, { upper: 'FAULT' })}
  </div>`;
}

/* The electrical layout's elements, sorted for the overhead: the engine generators split left and
   right by engine (the shared sources — APU GEN, EXT — between them), the batteries, the loads */
function _elecParts() {
  const L = electricalLayout();
  const engGens = L.sources.filter(e => e.type === 'gen' && e.driver !== 'apu');
  const half    = Math.ceil(engGens.length / 2);
  return { L,
    left:   engGens.slice(0, half), right: engGens.slice(half),
    shared: L.sources.filter(e => (e.type === 'gen' && e.driver === 'apu') || e.type === 'ext'),
    bats:   L.sources.filter(e => e.type === 'bat'),
    loads:  L.loads ?? [],
    tie:    L.buses.some(b => (b.ties ?? []).length) };
}

/* ── Build inner HTML ─────────────────────────────────────────── */
function _buildHTML() {
  const n = _engCount();
  const turbofan = _isTurbofan();

  /* Electrical section — turbofan only; built from the electrical layout (core/electrical.js):
     the batteries, BUS TIE (if the layout has ties) and the loads; then the engine generators
     split left and right with the shared sources (APU GEN, EXT PWR) between them */
  const E = turbofan ? _elecParts() : null;
  const sharedPb = (el) => el.type === 'ext' ? _sysPb(`el-${el.id}`, el.label ?? el.id, { upper: 'AVAIL', upperColor: '#4ad86a' })
                                             : _sysPb(`el-${el.id}`, el.label ?? el.id, { upper: 'FAULT' });
  const elecSection = turbofan ? `<div class="ohp-section">
    <div class="ohp-section-hdr">ELECTRICAL</div>
    <div class="ohp-row" style="margin-bottom:10px;">
      ${E.bats.map(b => _batPb(`ohp-el-${b.id}`, b.label ?? b.id)).join('')}
      ${E.tie ? `<div class="ohp-divider"></div>${_sysPb('el-busTie', 'BUS TIE', { upper: 'FAULT' })}` : ''}
      ${E.loads.length ? `<div class="ohp-divider"></div>${E.loads.map(l => _sysPb(`el-${l.id}`, l.label ?? l.id, { upper: 'FAULT' })).join('')}` : ''}
    </div>
    <div class="ohp-row" style="align-items:flex-start; gap:8px;">
      ${E.left.map(_genPair).join('')}
      ${E.shared.length ? `<div class="ohp-divider"></div>${E.shared.map(sharedPb).join('')}` : ''}
      ${E.right.length ? `<div class="ohp-divider"></div>${E.right.map(_genPair).join('')}` : ''}
    </div>
  </div>` : '';

  /* APU section */
  const apuSection = `<div class="ohp-section">
    <div class="ohp-section-hdr">APU</div>
    <div class="ohp-row" style="align-items:flex-start; gap:10px;">
      ${_sysPb('apu-master', 'MASTER SW', { upper: 'FAULT' })}
      ${_sysPb('apu-start',  'START',     { upper: 'AVAIL', upperColor: '#40a0ff' })}
      ${_sysPb('apu-bleed',  'BLEED',     { upper: 'FAULT' })}
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
        <button class="ohp-agent-btn unavail" id="ohp-apu-agent">AGENT</button>
      </div>
    </div>
  </div>`;

  /* Fuel section */
  const fuelPumps = Array.from({ length: n }, (_, i) =>
    _sysPb(`fuel-${i + 1}`, `PMP ${i + 1}`, { upper: 'FAULT' })
  ).join('');
  const fuelSection = `<div class="ohp-section">
    <div class="ohp-section-hdr">FUEL</div>
    <div class="ohp-row">
      ${_sysPb('xfeed', 'X FEED', { upper: 'FAULT' })}
      <div class="ohp-divider"></div>
      ${fuelPumps}
    </div>
  </div>`;

  /* Hydraulics section — turbofan only */
  const hydSection = turbofan ? `<div class="ohp-section">
    <div class="ohp-section-hdr">HYDRAULICS</div>
    <div class="ohp-row">
      ${_sysPb('hyd-green',  'GREEN PMP',  { upper: 'FAULT' })}
      ${_sysPb('hyd-blue',   'BLUE PMP',   { upper: 'FAULT' })}
      ${_sysPb('hyd-yellow', 'YELLOW PMP', { upper: 'FAULT' })}
    </div>
  </div>` : '';

  /* Engine fire handles */
  const engFireHandles = Array.from({ length: n }, (_, i) => `
    <div class="ohp-fire-group">
      <div class="ohp-fire-wrap">
        <div class="ohp-fire-btn" id="ohp-eng-fire-${i + 1}">
          <div class="ohp-fire-led" id="ohp-eng-fire-led-${i + 1}"></div>
          <div class="ohp-fire-legend">FIRE</div>
        </div>
        <div class="ohp-guard-cover" id="ohp-eng-fire-guard-${i + 1}"><span>GUARD</span></div>
      </div>
      <div class="ohp-fire-label">ENG ${i + 1}</div>
      <div class="ohp-test-btn" id="ohp-eng-fire-test-${i + 1}">TEST</div>
      <div class="ohp-agent-row">
        <button class="ohp-agent-btn unavail" id="ohp-eng-agent1-${i + 1}">AGENT1</button>
        <button class="ohp-agent-btn unavail" id="ohp-eng-agent2-${i + 1}">AGENT2</button>
      </div>
    </div>`).join('');
  const engSection = `<div class="ohp-section">
    <div class="ohp-section-hdr">ENGINE FIRE</div>
    <div class="ohp-row" style="flex-wrap:wrap; gap:12px;">
      ${engFireHandles}
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

  /* Engine fire handles */
  for (let i = 1; i <= n; i++) {
    document.getElementById(`ohp-eng-fire-guard-${i}`)?.addEventListener('click', () => {
      document.getElementById(`ohp-eng-fire-guard-${i}`)?.classList.toggle('lifted');
    });
    document.getElementById(`ohp-eng-fire-${i}`)?.addEventListener('click', () => {
      const guard = document.getElementById(`ohp-eng-fire-guard-${i}`);
      if (!guard?.classList.contains('lifted')) return;
      const fires = [...(S.engFireArmed ?? Array(n).fill(false))];
      fires[i - 1] = true;
      setState({ engFireArmed: fires });
      /* Shut down engine if this was the last/only running engine */
      if ((S.engineState ?? 'off') === 'running') stopEngine();
      _updateSwitches();
    });
    /* AGENT 1 */
    document.getElementById(`ohp-eng-agent1-${i}`)?.addEventListener('click', () => {
      if (!(S.engFireArmed?.[i - 1])) return;
      const agents = [...(S.engAgents ?? [])];
      agents[(i - 1) * 2] = true;
      setState({ engAgents: agents });
      _updateSwitches();
    });
    /* AGENT 2 */
    document.getElementById(`ohp-eng-agent2-${i}`)?.addEventListener('click', () => {
      if (!(S.engFireArmed?.[i - 1])) return;
      const agents = [...(S.engAgents ?? [])];
      agents[(i - 1) * 2 + 1] = true;
      setState({ engAgents: agents });
      _updateSwitches();
    });
  }

  /* APU MASTER — latching switch */
  document.getElementById('pb-apu-master')?.addEventListener('click', () => {
    apuMaster(!(S.apuMasterOn ?? false));   // off = shutdown (the APU sound follows apuState)
    _updateSwitches();
  });

  /* APU START — momentary; the start-up sound follows apuState */
  document.getElementById('pb-apu-start')?.addEventListener('click', () => {
    apuStart();
    _updateSwitches();
  });

  /* APU BLEED — only when APU running */
  document.getElementById('pb-apu-bleed')?.addEventListener('click', () => {
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
    apuFire();
    _updateSwitches();
  });

  /* APU fire TEST — direct assignment, flags protect against _updateSwitches overriding */
  const apuTestBtn = _el.querySelector('#ohp-apu-fire-test');
  if (apuTestBtn) {
    apuTestBtn.onclick = () => {
      _testLitAPU = true;
      _updateSwitches();
      if (!(S.apuFireArmed ?? false)) {
        setTimeout(() => { _testLitAPU = false; _updateSwitches(); }, 600);
      }
    };
  }

  /* Engine fire TEST buttons */
  for (let j = 1; j <= n; j++) {
    const testBtn = _el.querySelector(`#ohp-eng-fire-test-${j}`);
    if (testBtn) {
      const idx = j;
      testBtn.onclick = () => {
        _testLitEng[idx] = true;
        _updateSwitches();
        if (!(S.engFireArmed?.[idx - 1])) {
          setTimeout(() => { _testLitEng[idx] = false; _updateSwitches(); }, 600);
        }
      };
    }
  }

  /* APU AGENT — only available after fire handle pulled */
  document.getElementById('ohp-apu-agent')?.addEventListener('click', () => {
    if (!(S.apuFireArmed ?? false)) return;
    setState({ apuAgent: true });
    _updateSwitches();
  });

  /* X-feed */
  document.getElementById('pb-xfeed')?.addEventListener('click', () => {
    setState({ xfeedOpen: !(S.xfeedOpen ?? false) });
    _updateSwitches();
  });

  /* Fuel pumps */
  for (let i = 1; i <= n; i++) {
    document.getElementById(`pb-fuel-${i}`)?.addEventListener('click', () => {
      const pumps = [...(S.fuelPumps ?? Array(n).fill(true))];
      pumps[i - 1] = !pumps[i - 1];
      setState({ fuelPumps: pumps });
      _updateSwitches();
    });
  }

  /* Hydraulic electric pumps */
  for (const [id, key] of [
    ['pb-hyd-green',  'hydGreenElecOn'],
    ['pb-hyd-blue',   'hydBlueElecOn'],
    ['pb-hyd-yellow', 'hydYellowElecOn'],
  ]) {
    document.getElementById(id)?.addEventListener('click', () => {
      setState({ [key]: !(S[key] ?? false) });
      _updateSwitches();
    });
  }

  if (!turbofan) return;

  /* Electrical — every control sends its element's command to core/electrical.js */
  if (turbofan) {
    const E = _elecParts();
    for (const el of [...E.bats]) {
      document.getElementById(`ohp-el-${el.id}`)?.addEventListener('click', () => { elecSwitch(el.id); _updateSwitches(); });
    }
    for (const el of [...E.shared, ...E.left, ...E.right, ...E.loads]) {
      document.getElementById(`pb-el-${el.id}`)?.addEventListener('click', () => { elecSwitch(el.id); _updateSwitches(); });
    }
    document.getElementById('pb-el-busTie')?.addEventListener('click', () => { elecBusTie(); _updateSwitches(); });
    for (const el of [...E.left, ...E.right]) {
      document.getElementById(`ohp-idg-guard-${el.id}`)?.addEventListener('click', () => {
        document.getElementById(`ohp-idg-guard-${el.id}`)?.classList.toggle('lifted');
      });
      document.getElementById(`ohp-idg-${el.id}`)?.addEventListener('click', () => {
        if (!document.getElementById(`ohp-idg-guard-${el.id}`)?.classList.contains('lifted')) return;   // guard first
        elecIdgDisconnect(el.id);
        _updateSwitches();
      });
    }
  }
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

function _sub(id, text) {
  const el = document.getElementById(`${id}-sub`);
  if (el) el.textContent = text;
}

function _updateSwitches() {
  const n        = _engCount();
  const turbofan = _isTurbofan();
  const fuelPumps = S.fuelPumps ?? Array(n).fill(true);

  /* Engine fire handles + AGENT buttons */
  const fires  = S.engFireArmed ?? Array(n).fill(false);
  const agents = S.engAgents ?? [];
  for (let i = 1; i <= n; i++) {
    const armed = fires[i - 1] ?? false;
    document.getElementById(`ohp-eng-fire-${i}`)?.classList.toggle('armed', armed);
    const led = document.getElementById(`ohp-eng-fire-led-${i}`);
    if (led) led.classList.toggle('on', armed || !!_testLitEng[i]);
    const a1 = document.getElementById(`ohp-eng-agent1-${i}`);
    const a2 = document.getElementById(`ohp-eng-agent2-${i}`);
    if (a1) { a1.classList.toggle('unavail', !armed); a1.classList.toggle('discharged', !!(agents[(i-1)*2])); }
    if (a2) { a2.classList.toggle('unavail', !armed); a2.classList.toggle('discharged', !!(agents[(i-1)*2+1])); }
  }

  /* APU AGENT */
  const apuAgent   = S.apuAgent ?? false;
  const apuFireArmed = S.apuFireArmed ?? false;
  const apuAgentEl = document.getElementById('ohp-apu-agent');
  if (apuAgentEl) {
    apuAgentEl.classList.toggle('unavail',    !apuFireArmed);
    apuAgentEl.classList.toggle('discharged', apuAgent);
  }

  /* APU */
  const apuState    = S.apuState ?? 'off';
  const apuMasterOn = S.apuMasterOn ?? false;
  /* MASTER SW — ON lit when the switch is latched */
  setPushButton('apu-master', { lower: apuMasterOn });
  /* START — ON lit while starting, AVAIL (upper) when running; disabled unless ready to start */
  setPushButton('apu-start', { lower: apuState === 'starting', upper: apuState === 'running',
                               disabled: !apuMasterOn || apuState !== 'off' });
  /* BLEED — ON lit; disabled until the APU is running (turbofan) */
  setPushButton('apu-bleed', { lower: S.apuBleedOn ?? false,
                               disabled: turbofan && apuState !== 'running' });
  /* FIRE */
  const fireArmed = S.apuFireArmed ?? false;
  document.getElementById('ohp-apu-fire')?.classList.toggle('armed', fireArmed);
  const fireLed = document.getElementById('ohp-apu-fire-led');
  if (fireLed) fireLed.classList.toggle('on', fireArmed || _testLitAPU);

  /* Fuel */
  setPushButton('xfeed', { lower: S.xfeedOpen ?? false });
  for (let i = 1; i <= n; i++) {
    setPushButton(`fuel-${i}`, { lower: fuelPumps[i - 1] ?? true });
  }

  /* Hydraulics */
  for (const [id, key] of [
    ['hyd-green',  'hydGreenElecOn'],
    ['hyd-blue',   'hydBlueElecOn'],
    ['hyd-yellow', 'hydYellowElecOn'],
  ]) {
    setPushButton(id, { lower: S[key] ?? false });
  }

  if (!turbofan) return;

  /* Electrical — from the layout, its controls and its solution (S.elec) */
  const E    = _elecParts();
  const elec = S.elec;
  const busPowered = (id) => !!elec?.buses?.[id]?.powered;
  for (const el of E.bats) {
    const id      = `ohp-el-${el.id}`;
    const on      = elecCtl(el.id, E.L).on;
    const charge  = elecCharge(el.id);
    const pct     = Math.round(charge);
    const charging = on && (el.chargedBy ?? []).some(busPowered);
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
  /* External power — AVAIL (green) when the cart is connected on the ground and unused, ON when in use;
     APU GEN — ON lit when selected */
  const onGround = S.wow ?? false;
  for (const el of E.shared) {
    const on = elecCtl(el.id, E.L).on;
    if (el.type === 'ext') setPushButton(`el-${el.id}`, { upper: onGround && !on, lower: on, disabled: !onGround });
    else                   setPushButton(`el-${el.id}`, { lower: on });
  }
  setPushButton('el-busTie', { lower: elecBusTieAuto() });               // ON lit when AUTO (tie engaged)
  for (const el of E.loads) setPushButton(`el-${el.id}`, { lower: elecCtl(el.id, E.L).on });
  /* Engine generators — IDG disconnected (red), GEN ON lit when the generator is online */
  for (const el of [...E.left, ...E.right]) {
    document.getElementById(`ohp-idg-${el.id}`)?.classList.toggle('disconnected', !elecCtl(el.id, E.L).idg);
    setPushButton(`el-${el.id}`, { lower: !!elec?.sources?.[el.id]?.on });
  }
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
  if (!S.aircraft?.views?.includes('overhead')) return;   // aircraft declares no overhead panel
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
