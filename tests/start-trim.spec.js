// OpenSim — start-trim.spec.js
// An airborne start is trimmed (core/trim.js, core/mission.js): the level starts hold their altitude and speed over
// the first 10 s; the approach starts on the ILS capture the glideslope and follow it — no dive.

import { test, expect } from '@playwright/test';

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true);
}

/* Steps n seconds and returns the extremes of altitude, speed and vertical speed */
const fly = (page, secs) => page.evaluate((n) => {
  const s0 = window.simGetState();
  let dAlt = 0, dSpd = 0, minVs = 0;
  window.simSetState({ paused: false });
  for (let i = 0; i < n; i++) {
    window.simStep(1);
    const s = window.simGetState();
    dAlt = Math.max(dAlt, Math.abs(s.alt - s0.alt)); dSpd = Math.max(dSpd, Math.abs(s.spd - s0.spd)); minVs = Math.min(minVs, s.vs);
  }
  return { dAlt, dSpd, minVs, gs: window.simGetState().gsCaptured };
}, Math.round(secs * 60));

for (const id of ['egll-approach', 'evra-approach', 'bougainville-1943', 'wolfskopf-1942', 'melun-1918']) {
  test(`${id} — a level start holds ±50 ft and ±3 kt over its first 10 s`, async ({ page }) => {
    await loadSim(page, id);
    const r = await fly(page, 10);
    expect(r.dAlt).toBeLessThan(50);
    expect(r.dSpd).toBeLessThan(3);
  });
}

for (const id of ['lszh-approach', 'anchorage-bozeman']) {
  test(`${id} — an approach start captures the glideslope, no dive`, async ({ page }) => {
    await loadSim(page, id);
    const r = await fly(page, 10);
    expect(r.gs).toBe(true);
    expect(r.minVs).toBeGreaterThan(-2500);   // the capture onto a 3° slope at ~180 kt (~950 ft/min) — was −9,000 untrimmed
  });
}

/* The A/THR's ceiling is the detent its levers sit in (core/thrust.js): an airborne start with the A/THR on starts with
   them in CLB — the trim's manual-thrust lever (e.g. 0.24, nearest IDLE) pinned it at idle for a whole approach. */
for (const id of ['egll-approach', 'evra-approach', 'lszh-approach', 'anchorage-bozeman']) {
  test(`${id} — the A/THR starts with its levers in CLB, not pinned at idle`, async ({ page }) => {
    await loadSim(page, id);
    await fly(page, 1);
    const s = await page.evaluate(() => window.simGetState());
    expect(s.athrDetent).toBe('CLB');
  });
}
