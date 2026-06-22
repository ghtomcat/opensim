/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/pedestal.js
   Centre pedestal — slides up from below, covers all other views.
   Shows thrust levers, flap handle, speed brake.
   Toggle: D key.  Close: D key again.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';
import { startEngineLifecycle, stopEngineLifecycle, startFuelPump, stopFuelPump } from '../core/sound.js';
import { buildFullRoute, altLabel } from '../core/route.js';
import { buildDescentPath } from '../core/vnav.js';

let _el = null;

const _DEG = Math.PI / 180;
function _gc(aLat, aLon, bLat, bLon) {                    // great-circle nm
  const p1 = aLat*_DEG, p2 = bLat*_DEG, dp = (bLat-aLat)*_DEG, dl = (bLon-aLon)*_DEG;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function _brg(aLat, aLon, bLat, bLon) {                   // initial bearing °
  const p1 = aLat*_DEG, p2 = bLat*_DEG, dl = (bLon-aLon)*_DEG;
  const y = Math.sin(dl)*Math.cos(p2), x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y, x)/_DEG + 360) % 360;
}

/* ── CSS ──────────────────────────────────────────────────────── */
const _CSS = `
  #ped {
    position: fixed; inset: 0; z-index: 180;
    background: #0d0f12;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 28px;
    padding: 24px 20px 20px;
    transform: translateY(100%);
    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
  }
  #ped.ped-visible { transform: translateY(0); }

  .ped-title {
    font: 600 10px/1 monospace; letter-spacing: 0.14em;
    color: #384050; text-transform: uppercase;
    align-self: flex-start; margin-left: 8px;
  }

  /* ── Thrust lever block ── */
  .ped-tl-block {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  .ped-tl-label {
    font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c;
  }
  .ped-tl-row {
    display: flex; gap: 22px; align-items: flex-end;
  }
  .ped-lever-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
  }
  .ped-lever-eng {
    font: 700 8px/1 monospace; letter-spacing: 0.06em; color: #3a4860;
  }
  /* Lever track */
  .ped-lever-track {
    position: relative;
    width: 28px; height: 160px;
    background: #141820;
    border: 1px solid #252c3c;
    border-radius: 4px;
    overflow: visible;
  }
  /* Detent marks */
  .ped-det {
    position: absolute; left: -1px; right: -1px;
    height: 1px; background: #2a3448;
    display: flex; align-items: center;
  }
  .ped-det-lbl {
    position: absolute; right: calc(100% + 5px);
    font: 600 7px/1 monospace; letter-spacing: 0.04em;
    color: #3a4860; white-space: nowrap;
  }
  /* Active detent label — highlighted when lever is at that position */
  .ped-det.ped-det-active { background: #3a5080; }
  .ped-det.ped-det-active .ped-det-lbl { color: #8ab0d8; }
  /* Lever head */
  .ped-lever-head {
    position: absolute; left: 50%; transform: translateX(-50%);
    width: 22px; height: 16px;
    background: linear-gradient(180deg, #50606e 0%, #303844 100%);
    border: 1px solid #6070880;
    border-radius: 3px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.6);
    cursor: ns-resize;
    transition: top 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    z-index: 2;
  }
  .ped-lever-head::after {
    content: '';
    position: absolute; left: 3px; right: 3px; top: 50%;
    height: 2px; border-radius: 1px;
    background: rgba(160,190,220,0.28);
    transform: translateY(-50%);
  }
  /* N1 readout under lever */
  .ped-n1 {
    font: 700 9px/1 monospace; letter-spacing: 0.04em;
    color: #40c080; width: 36px; text-align: center;
  }

  /* ── Flap handle ── */
  .ped-flap-block {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .ped-flap-label {
    font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c;
  }
  .ped-flap-gate {
    display: flex; gap: 0; border: 1px solid #252c3c;
    border-radius: 3px; overflow: hidden;
  }
  .ped-flap-pos {
    padding: 7px 14px;
    background: #141820;
    font: 700 9px/1 monospace; letter-spacing: 0.05em;
    color: #3a4860;
    cursor: pointer;
    border-right: 1px solid #252c3c;
    transition: background 0.08s, color 0.08s;
    user-select: none;
  }
  .ped-flap-pos:last-child { border-right: none; }
  .ped-flap-pos:hover { background: #1e2534; color: #6080a8; }
  .ped-flap-pos.ped-flap-sel {
    background: #1a2a40; color: #80b0e0;
    box-shadow: inset 0 -2px 0 #4070b0;
  }

  /* ── Speed brake ── */
  .ped-spdbk-block {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .ped-spdbk-label {
    font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c;
  }
  .ped-spdbk-gate {
    display: flex; gap: 0; border: 1px solid #252c3c;
    border-radius: 3px; overflow: hidden;
  }
  .ped-spdbk-pos {
    padding: 7px 14px;
    background: #141820;
    font: 700 9px/1 monospace; letter-spacing: 0.05em;
    color: #3a4860; cursor: pointer;
    border-right: 1px solid #252c3c;
    transition: background 0.08s, color 0.08s;
    user-select: none;
  }
  .ped-spdbk-pos:last-child { border-right: none; }
  .ped-spdbk-pos:hover { background: #1e2534; color: #6080a8; }
  .ped-spdbk-pos.ped-spdbk-sel {
    background: #2a1a14; color: #e09050;
    box-shadow: inset 0 -2px 0 #b06030;
  }


  /* ── Parking brake ── */
  .ped-park-block { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ped-park-label { font: 600 9px/1 monospace; letter-spacing: 0.10em; color: #50607c; }
  .ped-park-gate { display: flex; gap: 0; border: 1px solid #252c3c; border-radius: 3px; overflow: hidden; }
  .ped-park-pos {
    padding: 7px 16px; background: #141820;
    font: 700 9px/1 monospace; letter-spacing: 0.05em;
    color: #3a4860; cursor: pointer; border-right: 1px solid #252c3c;
    transition: background 0.08s, color 0.08s; user-select: none;
  }
  .ped-park-pos:last-child { border-right: none; }
  .ped-park-pos:hover { background: #1e2534; color: #6080a8; }
  .ped-park-pos.ped-park-sel-on  { background: #3a1414; color: #ff5a4a; box-shadow: inset 0 -2px 0 #c02020; }
  .ped-park-pos.ped-park-sel-off { background: #14241a; color: #5ad08a; box-shadow: inset 0 -2px 0 #2a8050; }

  /* ── Light-piston vernier knobs + magneto (C172 pedestal) ── */
  .ped-flexrow { display: flex; gap: 36px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
  .ped-knob-block { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .ped-knob-label { font: 600 9px/1 monospace; letter-spacing: 0.12em; color: #50607c; }
  .ped-knob-row { display: flex; gap: 26px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
  .ped-knob-wrap { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  .ped-knob {
    width: 42px; height: 42px; border-radius: 50%;
    background: radial-gradient(circle at 34% 32%, #3a4150 0%, #20252f 55%, #14171e 100%);
    border: 2px solid #303848; cursor: pointer; user-select: none;
    box-shadow: 0 3px 9px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06);
    transition: transform 0.18s ease, box-shadow 0.15s; position: relative;
  }
  .ped-knob i {
    position: absolute; top: 4px; left: 50%; width: 3px; height: 13px;
    background: #c8cdd4; border-radius: 1px; transform: translateX(-50%);
  }
  .ped-knob.knob-black { background: radial-gradient(circle at 34% 32%, #30343c 0%, #15171c 60%, #0c0d10 100%); border-color: #2a2e36; }
  .ped-knob.knob-red   { background: radial-gradient(circle at 34% 32%, #b84038 0%, #7a221c 60%, #4a1210 100%); border-color: #803028; }
  .ped-knob.knob-blue  { background: radial-gradient(circle at 34% 32%, #3a6db8 0%, #1e3f7a 60%, #122648 100%); border-color: #2a4a80; }
  .ped-knob.knob-plain { background: radial-gradient(circle at 34% 32%, #6a7280 0%, #424a58 60%, #2a303a 100%); border-color: #4a5260; }
  .ped-knob.ped-knob-lit { box-shadow: 0 3px 9px rgba(0,0,0,0.7), 0 0 8px rgba(110,170,230,0.35), inset 0 1px 0 rgba(255,255,255,0.08); }
  .ped-knob-name { font: 700 7px/1 monospace; letter-spacing: 0.05em; color: #50607c; }
  .ped-knob-val  { font: 700 9px/1 monospace; letter-spacing: 0.04em; color: #80b0e0; }

  /* ── Fuel selector — white rotary lever (LEFT / BOTH / RIGHT) ── */
  .ped-fsel { position: relative; width: 88px; height: 68px; cursor: pointer; user-select: none; }
  .ped-fsel-lbl {
    position: absolute; transform: translate(-50%, -50%);
    font: 700 7px/1 monospace; letter-spacing: 0.03em; color: rgba(255,255,255,0.32); white-space: nowrap;
  }
  .ped-fsel-lbl.ped-fsel-lbl-on { color: #e8f0f8; }
  .ped-fsel-lbl[data-fsel="LEFT"]  { left: 17%; top: 42%; }
  .ped-fsel-lbl[data-fsel="BOTH"]  { left: 50%; top: 13%; }
  .ped-fsel-lbl[data-fsel="RIGHT"] { left: 83%; top: 42%; }
  .ped-fsel-knob {
    position: absolute; left: 50%; top: 58%; transform: translate(-50%, -50%);
    width: 34px; height: 34px; border-radius: 50%;
    background: radial-gradient(circle at 36% 36%, #2c3040 0%, #141820 100%);
    border: 1px solid rgba(255,255,255,0.22);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.6);
  }
  .ped-fsel-lever {   /* white winged handle, points up (BOTH) at 0deg */
    position: absolute; left: 50%; bottom: 50%;
    width: 7px; height: 21px; border-radius: 3px;
    background: linear-gradient(180deg, #f0f2f5 0%, #c4c8ce 100%);
    border: 1px solid rgba(0,0,0,0.30);
    transform-origin: bottom center; transform: translateX(-50%) rotate(0deg);
    transition: transform 0.18s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }

  /* ── Fuel shutoff — red cutoff knob ── */
  .ped-shutoff {
    width: 38px; height: 38px; border-radius: 50%;
    background: radial-gradient(circle at 36% 32%, #e85048 0%, #b02018 55%, #7a1410 100%);
    border: 2px solid #6a1410; cursor: pointer; user-select: none;
    box-shadow: 0 3px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.18);
    display: flex; align-items: center; justify-content: center;
    transition: box-shadow 0.15s, transform 0.12s;
  }
  .ped-shutoff span { font: 700 7px/1 monospace; letter-spacing: 0.06em; color: rgba(255,255,255,0); }
  .ped-shutoff.ped-shutoff-on {
    transform: translateY(-3px);   /* pulled out */
    box-shadow: 0 6px 13px rgba(0,0,0,0.6), 0 0 12px rgba(255,70,58,0.6), inset 0 1px 0 rgba(255,255,255,0.18);
  }
  .ped-shutoff.ped-shutoff-on span { color: #fff; }

  /* ── Bat-handle toggle switches (G1000 design, recreated in the DOM) ── */
  .ped-toggle-block { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .ped-toggle-grouplabel { font: 600 9px/1 monospace; letter-spacing: 0.12em; color: #50607c; }
  .ped-toggle-row { display: flex; gap: 16px; }
  .ped-toggle { display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; user-select: none; width: 34px; }
  .ped-toggle-housing {
    width: 16px; height: 26px; border-radius: 3px;
    background: #0c1018; border: 1px solid rgba(255,255,255,0.14); position: relative;
  }
  .ped-toggle-lever {
    position: absolute; left: 50%; transform: translateX(-50%); bottom: 3px;
    width: 5px; height: 11px; border-radius: 2px; background: #2c3038;
    transition: bottom 0.14s ease, background 0.1s;
  }
  .ped-toggle.on .ped-toggle-lever { bottom: 12px; background: #9eaabf; box-shadow: inset 1px 0 0 rgba(255,255,255,0.22); }
  .ped-toggle-led { width: 6px; height: 6px; border-radius: 50%; background: #101810; transition: background 0.1s, box-shadow 0.1s; }
  .ped-toggle.on .ped-toggle-led { background: #38d060; box-shadow: 0 0 6px rgba(56,208,96,0.6); }
  .ped-toggle-lbl { font: 700 7px/1 monospace; letter-spacing: 0.04em; color: rgba(255,255,255,0.24); }
  .ped-toggle.on .ped-toggle-lbl { color: rgba(255,255,255,0.62); }

  /* ── Magneto rotary (G1000 design) ── */
  .ped-magrot { position: relative; width: 92px; height: 80px; cursor: pointer; user-select: none; }
  .ped-magrot-lbl {
    position: absolute; transform: translate(-50%, -50%);
    font: 700 7px/1 monospace; letter-spacing: 0.03em; color: rgba(255,255,255,0.30); white-space: nowrap;
  }
  .ped-magrot-lbl.ped-magrot-lbl-on { color: #e8f0f8; }
  .ped-magrot-lbl[data-magl="OFF"]   { left: 17%; top: 74%; }
  .ped-magrot-lbl[data-magl="R"]     { left: 17%; top: 33%; }
  .ped-magrot-lbl[data-magl="L"]     { left: 50%; top: 12%; }
  .ped-magrot-lbl[data-magl="BOTH"]  { left: 83%; top: 33%; }
  .ped-magrot-lbl[data-magl="START"] { left: 83%; top: 74%; }
  .ped-magrot-knob {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: 38px; height: 38px; border-radius: 50%;
    background: radial-gradient(circle at 36% 36%, #2c3040 0%, #141820 100%);
    border: 1px solid rgba(255,255,255,0.22);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.6);
  }
  .ped-magrot-knob::after {
    content: ''; position: absolute; left: 50%; top: 50%;
    width: 6px; height: 6px; border-radius: 50%; background: #d8dce0;
    transform: translate(-50%, -50%); z-index: 2;
  }
  .ped-magrot-ptr {
    position: absolute; left: 50%; bottom: 50%;
    width: 3px; height: 15px; border-radius: 1px; background: #d8dce0;
    transform-origin: bottom center; transform: translateX(-50%) rotate(0deg);
    transition: transform 0.18s ease;
  }

  /* ── Circuit breakers (decorative) ── */
  .ped-brk-block { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ped-brk-label { font: 600 9px/1 monospace; letter-spacing: 0.12em; color: #50607c; }
  .ped-brk-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 7px; }
  .ped-brk-dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: radial-gradient(circle at 36% 34%, #2a2e36 0%, #16181e 70%);
    border: 1px solid #2a3040; display: block;
  }

  /* ── Parking-brake annunciator (visible in any view when set) ── */
  #parkbrk-ind {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 170; display: none;
    padding: 4px 12px; border-radius: 4px;
    background: rgba(58,10,10,0.86); border: 1px solid #c02020;
    font: 700 12px/1 monospace; letter-spacing: 0.14em; color: #ff5a4a;
    box-shadow: 0 0 10px rgba(192,32,32,0.4);
  }
  #parkbrk-ind.pb-on { display: block; }

  /* ── Close hint ── */
  .ped-hint {
    font: 500 9px/1 monospace; letter-spacing: 0.08em;
    color: #28303c; margin-top: 4px;
  }

  /* ── Separator ── */
  .ped-sep {
    width: 200px; height: 1px; background: #181e28;
  }

  /* ── Engine start ── */
  .ped-eng-block {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  .ped-eng-block-label {
    font: 600 9px/1 monospace; letter-spacing: 0.12em; color: #50607c;
  }

  /* Master flip toggle switches */
  .ped-masters-row { display: flex; gap: 8px; }
  .ped-flip-wrap   { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .ped-flip-top-label {
    font: 600 7px/1 monospace; letter-spacing: 0.06em; color: #384858;
  }
  .ped-flip-track {
    width: 48px; height: 24px;
    background: #0c1016; border: 1px solid #1c2530; border-radius: 2px;
    position: relative; cursor: pointer; user-select: none;
  }
  .ped-flip-off-lbl, .ped-flip-on-lbl {
    position: absolute; top: 50%; transform: translateY(-50%);
    font: 600 6px/1 monospace; color: #283848; pointer-events: none;
  }
  .ped-flip-off-lbl { left: 3px; }
  .ped-flip-on-lbl  { right: 3px; }
  .ped-flip-lever {
    position: absolute; top: 2px; bottom: 2px; width: 20px; left: 3px;
    background: linear-gradient(160deg, #606878 0%, #404858 100%);
    border: 1px solid #5a6878; border-radius: 2px;
    display: flex; align-items: center; justify-content: center;
    transition: left 0.14s ease;
  }
  .ped-flip-track.flip-on .ped-flip-lever { left: calc(100% - 23px); }
  .ped-flip-lever-txt {
    font: 700 6px/1.2 monospace; color: #9ab0c0; text-align: center; pointer-events: none;
  }
  /* ON state — lever brighter, track lit */
  .ped-flip-track.flip-on { background: #0c1a12; border-color: #1e3a28; }
  .ped-flip-track.flip-on .ped-flip-lever {
    background: linear-gradient(160deg, #4a8060 0%, #2a5040 100%);
    border-color: #4a7060;
  }
  .ped-flip-track.flip-on .ped-flip-lever-txt { color: #80d0a0; }

  /* Rotary mode knob */
  .ped-rotary-wrap  { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .ped-rotary-area  {
    position: relative; width: 110px; height: 72px;
    display: flex; align-items: center; justify-content: center;
  }
  .ped-rotary-knob {
    width: 46px; height: 46px; border-radius: 50%;
    background: radial-gradient(circle at 34% 34%, #808898 0%, #50586a 45%, #282834 100%);
    border: 2px solid #484858;
    cursor: pointer; user-select: none;
    box-shadow: 0 3px 10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08);
    transition: transform 0.20s ease;
    position: relative; z-index: 1;
  }
  /* White indicator line, points up at 0° */
  .ped-rotary-knob::after {
    content: '';
    position: absolute; top: 5px; left: 50%;
    width: 3px; height: 13px;
    background: #d8dce0; border-radius: 1px;
    transform: translateX(-50%);
  }
  .ped-rot-lbl-crank, .ped-rot-lbl-norm, .ped-rot-lbl-ign {
    position: absolute;
    font: 700 6px/1.3 monospace; letter-spacing: 0.05em;
    color: #506878; text-align: center; pointer-events: none; white-space: nowrap;
  }
  .ped-rot-lbl-crank { bottom: 0; left: 2px; }
  .ped-rot-lbl-norm  { top: 0;    left: 50%; transform: translateX(-50%); }
  .ped-rot-lbl-ign   { bottom: 0; right: 2px; }
  .ped-rotary-sub {
    font: 600 8px/1 monospace; letter-spacing: 0.10em; color: #485868;
  }

  /* ── Two-column layout: controls + MCDU ── */
  .ped-main {
    display: flex; gap: 48px; align-items: flex-start; justify-content: center;
  }
  .ped-controls {
    display: flex; flex-direction: column; align-items: center; gap: 28px;
  }

  /* ── MCDU (Airbus F-PLN page, read-only) ── */
  .ped-mcdu {
    width: 500px; max-height: 82vh;
    display: flex; flex-direction: column;
    background: #04070a; border: 1px solid #1b2730; border-radius: 8px;
    padding: 16px 18px 14px;
    font-family: "IBM Plex Mono","Courier New",monospace;
    box-shadow: inset 0 0 60px rgba(0,50,40,0.10), 0 8px 30px rgba(0,0,0,0.5);
  }
  .mcdu-hdr {
    display: flex; justify-content: space-between; align-items: baseline;
    color: #e8ecf0; font-size: 15px; letter-spacing: 0.10em;
    padding-bottom: 9px; border-bottom: 1px solid #1b2730;
  }
  .mcdu-dim { color: #56707f; }
  .mcdu-cols, .mcdu-wp {
    display: grid; grid-template-columns: 1fr auto 78px; gap: 16px; align-items: baseline;
  }
  .mcdu-cols {
    color: #44586a; font-size: 11px; letter-spacing: 0.06em; padding: 8px 2px 2px;
  }
  .mcdu-cols span:last-child { text-align: right; }
  .mcdu-list { overflow-y: auto; flex: 1; padding-right: 4px; }
  .mcdu-wp { padding: 4px 2px; }
  .mcdu-id  { font-size: 18px; letter-spacing: 0.04em; }
  .mcdu-id.gr  { color: #3ddc6e; }
  .mcdu-id.wht { color: #e8ecf0; }
  .mcdu-td  { color: #6b8294; font-size: 13px; align-self: center; }
  .mcdu-alt { color: #d96ec8; font-size: 14px; text-align: right; }
  .mcdu-alt.pred { color: #56707f; }   /* FMS-predicted altitude (no published constraint) */
  .mcdu-div.td { color: #8fd6ff; border-top: 1px dashed #2b4658; }   /* Top of Descent marker */
  .mcdu-div {
    font-size: 12px; letter-spacing: 0.12em;
    padding: 11px 2px 4px; margin-top: 5px; border-top: 1px solid #121a22;
  }
  .mcdu-div.cy { color: #56c7e6; } .mcdu-div.mg { color: #d96ec8; }
  .mcdu-div.am { color: #e6b455; } .mcdu-div.or { color: #ef9a5a; }
  .mcdu-empty { color: #56707f; text-align: center; padding: 48px 0; font-size: 14px; line-height: 1.8; }
`;

/* ── Helpers ──────────────────────────────────────────────────── */

/* Return 0-1 fraction for lever position: IDLE=0, TOGA=1 */
function _leverFrac() {
  return Math.max(0, Math.min(1, S.thrustLever ?? 0));   // lever position (0=idle…1=TOGA)
}

/* Return index of nearest thrust profile to the current lever position */
function _activeProfileIdx() {
  const profiles = S.aircraft?.thrustProfiles;
  if (!profiles?.length) return -1;
  const maxSpdT = Math.max(...profiles.map(p => p.spdT)) || 1;
  const lever   = S.thrustLever ?? 0;
  let best = 0, bestD = Infinity;
  profiles.forEach((p, i) => {
    const d = Math.abs(lever - p.spdT / maxSpdT);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/* ── MCDU — Airbus F-PLN page (read-only) ─────────────────────────
   The text twin of the ND: the same buildFullRoute flight plan as a scrollable list, one
   row per waypoint with track/distance and the altitude constraint, grouped by segment. */
function _mcduHTML() {
  const dep = S.mission?.departure, arr = S.mission?.arrival;
  const tag = (d) => d?.icao ? d.icao + (d.runway ? d.runway : '') : '----';
  const from = tag(dep), to = tag(arr);
  const hdr = `<div class="mcdu-hdr"><span>F-PLN</span><span class="mcdu-dim">${from} → ${to}</span></div>`;

  let route = null; try { route = buildFullRoute(dep, arr); } catch {}
  if (!route?.legs?.length) {
    const why = (!dep?.icao || !arr?.icao) ? 'needs departure + arrival' : 'procedures not loaded';
    return hdr + `<div class="mcdu-empty">NO FLIGHT PLAN<br><span class="mcdu-dim">${why}</span></div>`;
  }

  /* FMS vertical predictions — the descent path's altitude at each fix + the Top of Descent. */
  let prof = null;
  try {
    const cruiseAlt = Math.max(S.alt ?? 0, S.altT ?? 0);   // the real cruise you descend from (not the type ceiling)
    prof = buildDescentPath(route.legs, cruiseAlt, arr?.elevation ?? 0);
  } catch {}
  const _predLabel = (ft) => ft == null ? '' : (ft >= 18000 ? 'FL' + Math.round(ft / 100) : String(Math.round(ft / 100) * 100));
  let todAfter = -1;
  if (prof) for (let i = 0; i < route.legs.length - 1; i++)
    if (prof.distToEnd[i] >= prof.todDist && prof.distToEnd[i + 1] < prof.todDist) { todAfter = i; break; }

  const segName = { sid: route.sid?.name, star: route.star?.name, app: route.appr };
  const segLbl  = { sid: 'SID', awy: 'AIRWAY', star: 'STAR', app: 'APPR' };
  const segCol  = { sid: 'cy', awy: 'mg', star: 'am', app: 'or' };
  let rows = '', lastSeg = null;
  route.legs.forEach((l, i) => {
    const isApt = l.seg === 'dep' || l.seg === 'arr';
    if (!isApt && l.seg !== lastSeg) {
      const nm = segName[l.seg];
      rows += `<div class="mcdu-div ${segCol[l.seg]}">${nm ? nm + ' · ' : ''}${segLbl[l.seg] || ''}</div>`;
    }
    lastSeg = l.seg;
    if (!l.id) return;
    let td = '';
    if (i > 0) { const p = route.legs[i-1];
      td = `${String(Math.round(_brg(p.lat, p.lon, l.lat, l.lon))).padStart(3, '0')}°/${Math.round(_gc(p.lat, p.lon, l.lat, l.lon))}`; }
    const con = altLabel(l.alt);                                    // published constraint (magenta) wins, else FMS prediction (dim)
    const alt = con ? `<span class="mcdu-alt">${con}</span>`
                    : `<span class="mcdu-alt pred">${prof ? _predLabel(prof.predAlt[i]) : ''}</span>`;
    rows += `<div class="mcdu-wp"><span class="mcdu-id ${isApt ? 'wht' : 'gr'}">${l.id}</span>` +
            `<span class="mcdu-td">${td}</span>${alt}</div>`;
    if (i === todAfter) rows += `<div class="mcdu-div td">⊤ T/D · TOP OF DESCENT</div>`;
  });

  return hdr +
    `<div class="mcdu-cols"><span>WPT</span><span>TRK/DIST</span><span>ALT</span></div>` +
    `<div class="mcdu-list">${rows}</div>`;
}

/* ── HTML builder ─────────────────────────────────────────────── */

/* Which control groups sit on this aircraft's pedestal, in render order.
   Explicit `aircraft.pedestal` wins; otherwise derive the historical airliner
   layout so every existing aircraft renders byte-identical (no JSON churn). */
function _pedestalTokens() {
  if (Array.isArray(S.aircraft?.pedestal)) return S.aircraft.pedestal;
  const t = ['thrust', 'flaps', 'speedbrake'];
  /* AUTO BRK lives on the centre panel (M view), not the pedestal — see centerconsole.js */
  t.push('parkbrake');
  if (S.aircraft?.engine?.type === 'turbofan') t.push('engstart');
  if (!['g1000', 'dr400', 'velis-epsi'].includes(S.aircraft?.panel)) t.push('mcdu');
  return t;
}

function _buildHTML() {
  const tokens    = _pedestalTokens();
  const has       = (t) => tokens.includes(t);
  const profiles  = S.aircraft?.thrustProfiles ?? [
    { label: 'IDLE', spdT: 0 },
    { label: 'CLB',  spdT: 175 },
    { label: 'MCT',  spdT: 280 },
    { label: 'TOGA', spdT: 350 },
  ];
  const engCount  = S.aircraft?.engine?.count ?? 2;
  const flapCfgs  = S.aircraft?.flaps ?? [
    { label: '0' }, { label: '1+F' }, { label: '2' }, { label: '3' },
  ];

  /* ── Thrust levers (quadrant — airliners + large props) ── */
  const thrustBlock = has('thrust') ? (() => {
    /* Detent positions top-to-bottom: TOGA at top (0%), IDLE at bottom (100%) */
    const detentPcts = profiles.map((_, i) => {
      const frac = i / Math.max(1, profiles.length - 1);
      return (1 - frac) * 82 + 4;   // 4% (top) … 86% (bottom), leaving head room
    }).reverse();  // reverse: TOGA first = top

    let leverCols = '';
    for (let e = 0; e < engCount; e++) {
      leverCols += `
      <div class="ped-lever-wrap">
        <div class="ped-lever-eng">${e + 1}</div>
        <div class="ped-lever-track" data-eng="${e}">
          ${profiles.map((p, i) => `
            <div class="ped-det" data-det="${i}" style="top:${detentPcts[profiles.length-1-i]}%">
              ${e === 0 ? `<span class="ped-det-lbl">${p.label}</span>` : ''}
            </div>
          `).join('')}
          <div class="ped-lever-head" id="ped-lh-${e}"></div>
        </div>
        <div class="ped-n1" id="ped-n1-${e}">—</div>
      </div>`;
    }
    return `
        <div class="ped-tl-block">
          <div class="ped-tl-label">THRUST</div>
          <div class="ped-tl-row">${leverCols}</div>
        </div>

        <div class="ped-sep"></div>`;
  })() : '';

  /* ── Engine vernier knobs (light pistons) + magneto ── */
  const KNOBS = [
    { tok: 'throttle', label: 'THROTTLE',  cls: 'knob-black' },
    { tok: 'prop',     label: 'PROP',      cls: 'knob-blue'  },
    { tok: 'mixture',  label: 'MIXTURE',   cls: 'knob-red'   },
    { tok: 'carbheat', label: 'CARB HEAT', cls: 'knob-plain' },
  ].filter(k => has(k.tok));
  const knobsBlock = (KNOBS.length || has('magneto')) ? `
        <div class="ped-knob-block">
          <div class="ped-knob-label">ENGINE</div>
          <div class="ped-knob-row">
            ${KNOBS.map(k => `
              <div class="ped-knob-wrap">
                <div class="ped-knob ${k.cls}" id="ped-knob-${k.tok}"><i></i></div>
                <div class="ped-knob-name">${k.label}</div>
                <div class="ped-knob-val" id="ped-kv-${k.tok}">—</div>
              </div>`).join('')}
            ${has('magneto') ? `
              <div class="ped-knob-wrap">
                <div class="ped-magrot" id="ped-mag-rot">
                  ${['OFF', 'R', 'L', 'BOTH', 'START'].map(p =>
                    `<span class="ped-magrot-lbl" data-magl="${p}">${p}</span>`).join('')}
                  <div class="ped-magrot-knob"><div class="ped-magrot-ptr" id="ped-mag-ptr"></div></div>
                </div>
                <div class="ped-knob-name">MAGNETOS</div>
              </div>` : ''}
          </div>
        </div>
        <div class="ped-sep"></div>` : '';

  /* ── Flex row: flaps / spd brk / fuel / elec / lights / park brk ── */
  const flapBtns = flapCfgs.map((f, i) =>
    `<div class="ped-flap-pos" data-flap="${i}">${f.label}</div>`
  ).join('');
  const sbBtns = ['RET', 'ARM', 'FULL'].map((lbl, i) =>
    `<div class="ped-spdbk-pos" data-sb="${i}">${lbl}</div>`
  ).join('');

  const flapBlock = has('flaps') ? `
          <div class="ped-flap-block">
            <div class="ped-flap-label">FLAPS</div>
            <div class="ped-flap-gate">${flapBtns}</div>
          </div>` : '';
  const sbBlock = has('speedbrake') ? `
          <div class="ped-spdbk-block">
            <div class="ped-spdbk-label">SPD BRK</div>
            <div class="ped-spdbk-gate">${sbBtns}</div>
          </div>` : '';
  const pbBlock = has('parkbrake') ? `
          <div class="ped-park-block">
            <div class="ped-park-label">PARK BRK</div>
            <div class="ped-park-gate">
              <div class="ped-park-pos" data-pb="1">ON</div>
              <div class="ped-park-pos" data-pb="0">OFF</div>
            </div>
          </div>` : '';
  /* ── Fuel selector — white rotary lever (LEFT / BOTH / RIGHT) ── */
  const fuelBlock = has('fuel') ? `
          <div class="ped-knob-wrap">
            <div class="ped-fsel" id="ped-fsel">
              ${['LEFT', 'BOTH', 'RIGHT'].map(p =>
                `<span class="ped-fsel-lbl" data-fsel="${p}">${p}</span>`).join('')}
              <div class="ped-fsel-knob"><div class="ped-fsel-lever" id="ped-fsel-lever"></div></div>
            </div>
            <div class="ped-knob-name">FUEL SEL</div>
          </div>` : '';
  /* ── Fuel shutoff — red cutoff knob (push in = on, pull out = OFF) ── */
  const cutoffBlock = has('fuelcutoff') ? `
          <div class="ped-knob-wrap">
            <div class="ped-shutoff" id="ped-shutoff"><span>OFF</span></div>
            <div class="ped-knob-name">FUEL<br>SHUTOFF</div>
          </div>` : '';
  /* Bat-handle toggle (G1000 design: housing + lever + LED) */
  const _toggle = (attr, key, lbl) => `
              <div class="ped-toggle" data-${attr}="${key}">
                <div class="ped-toggle-housing"><span class="ped-toggle-lever"></span></div>
                <span class="ped-toggle-led"></span>
                <span class="ped-toggle-lbl">${lbl}</span>
              </div>`;
  /* ── Electrical switches (master / avionics / fuel pump) ── */
  const switchBlock = has('switches') ? `
          <div class="ped-toggle-block">
            <div class="ped-toggle-grouplabel">ELEC</div>
            <div class="ped-toggle-row">${[
              ['masterBat', 'BAT'], ['masterAlt', 'ALT'], ['avionicsOn', 'AVNCS'], ['fuelPump', 'PUMP'],
            ].map(([id, lbl]) => _toggle('sw', id, lbl)).join('')}</div>
          </div>` : '';
  /* ── Exterior lights ── */
  const lightsBlock = has('lights') ? `
          <div class="ped-toggle-block">
            <div class="ped-toggle-grouplabel">LIGHTS</div>
            <div class="ped-toggle-row">${[
              ['nav', 'NAV'], ['beacon', 'BCN'], ['strobe', 'STRB'], ['landing', 'LAND'],
            ].map(([k, lbl]) => _toggle('light', k, lbl)).join('')}</div>
          </div>` : '';
  const flexRow = (flapBlock || sbBlock || pbBlock || fuelBlock || cutoffBlock || switchBlock || lightsBlock) ? `
        <div class="ped-flexrow">${flapBlock}${sbBlock}${fuelBlock}${cutoffBlock}${switchBlock}${lightsBlock}${pbBlock}
        </div>` : '';
  /* ── Circuit breakers (decorative — light singles) ── */
  const breakersBlock = has('breakers') ? `
        <div class="ped-brk-block">
          <div class="ped-brk-label">CIRCUIT BREAKERS</div>
          <div class="ped-brk-grid">${Array.from({ length: 20 }, () => '<i class="ped-brk-dot"></i>').join('')}</div>
        </div>` : '';

  /* ── ENG START section (turbofan) ── */
  const engStartSection = has('engstart') ? (() => {
    const flips = Array.from({ length: engCount }, (_, i) => `
      <div class="ped-flip-wrap">
        <div class="ped-flip-top-label">MASTER</div>
        <div class="ped-flip-track" id="ped-master-${i + 1}">
          <span class="ped-flip-off-lbl">OFF</span>
          <div class="ped-flip-lever">
            <span class="ped-flip-lever-txt">ENG<br>${i + 1}</span>
          </div>
          <span class="ped-flip-on-lbl">ON</span>
        </div>
      </div>`).join('');
    return `
      <div class="ped-sep"></div>
      <div class="ped-eng-block">
        <div class="ped-eng-block-label">ENGINE START</div>
        <div class="ped-masters-row">${flips}</div>
        <div class="ped-rotary-wrap">
          <div class="ped-rotary-area">
            <span class="ped-rot-lbl-crank">CRANK</span>
            <div class="ped-rotary-knob" id="ped-rotary-knob"></div>
            <span class="ped-rot-lbl-norm">NORM</span>
            <span class="ped-rot-lbl-ign">IGN<br>START</span>
          </div>
          <div class="ped-rotary-sub">ENG MODE</div>
        </div>
      </div>`;
  })() : '';

  /* ── MCDU — Airbus F-PLN page (FMS jets only) ── */
  const mcdu = has('mcdu') ? `<div class="ped-mcdu">${_mcduHTML()}</div>` : '';

  return `
    <div class="ped-title">CENTRE PEDESTAL</div>

    <div class="ped-main">
      <div class="ped-controls">
        ${thrustBlock}${knobsBlock}
        ${flexRow}
        ${breakersBlock}
        ${engStartSection}
      </div>

      ${mcdu}
    </div>

    <div class="ped-hint">D · CLOSE</div>
  `;
}

/* ── Event handlers ────────────────────────────────────────────── */

function _attachHandlers() {
  if (!_el) return;

  /* Rotary mode knob — click cycles CRANK → NORM → IGN+START */
  const MODES = ['CRANK', 'NORM', 'IGN+START'];
  const ANGLES = { 'CRANK': -120, 'NORM': 0, 'IGN+START': 120 };
  document.getElementById('ped-rotary-knob')?.addEventListener('click', () => {
    const cur  = S.engMode ?? 'NORM';
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    setState({ engMode: next });
    const knob = document.getElementById('ped-rotary-knob');
    if (knob) knob.style.transform = `rotate(${ANGLES[next]}deg)`;
  });

  /* Engine master flip switches */
  const n = S.aircraft?.engine?.count ?? 2;
  for (let i = 1; i <= n; i++) {
    document.getElementById(`ped-master-${i}`)?.addEventListener('click', () => {
      const mode    = S.engMode ?? 'NORM';
      const masters = [...(S.engMasters ?? Array(n).fill(false))];
      const wasOn   = masters[i - 1];
      masters[i - 1] = !wasOn;
      setState({ engMasters: masters });

      if (!wasOn && mode === 'IGN+START') {
        if (!(S.acBusPowered ?? false)) {
          masters[i - 1] = false;
          setState({ engMasters: masters });
          return;
        }
        startEngineLifecycle();
      } else if (wasOn) {
        stopEngineLifecycle();
      }
    });
  }

  /* Thrust profile detents — click any track to jump to nearest profile */
  _el.querySelectorAll('.ped-lever-track').forEach(track => {
    track.addEventListener('click', e => {
      const rect = track.getBoundingClientRect();
      const frac = 1 - (e.clientY - rect.top) / rect.height;   // 0=IDLE 1=TOGA
      const profiles = S.aircraft?.thrustProfiles ?? [
        { label: 'IDLE', spdT: 0 }, { label: 'CLB', spdT: 175 },
        { label: 'MCT', spdT: 280 }, { label: 'TOGA', spdT: 350 },
      ];
      const maxSpdT  = Math.max(...profiles.map(p => p.spdT)) || 1;
      const targetSpd = frac * maxSpdT;
      /* Snap to nearest detent, set the thrust lever (0…1) — not the FCU speed */
      const snapped = profiles.reduce((best, p) =>
        Math.abs(p.spdT - targetSpd) < Math.abs(best.spdT - targetSpd) ? p : best
      );
      setState({ thrustLever: Math.max(0, Math.min(1, snapped.spdT / maxSpdT)) });
    });
  });

  /* Flap handle */
  _el.querySelectorAll('.ped-flap-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ flaps: +btn.dataset.flap });
    });
  });

  /* Speed brake — RET=0, ARM=1, FULL=2 */
  _el.querySelectorAll('.ped-spdbk-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ speedBrake: +btn.dataset.sb });
    });
  });

  /* Parking brake — ON / OFF */
  _el.querySelectorAll('.ped-park-pos').forEach(btn => {
    btn.addEventListener('click', () => setState({ parkBrake: btn.dataset.pb === '1' }));
  });


  /* ── Light-piston controls (moved off the G1000 main panel) ── */
  /* Throttle vernier — props use spdT as the throttle (same as +/-): IDLE → CRUISE → FULL */
  document.getElementById('ped-knob-throttle')?.addEventListener('click', () => {
    const maxSpd = S.aircraft?.envelope?.maxSpd ?? 130;
    const cur = (S.spdT ?? 0) / maxSpd;
    const next = cur < 0.33 ? 0.7 : cur < 0.85 ? 1 : 0;
    setState({ spdT: Math.round(next * maxSpd) });
  });
  /* Mixture vernier — RICH → LEAN → ICO → RICH */
  document.getElementById('ped-knob-mixture')?.addEventListener('click', () => {
    const cur = S.mixture ?? 1;
    setState({ mixture: cur >= 1 ? 0.5 : cur >= 0.5 ? 0 : 1 });
  });
  /* Carb heat — COLD / HOT */
  document.getElementById('ped-knob-carbheat')?.addEventListener('click', () => {
    setState({ carbHeat: !S.carbHeat });
  });
  /* Magneto rotary — OFF → R → L → BOTH → START */
  const MAG = ['OFF', 'R', 'L', 'BOTH', 'START'];
  document.getElementById('ped-mag-rot')?.addEventListener('click', () => {
    const next = MAG[(MAG.indexOf(S.magnetos ?? 'OFF') + 1) % MAG.length];
    setState({ magnetos: next });
    if (next === 'START') startEngineLifecycle();
    if (next === 'OFF')   stopEngineLifecycle();
  });
  /* Fuel selector rotary — cycle BOTH → LEFT → RIGHT */
  const FSEL = ['BOTH', 'LEFT', 'RIGHT'];
  document.getElementById('ped-fsel')?.addEventListener('click', () => {
    setState({ fuelSelector: FSEL[(FSEL.indexOf(S.fuelSelector ?? 'BOTH') + 1) % FSEL.length] });
  });
  /* Fuel shutoff — red cutoff knob */
  document.getElementById('ped-shutoff')?.addEventListener('click', () => {
    setState({ fuelShutoff: !S.fuelShutoff });
  });
  /* Electrical switches — bat-handle toggle */
  _el.querySelectorAll('.ped-toggle[data-sw]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.sw, next = !S[k];
      setState({ [k]: next });
      if (k === 'fuelPump') { if (next) startFuelPump(); else stopFuelPump(); }
    });
  });
  /* Exterior lights — bat-handle toggle */
  _el.querySelectorAll('.ped-toggle[data-light]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.light;
      setState({ lights: { ...S.lights, [k]: !(S.lights?.[k]) } });
    });
  });
}

/* ── Live update ───────────────────────────────────────────────── */

function _update() {
  if (!_el || !_el.classList.contains('ped-visible')) return;

  const engCount   = S.aircraft?.engine?.count ?? 2;
  const frac       = _leverFrac();
  const activeIdx  = _activeProfileIdx();
  const profiles   = S.aircraft?.thrustProfiles ?? [];

  /* Lever heads: top% = (1-frac)*82+4, inverted so TOGA is near top */
  const leverPct = (1 - frac) * 82 + 4;
  for (let e = 0; e < engCount; e++) {
    const head = document.getElementById(`ped-lh-${e}`);
    if (head) head.style.top = `${leverPct}%`;
    const n1el = document.getElementById(`ped-n1-${e}`);
    if (n1el) {
      const n1 = S.N1 ?? (S.enginePower != null ? (S.aircraft?.engine?.idleN1 ?? 22) + (100 - (S.aircraft?.engine?.idleN1 ?? 22)) * S.enginePower : null);
      n1el.textContent = n1 != null ? `${n1.toFixed(1)}%` : '—';
    }
  }

  /* Detent highlights */
  _el.querySelectorAll('.ped-det').forEach(det => {
    const i = +det.dataset.det;
    det.classList.toggle('ped-det-active', i === activeIdx);
  });

  /* Flap handle */
  const curFlap = S.flaps ?? 0;
  _el.querySelectorAll('.ped-flap-pos').forEach(btn => {
    btn.classList.toggle('ped-flap-sel', +btn.dataset.flap === curFlap);
  });

  /* Speed brake */
  const curSB = S.speedBrake ?? 0;
  _el.querySelectorAll('.ped-spdbk-pos').forEach(btn => {
    btn.classList.toggle('ped-spdbk-sel', +btn.dataset.sb === curSB);
  });

  /* Parking brake — ON red (warning), OFF green */
  const pbOn = !!S.parkBrake;
  _el.querySelectorAll('.ped-park-pos').forEach(btn => {
    const isOn = btn.dataset.pb === '1';
    btn.classList.toggle('ped-park-sel-on',  isOn && pbOn);
    btn.classList.toggle('ped-park-sel-off', !isOn && !pbOn);
  });

  /* Engine master flip switches */
  const masters  = S.engMasters ?? Array(engCount).fill(false);
  const running  = S.engineState === 'running';
  for (let i = 1; i <= engCount; i++) {
    const track = document.getElementById(`ped-master-${i}`);
    if (track) track.classList.toggle('flip-on', !!(masters[i - 1] || running));
  }
  /* Rotary knob angle */
  const ANGLES = { 'CRANK': -120, 'NORM': 0, 'IGN+START': 120 };
  const knob = document.getElementById('ped-rotary-knob');
  if (knob) knob.style.transform = `rotate(${ANGLES[S.engMode ?? 'NORM']}deg)`;

  /* ── Light-piston controls ── */
  const setKnob = (id, valId, angle, txt, lit) => {
    const k = document.getElementById(id);
    if (k) { k.style.transform = `rotate(${angle}deg)`; k.classList.toggle('ped-knob-lit', !!lit); }
    const v = document.getElementById(valId);
    if (v) v.textContent = txt;
  };
  /* Throttle knob follows the prop throttle (spdT / maxSpd), which +/- drive */
  const thr = Math.max(0, Math.min(1, (S.spdT ?? 0) / (S.aircraft?.envelope?.maxSpd ?? 130)));
  setKnob('ped-knob-throttle', 'ped-kv-throttle', -120 + thr * 240, `${Math.round(thr * 100)}%`, thr > 0.02);
  const mix = S.mixture ?? 1;
  setKnob('ped-knob-mixture', 'ped-kv-mixture', -120 + mix * 240, mix >= 1 ? 'RICH' : mix <= 0 ? 'ICO' : 'LEAN', mix > 0);
  const carb = !!S.carbHeat;
  setKnob('ped-knob-carbheat', 'ped-kv-carbheat', carb ? 60 : -60, carb ? 'HOT' : 'COLD', carb);

  /* Magneto rotary — pointer rotates to position, recolours (OFF red / START amber) */
  const mag  = S.magnetos ?? 'OFF';
  const MAGA = { OFF: -120, R: -60, L: 0, BOTH: 60, START: 120 };
  const magPtr = document.getElementById('ped-mag-ptr');
  if (magPtr) {
    magPtr.style.transform  = `translateX(-50%) rotate(${MAGA[mag] ?? 0}deg)`;
    magPtr.style.background  = mag === 'OFF' ? '#ff5a4a' : mag === 'START' ? '#f0c050' : '#d8dce0';
  }
  _el.querySelectorAll('.ped-magrot-lbl').forEach(l =>
    l.classList.toggle('ped-magrot-lbl-on', l.dataset.magl === mag));

  /* Fuel selector — white lever rotates to LEFT / BOTH / RIGHT */
  const fsel = S.fuelSelector ?? 'BOTH';
  const lever = document.getElementById('ped-fsel-lever');
  if (lever) lever.style.transform = `translateX(-50%) rotate(${({ LEFT: -55, BOTH: 0, RIGHT: 55 })[fsel] ?? 0}deg)`;
  _el.querySelectorAll('.ped-fsel-lbl').forEach(l =>
    l.classList.toggle('ped-fsel-lbl-on', l.dataset.fsel === fsel));
  /* Fuel shutoff — red knob pulled out (glow) when closed */
  const shut = document.getElementById('ped-shutoff');
  if (shut) shut.classList.toggle('ped-shutoff-on', !!S.fuelShutoff);
  /* Electrical switches + lights — bat-handle toggles */
  _el.querySelectorAll('.ped-toggle[data-sw]').forEach(b => b.classList.toggle('on', !!S[b.dataset.sw]));
  _el.querySelectorAll('.ped-toggle[data-light]').forEach(b => b.classList.toggle('on', !!(S.lights?.[b.dataset.light])));
}

/* ── Public API ────────────────────────────────────────────────── */

export function initPedestal() {
  document.getElementById('ped')?.remove();
  if (!document.getElementById('ped-style')) {
    const s = document.createElement('style');
    s.id = 'ped-style';
    s.textContent = _CSS;
    document.head.appendChild(s);
  }
  _el = document.createElement('div');
  _el.id = 'ped';
  document.body.appendChild(_el);
  _el.innerHTML = _buildHTML();
  _attachHandlers();

  /* Parking-brake annunciator — persists across all views while the brake is set */
  if (!document.getElementById('parkbrk-ind')) {
    const pb = document.createElement('div');
    pb.id = 'parkbrk-ind';
    pb.textContent = 'PARK BRK';
    document.body.appendChild(pb);
  }
}

export function togglePedestal() {
  if (!S.aircraft?.views?.includes('pedestal')) return;   // aircraft declares no pedestal
  const next = S.cockpitView === 'pedestal' ? 'forward' : 'pedestal';
  setState({ cockpitView: next });
}

export function renderPedestal() {
  if (!_el) return;
  const visible   = S.cockpitView === 'pedestal';
  const wasVisible = _el.classList.contains('ped-visible');
  _el.classList.toggle('ped-visible', visible);
  if (visible && !wasVisible) {
    _el.innerHTML = _buildHTML();
    _attachHandlers();
  }
  if (visible) _update();
  /* The radio lives on the pedestal in WB/NB cockpits — show the comm panel only with the
     pedestal view (the G1000 keeps its own forward-panel radio). */
  document.body.classList.toggle('pedestal-active', visible);
  if (S.aircraft?.panel !== 'g1000') {
    const _com = document.getElementById('com-container');
    if (_com) _com.style.display = visible ? '' : 'none';
  }
  /* Persistent parking-brake annunciator (any view) */
  document.getElementById('parkbrk-ind')?.classList.toggle('pb-on', !!S.parkBrake);
}
