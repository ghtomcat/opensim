/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/controls.js
   What a click does on a control — shared by the canvas panels and the HTML zones, so
   the same switch behaves the same wherever it is drawn. The first piece of the control
   kit (docs/issues.md, *Instruments, controls and mixed panels — the plan*, step 2).

   A rotary switch with detents (magnetos, fuel selector) SWEEPS: a click steps to the
   next position in the current direction, and the direction turns round at either end —
   no wrap-around (Markus, 2026-11-11). A spring-loaded end (START) counts as reached
   when it is clicked to, so after it springs back the next click goes the other way:
     OFF → R → L → BOTH → START ⟲ BOTH → L → R → OFF → R …
   The direction belongs to the control, not to the aircraft: kept here per control id,
   cleared on every mission load. The control then sends the position as a command.
   ═══════════════════════════════════════════════════════════════ */

import { onMissionReset } from '../core/lifecycle.js';

const _dir = new Map();   // control id → +1 | −1
onMissionReset(() => _dir.clear());

/** The position a click on a sweeping rotary switch goes to — from `current`, among `positions` */
export function sweep(id, positions, current) {
  const n = positions.length, i = Math.max(0, positions.indexOf(current));
  if (n < 2) return positions[0];
  let d = _dir.get(id) ?? (i === n - 1 ? -1 : 1);
  let next = i + d;
  if (next < 0 || next >= n) { d = -d; next = i + d; }      // at an end: turn round
  if (next === 0 || next === n - 1) d = -d;                  // reaching an end: the next click goes back
  _dir.set(id, d);
  return positions[next];
}
