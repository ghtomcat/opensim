/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/failures.js
   Scripted failure events. Reads S.mission.failures.
   Triggers by time (seconds) or altitude (ft).

   Failure types:
     engine_bang   — sharp impulse sound, then power drops
     engine_power  — ramp the failure power factor to value over rampTime seconds (core/engine.js);
                     on ENG `engine` (1 = ENG 1) only, or on all engines when it is absent
     carb_ice      — gradual power loss; recover with carb heat ON for 10s
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { engineBang, engineGunfire, coolantHiss } from './sound.js';
import { engineQuit, setEngineFactor } from './engine.js';
import { bbEvent } from './blackbox.js';
import { onMissionReset } from './lifecycle.js';
import { FAILURE, FAILURE_TRIGGER, assertCovers, warnUnknown } from './vocab.js';

let _fired    = new Set();   // indices of already-fired failures
let _ramps    = [];          // active power ramps

export function resetFailures() {
  _fired.clear();
  _ramps = [];
  /* engine power: the factors are reset with the mission's initial engine state (core/engine.js) */
  setState({ emergLog: [], carbHeat: false, carbIceLevel: 0, carbIceActive: false, coolantState: 'ok' });
}
onMissionReset(resetFailures);

/* What each scripted failure does. scored: logged for the emergency debrief score. */
const _FAILURES = {
  [FAILURE.ENGINE_GUNFIRE]: { scored: false, fire: () => engineGunfire() },
  [FAILURE.ENGINE_BANG]:    { scored: true,  fire: () => engineBang() },
  [FAILURE.ENGINE_POWER]:   { scored: true,  fire: (f) => {
    const idx = f.engine != null ? f.engine - 1 : undefined;   // 0-based engine, or all
    _ramps.push({
      target:   f.value   ?? 0,
      rampTime: f.rampTime ?? 10,
      elapsed:  0,
      engine:   idx,
      from:     (idx != null ? S.engines?.[idx]?.factors?.failure : S.engineFactors?.failure) ?? 1.0,
    });
  } },
  [FAILURE.CARB_ICE]:       { scored: true,  fire: () => { if (S.aircraft?.hasCarbHeat) setState({ carbIceActive: true }); } },
  [FAILURE.COOLANT_LEAK]:   { scored: true,  fire: () => {
    if (S.aircraft?.coolingSystem === 'liquid') {
      setState({ coolantState: 'leaking' });
      coolantHiss();
    }
  } },
};
assertCovers(_FAILURES, FAILURE, 'core/failures.js _FAILURES');

export function tickFailures(dt) {
  const failures = S.mission?.failures;
  const t   = S.time ?? 0;
  const alt = S.alt  ?? 0;

  /* NIFLHEIM — das Tiefenwesen, T+108 to T+124 */
  const niflheimNow = S.mission?.id === 'wolfskopf-1942' && t >= 108 && t < 124;
  if (niflheimNow !== (S.niflheimVisible ?? false)) setState({ niflheimVisible: niflheimNow });

  /* Check triggers */
  if (failures?.length) {
    failures.forEach((f, i) => {
      if (_fired.has(i)) return;

      const tr = f.trigger;
      if (!tr) return;   // rocket-system failures (affects/masterAlarm) handled by rocket.js
      const triggered =
        (tr.type === FAILURE_TRIGGER.TIME && t >= tr.t) ||
        (tr.type === FAILURE_TRIGGER.ALT  && alt <= tr.alt);

      if (!triggered) return;
      _fired.add(i);

      const kind = _FAILURES[f.type];
      if (!kind) { warnUnknown('failure type', f.type); return; }

      /* Log failure event for emergency scoring */
      if (kind.scored) {
        S.emergLog.push({ t, type: 'failure', failureType: f.type, value: f.value ?? 0 });
        bbEvent({ type: 'failure', failureType: f.type, value: f.value ?? 0 });
      }
      kind.fire(f);
    });

    /* Process ramps */
    _ramps = _ramps.filter(r => r.elapsed < r.rampTime);
    for (const r of _ramps) {
      r.elapsed += dt;
      const t01 = Math.min(1, r.elapsed / r.rampTime);
      setEngineFactor('failure', r.from + (r.target - r.from) * t01, r.engine);   // its engine, or all
    }
  }

  /* ── Cooling system — a coolant leak overheats the engine until it seizes ──
     The temp climbs on its own (physics.js: cooling capacity has collapsed). Crossing the
     critical limit is irreversible (→ 'seizing'); the engine then dies regardless of temp,
     so the partial cool-down as power drops can't save it. The gauge tells the story. */
  if (S.coolantState === 'leaking' && (S.coolantTemp ?? 0) >= (S.aircraft?.cooling?.critical ?? 115)) {
    setState({ coolantState: 'seizing' });
  }
  if (S.coolantState === 'seizing') {
    const power = Math.max(0, (S.engineFactors?.seizure ?? 1) - (dt / 25));   // seizes over ~25s
    setEngineFactor('seizure', power);
    if (power <= 0) {
      setState({ coolantState: 'failed' });
      engineQuit();            // engine seized — it stops, and won't restart (coolantState 'failed')
    }
  }

  /* ── Carb ice — runs independently of other failures ── */
  if (S.carbIceActive && S.aircraft?.hasCarbHeat) {
    const iceRate  = dt / 90;   // fully iced in 90s (subtle — student must notice early)
    const meltRate = dt / 10;   // clear in 10s with carb heat ON
    let ice = S.carbIceLevel ?? 0;

    if (S.carbHeat) {
      ice = Math.max(0, ice - meltRate);
    } else {
      ice = Math.min(1, ice + iceRate);
    }

    /* Max power reduction: 70% at full ice (rough running → partial power → silence) */
    setState({ carbIceLevel: ice });
    setEngineFactor('ice', 1.0 - ice * 0.7);
  }
}
