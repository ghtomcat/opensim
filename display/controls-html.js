/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/controls-html.js
   The HTML looks of the controls, and their wiring — the twin of the canvas kit
   (display/controls-canvas.js) for the slide-in zones: the pedestal, the consoles,
   the centre view. docs/issues.md, *Instruments, controls and mixed panels*, step 2c.

   Wiring: an element with `data-control="<id>"` is a control (display/controls.js) —
   a click operates it (a toggle flips, a rotary sweeps, a lever goes over); with
   `data-value` too, a click sets it to that value (a detent button, a gate position).
   One click handler per zone (wireControls), none per element.

   Looks: toggleHTML — the bat-handle toggle, the HTML twin of drawToggle (the same
   colours). refreshControls lights each toggle from its control's state.
   ═══════════════════════════════════════════════════════════════ */

import { operate, setControl, controlState } from './controls.js';

const _CSS = `
  .ctl-toggle { display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; user-select: none; width: 34px; }
  .ctl-toggle-housing {
    width: 16px; height: 26px; border-radius: 3px;
    background: #0c1018; border: 1px solid rgba(255,255,255,0.14); position: relative;
  }
  .ctl-toggle-lever {
    position: absolute; left: 50%; transform: translateX(-50%); bottom: 3px;
    width: 5px; height: 11px; border-radius: 2px; background: #2c3038;
    transition: bottom 0.14s ease, background 0.1s;
  }
  .ctl-toggle.on .ctl-toggle-lever { bottom: 12px; background: #9eaabf; box-shadow: inset 1px 0 0 rgba(255,255,255,0.22); }
  .ctl-toggle-led { width: 6px; height: 6px; border-radius: 50%; background: #101810; transition: background 0.1s, box-shadow 0.1s; }
  .ctl-toggle.on .ctl-toggle-led { background: #38d060; box-shadow: 0 0 6px rgba(56,208,96,0.6); }
  .ctl-toggle-lbl { font: 700 7px/1 monospace; letter-spacing: 0.04em; color: rgba(255,255,255,0.24); }
  .ctl-toggle.on .ctl-toggle-lbl { color: rgba(255,255,255,0.62); }
`;
function _ensureCSS() {
  if (typeof document === 'undefined' || document.getElementById('ctl-style')) return;
  const s = document.createElement('style'); s.id = 'ctl-style'; s.textContent = _CSS; document.head.appendChild(s);
}

/** The bat-handle toggle for control `id`, labelled — lit by refreshControls */
export function toggleHTML(id, label) {
  _ensureCSS();
  return `
              <div class="ctl-toggle" data-control="${id}">
                <div class="ctl-toggle-housing"><span class="ctl-toggle-lever"></span></div>
                <span class="ctl-toggle-led"></span>
                <span class="ctl-toggle-lbl">${label}</span>
              </div>`;
}

/** A data-value as the control takes it: true / false, a number, else the text */
export function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v !== '' && Number.isFinite(+v) ? +v : v;
}

/** One click handler for a zone: a click on (or inside) a [data-control] element operates it, or sets its data-value */
export function wireControls(root) {
  if (!root || root.dataset.ctlWired) return;
  root.dataset.ctlWired = '1';
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-control]');
    if (!el || !root.contains(el)) return;
    const id = el.dataset.control;
    if (el.dataset.value !== undefined) setControl(id, parseValue(el.dataset.value));
    else operate(id, { guarded: el.dataset.guarded === 'true' });
  });
}

/** Light every toggle in the zone from its control's state */
export function refreshControls(root) {
  root?.querySelectorAll('.ctl-toggle[data-control]').forEach(b => b.classList.toggle('on', !!controlState(b.dataset.control)));
}
