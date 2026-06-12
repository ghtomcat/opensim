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

    const val2 = document.createElement('div');
    val2.className = 'fma-val2';

    box.appendChild(sub);
    box.appendChild(val);
    box.appendChild(val2);
    _container.appendChild(box);
    _boxes.push({ box, sub, val, val2 });
  }
}

export function renderFMA() {
  if (!_boxes.length) return;
  const now = performance.now();

  for (let i = 0; i < 5; i++) {
    const fmaBox = S.fma[i];
    if (!fmaBox) continue;
    const b = _boxes[i];

    b.val.textContent  = fmaBox.val;
    b.val.style.color  = _colourToHex(fmaBox.col);
    b.sub.textContent  = fmaBox.sub || SUBS[i];

    b.val2.textContent = fmaBox.val2 || '';
    b.val2.style.color = _colourToHex(fmaBox.col2 || 'white');

    /* Mode-change boxing — a white box for ~10 s whenever the annunciation changes (the Airbus
       cue that a mode engaged/reverted, e.g. NAV/ALT dropping when the AP is disconnected). */
    const cur = fmaBox.val + '|' + (fmaBox.val2 || '');
    if (b.prev !== undefined && cur !== b.prev) b.boxUntil = now + 10000;
    b.prev = cur;
    b.box.classList.toggle('flash', !!fmaBox.flash || now < (b.boxUntil ?? 0));
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
