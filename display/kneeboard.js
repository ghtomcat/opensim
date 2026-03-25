/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/kneeboard.js
   Kneeboard overlay: briefings + checklists.
   Toggle with K key. HTML overlay, not canvas.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

let _el       = null;   // kneeboard DOM element
let _visible  = false;
let _page     = 0;
let _checked  = {};     // { "pageIndex-itemIndex": true }

export function initKneeboard() {
  _el = document.createElement('div');
  _el.id = 'kneeboard';
  _el.innerHTML = '';
  document.body.appendChild(_el);

  _applyStyles();
  _render();
}

export function toggleKneeboard() {
  _visible = !_visible;
  _el.style.transform = _visible ? 'translateX(0)' : 'translateX(110%)';
}

export function isKneeboardVisible() { return _visible; }

/* Called each frame — re-renders if aircraft changes */
let _lastAircraftId = null;
export function tickKneeboard() {
  const id = S.aircraft?.id ?? null;
  if (id !== _lastAircraftId) {
    _lastAircraftId = id;
    _page    = 0;
    _checked = {};
    _render();
  }
}

/* ── Internal ── */

function _pages() {
  return S.aircraft?.kneeboard ?? [];
}

function _render() {
  if (!_el) return;
  const pages = _pages();
  if (pages.length === 0) {
    _el.innerHTML = '<div class="kb-empty">No kneeboard for this aircraft.</div>';
    return;
  }

  _page = Math.max(0, Math.min(_page, pages.length - 1));
  const p = pages[_page];

  const isBriefing = p.type === 'briefing';

  let html = `
    <div class="kb-header">
      <button class="kb-nav" id="kb-prev" ${_page === 0 ? 'disabled' : ''}>◀</button>
      <span class="kb-title">${p.title}</span>
      <button class="kb-nav" id="kb-next" ${_page === pages.length - 1 ? 'disabled' : ''}>▶</button>
    </div>
    <div class="kb-page-indicator">${_page + 1} / ${pages.length}</div>
    <div class="kb-items">
  `;

  p.items.forEach((item, i) => {
    const key     = `${_page}-${i}`;
    const checked = !!_checked[key];
    if (isBriefing) {
      html += `<div class="kb-briefing-item">${item}</div>`;
    } else {
      html += `
        <label class="kb-check-item ${checked ? 'kb-done' : ''}" data-key="${key}">
          <span class="kb-box">${checked ? '✓' : ''}</span>
          <span class="kb-text">${item}</span>
        </label>
      `;
    }
  });

  if (!isBriefing) {
    const total   = p.items.length;
    const done    = p.items.filter((_, i) => !!_checked[`${_page}-${i}`]).length;
    html += `<div class="kb-progress">${done} / ${total}</div>`;
  }

  html += `</div>`;

  if (!isBriefing) {
    html += `<button class="kb-clear" id="kb-clear">Clear</button>`;
  }

  _el.innerHTML = html;

  /* Events */
  _el.querySelector('#kb-prev')?.addEventListener('click', () => { _page--; _render(); });
  _el.querySelector('#kb-next')?.addEventListener('click', () => { _page++; _render(); });
  _el.querySelector('#kb-clear')?.addEventListener('click', () => {
    p.items.forEach((_, i) => delete _checked[`${_page}-${i}`]);
    _render();
  });

  _el.querySelectorAll('.kb-check-item').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      _checked[key] = !_checked[key];
      _render();
    });
  });
}

function _applyStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #kneeboard {
      position: fixed;
      top: 50%;
      right: 12px;
      transform: translateX(110%) translateY(-50%);
      transition: transform 0.25s ease;
      width: 260px;
      background: #f5f0e8;
      border: 2px solid #8b7355;
      border-radius: 6px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #1a1a1a;
      z-index: 9999;
      user-select: none;
    }
    .kb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #2c2c2c;
      color: #f0e6c8;
      padding: 8px 10px;
      border-radius: 4px 4px 0 0;
    }
    .kb-title {
      font-weight: bold;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-align: center;
      flex: 1;
    }
    .kb-nav {
      background: none;
      border: none;
      color: #f0e6c8;
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
      opacity: 0.9;
    }
    .kb-nav:disabled { opacity: 0.25; cursor: default; }
    .kb-page-indicator {
      text-align: center;
      font-size: 10px;
      color: #666;
      padding: 3px 0;
      background: #e8e0d0;
      border-bottom: 1px solid #c8b89a;
    }
    .kb-items {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .kb-briefing-item {
      padding: 4px 0;
      border-bottom: 1px dashed #c8b89a;
      line-height: 1.4;
      font-size: 11px;
    }
    .kb-check-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      padding: 3px 0;
      border-bottom: 1px dashed #c8b89a;
    }
    .kb-check-item:hover { background: #ede5d0; }
    .kb-box {
      width: 16px;
      height: 16px;
      border: 1.5px solid #4a3f2f;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 11px;
      font-weight: bold;
      color: #1a6b1a;
      margin-top: 1px;
    }
    .kb-done .kb-text { text-decoration: line-through; color: #999; }
    .kb-done .kb-box  { background: #e0f0e0; }
    .kb-text { line-height: 1.35; font-size: 11px; }
    .kb-progress {
      text-align: right;
      font-size: 10px;
      color: #666;
      padding-top: 4px;
    }
    .kb-clear {
      display: block;
      width: calc(100% - 20px);
      margin: 0 10px 10px;
      background: #2c2c2c;
      color: #f0e6c8;
      border: none;
      border-radius: 3px;
      padding: 5px;
      cursor: pointer;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    .kb-clear:hover { background: #444; }
    .kb-empty {
      padding: 16px;
      color: #666;
      font-size: 11px;
    }
  `;
  document.head.appendChild(style);
}
