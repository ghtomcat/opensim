/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/schema/known.js
   Schema violations that are logged in docs/issues.md and not fixed
   yet. Shared by the load-time check (core/mission.js lets them pass)
   and tests/data-schema.test.mjs (which also fails when one of them
   no longer occurs — remove it here and close the issue).
   ═══════════════════════════════════════════════════════════════ */

/* file → errors (matched by prefix) and the issue that tracks them */
export const KNOWN = {
  'missions/crew-demo2.json': [
    { error: 'characters.crew.commProfile: "sband-crew" is not one of', issue: 'Comm profile names outside the profile table' },
  ],
  'aircraft/so101.json':  [{ error: 'type: unknown key', issue: 'No vehicle contract' }],
  'aircraft/yertle.json': [{ error: 'type: unknown key', issue: 'No vehicle contract' }],
};

/** The errors for `file` that aren't on the known list. */
export function unknownErrors(file, errors) {
  const known = KNOWN[file] ?? [];
  return errors.filter(e => !known.some(k => e.startsWith(k.error)));
}
