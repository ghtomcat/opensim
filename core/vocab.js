/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/vocab.js
   The names that data and code share: vehicle types, panels, engine
   sounds, script triggers, rocket events, failures, comm profiles.
   One source — the schemas (core/schema/) and the code import these.

   Each set is a names() object: PANEL.VELIS → 'velis-epsi'. Reading a
   name that doesn't exist (PANEL.VELLIS) throws, so a typo fails the
   first time the line runs instead of comparing against undefined.
   No imports: Node can load this (tests/data-schema.test.mjs).
   ═══════════════════════════════════════════════════════════════ */

/** A frozen name → value map that throws on an unknown name. */
export function names(map) {
  const frozen = Object.freeze({ ...map });
  return new Proxy(frozen, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return target[prop];
      if (prop === 'toJSON' || prop === 'then') return undefined;   // JSON.stringify / await probes
      throw new Error(`vocab: unknown name "${String(prop)}" (known: ${Object.keys(target).join(', ')})`);
    },
  });
}

/** names() from a list of values: 'alt_ft' → ALT_FT, 'geared-turbofan' → GEARED_TURBOFAN. */
function namesFrom(values) {
  return names(Object.fromEntries(values.map(v => [v.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), v])));
}

/** All values of a names() object, for schemas and coverage checks. */
export const valuesOf = (set) => Object.values(set);

/**
 * Throw unless `table` (a dispatch table keyed by name) handles exactly the names in `set`,
 * apart from `except`. Run at module load next to the table, so a name added to the vocabulary
 * but not to the code — or the other way round — fails on the first page load.
 */
export function assertCovers(table, set, where, { except = [] } = {}) {
  const want = valuesOf(set).filter(v => !except.includes(v));
  const have = Object.keys(table);
  const missing = want.filter(v => !have.includes(v));
  const extra   = have.filter(v => !want.includes(v));
  if (missing.length || extra.length)
    throw new Error(`vocab: ${where} — missing: [${missing.join(', ')}], not in core/vocab.js: [${extra.join(', ')}]`);
}

const _warned = new Set();
/** console.warn once per kind + value — for data the code falls back on silently. */
export function warnUnknown(kind, value, fallback) {
  const key = `${kind}:${value}`;
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(`[vocab] unknown ${kind} "${value}"${fallback ? ` — using "${fallback}"` : ''}`);
}

/* ── Vehicles and cockpits ── */

/** aircraft.vehicleType — absent means a fixed-wing aircraft */
export const VEHICLE = names({ ROCKET: 'rocket', ROBOT_ARM: 'robot-arm', ROBOT_DOG: 'robot-dog' });

/** aircraft.panel — the cockpit display set. 'f9' is a label only: rockets pick their display by vehicleType. */
export const PANEL = names({
  AIRBUS: 'airbus', E190: 'e190', G1000: 'g1000', DR400: 'dr400',
  BF109: 'bf109', F4U: 'f4u', VELIS: 'velis-epsi', F9: 'f9',
});

/** aircraft.sound.engineType — the presets in core/sound.js (ENGINES), plus 'electric' and 'none' */
export const ENGINE = namesFrom([
  'geared-turbofan', 'high-bypass', 'low-bypass-military', 'turbojet-vk1', 'rotary-9', 'lycoming-o360',
  'nk12-turboprop', 'v12-supercharged', 'radial-2000hp', 'electric', 'none',
]);

/** aircraft.engine.type — the kind of engine. Only 'turbofan' selects code today (N1 spool, A/THR,
    electrical, hydraulics); the others describe the engine for the engine model (issues.md:
    "One engine per aircraft"). Absent on the An-225 and the DC-8 (see issues.md). */
export const ENGINE_TYPE = namesFrom(['turbofan', 'turboprop', 'turbojet', 'piston', 'electric']);

/* ── Mission script ── */

/** atcClearances[].trigger.type — evaluated in core/crew.js */
export const TRIGGER = namesFrom([
  'time', 'airborne', 'alt_ft', 'alt_km', 'gload', 'velocity', 'meco', 'meco_s2', 's2_ignition',
  's3_ignition', 'seco', 'ceco', 'tli', 'loi', 'tei', 'com_active', 'after',
]);

/** atcClearances[].event — rocket events detected in core/crew.js */
export const ROCKET_EVENT = namesFrom([
  'supersonic', 'maxq', 'stage1_nominal', 'meco', 'stagesep', 'meco_s2', 's2_ignition', 's3_ignition',
  'seco', 'orbit', 'engine_out', 'ceco', 'engine_failure_ascent', 'stage2_anomaly', 'structural_failure',
  'orbit_anomaly', 'alt', 'alt_desc', 'booster_flip', 'booster_boostback', 'booster_coast', 'booster_entry',
  'booster_landing_burn', 'booster_landing', 'dragonsep', 'deorbit', 'blackout', 'signal', 'drogue',
  'mains', 'splashdown',
]);

/** failures[].type — scripted failures in core/failures.js */
export const FAILURE = namesFrom(['engine_gunfire', 'engine_bang', 'engine_power', 'carb_ice', 'coolant_leak']);

/** failures[].trigger.type */
export const FAILURE_TRIGGER = namesFrom(['time', 'alt']);

/** commProfile — the radio chains in core/radio.js (PROFILES), plus 'broadcast' (played dry, no chain) */
export const COMM_PROFILE = namesFrom([
  'vhf-aviation', 'tower-quiet', 'sband-apollo', 'vhf-vostok', 'capsule-dragon', 'ip-spacex-crew',
  'ip-spacex-narrate', 'ip-spacex', 'launch-control', 'cockpit-bf109', 'arc-5', 'rsiu-3', 'broadcast',
]);
