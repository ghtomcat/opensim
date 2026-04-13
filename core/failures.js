/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/failures.js
   Scripted failure events. Reads S.mission.failures.
   Triggers by time (seconds) or altitude (ft).

   Failure types:
     engine_bang   — sharp impulse sound, then power drops
     engine_power  — set enginePower to value over rampTime seconds
     carb_ice      — gradual power loss; recover with carb heat ON for 10s
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { engineBang, engineGunfire, coolantHiss } from './sound.js';

let _fired    = new Set();   // indices of already-fired failures
let _ramps    = [];          // active power ramps

export function resetFailures() {
  _fired.clear();
  _ramps = [];
  setState({ enginePower: 1.0, emergLog: [], carbHeat: false, carbIceLevel: 0, carbIceActive: false, coolantState: 'ok' });
}

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
      const triggered =
        (tr.type === 'time' && t >= tr.t) ||
        (tr.type === 'alt'  && alt <= tr.alt);

      if (!triggered) return;
      _fired.add(i);

      /* Log failure event for emergency scoring */
      if (['engine_power', 'engine_bang', 'carb_ice', 'coolant_leak'].includes(f.type)) {
        S.emergLog.push({ t, type: 'failure', failureType: f.type, value: f.value ?? 0 });
      }

      switch (f.type) {
        case 'engine_gunfire':
          engineGunfire();
          break;

        case 'engine_bang':
          engineBang();
          break;

        case 'engine_power':
          _ramps.push({
            target:   f.value   ?? 0,
            rampTime: f.rampTime ?? 10,
            elapsed:  0,
            from:     S.enginePower ?? 1.0,
          });
          break;

        case 'carb_ice':
          if (S.aircraft?.hasCarbHeat) setState({ carbIceActive: true });
          break;

        case 'coolant_leak':
          if (S.aircraft?.coolingSystem === 'liquid') {
            setState({ coolantState: 'leaking' });
            coolantHiss();
          }
          break;
      }
    });

    /* Process ramps */
    _ramps = _ramps.filter(r => r.elapsed < r.rampTime);
    let power = S.enginePower ?? 1.0;
    for (const r of _ramps) {
      r.elapsed += dt;
      const t01 = Math.min(1, r.elapsed / r.rampTime);
      power = r.from + (r.target - r.from) * t01;
    }
    if (_ramps.length > 0) setState({ enginePower: power });
  }

  /* ── Cooling system — runs independently of other failures ── */
  if (S.coolantState === 'leaking') {
    /* DB601 overheats — full power death over 80s, cannot restart */
    const power = Math.max(0, (S.enginePower ?? 1) - (dt / 80));
    if (power <= 0) {
      setState({ enginePower: 0, coolantState: 'failed' });
    } else {
      setState({ enginePower: power });
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
    const icePower = 1.0 - ice * 0.7;
    setState({ carbIceLevel: ice, enginePower: icePower });
  }
}
