/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/alerts.js
   The alerts the warning displays read: S.warnings, one key per alert.

   A key's value is its level: 'warning' (red — MASTER WARN) or
   'caution' (amber — MASTER CAUT); false / absent = not active. The
   older writers still set `true`, and those keep the rule the displays
   used before levels: a key starting with LOW or FUEL is a caution,
   anything else a warning.

   A module that raises alerts publishes its own set each tick through
   publishAlerts(owner, {KEY: level}) — its keys from the last call are
   replaced, every other module's keys kept — and clearAlerts(owner) on
   a mission reset. activeAlerts() lists the active ones for the
   displays: warnings first, then cautions, each in the order raised.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

/** An alert's level from its key and value: 'warning' | 'caution' | null (not active). */
export function alertLevel(key, value) {
  if (value === 'warning' || value === 'caution') return value;
  if (!value) return null;
  return key.startsWith('LOW') || key.startsWith('FUEL') ? 'caution' : 'warning';   // `true` — the old rule
}

/** The active alerts, warnings first: [{ key, level, text }]. */
export function activeAlerts(warnings = S.warnings ?? {}) {
  const list = Object.entries(warnings).map(([key, v]) => ({ key, level: alertLevel(key, v), text: key.replace(/_/g, ' ') }))
                                       .filter(a => a.level);
  return [...list.filter(a => a.level === 'warning'), ...list.filter(a => a.level === 'caution')];
}

/* Each owner's keys from its last publish */
const _owned = new Map();

/** Replace `owner`'s alerts with `alerts` ({KEY: 'warning' | 'caution'}); the others' keys stay. */
export function publishAlerts(owner, alerts) {
  const w = { ...(S.warnings ?? {}) };
  for (const k of _owned.get(owner) ?? []) delete w[k];
  Object.assign(w, alerts);
  _owned.set(owner, Object.keys(alerts));
  setState({ warnings: w });
}

/** Remove `owner`'s alerts — on a mission reset. */
export function clearAlerts(owner) {
  if (!(_owned.get(owner) ?? []).length) return;
  publishAlerts(owner, {});
}
