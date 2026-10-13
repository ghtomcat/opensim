/**
 * Flight plan in the browser — one plan for the ND, the MCDU and LNAV: changing the arrival
 * runway in flight (setArrivalRunway) re-routes all of them together (needs the gitignored
 * CIFP procedure bundle; skipped without it), and a mission that starts mid-route joins the
 * leg being flown.
 */

import { test, expect } from '@playwright/test';

test('a new arrival runway in flight reaches the MCDU and LNAV', async ({ page }) => {
  await page.goto('/?mission=evra-approach&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  const hasCifp = await page.evaluate(async () => {
    const { getProcedures } = await import('/core/route.js');
    for (let i = 0; i < 100 && !getProcedures().EVRA; i++) await new Promise(r => setTimeout(r, 50));
    return !!getProcedures().EVRA;
  });
  test.skip(!hasCifp, 'CIFP procedure bundle not present');

  await page.evaluate(() => window.simSetState({ cockpitView: 'pedestal', ap: true, navManaged: true }));
  await page.evaluate(() => window.simStep(2));
  const mcdu = page.locator('.ped-mcdu');
  await expect(mcdu).toContainText('EVRA36');
  await expect(mcdu).toContainText('I36');

  await page.evaluate(async () => { (await import('/core/flightplan.js')).setArrivalRunway('18'); });
  await page.evaluate(() => window.simStep(2));

  await expect(mcdu).toContainText('EVRA18');
  await expect(mcdu).toContainText('I18');
  const lnav = await page.evaluate(async () => {
    const { lnavActive } = await import('/core/lnav.js');
    const { legs } = lnavActive();
    return legs.slice(-3).map(l => l.id);
  });
  expect(lnav).toContain('FI18');                          // LNAV flies the amended approach
  expect(await page.evaluate(() => window.simGetState().mission.arrival.runway)).toBe('36');
});

/* A mission that starts mid-route: LNAV joins the leg being flown instead of turning back to the
   first fix. evra-approach starts at FL350 inbound Riga, ~55.0 N 21.1 E, heading 045°. */
test('mid-route start: managed NAV flies on toward the destination', async ({ page }) => {
  await page.goto('/?mission=evra-approach&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  expect(await page.evaluate(() => window.simGetState().flightPlan.activeIdx)).toBeGreaterThan(1);

  await page.evaluate(() => window.simSetState({ ap: true, navManaged: true }));
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => window.simStep(60 * 30));   // 30 s
    const hdg = await page.evaluate(() => window.simGetState().hdg);
    expect(hdg, 'still heading for Riga (north-east), not back to Warsaw').toBeLessThan(90);
  }
});
