/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/com.js
   COM radio panel + transponder.
   Call initCOM(container) once. Panel manages its own DOM.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

/* ── Default LSZH frequency card ── */
const FREQS_DEFAULT = {
  '121.750': { label: 'LSZH GROUND',               audio: 'audio/guete-morge.mp3' },
  '121.900': { label: 'LSZH CLEARANCE DELIVERY',   audio: null },
  '126.200': { label: 'LSZH ATIS',                 audio: 'audio/atis-zurich.mp3', atis: true },
  '118.100': { label: 'LSZH TOWER',                audio: null, squawk: true },
  '119.700': { label: 'LSZH APPROACH',             audio: null },
  '121.500': { label: 'GUARD',                     audio: null },
};

function _missionCom() { return S.mission?.com ?? null; }
function _freqs()      { return _missionCom()?.freqs ?? FREQS_DEFAULT; }
function _comTitle()   { return _missionCom()?.title ?? 'COM 1'; }
function _xpdrLabel()  { return _missionCom()?.xpdrLabel ?? 'XPDR'; }

/* ── COM state ── */
const COM = {
  active:  '121.750',
  standby: '121.900',
};

/* ── Transponder state ── */
const XPDR = {
  code:   [0, 0, 0, 0],   // 4 octal digits
  mode:   'MODE C',
  ident:  false,
};

let _squelchCtx = null;

/* ═══ Public ══════════════════════════════════════════════════ */

export function initCOM(container) {
  /* Seed COM state from mission if provided */
  const mc = _missionCom();
  if (mc) {
    COM.active  = mc.active  ?? Object.keys(mc.freqs)[0];
    COM.standby = mc.standby ?? Object.keys(mc.freqs)[1] ?? COM.active;
  } else {
    COM.active  = '121.750';
    COM.standby = '121.900';
  }
  container.innerHTML = _html();
  _render();
  _bindEvents(container);
}

/* ═══ Private — DOM ════════════════════════════════════════════ */

function _html() {
  return `
<div class="com-panel">

  <!-- COM radio -->
  <div class="com-section">
    <div class="com-header">
      <span class="com-title">${_comTitle()}</span>
      <span class="com-ptt" id="com-ptt-hint"></span>
    </div>

    <div class="com-row">
      <div class="com-freq-block">
        <div class="com-freq-label">ACTIVE</div>
        <div class="com-freq active" id="com-active">121.750</div>
        <div class="com-station" id="com-station">LSZH GROUND</div>
      </div>

      <button class="com-xfer" id="com-xfer" title="Transfer (T)">⇄</button>

      <div class="com-freq-block">
        <div class="com-freq-label">STANDBY</div>
        <div class="com-freq standby" id="com-standby">121.900</div>
        <div class="com-freq-tuner">
          <button class="com-tune" data-dir="-1">−</button>
          <button class="com-tune" data-dir="1">+</button>
        </div>
      </div>
    </div>

    <!-- Preset buttons -->
    <div class="com-presets" id="com-presets"></div>
  </div>

  <!-- Transponder -->
  <div class="xpdr-section">
    <div class="com-header">
      <span class="com-title">${_xpdrLabel()}</span>
      <span class="xpdr-mode" id="xpdr-mode">MODE C</span>
    </div>
    <div class="xpdr-row">
      <div class="xpdr-digits" id="xpdr-digits"></div>
      <button class="xpdr-ident" id="xpdr-ident">IDENT</button>
    </div>
    <div class="xpdr-status" id="xpdr-status"></div>
  </div>

</div>`;
}

function _render() {
  /* COM */
  const actEl  = document.getElementById('com-active');
  const sbyEl  = document.getElementById('com-standby');
  const staEl  = document.getElementById('com-station');
  if (actEl)  actEl.textContent  = COM.active;
  if (sbyEl)  sbyEl.textContent  = COM.standby;
  if (staEl)  staEl.textContent  = _freqs()[COM.active]?.label ?? COM.active;

  /* Presets */
  const pre = document.getElementById('com-presets');
  if (pre && pre.children.length === 0) {
    for (const [freq, info] of Object.entries(_freqs())) {
      const btn = document.createElement('button');
      btn.className   = 'com-preset-btn';
      btn.dataset.freq = freq;
      btn.title        = info.label;
      btn.innerHTML    = `<span class="preset-freq">${freq}</span><span class="preset-label">${info.label}</span>`;
      btn.addEventListener('click', () => _tuneStandby(freq));
      pre.appendChild(btn);
    }
  }

  /* XPDR digits */
  const dig = document.getElementById('xpdr-digits');
  if (dig && dig.children.length === 0) {
    XPDR.code.forEach((v, i) => {
      const span = document.createElement('span');
      span.className    = 'xpdr-digit';
      span.dataset.idx  = i;
      span.textContent  = v;
      span.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1 : -1;
        XPDR.code[i] = (XPDR.code[i] + delta + 8) % 8;
        span.textContent = XPDR.code[i];
        _renderXpdrStatus();
      });
      dig.appendChild(span);
    });
  } else if (dig) {
    [...dig.children].forEach((span, i) => { span.textContent = XPDR.code[i]; });
  }

  _renderXpdrStatus();
}

function _renderXpdrStatus() {
  const el = document.getElementById('xpdr-status');
  if (el) el.textContent = XPDR.code.join('');
}

function _bindEvents(container) {
  /* Transfer button */
  container.addEventListener('click', (e) => {
    if (e.target.id === 'com-xfer' || e.target.closest('#com-xfer')) _transfer();
    if (e.target.id === 'xpdr-ident' || e.target.closest('#xpdr-ident')) _ident();
  });

  /* Tune standby */
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.com-tune');
    if (!btn) return;
    _nudgeStandby(Number(btn.dataset.dir));
  });

  /* Keyboard */
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') _transfer();
  });

  /* PTT */
  document.addEventListener('ptt', (e) => {
    const hint = document.getElementById('com-ptt-hint');
    const actEl = document.getElementById('com-active');
    if (!hint || !actEl) return;
    if (e.detail.active) {
      hint.textContent = '● TX';
      actEl.classList.add('transmitting');
      _squelch();
    } else {
      hint.textContent = '';
      actEl.classList.remove('transmitting');
      _squelch();
    }
  });
}

/* ── Frequency logic ── */

function _transfer() {
  [COM.active, COM.standby] = [COM.standby, COM.active];
  _render();
  _squelch();
  _onTune(COM.active);
}

function _tuneStandby(freq) {
  COM.standby = freq;
  _render();
}

function _nudgeStandby(dir) {
  const list = Object.keys(_freqs());
  const i = list.indexOf(COM.standby);
  COM.standby = list[(i + dir + list.length) % list.length];
  _render();
}

function _onTune(freq) {
  const info = _freqs()[freq];
  if (!info) return;

  /* Auto-assign squawk on Tower */
  if (info.squawk) {
    const code = [4, _r8(), _r8(), _r8()];
    XPDR.code = code;
    _render();
    setTimeout(() => {
      const el = document.getElementById('xpdr-status');
      if (el) el.textContent = `ASSIGNED ${code.join('')}`;
    }, 600);
  }

  /* Play audio file if defined */
  if (info.audio) {
    const a = new Audio(info.audio);
    a.volume = 0.9;
    a.play().catch(() => {});
  }

  /* ATIS modal */
  if (info.atis) {
    _openATIS();
  }
}

function _r8() { return Math.floor(Math.random() * 8); }

/* ── IDENT ── */
function _ident() {
  XPDR.ident = true;
  const btn = document.getElementById('xpdr-ident');
  if (btn) btn.classList.add('active');
  setTimeout(() => {
    XPDR.ident = false;
    if (btn) btn.classList.remove('active');
  }, 4500);
}

/* ── Squelch click ── */
function _squelch() {
  if (!_squelchCtx) _squelchCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = _squelchCtx;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

/* ── ATIS modal (simple) ── */
function _openATIS() {
  const existing = document.getElementById('atis-modal');
  if (existing) { existing.remove(); return; }

  const m = S.metar;
  const lines = m ? _buildAtis(m) : ['ATIS NOT AVAILABLE'];

  const modal = document.createElement('div');
  modal.id = 'atis-modal';
  modal.innerHTML = `
    <div class="atis-title">ATIS LSZH · INFO ${_atisLetter()}</div>
    ${lines.map(l => `<div class="atis-line">${l}</div>`).join('')}
    <button class="atis-close" onclick="document.getElementById('atis-modal').remove()">×</button>
  `;
  document.body.appendChild(modal);
}

function _buildAtis(m) {
  const rwy = _rwyFromWind(m.wdir ?? 270);
  return [
    `RUNWAY IN USE: ${rwy}`,
    `WIND: ${String(m.wdir ?? '---').padStart(3,'0')}° / ${m.wspd ?? '--'} KT`,
    `QNH: ${m.altim ?? '----'} HPA`,
    `TEMP: ${m.temp ?? '--'}°C  DEW: ${m.dewp ?? '--'}°C`,
    `VIS: ${m.visib ?? '----'}`,
    m.clouds?.length ? `CLOUD: ${m.clouds.map(c => `${c.cover} ${c.base}FT`).join(' ')}` : 'SKY CLEAR',
    `ILS RWY ${rwy} · ${rwy === '28' ? '109.90' : '110.30'} MHZ`,
  ];
}

function _atisLetter() {
  return String.fromCharCode(65 + (Math.floor(Date.now() / 3600000) % 26));
}

function _rwyFromWind(wdir) {
  if (wdir >= 240 && wdir <= 300) return '28';
  if (wdir >= 60  && wdir <= 120) return '10';
  if (wdir >= 300 || wdir <= 30)  return '34';
  return '16';
}
