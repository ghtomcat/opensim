/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/leftconsole.js
   Left cockpit console — slides in from the left. Toggle: L key.
   Data-driven from aircraft.left = [tokens]. First user: Bf 109.
     throttle  — Gashebel (power lever)  → spdT  (props key off spdT)
     trim      — Höhentrimmrad           → trim  (-10 nose-down … +10 nose-up)
     fuelcock  — Brandhahn (fuel cock)   → fuelShutoff
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';

let _el = null;

/* ── CSS ──────────────────────────────────────────────────────── */
const _CSS = `
  #lcon {
    position: fixed; left: 0; top: 0; bottom: 0; width: min(38vw, 500px); z-index: 180;
    background: #14161a; border-right: 1px solid #20242a;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 24px; padding: 24px 30px;
    transform: translateX(-100%);
    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #lcon.lcon-visible { transform: translateX(0); }
  /* Wide variant — airliner/transport Captain station covers the full screen */
  #lcon.lcon-wide { width: 100vw; align-items: flex-start; padding: 24px 48px; }

  .lc-title { font: 600 10px/1 monospace; letter-spacing: 0.14em; color: #44504a; text-transform: uppercase; }
  .lc-row   { display: flex; gap: 34px; align-items: flex-end; }
  .lc-ctrl  { display: flex; flex-direction: column; align-items: center; gap: 11px; }
  .lc-label { font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #6a7a66; }
  .lc-val   { font: 700 10px/1 monospace; letter-spacing: 0.04em; color: #9ab088; min-height: 11px; }
  .lc-hint  { font: 500 9px/1 monospace; letter-spacing: 0.08em; color: #28302a; margin-top: 4px; }

  /* ── Gashebel (throttle) — vertical lever ── */
  .lc-throttle-track {
    position: relative; width: 30px; height: 178px;
    background: #0e1014; border: 1px solid #2a322c; border-radius: 4px; cursor: ns-resize;
  }
  .lc-throttle-handle {
    position: absolute; left: 50%; transform: translateX(-50%); top: 0;
    width: 40px; height: 18px;
    background: linear-gradient(180deg, #3a4038 0%, #20241e 100%);
    border: 1px solid #4a5244; border-radius: 3px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.6); transition: top 0.12s ease;
  }
  .lc-throttle-handle::after {
    content: ''; position: absolute; left: 4px; right: 4px; top: 50%;
    height: 2px; background: rgba(160,180,150,0.3); transform: translateY(-50%);
  }

  /* ── Kühler-/Cowl-Flap step gate (open / half / closed) ── */
  .lc-gate { display: flex; flex-direction: column; border: 1px solid #2a322c; border-radius: 3px; overflow: hidden; }
  .lc-gate-pos {
    padding: 9px 20px; background: #0e1014;
    font: 700 9px/1 monospace; letter-spacing: 0.06em; color: #4a5446;
    cursor: pointer; border-bottom: 1px solid #2a322c; user-select: none; text-align: center;
    transition: background 0.08s, color 0.08s;
  }
  .lc-gate-pos:last-child { border-bottom: none; }
  .lc-gate-pos:hover { background: #181c18; color: #6a7a66; }
  .lc-gate-pos.lc-gate-on   { background: #16241a; color: #9ab088; box-shadow: inset 3px 0 0 #3a7a4a; }
  .lc-gate-pos.lc-gate-warn { background: #2a1414; color: #d89090; box-shadow: inset 3px 0 0 #a04040; }

  /* ── Throttle quadrant — throttle / prop / mixture levers ── */
  .lc-quad { display: flex; gap: 9px; align-items: flex-end; }
  .lc-quad-col { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  .lc-quad-track {
    position: relative; width: 18px; height: 150px;
    background: #0e1014; border: 1px solid #2a322c; border-radius: 4px; cursor: ns-resize;
  }
  .lc-quad-handle {
    position: absolute; left: 50%; transform: translateX(-50%); top: 0;
    width: 26px; height: 14px; border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.20); box-shadow: 0 2px 5px rgba(0,0,0,0.6);
    transition: top 0.12s ease;
  }
  .q-black .lc-quad-handle { background: linear-gradient(180deg, #2e3036 0%, #131418 100%); border-color: #3a3e46; }
  .q-blue  .lc-quad-handle { background: linear-gradient(180deg, #3a6db8 0%, #1e3f7a 100%); border-color: #2a4a80; }
  .q-red   .lc-quad-handle { background: linear-gradient(180deg, #c04038 0%, #7a201a 100%); border-color: #803028; }
  .lc-quad-lbl { font: 700 7px/1 monospace; letter-spacing: 0.04em; color: #6a7a66; }

  /* ── Höhentrimmrad (elevator trim wheel) ── */
  .lc-wheel {
    position: relative; width: 78px; height: 78px; border-radius: 50%;
    background: radial-gradient(circle at 38% 36%, #3a4038 0%, #1c201a 70%);
    border: 2px solid #4a5244; cursor: pointer;
    box-shadow: 0 3px 9px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .lc-wheel::before {   /* hub */
    content: ''; position: absolute; left: 50%; top: 50%;
    width: 16px; height: 16px; border-radius: 50%;
    background: #10120e; border: 1px solid #3a423a; transform: translate(-50%, -50%);
  }
  .lc-wheel-mark {
    position: absolute; left: 50%; bottom: 50%;
    width: 4px; height: 31px; border-radius: 2px; background: #aebf9e;
    transform-origin: bottom center; transform: translateX(-50%) rotate(0deg);
    transition: transform 0.14s ease;
  }

  /* ── Brandhahn (fuel cock) — red valve lever ── */
  .lc-cock {
    position: relative; width: 66px; height: 66px; border-radius: 50%;
    background: radial-gradient(circle at 38% 36%, #2a2e26 0%, #15170f 70%);
    border: 2px solid #3a4234; cursor: pointer; transition: box-shadow 0.15s;
  }
  .lc-cock::after {   /* centre pivot */
    content: ''; position: absolute; left: 50%; top: 50%;
    width: 9px; height: 9px; border-radius: 50%; background: #d8dce0;
    transform: translate(-50%, -50%); z-index: 2;
  }
  .lc-cock-lever {
    position: absolute; left: 50%; bottom: 50%;
    width: 8px; height: 25px; border-radius: 3px;
    background: linear-gradient(180deg, #e85048 0%, #a02018 100%);
    border: 1px solid #6a1410;
    transform-origin: bottom center; transform: translateX(-50%) rotate(0deg);
    transition: transform 0.16s ease; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  .lc-cock.lc-cock-closed { box-shadow: 0 0 13px rgba(255,70,58,0.5); }
`;

/* ── Build ─────────────────────────────────────────────────────── */
function _buildHTML() {
  const tokens = S.aircraft?.left ?? [];
  const has = (t) => tokens.includes(t);

  /* Throttle quadrant — the classic American 3-lever set: throttle / prop / mixture */
  const _QL = [['throttle', 'THR', 'q-black'], ['prop', 'PROP', 'q-blue'], ['mixture', 'MIX', 'q-red']];
  const quadrant = has('quadrant') ? `
        <div class="lc-ctrl">
          <div class="lc-label">THROTTLE QUADRANT</div>
          <div class="lc-quad">
            ${_QL.map(([id, lbl, cls]) => `
              <div class="lc-quad-col">
                <div class="lc-quad-track ${cls}" id="lc-q-${id}"><div class="lc-quad-handle"></div></div>
                <div class="lc-quad-lbl">${lbl}</div>
              </div>`).join('')}
          </div>
        </div>` : '';
  const throttle = has('throttle') ? `
        <div class="lc-ctrl">
          <div class="lc-label">GASHEBEL</div>
          <div class="lc-throttle-track" id="lc-throttle"><div class="lc-throttle-handle" id="lc-throttle-h"></div></div>
          <div class="lc-val" id="lc-throttle-v">—</div>
        </div>` : '';
  const trim = has('trim') ? `
        <div class="lc-ctrl">
          <div class="lc-label">HÖHENTRIMM</div>
          <div class="lc-wheel" id="lc-trim"><div class="lc-wheel-mark"></div></div>
          <div class="lc-val" id="lc-trim-v">—</div>
        </div>` : '';
  /* Cowl/radiator flaps are operated in a few steps, not finely dialed → discrete gate */
  const _liquid = S.aircraft?.coolingSystem === 'liquid';
  const _cfPos  = _liquid ? [['1', 'AUF'], ['0.5', 'HALB'], ['0', 'ZU']]
                          : [['1', 'OPEN'], ['0.5', 'TRAIL'], ['0', 'CLOSE']];
  const coolflap = has('coolflap') ? `
        <div class="lc-ctrl">
          <div class="lc-label">${_liquid ? 'KÜHLERKLAPPE' : 'COWL FLAPS'}</div>
          <div class="lc-gate" id="lc-coolflap">
            ${_cfPos.map(([v, lbl]) => `<div class="lc-gate-pos" data-v="${v}">${lbl}</div>`).join('')}
          </div>
        </div>` : '';
  const cock = has('fuelcock') ? `
        <div class="lc-ctrl">
          <div class="lc-label">BRANDHAHN</div>
          <div class="lc-cock" id="lc-cock"><div class="lc-cock-lever" id="lc-cock-l"></div></div>
          <div class="lc-val" id="lc-cock-v">—</div>
        </div>` : '';
  /* Parking brake — fighters have no pedestal, so it lives on the left console */
  const _pbPos = _liquid ? [['1', 'FEST'], ['0', 'LÖSEN']] : [['1', 'SET'], ['0', 'OFF']];
  const parkbrake = has('parkbrake') ? `
        <div class="lc-ctrl">
          <div class="lc-label">${_liquid ? 'PARKBREMSE' : 'PARK BRAKE'}</div>
          <div class="lc-gate" id="lc-parkbrake">
            ${_pbPos.map(([v, lbl]) => `<div class="lc-gate-pos" data-pb="${v}">${lbl}</div>`).join('')}
          </div>
        </div>` : '';

  return `
    <div class="lc-title">Linke Konsole</div>
    <div class="lc-row">${quadrant}${throttle}${trim}${coolflap}${cock}${parkbrake}</div>
    <div class="lc-hint">L · schliessen</div>
  `;
}

/* ── Handlers ──────────────────────────────────────────────────── */
function _attachHandlers() {
  if (!_el) return;

  /* Throttle quadrant — click a lever track to set its position */
  const _quad = (id, fn) => {
    const t = document.getElementById('lc-q-' + id);
    t?.addEventListener('click', e => {
      const rect = t.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      fn(frac);
    });
  };
  const _maxSpdQ = S.aircraft?.envelope?.maxSpd ?? 360;
  _quad('throttle', f => setState({ spdT: Math.round(f * _maxSpdQ) }));
  _quad('prop',     f => setState({ propPitch: f }));
  _quad('mixture',  f => setState({ mixture: f }));

  /* Gashebel — click the track to set the throttle (spdT, like +/-) */
  const track = document.getElementById('lc-throttle');
  track?.addEventListener('click', e => {
    const rect = track.getBoundingClientRect();
    const frac = 1 - (e.clientY - rect.top) / rect.height;   // 0 idle (bottom) … 1 full (top)
    const maxSpd = S.aircraft?.envelope?.maxSpd ?? 335;
    setState({ spdT: Math.round(Math.max(0, Math.min(1, frac)) * maxSpd) });
  });

  /* Höhentrimmrad — click upper half = nose up, lower = nose down (same 0.5 step as t/T) */
  const wheel = document.getElementById('lc-trim');
  wheel?.addEventListener('click', e => {
    const rect = wheel.getBoundingClientRect();
    const up = (e.clientY - rect.top) < rect.height / 2;
    setState({ trim: Math.max(-10, Math.min(10, (S.trim ?? 0) + (up ? 0.5 : -0.5))) });
  });

  /* Kühlerklappe / cowl flaps — discrete steps (open / half / closed) */
  _el.querySelectorAll('#lc-coolflap .lc-gate-pos').forEach(btn => {
    btn.addEventListener('click', () => setState({ coolFlap: +btn.dataset.v }));
  });

  /* Brandhahn — toggle fuel cock (fuelShutoff) */
  document.getElementById('lc-cock')?.addEventListener('click', () => {
    setState({ fuelShutoff: !S.fuelShutoff });
  });

  /* Parking brake — set / release */
  _el.querySelectorAll('#lc-parkbrake .lc-gate-pos').forEach(btn => {
    btn.addEventListener('click', () => setState({ parkBrake: btn.dataset.pb === '1' }));
  });
}

/* ── Live update ───────────────────────────────────────────────── */
function _update() {
  if (!_el || !_el.classList.contains('lcon-visible')) return;

  /* Throttle quadrant — each lever handle rides to its position */
  const _qPos = (id, frac) => {
    const h = _el.querySelector('#lc-q-' + id + ' .lc-quad-handle');
    if (h) h.style.top = `${(1 - Math.max(0, Math.min(1, frac))) * 88}%`;
  };
  const _maxSpdU = S.aircraft?.envelope?.maxSpd ?? 360;
  _qPos('throttle', (S.spdT ?? 0) / _maxSpdU);
  _qPos('prop',     S.propPitch ?? 1);
  _qPos('mixture',  S.mixture ?? 1);

  /* Gashebel — handle rides up with throttle */
  const maxSpd = S.aircraft?.envelope?.maxSpd ?? 335;
  const thr = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  const h = document.getElementById('lc-throttle-h');
  if (h) h.style.top = `${(1 - thr) * 89}%`;
  const tv = document.getElementById('lc-throttle-v');
  if (tv) tv.textContent = `${Math.round(thr * 100)}%`;

  /* Höhentrimmrad — wheel notch rotates with trim, ±10 → ±150° */
  const trim = S.trim ?? 0;
  const mk = _el.querySelector('#lc-trim .lc-wheel-mark');
  if (mk) mk.style.transform = `translateX(-50%) rotate(${trim / 10 * 150}deg)`;
  const trv = document.getElementById('lc-trim-v');
  if (trv) trv.textContent = trim === 0 ? 'NEUTRAL' : `${trim > 0 ? 'KOPF' : 'SCHWANZ'} ${Math.abs(trim).toFixed(1)}`;

  /* Kühlerklappe / cowl flaps — highlight the active step */
  const cf = S.coolFlap ?? 1;
  _el.querySelectorAll('#lc-coolflap .lc-gate-pos').forEach(btn =>
    btn.classList.toggle('lc-gate-on', Math.abs(+btn.dataset.v - cf) < 0.25));

  /* Brandhahn — lever up = AUF (open), sideways + glow = ZU (closed) */
  const closed = !!S.fuelShutoff;
  const lever = document.getElementById('lc-cock-l');
  if (lever) lever.style.transform = `translateX(-50%) rotate(${closed ? 90 : 0}deg)`;
  document.getElementById('lc-cock')?.classList.toggle('lc-cock-closed', closed);
  const cv = document.getElementById('lc-cock-v');
  if (cv) cv.textContent = closed ? 'ZU' : 'AUF';

  /* Parking brake — SET active = red caution, OFF active = green */
  const pbOn = !!S.parkBrake;
  _el.querySelectorAll('#lc-parkbrake .lc-gate-pos').forEach(btn => {
    const set = btn.dataset.pb === '1';
    btn.classList.toggle('lc-gate-warn', set && pbOn);
    btn.classList.toggle('lc-gate-on',  !set && !pbOn);
  });
}

/* ── Public API ────────────────────────────────────────────────── */
export function initLeftConsole() {
  document.getElementById('lcon')?.remove();
  if (!document.getElementById('lcon-style')) {
    const s = document.createElement('style');
    s.id = 'lcon-style';
    s.textContent = _CSS;
    document.head.appendChild(s);
  }
  _el = document.createElement('div');
  _el.id = 'lcon';
  document.body.appendChild(_el);
  _el.innerHTML = _buildHTML();
  _attachHandlers();
}

export function toggleLeftConsole() {
  if (!S.aircraft?.views?.includes('left')) return;   // aircraft declares no left console
  setState({ cockpitView: S.cockpitView === 'left' ? 'forward' : 'left' });
}

export function renderLeftConsole() {
  if (!_el) return;
  const visible    = S.cockpitView === 'left';
  const wasVisible = _el.classList.contains('lcon-visible');
  /* Airliners/transports (have an overhead) get the full-screen Captain station;
     fighters get a narrow side console. */
  _el.classList.toggle('lcon-wide', !!S.aircraft?.views?.includes('overhead'));
  _el.classList.toggle('lcon-visible', visible);
  if (visible && !wasVisible) {
    _el.innerHTML = _buildHTML();
    _attachHandlers();
  }
  if (visible) _update();
}
