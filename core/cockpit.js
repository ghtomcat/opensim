/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/cockpit.js
   Which controls an aircraft has — from its data: the slide-in zones' tokens
   (aircraft.pedestal / left / right — core/vocab.js ZONE_TOKEN says which controls each
   token holds) and its cockpit panel spec (panels/<panel>.json — the controls it names).
   Readers: the E key (a magneto switch → START), tests. docs/issues.md, *Instruments,
   controls and mixed panels — the plan*, step 5.
   ═══════════════════════════════════════════════════════════════ */

import { ZONE_TOKEN } from './vocab.js';
import { lightSwitches } from './electrical.js';

/** A zone's tokens: the aircraft's own list, or — the pedestal only — the ones derived from its systems */
export function zoneTokens(ac, zone) {
  if (Array.isArray(ac?.[zone])) return ac[zone];
  if (zone !== 'pedestal' || !ac?.views?.includes('pedestal')) return [];
  const t = ['thrust', 'flaps', ...(ac.spoilers ? ['speedbrake'] : [])];   // SPD BRK only with spoilers in the data
  t.push('parkbrake');
  if (ac.engine?.type === 'turbofan') t.push('engstart');
  if (!['g1000', 'dr400', 'velis-epsi'].includes(ac.panel)) t.push('mcdu');
  return t;
}

/** The controls a panel spec names: a widget's config `control`, its switches' `control`, and the widgets that are a
    control by themselves (the magneto knob, the fuel selector) */
const WIDGET_CONTROL = { magneto_knob: 'magnetos', fuel_selector: 'fuelSelector' };
export function specControls(spec) {
  const out = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (WIDGET_CONTROL[n.widget]) out.add(WIDGET_CONTROL[n.widget]);
    if (typeof n.control === 'string') out.add(n.control);
    Object.values(n).forEach(walk);
  };
  walk(spec?.layout);
  return out;
}

/** The controls the aircraft has — its zones' tokens (a switches block only its own switches) and its panel spec */
export function aircraftControls(ac, spec = null) {
  const own = new Set([...(lightSwitches(ac) ?? []), ...(ac?.tanks ? ['fuelPump'] : [])]);
  const out = new Set(specControls(spec));
  for (const zone of ['pedestal', 'left', 'right'])
    for (const tok of zoneTokens(ac, zone))
      for (const c of ZONE_TOKEN[zone][tok] ?? []) if (tok !== 'switches' || own.has(c)) out.add(c);
  return out;
}
