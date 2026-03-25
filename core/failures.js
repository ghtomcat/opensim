/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/failures.js
   Scripted failure events. Reads S.mission.failures.
   Triggers by time (seconds) or altitude (ft).

   Failure types:
     engine_bang   — sharp impulse sound, then power drops
     engine_power  — set enginePower to value over rampTime seconds
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { engineBang, engineGunfire } from './sound.js';

let _fired    = new Set();   // indices of already-fired failures
let _ramps    = [];          // active power ramps

export function resetFailures() {
  _fired.clear();
  _ramps = [];
  setState({ enginePower: 1.0 });
}

export function tickFailures(dt) {
  const failures = S.mission?.failures;
  if (!failures?.length) return;

  const t   = S.time ?? 0;
  const alt = S.alt  ?? 0;

  /* NIFLHEIM — das Tiefenwesen, T+108 to T+124 */
  const niflheimNow = S.mission?.id === 'wolfskopf-1942' && t >= 108 && t < 124;
  if (niflheimNow !== (S.niflheimVisible ?? false)) setState({ niflheimVisible: niflheimNow });

  /* Check triggers */
  failures.forEach((f, i) => {
    if (_fired.has(i)) return;

    const tr = f.trigger;
    const triggered =
      (tr.type === 'time' && t >= tr.t) ||
      (tr.type === 'alt'  && alt <= tr.alt);

    if (!triggered) return;
    _fired.add(i);

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
