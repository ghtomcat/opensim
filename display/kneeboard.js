/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/kneeboard.js
   Kneeboard overlay: briefings + checklists + DSKY procedures.
   Toggle with K key. HTML overlay, not canvas.
   ═══════════════════════════════════════════════════════════════ */

import { S }                              from '../core/state.js';
import { loadDSKYProgram, setApolloRole } from './rocket_display.js';

let _el       = null;
let _visible  = false;
let _page     = 0;
let _checked  = {};   // { "pageIndex-itemIndex": true }

export function initKneeboard() {
  _el = document.createElement('div');
  _el.id = 'kneeboard';
  document.body.appendChild(_el);
  _applyStyles();
  _render();
}

export function toggleKneeboard() {
  _visible = !_visible;
  if (_visible) _render();          // refresh — the taxi clearance may have changed
  _el.style.transform = _visible ? 'translateX(0)' : 'translateX(110%)';
}

export function isKneeboardVisible() { return _visible; }

let _lastAircraftId = null, _lastVia = '';
export function tickKneeboard() {
  const id = S.aircraft?.id ?? null;
  if (id !== _lastAircraftId) {
    _lastAircraftId = id;
    _page    = 0;
    _checked = {};
    _render();
  }
  /* live-refresh the scratchpad when the taxi clearance changes and it's on screen */
  const via = (S.taxiClearance?.via ?? []).join(',') + '|' + (S.taxiClearance?.rwy ?? '');
  if (via !== _lastVia) {
    _lastVia = via;
    if (_visible && _pages()[_page]?.type === 'scratch') _render();
  }
}

/* ── Pages: mission first, then aircraft, then a scratchpad (not for rockets) ── */
function _pages() {
  const mp = S.mission?.kneeboard  ?? [];
  const ap = S.aircraft?.kneeboard ?? [];
  const base = [...mp, ...ap];
  if (S.aircraft?.vehicleType === 'rocket') return base;
  return [...base, { type: 'scratch', title: 'SCRATCHPAD', clearance: S.taxiClearance }];
}

/* ── Render ── */
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
  const isDSKY     = p.type === 'dsky';
  const isScratch  = p.type === 'scratch';

  let html = `
    <div class="kb-header">
      <button class="kb-nav" id="kb-prev" ${_page === 0 ? 'disabled' : ''}>◀</button>
      <span class="kb-title">${p.title}</span>
      <button class="kb-nav" id="kb-next" ${_page === pages.length - 1 ? 'disabled' : ''}>▶</button>
    </div>
    <div class="kb-page-indicator">${_page + 1} / ${pages.length}</div>
  `;

  if (isScratch) {
    const t = p.clearance, rwy = t?.rwy ? `RWY ${t.rwy}` : 'RWY —';
    const via = t?.via?.length ? t.via.join('   ') : null;
    html += `
      <div class="kb-scratch">
        <div class="kb-scratch-head">TAXI · ${rwy}</div>
        ${via ? `<div class="kb-scratch-seq">${via}</div>`
              : `<div class="kb-scratch-empty">— awaiting taxi clearance —</div>`}
      </div>`;
    _el.innerHTML = html;
    _el.querySelector('#kb-prev')?.addEventListener('click', () => { _page--; _render(); });
    _el.querySelector('#kb-next')?.addEventListener('click', () => { _page++; _render(); });
    return;
  }

  html += `<div class="kb-items ${isDSKY ? 'kb-items-dsky' : ''}">`;

  p.items.forEach((item, i) => {
    const key = `${_page}-${i}`;

    if (isBriefing) {
      html += `<div class="kb-briefing-item">${item}</div>`;

    } else if (isDSKY) {
      /* item = { step, desc, dsky: { verb, noun }, registers: [...] } */
      const seq   = item.step  ?? '';
      const desc  = item.desc  ?? '';
      const regs  = item.registers ?? [];
      const hasLoad = !!(item.dsky?.verb);
      html += `
        <div class="kb-dsky-item" data-i="${i}">
          <div class="kb-dsky-top">
            <span class="kb-dsky-seq">${seq}</span>
            ${hasLoad ? `<button class="kb-dsky-load" data-verb="${item.dsky.verb}" data-noun="${item.dsky.noun}">→ DSKY</button>` : ''}
          </div>
          ${desc  ? `<div class="kb-dsky-desc">${desc}</div>` : ''}
          ${regs.length ? `<div class="kb-dsky-regs">${regs.join('  ·  ')}</div>` : ''}
        </div>
      `;

    } else {
      /* Standard checklist */
      const checked = !!_checked[key];
      const text    = typeof item === 'string' ? item : (item.text ?? '');
      html += `
        <label class="kb-check-item ${checked ? 'kb-done' : ''}" data-key="${key}">
          <span class="kb-box">${checked ? '✓' : ''}</span>
          <span class="kb-text">${text}</span>
        </label>
      `;
    }
  });

  if (!isBriefing && !isDSKY) {
    const total = p.items.length;
    const done  = p.items.filter((_, i) => !!_checked[`${_page}-${i}`]).length;
    html += `<div class="kb-progress">${done} / ${total}</div>`;
  }

  html += `</div>`;

  if (!isBriefing && !isDSKY) {
    html += `<button class="kb-clear" id="kb-clear">Clear</button>`;
  }

  _el.innerHTML = html;

  /* Nav */
  _el.querySelector('#kb-prev')?.addEventListener('click', () => { _page--; _render(); });
  _el.querySelector('#kb-next')?.addEventListener('click', () => { _page++; _render(); });
  _el.querySelector('#kb-clear')?.addEventListener('click', () => {
    p.items.forEach((_, i) => delete _checked[`${_page}-${i}`]);
    _render();
  });

  /* Checklist toggle */
  _el.querySelectorAll('.kb-check-item').forEach(el => {
    el.addEventListener('click', () => {
      _checked[el.dataset.key] = !_checked[el.dataset.key];
      _render();
    });
  });

  /* DSKY LOAD buttons */
  _el.querySelectorAll('.kb-dsky-load').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const verb = btn.dataset.verb;
      const noun = btn.dataset.noun;
      loadDSKYProgram(verb, noun);
      setApolloRole('CMP');   /* switch to CMP so user sees the DSKY update */
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
      width: 280px;
      max-height: 80vh;
      overflow-y: auto;
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
      font-size: 10px;
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
    .kb-items-dsky {
      background: #0e1410;
      padding: 10px;
      gap: 0;
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

    /* ── Scratchpad (taxi clearance) ── */
    .kb-scratch {
      background: #ffffff;
      margin: 10px;
      padding: 12px 14px 22px;
      border: 1px solid #d8d2c4;
      border-radius: 2px;
      min-height: 130px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      background-image: repeating-linear-gradient(#ffffff 0, #ffffff 27px, #cfe0ee 28px);
    }
    .kb-scratch-head {
      font: bold 12px 'Courier New', monospace;
      color: #111; letter-spacing: 0.06em;
      border-bottom: 1.5px solid #222; padding-bottom: 5px; margin-bottom: 10px;
    }
    .kb-scratch-seq {
      font-family: 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive;
      font-size: 20px; font-weight: 700; color: #14213a;
      line-height: 1.4; word-spacing: 0.15em;
    }
    .kb-scratch-empty { color: #aaa; font-style: italic; font-size: 11px; }

    /* ── DSKY procedure items ── */
    .kb-dsky-item {
      border-left: 2px solid #2a4a30;
      margin-bottom: 10px;
      padding: 6px 0 6px 8px;
    }
    .kb-dsky-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .kb-dsky-seq {
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
      font-size: 13px;
      font-weight: bold;
      color: #a0d890;
      letter-spacing: 0.12em;
    }
    .kb-dsky-load {
      background: #182518;
      border: 1px solid #2a4a30;
      color: #6ab870;
      border-radius: 3px;
      padding: 3px 8px;
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
      font-size: 10px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .kb-dsky-load:hover { background: #223522; color: #b0e890; border-color: #4a7a50; }
    .kb-dsky-load:active { background: #1a4020; }
    .kb-dsky-desc {
      margin-top: 3px;
      font-size: 10px;
      color: #5a7a60;
      line-height: 1.3;
    }
    .kb-dsky-regs {
      margin-top: 2px;
      font-size: 9px;
      color: #3a5040;
      letter-spacing: 0.04em;
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
    }
  `;
  document.head.appendChild(style);
}
