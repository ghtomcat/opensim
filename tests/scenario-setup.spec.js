/**
 * Scenario setup → mission load: the pilot's choices (weather preset, injected failure, crew role)
 * go into loadMission() and are in place before anything reads them. lszh-approach has live
 * weather; test mode never fetches, so S.metar is the mission's recorded fallback (FEW 4500,
 * 1020 hPa) unless a preset replaces it.
 */

import { test, expect } from '@playwright/test';

const OVC_1500 = { source: 'manual', manual: { wdir: 240, wspd: 15, altim: 1008, temp: 8, dewp: 7, visib: '5', clouds: [{ cover: 'OVC', base: 1500 }] } };
const HALF_POWER = { trigger: { type: 'time', t: 120 }, type: 'engine_power', value: 0.5, rampTime: 30 };

test.beforeEach(async ({ page }) => {
  await page.goto('/?mission=lszh-approach&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
});

test('without a setup the mission keeps its own weather', async ({ page }) => {
  const s = await page.evaluate(() => window.simGetState());
  expect(s.mission.weather.source).toBe('live');
  expect(s.metar.clouds).toEqual([{ cover: 'FEW', base: 4500 }]);
});

test('a weather preset is the weather the METAR, ATIS and flight all read', async ({ page }) => {
  await page.evaluate(w => window.simLoad('lszh-approach', { weather: w }), OVC_1500);
  const s = await page.evaluate(() => window.simGetState());
  expect(s.mission.weather.source).toBe('manual');
  expect(s.mission.weather.icao).toBe('LSZH');             // the station stays — the ATIS still has a field
  expect(s.metar.clouds).toEqual([{ cover: 'OVC', base: 1500 }]);
  expect(s.metar.altim).toBe(1008);
});

test('an injected failure is added to the scripted ones, and the crew role is set', async ({ page }) => {
  const before = await page.evaluate(() => window.simGetState().mission.failures?.length ?? 0);
  await page.evaluate(f => window.simLoad('lszh-approach', { failures: [f], crew: { role: 'PM', pilotId: 'PM' } }), HALF_POWER);
  const s = await page.evaluate(() => window.simGetState());
  expect(s.mission.failures.length).toBe(before + 1);
  expect(s.mission.failures.at(-1)).toEqual(HALF_POWER);
  expect(s.role).toBe('PM');
  expect(s.mission.weather.source).toBe('live');           // no weather in the setup → the mission's own
});
