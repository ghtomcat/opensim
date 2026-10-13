/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/schema/catalog.js
   Schema for missions/catalog.json — the mission picker list.
   One entry per mission card; read by index.html (picker, briefing,
   role select). See core/schema/check.js for the rules.

   The card holds labels, the mission file holds the facts: title,
   acName, location and engine are short card texts and may differ
   from the mission ("ILS Approach · RWY 28" vs "ILS Approach — Zürich
   LSZH"). The one fact both carry — `aircraft` — must match; checked
   in tests/data-schema.test.mjs.
   ═══════════════════════════════════════════════════════════════ */

import { str, bool, arrayOf, object } from './check.js';

/* The pre-mission briefing card (showBriefing() in index.html) */
const briefing = object({
  classification: str, date: str, pilot: str, unit: str, aircraft: str,
  orders: str, atmosphere: str, image: str, document: str, document_en: str,
});

export const catalogEntry = object(
  {
    id: str, title: str, aircraft: str, acName: str, engine: str, location: str,
    era: str,          // 'LAB' and 'ORBIT' pick the picker tab; anything else is a label
    eraLabel: str, accent: str,
    briefing,
    roles: arrayOf(object({ id: str, label: str })),
    crew: arrayOf(object({ id: str, name: str, callsign: str, role: str, label: str })),
    fixedScenario: bool,
  },
  { required: ['id', 'title', 'aircraft', 'era'] },
);

export const catalog = arrayOf(catalogEntry);
