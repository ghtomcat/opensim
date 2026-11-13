/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/gyro.js
   The heading instruments' settings — their owner and commands (the analog panels' knobs):
     courseSet   the remote-indicating compass's course setter (the F4U): the two parallel
                 arrows the pilot turns with the knob — it starts at the mission's course
     dgSet       the directional gyro's card, set against the compass with its knob (the F4U's
                 AN-5735-1): an offset on the heading it shows
   1° a step (a drag's step, a wheel's notch; Shift ten). The gyro does not drift yet, and the
   knob does not cage it — both with a gyro model (issues.md, *The analog instruments have no knobs*).
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { registerCommand } from './commands.js';
import { onMissionReset } from './lifecycle.js';

const wrap = (d) => ((d % 360) + 360) % 360;

/** The course on the remote compass's setter — set by its knob, else the mission's course */
export const courseSetting = () => S.courseSet ?? S.mission?.course ?? S.mission?.initialState?.hdg ?? S.hdgT ?? 0;
/** The heading the directional gyro shows — the aircraft's, plus the card's setting */
export const dgHeading = () => wrap((S.hdg ?? 0) + (S.dgOffset ?? 0));

export function courseSet({ step = 0 } = {}) { if (!step) return false; setState({ courseSet: wrap(courseSetting() + step) }); return true; }
export function dgSet({ step = 0 } = {})     { if (!step) return false; setState({ dgOffset: wrap((S.dgOffset ?? 0) + step) }); return true; }

registerCommand('courseSet', (a) => courseSet(a));
registerCommand('dgSet',     (a) => dgSet(a));
onMissionReset(() => setState({ courseSet: null, dgOffset: 0 }));
