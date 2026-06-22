/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/pushbutton.js
   Generic Airbus-style pushbutton-switch — a reusable building block.

   Black face, grey bezel, two stacked legends:
     · upper — configurable text + colour (e.g. FAULT amber, OFF white)
     · lower — "ON" by default, in a white-bordered box
   Each legend illuminates independently (lit / unlit).

   Usage:
     el.innerHTML = pushButtonHTML('xfeed', { upper: 'FAULT' });   // lower defaults to ON
     el.querySelector('#pb-xfeed').addEventListener('click', …);   // caller owns the behaviour
     setPushButton('xfeed', { upper: faultActive, lower: systemOn });

   The legends are display-only; the caller wires the click and decides
   what each lit state means. id is used as `pb-<id>` on the element.
   ═══════════════════════════════════════════════════════════════ */

const _CSS = `
  .gpb {
    width: 54px; height: 46px;
    background: #0a0a0c; border: 1px solid #8a8f98; border-radius: 3px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    cursor: pointer; user-select: none; position: relative;
    transition: background 0.08s, border-color 0.08s;
  }
  .gpb:hover  { background: #141418; }
  .gpb:active { background: #1d1d23; }
  .gpb.gpb-disabled { opacity: 0.35; cursor: not-allowed; }

  /* Upper legend — configurable text/colour, dark when unlit */
  .gpb-upper {
    font: 700 8px/1 monospace; letter-spacing: 0.06em;
    color: #26262a; min-height: 8px; text-align: center;
  }
  .gpb-upper.lit { color: var(--gpb-upper-col, #ffb000); }

  /* Lower legend — boxed "ON", white frame; text illuminates */
  .gpb-lower {
    font: 700 8px/1 monospace; letter-spacing: 0.06em; text-align: center;
    padding: 2px 6px; border-radius: 2px;
    border: 1px solid rgba(220,226,234,0.5); color: #3a3a40;
    transition: color 0.1s, border-color 0.1s;
  }
  .gpb-lower.lit { border-color: #e8edf2; color: var(--gpb-lower-col, #e8edf2); }
`;

function _ensureCSS() {
  if (document.getElementById('gpb-style')) return;
  const s = document.createElement('style');
  s.id = 'gpb-style';
  s.textContent = _CSS;
  document.head.appendChild(s);
}

/* Build the pushbutton HTML.
   opts: { upper='', lower='ON', upperColor, lowerColor, upperLit=false, lowerLit=false } */
export function pushButtonHTML(id, opts = {}) {
  _ensureCSS();
  const { upper = '', lower = 'ON', upperColor, lowerColor, upperLit = false, lowerLit = false } = opts;
  const vars = [
    upperColor ? `--gpb-upper-col:${upperColor}` : '',
    lowerColor ? `--gpb-lower-col:${lowerColor}` : '',
  ].filter(Boolean).join(';');
  return `<div class="gpb" id="pb-${id}" tabindex="-1"${vars ? ` style="${vars}"` : ''}>
    <div class="gpb-upper${upperLit ? ' lit' : ''}" id="pb-${id}-upper">${upper}</div>
    <div class="gpb-lower${lowerLit ? ' lit' : ''}" id="pb-${id}-lower">${lower}</div>
  </div>`;
}

/* Toggle the lit state of either legend. Pass only the keys you want to change. */
export function setPushButton(id, { upper, lower, disabled } = {}) {
  if (upper !== undefined)    document.getElementById(`pb-${id}-upper`)?.classList.toggle('lit', !!upper);
  if (lower !== undefined)    document.getElementById(`pb-${id}-lower`)?.classList.toggle('lit', !!lower);
  if (disabled !== undefined) document.getElementById(`pb-${id}`)?.classList.toggle('gpb-disabled', !!disabled);
}

/* Set the upper legend text at runtime (e.g. OFF ↔ blank). */
export function setPushButtonUpper(id, text) {
  const el = document.getElementById(`pb-${id}-upper`);
  if (el) el.textContent = text;
}
