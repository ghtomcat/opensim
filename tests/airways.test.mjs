/**
 * The airway bundle (data/airways-data.js, scripts/build-airways.py) is sliced per mission city pair — a new
 * pair needs a rebuild, and a corridor too narrow cuts the network in two. Each mission's pair must have an
 * airway path that starts and ends near its airports, not much longer than the great circle.
 *
 * Run:  node --test tests/airways.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeAirway } from '../core/airway-graph.js';
import { airportCentre, getProcedures } from '../core/route.js';
import { planFor } from '../core/flightplan.js';

const R = Math.PI / 180;
const gc = ([a1, o1], [a2, o2]) => 2 * 3440.065 * Math.asin(Math.sqrt(Math.sin((a2 - a1) * R / 2) ** 2 + Math.cos(a1 * R) * Math.cos(a2 * R) * Math.sin((o2 - o1) * R / 2) ** 2));

const missions = fs.readdirSync(new URL('../missions/', import.meta.url))
  .filter(f => f.endsWith('.json') && f !== 'catalog.json')
  .map(f => JSON.parse(fs.readFileSync(new URL(`../missions/${f}`, import.meta.url))))
  .filter(m => m.departure?.icao && m.arrival?.icao && m.departure.icao !== m.arrival.icao
            && airportCentre(m.departure.icao) && airportCentre(m.arrival.icao));

test('every mission city pair has an airway path — near both airports, at most 1.3 × the great circle', () => {
  assert.ok(missions.length >= 8);
  for (const m of missions) {
    const a = airportCentre(m.departure.icao), b = airportCentre(m.arrival.icao), id = `${m.id} ${m.departure.icao}→${m.arrival.icao}`;
    const r = routeAirway(a[0], a[1], b[0], b[1]);
    assert.ok(r, `${id}: no airway path — rebuild with scripts/build-airways.py`);
    const w0 = r.wpts[0], w1 = r.wpts.at(-1);
    assert.ok(gc(a, [w0.lat, w0.lon]) < 150, `${id}: the airways start ${Math.round(gc(a, [w0.lat, w0.lon]))} nm from the departure`);
    assert.ok(gc(b, [w1.lat, w1.lon]) < 150, `${id}: the airways end ${Math.round(gc(b, [w1.lat, w1.lon]))} nm from the arrival`);
    assert.ok(r.distNm < 1.3 * gc(a, b), `${id}: ${Math.round(r.distNm)} nm against ${Math.round(gc(a, b))}`);
  }
});

/* With the CIFP bundle (gitignored, local only) — the whole plan, SID to approach */
test('FIMP → LSZH up the east of Africa: within 10 % of the great circle, no leg over 300 nm', async (t) => {
  const t0 = Date.now();
  while (!getProcedures().FIMP && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 25));
  if (!getProcedures().FIMP) { t.skip('CIFP procedure bundle not present'); return; }
  const m = missions.find(m => m.id === 'fimp-takeoff');
  const p = planFor(m.departure, m.arrival);
  const g = gc(airportCentre('FIMP'), airportCentre('LSZH'));
  assert.ok(p.distNm < 1.1 * g, `${Math.round(p.distNm)} nm against ${Math.round(g)}`);
  for (let i = 1; i < p.legs.length; i++) {
    const d = gc([p.legs[i - 1].lat, p.legs[i - 1].lon], [p.legs[i].lat, p.legs[i].lon]);
    assert.ok(d < 300, `${p.legs[i - 1].id} → ${p.legs[i].id}: ${Math.round(d)} nm`);
  }
  const ids = p.legs.map(l => l.id);
  for (const fix of ['ASM', 'LXR']) assert.ok(ids.includes(fix), `via ${fix}`);   // Asmara, Luxor
});
