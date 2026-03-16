/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/fma.js
   Flight Mode Annunciator — 5-box HTML overlay.
   Call initFMA(container) once, then renderFMA() each frame.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const SUBS = ['SPEED', 'AUTOPILOT', 'LATERAL', 'VERTICAL', 'ALTITUDE'];

let _container = null;
let _boxes     = [];

export function initFMA(container) {
  _container = container;
  _container.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const box = document.createElement('div');
    box.className = 'fma-box';

    const sub = document.createElement('div');
    sub.className = 'fma-sub';
    sub.textContent = SUBS[i];

    const val = document.createElement('div');
    val.className = 'fma-val';

    box.appendChild(sub);
    box.appendChild(val);
    _container.appendChild(box);
    _boxes.push({ box, sub, val });
  }
}

export function renderFMA() {
  if (!_boxes.length) return;

  for (let i = 0; i < 5; i++) {
    const fmaBox = S.fma[i];
    if (!fmaBox) continue;
    const { box, sub, val } = _boxes[i];

    val.textContent  = fmaBox.val;
    val.style.color  = _colourToHex(fmaBox.col);
    sub.textContent  = fmaBox.sub || SUBS[i];

    box.classList.toggle('flash', !!fmaBox.flash);
  }
}

function _colourToHex(col) {
  const map = {
    white:  '#e8edf2',
    green:  '#5dd47e',
    cyan:   '#4dc5dc',
    amber:  '#ffb74d',
    magenta:'#d96ec8',
  };
  return map[col] ?? col;
}
