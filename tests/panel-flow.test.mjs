/**
 * The analog panel's flowing layout (display/panel_flow.js) — the rules decided 2026-11-09
 * (docs/architecture.md §5.2).
 *
 * Run:  node --test tests/panel-flow.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowLayout, SIZES, PREFER } from '../display/panel_flow.js';

const L = id => ({ id, size: 'L' }), S = id => ({ id, size: 'S' });
const BF109 = [   // D-FEML's upper and lower panel, as the photo shows them
  { name: 'upper', rows: [[S('clock')], [L('alt'), L('compass'), L('boost')], [L('asi'), L('turn'), L('rpm')]] },
  { name: 'lower', rows: [[S('amps'), S('pitch'), { id: 'gear', kind: 'lamps', n: 4, size: 'T' }],
                          [{ id: 'fuelLow', kind: 'lamp', size: 'T' }, S('fuel'), S('oilT'), S('coolant')]] },
];
const PANEL = { w: 1440, h: 820 }, STRIP = { w: 1440, h: 370 };   // 1440 × 900 less the status bar; the lower half less it

const rowsOf = (items, group) => {                                  // the items of a group, grouped by their y
  const rows = new Map();
  for (const it of items.filter(i => i.group === group)) {
    const k = Math.round(it.y); (rows.get(k) ?? rows.set(k, []).get(k)).push(it);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map(i => i.id));
};
const inside = (lay, area) => lay.items.every(i => i.x - i.d / 2 >= 0 && i.x + i.d / 2 <= area.w && i.y - i.d / 2 >= 0 && i.y + i.d / 2 <= area.h);

test('panel view: each group in its own rows — the photo\'s', () => {
  const lay = flowLayout(BF109, PANEL, { view: 'panel' });
  assert.deepEqual(rowsOf(lay.items, 'upper'), [['clock'], ['alt', 'compass', 'boost'], ['asi', 'turn', 'rpm']]);
  assert.deepEqual(rowsOf(lay.items, 'lower').map(r => [...new Set(r)]), [['amps', 'pitch', 'gear'], ['fuelLow', 'fuel', 'oilT', 'coolant']]);
  assert.ok(inside(lay, PANEL));
});

test('combined view: the order inside a group is kept, whatever the row breaks', () => {
  const lay = flowLayout(BF109, STRIP, { view: 'combined' });
  for (const g of BF109) {
    const order = g.rows.flat().map(e => e.id);
    const drawn = [...new Set(rowsOf(lay.items, g.name).flat())];
    assert.deepEqual(drawn, order, g.name);
  }
  assert.ok(inside(lay, STRIP));
});

test('combined view: the largest instruments win — never smaller than the own rows', () => {
  const own = flowLayout(BF109, STRIP, { view: 'panel' }), flow = flowLayout(BF109, STRIP, { view: 'combined' });
  assert.ok(flow.scale >= own.scale);
  assert.ok(own.scale < PREFER * flow.scale || flow.scale === own.scale, 'the own rows lose only when clearly smaller');
});

test('a lamp group stays together — one row, side by side', () => {
  for (const view of ['panel', 'combined']) {
    const lamps = flowLayout(BF109, view === 'panel' ? PANEL : STRIP, { view }).items.filter(i => i.id === 'gear');
    assert.equal(lamps.length, 4);
    assert.equal(new Set(lamps.map(l => Math.round(l.y))).size, 1, view);
  }
});

test('the size ratios are kept', () => {
  const lay = flowLayout(BF109, STRIP, { view: 'combined' });
  const d = id => lay.items.find(i => i.id === id).d;
  assert.ok(Math.abs(d('asi') / d('fuel') - SIZES.L / SIZES.S) < 1e-9);
});

test('the cap: a large instrument at most maxL px, the panel centred', () => {
  const lay = flowLayout(BF109, PANEL, { view: 'panel', maxL: 200 });
  const asi = lay.items.find(i => i.id === 'asi');
  assert.ok(Math.abs(asi.d - 200) < 1e-9);
  const xs = lay.items.map(i => [i.x - i.d / 2, i.x + i.d / 2]).flat();
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - PANEL.w / 2) < 30, 'centred horizontally');
});

test('an engine group is a fixed grid: a row per quantity, a column per engine', () => {
  const groups = [{ name: 'flight', rows: [[L('asi'), L('ai'), L('alt')]] },
                  { name: 'engines', perEngine: [{ id: 'n1', size: 'XS' }, { id: 'egt', size: 'XS' }] }];
  const lay = flowLayout(groups, STRIP, { view: 'combined', engines: 6 });
  const n1 = lay.items.filter(i => i.id === 'n1'), egt = lay.items.filter(i => i.id === 'egt');
  assert.equal(n1.length, 6); assert.equal(egt.length, 6);
  assert.deepEqual(n1.map(i => i.engine), [0, 1, 2, 3, 4, 5]);
  assert.ok(n1.every(i => Math.abs(i.y - n1[0].y) < 1e-9) && egt[0].y > n1[0].y);
  assert.deepEqual(n1.map(i => i.x), egt.map(i => i.x));
  assert.deepEqual(lay.labels.slice(0, 6).map(l => l.text), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(lay.labels.filter(l => l.id).map(l => l.id), ['n1', 'egt'], 'the row names carry their instrument (the style names them)');
});

test('footprints by kind: a lamp reserves no room for a name, a bubble level is wide and flat', () => {
  const lay = flowLayout([{ name: 'g', rows: [[{ id: 'lamp', size: 'T', kind: 'lamp' }, { id: 'level', size: 'L', kind: 'level' }, { id: 'asi', size: 'L' }]] }],
                         { w: 1440, h: 370 }, { view: 'panel' });
  const [lamp, level, asi] = ['lamp', 'level', 'asi'].map(id => lay.items.find(i => i.id === id));
  assert.ok(level.x - lamp.x > lamp.d / 2 + SIZES.L * lay.scale * 1.3 / 2 - 1e-6, 'the level is wider than its size class');
  assert.ok(asi.x - level.x >= SIZES.L * lay.scale * (1.3 + 1) / 2, 'and the next item starts after it');
});
