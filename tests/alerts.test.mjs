/**
 * The alerts the warning displays read (core/alerts.js): each alert's level — 'warning' / 'caution',
 * or the old `true` with the name rule (LOW… / FUEL… a caution, the rest a warning) — the list sorted
 * warnings first, and each owner publishing and clearing only its own keys.
 *
 * Run:  node --test tests/alerts.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState } from '../core/state.js';
import { alertLevel, activeAlerts, publishAlerts, clearAlerts } from '../core/alerts.js';

test('the level: given, or by the old name rule for `true`; inactive is null', () => {
  assert.equal(alertLevel('HYD_GREEN_LO', 'caution'), 'caution');
  assert.equal(alertLevel('ANYTHING', 'warning'), 'warning');
  assert.equal(alertLevel('LOW_FUEL', true), 'caution');
  assert.equal(alertLevel('FUEL_SHUTOFF', true), 'caution');
  assert.equal(alertLevel('OIL_PRESS', true), 'warning');
  assert.equal(alertLevel('OIL_PRESS', false), null);
});

test('the list: warnings first, then cautions, each in the order raised; texts without underscores', () => {
  const list = activeAlerts({ HYD_GREEN_LO: 'caution', OIL_PRESS: true, LOW_FUEL: false, FUEL_IMBALANCE: 'caution', ENG_FIRE: 'warning' });
  assert.deepEqual(list.map(a => [a.text, a.level]),
    [['OIL PRESS', 'warning'], ['ENG FIRE', 'warning'], ['HYD GREEN LO', 'caution'], ['FUEL IMBALANCE', 'caution']]);
});

test('an owner replaces only its own alerts, and clears them', () => {
  setState({ warnings: { OIL_PRESS: true } });
  publishAlerts('a', { A_ONE: 'caution', A_TWO: 'caution' });
  publishAlerts('b', { B_ONE: 'warning' });
  publishAlerts('a', { A_TWO: 'caution' });
  assert.deepEqual(Object.keys(S.warnings).sort(), ['A_TWO', 'B_ONE', 'OIL_PRESS']);
  clearAlerts('a');
  assert.deepEqual(Object.keys(S.warnings).sort(), ['B_ONE', 'OIL_PRESS']);
  clearAlerts('b');
  assert.deepEqual(Object.keys(S.warnings), ['OIL_PRESS']);
});
