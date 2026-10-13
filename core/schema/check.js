/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/schema/check.js
   A small validator for the JSON data (missions, catalog, aircraft).
   Schemas are plain objects built from the helpers below; check()
   returns a list of error strings ("path: problem"), empty if valid.

   Rules
   - An object's keys are its fields, its documentation-only keys and
     its planned keys. Any other key is an error.
   - Keys starting with "_" are comments: allowed anywhere, never read.
   - doc:     read by people, not by the sim (narrative, author, …).
   - planned: data for a feature that isn't built yet — allowed, and
              listed so it stays visible.
   - check:   a function (value, root) → errors, for rules that span
              several fields.
   ═══════════════════════════════════════════════════════════════ */

export const str  = { kind: 'str' };
export const num  = { kind: 'num' };
export const bool = { kind: 'bool' };
export const open = { kind: 'open' };            // any value — not modelled yet

/** One of the given values (strings or numbers). */
export const oneOf   = (...values) => ({ kind: 'enum', values });
/** An array whose items all match `item`. */
export const arrayOf = (item) => ({ kind: 'arr', item });
/** An object with free keys (frequencies, character names, …); every value matches `value`. */
export const mapOf   = (value) => ({ kind: 'map', value });
/** The first matching alternative wins. */
export const anyOf   = (...options) => ({ kind: 'any', options });
/** null, or a value matching `schema`. */
export const nullable = (schema) => anyOf({ kind: 'null' }, schema);

/** An object with known keys. Options: required, doc, planned (key → schema), check(value, root). */
export function object(fields, { required = [], doc = {}, planned = {}, check } = {}) {
  return { kind: 'obj', fields, required, doc, planned, check };
}

/** Validate `value` against `schema`. Returns error strings, empty when valid. */
export function check(value, schema, path = '', root = value) {
  const at = path || '(root)';
  switch (schema.kind) {
    case 'open': return [];
    case 'null': return value === null ? [] : [`${at}: expected null`];
    case 'str':  return typeof value === 'string'  ? [] : [`${at}: expected a string, got ${_type(value)}`];
    case 'bool': return typeof value === 'boolean' ? [] : [`${at}: expected true/false, got ${_type(value)}`];
    case 'num':  return Number.isFinite(value)     ? [] : [`${at}: expected a number, got ${_type(value)}`];
    case 'enum':
      return schema.values.includes(value) ? []
        : [`${at}: ${JSON.stringify(value)} is not one of ${schema.values.map(v => JSON.stringify(v)).join(', ')}`];
    case 'arr':
      if (!Array.isArray(value)) return [`${at}: expected an array, got ${_type(value)}`];
      return value.flatMap((v, i) => check(v, schema.item, `${path}[${i}]`, root));
    case 'map':
      if (!_isObj(value)) return [`${at}: expected an object, got ${_type(value)}`];
      return Object.entries(value).flatMap(([k, v]) => check(v, schema.value, `${path}.${k}`, root));
    case 'any': {
      let best = null;
      for (const opt of schema.options) {
        const errs = check(value, opt, path, root);
        if (!errs.length) return [];
        if (!best || errs.length < best.length) best = errs;
      }
      return best;
    }
    case 'obj': {
      if (!_isObj(value)) return [`${at}: expected an object, got ${_type(value)}`];
      const errs = [];
      for (const k of schema.required) if (!(k in value)) errs.push(`${at}: missing required "${k}"`);
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('_')) continue;   // comment
        const sub = schema.fields[k] ?? schema.doc[k] ?? schema.planned[k];
        if (!sub) { errs.push(`${path ? path + '.' : ''}${k}: unknown key`); continue; }
        errs.push(...check(v, sub, path ? `${path}.${k}` : k, root));
      }
      if (schema.check && !errs.length) errs.push(...schema.check(value, root).map(e => `${at}: ${e}`));
      return errs;
    }
  }
  throw new Error(`schema: unknown kind "${schema.kind}"`);
}

function _isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function _type(v)  { return v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v; }
