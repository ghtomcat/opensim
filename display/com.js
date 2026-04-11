/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/com.js
   COM radio panel + transponder.
   Call initCOM(container) once. Panel manages its own DOM.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { speakATC } from '../core/crew.js';

/* ── Default LSZH frequency card ── */
const FREQS_DEFAULT = {
  '121.750': { label: 'LSZH GROUND',               audio: 'audio/guete-morge.mp3',
               stream: 'http://d.liveatc.net/lszh1_gnd',
               streamPage: 'https://www.liveatc.net/hlisten.php?mount=lszh1_gnd&icao=lszh',
               checkin: (cs, alt, spd, phase) => alt !== null && alt > 500 ? null
                 : S.wow
                 ? `${cs}, Zürich Ground. Vacate runway, taxi to stand via Alpha.`
                 : `${cs}, Zürich Ground. Push and start approved, face east. QNH 1017.` },
  '121.900': { label: 'LSZH CLEARANCE DELIVERY',   audio: null,
               checkin: (cs) => `${cs}, Zürich Delivery. Cleared ILS runway 28 via LOBEP, climb 5000 feet, squawk 4721.` },
  '126.200': { label: 'LSZH ATIS',                 audio: 'audio/atis-zurich.mp3', atis: true },
  '118.100': { label: 'LSZH TOWER',                audio: null, squawk: true,
               stream: 'http://d.liveatc.net/lszh1_twr',
               streamPage: 'https://www.liveatc.net/hlisten.php?mount=lszh1_twr&icao=lszh',
               checkin: (cs, alt) => {
                 const m = S.metar;
                 const wind = m ? `Wind ${String(m.wdir??110).padStart(3,'0')} at ${m.wspd??5}.` : '';
                 const info = `Information ${_atisLetter()} current.`;
                 return `${cs}, Zürich Tower. Runway 28, cleared to land. ${wind} ${info}`;
               } },
  '119.700': { label: 'LSZH APPROACH',             audio: null,
               stream: 'http://d.liveatc.net/lszh_app_final',
               streamPage: 'https://www.liveatc.net/hlisten.php?mount=lszh_app_final&icao=lszh',
               checkin: (cs, alt) => `${cs}, Zürich Approach. Radar contact. ${alt ? `Confirm altitude ${Math.round(alt/100)*100} feet. ` : ''}Descend 4000 feet. Expect ILS runway 28. ` },
  '121.500': { label: 'GUARD',                     audio: null },
};

function _missionCom()  { return S.mission?.com ?? null; }
function _aircraftCom() { return S.aircraft?.com ?? null; }
function _activeCom()   { return _missionCom() ?? _aircraftCom(); }
function _freqs()       { return _activeCom()?.freqs ?? FREQS_DEFAULT; }
function _comTitle()    { return _activeCom()?.title ?? 'COM 1'; }
function _xpdrLabel()   { return _activeCom()?.xpdrLabel ?? 'XPDR'; }

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

let _squelchCtx  = null;
let _streamAudio = null;   // currently playing LiveATC stream
let _bound       = false;  // event listeners registered once only

/* ── Loop mode (rocket/mission audio) ── */
let _loopAudio  = null;    // currently playing mission audio loop
let _activeLoop = null;    // id of selected loop
let _loopBound  = false;   // loop event listeners registered

/* ═══ Public ══════════════════════════════════════════════════ */

export function initCOM(container) {
  _stopStream();
  _stopLoop();

  /* ── Loop mode: mission has com.loops array ── */
  const comCfg = _activeCom();
  if (comCfg?.loops) {
    _activeLoop = comCfg.active ?? null;
    container.innerHTML = _htmlLoops(comCfg);
    _renderLoops(comCfg);
    if (!_loopBound) { _bindLoopEvents(container); _loopBound = true; }
    return;
  }

  /* ── Standard airplane COM ── */
  if (comCfg?.freqs) {
    COM.active  = comCfg.active  ?? Object.keys(comCfg.freqs)[0];
    COM.standby = comCfg.standby ?? Object.keys(comCfg.freqs)[1] ?? COM.active;
  } else {
    COM.active  = '121.750';
    COM.standby = '121.900';
  }
  container.innerHTML = _html();
  _render();
  if (!_bound) { _bindEvents(container); _bound = true; }
  _onTune(COM.active);   // start stream if active freq has one
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

  /* Stop any active LiveATC stream */
  _stopStream();

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

  /* Start LiveATC stream if defined */
  if (info.stream) {
    _startStream(info.stream, info.streamPage);
  }

  /* Virtual ATC check-in */
  if (info.checkin) {
    const cs    = S.aircraft?.callsign ?? S.mission?.callsign ?? 'Traffic';
    const alt   = S.alt ? Math.round(S.alt) : null;
    const spd   = S.spd ? Math.round(S.spd) : 0;
    const phase = S.mission?.phase ?? null;
    const text  = info.checkin(cs, alt, spd, phase);
    if (text) setTimeout(() => speakATC(text), 1200);
  }
}

function _r8() { return Math.floor(Math.random() * 8); }

/* ═══ Loop mode (rocket / mission audio) ══════════════════════ */

function _stopLoop() {
  if (_loopAudio) {
    _loopAudio.pause();
    _loopAudio.src = '';
    _loopAudio = null;
  }
  _activeLoop = null;
}

function _htmlLoops(ac) {
  return `
<div class="com-panel">
  <div class="com-section" style="border-bottom:none">
    <div class="com-header">
      <span class="com-title">${ac?.title ?? 'MISSION AUDIO'}</span>
      <span id="loop-status" class="com-ptt"></span>
    </div>
    <div class="com-presets" id="loop-list"></div>
  </div>
</div>`;
}

function _renderLoops(ac) {
  const loops = (ac ?? _activeCom())?.loops ?? [];
  const list  = document.getElementById('loop-list');
  if (!list) return;
  list.innerHTML = '';

  for (const lp of loops) {
    const isPlaying = _activeLoop === lp.id && !!lp.audio;
    const btn = document.createElement('button');
    btn.className    = 'com-preset-btn' + (isPlaying ? ' loop-playing' : '');
    btn.dataset.loopId = lp.id;

    const icon    = isPlaying ? '■' : '▶';
    const iconCls = isPlaying ? 'preset-freq loop-active-icon' : 'preset-freq loop-idle-icon';
    const extra   = !lp.audio
      ? `<span class="preset-label" style="color:rgba(255,255,255,0.18)">NO FILE</span>`
      : (isPlaying ? `<span class="loop-playing-dot"></span>` : '');

    btn.innerHTML = `
      <span class="${iconCls}">${icon}</span>
      <span class="preset-label">${lp.label}</span>
      ${extra}`;
    list.appendChild(btn);
  }

  const status = document.getElementById('loop-status');
  if (status) {
    const cur = loops.find(l => l.id === _activeLoop && l.audio);
    status.textContent = cur ? '● PLAYING' : '';
    status.style.color = cur ? '#00ff88' : '';
  }
}

function _bindLoopEvents(container) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-loop-id]');
    if (!btn) return;
    const id  = btn.dataset.loopId;
    const ac  = _activeCom();
    const lp  = (ac?.loops ?? []).find(l => l.id === id);
    if (!lp) return;

    if (_activeLoop === id) {
      /* Toggle off */
      _stopLoop();
    } else {
      _stopLoop();
      _activeLoop = id;
      if (lp.audio) {
        const a   = new Audio(lp.audio);
        a.loop    = true;
        a.volume  = 0.75;
        a.play().catch(() => {});
        _loopAudio = a;
      }
    }
    _renderLoops(ac);
  });
}

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

/* ── LiveATC stream ── */
function _stopStream() {
  if (_streamAudio) {
    _streamAudio.pause();
    _streamAudio.src = '';
    _streamAudio = null;
  }
  const ind = document.getElementById('com-live-ind');
  if (ind) ind.remove();
}

function _startStream(url, fallbackPage) {
  /* Show fallback link immediately — direct stream blocked by Cloudflare */
  _setLiveIndicator('fallback', fallbackPage);
}

function _setLiveIndicator(state, fallbackPage) {
  let ind = document.getElementById('com-live-ind');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'com-live-ind';
    const header = document.querySelector('.com-section .com-header');
    if (header) header.appendChild(ind);
  }
  if (state === 'connecting') {
    ind.innerHTML = '<span class="com-live-dot connecting"></span>ATC';
  } else if (state === 'live') {
    ind.innerHTML = '<span class="com-live-dot live"></span>LIVE';
    ind.title = 'LiveATC stream playing — click to stop';
    ind.style.cursor = 'pointer';
    ind.onclick = () => { _stopStream(); };
  } else if (state === 'fallback') {
    ind.innerHTML = `<a class="com-live-link" href="${fallbackPage}" target="_blank" rel="noopener">🎧 LIVE ATC</a>`;
  }
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
  const letter = _atisLetter();
  const lines  = m ? _buildAtis(m) : ['ATIS NOT AVAILABLE'];

  const modal = document.createElement('div');
  modal.id = 'atis-modal';
  modal.innerHTML = `
    <div class="atis-title">ATIS LSZH · INFO ${letter}</div>
    ${lines.map(l => `<div class="atis-line">${l}</div>`).join('')}
    <button class="atis-close" onclick="document.getElementById('atis-modal').remove()">×</button>
  `;
  document.body.appendChild(modal);

  /* Speak ATIS via TTS */
  if (m) setTimeout(() => speakATC(_buildAtisSpoken(m, letter)), 600);
}

function _buildAtisSpoken(m, letter) {
  const rwy    = _rwyFromWind(m.wdir ?? 270);
  const wind   = m.wspd > 0
    ? `wind ${String(m.wdir ?? 270).padStart(3,'0')} degrees, ${m.wspd} knots`
    : 'wind calm';
  const vis    = m.visib ? `visibility ${m.visib}` : 'visibility good';
  const clouds = m.clouds?.length
    ? m.clouds.map(c => `${c.cover.toLowerCase()} at ${c.base} feet`).join(', ')
    : 'sky clear';
  const temp   = m.temp !== undefined ? `temperature ${m.temp}, dew point ${m.dewp ?? m.temp - 2}` : '';
  const qnh    = m.altim ? `QNH ${m.altim}` : '';

  return `Zürich information ${letter}. ` +
    `${wind}. ${vis}. ${clouds}. ` +
    `${temp}. ${qnh}. ` +
    `ILS approach runway ${rwy} in use. ` +
    `Advise on first contact you have information ${letter}.`;
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
