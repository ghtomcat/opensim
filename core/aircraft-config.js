/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/aircraft-config.js
   Resolve an aircraft's effective cockpit config by deep-merging its lineage:

       defaults  →  manufacturer  →  family  →  the aircraft's own `cockpit` block

   Each layer overrides only what it changes, so a property lives at the highest
   level where it's shared and only the exceptions push down. Layer files are
   optional — a missing manufacturer/family file simply contributes nothing.
   ═══════════════════════════════════════════════════════════════ */

const _isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* Deep-merge plain objects; arrays and scalars replace (predictable, no concat). */
function _merge(a, b) {
  if (!_isObj(a) || !_isObj(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = _isObj(a[k]) && _isObj(b[k]) ? _merge(a[k], b[k]) : b[k];
  return out;
}

const _fetchJson = (p) =>
  fetch(`${p}?v=${Date.now()}`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));

/* Returns the merged config for one aircraft. Safe to await on mission load. */
export async function resolveAircraftConfig(aircraft) {
  const paths = ['config/defaults.json'];
  if (aircraft.manufacturer) paths.push(`config/manufacturers/${aircraft.manufacturer}.json`);
  if (aircraft.family)       paths.push(`config/families/${aircraft.family}.json`);

  const layers = await Promise.all(paths.map(_fetchJson));
  let cfg = {};
  for (const l of layers) cfg = _merge(cfg, l);
  if (aircraft.cockpit) cfg = _merge(cfg, aircraft.cockpit);   // model-level overrides in the aircraft JSON
  return cfg;
}
