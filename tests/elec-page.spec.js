/**
 * The ELEC page is drawn from each aircraft's electrical layout (display/pfd_instruments.js
 * _ecamElec, core/electrical.js). Every airliner draws it without an error — four engines and
 * two, its own layout (A340) or the default — and the page follows the solver: on the A340 with
 * only GEN 1 online, AC BUS 1-2 is fed through the tie.
 */
import { test, expect } from '@playwright/test';

const AIRLINER_MISSIONS = ['fimp-takeoff', 'lsgg-takeoff', 'singapore-london', 'lszh-approach', 'egll-approach', 'evra-approach'];

for (const id of AIRLINER_MISSIONS) {
  test(`the ELEC page draws from the layout — ${id}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?mission=${id}&test=1`);
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await page.evaluate(() => window.simStep(2, 1 / 60));
    await page.keyboard.press('m');                               // the centre view: E/WD + ELEC
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => Object.keys(window.simGetState().elec?.buses ?? {}).length)).toBeGreaterThan(0);
  });
}

test('the A340 with only GEN 1: the other mains are fed through the tie', async ({ page }) => {
  await page.goto('/?mission=fimp-takeoff&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.evaluate(() => {
    const s = window.simGetState();
    window.simSetState({ engines: s.engines.map((e, i) => i === 0 ? { ...e, state: 'running', n1: 22, core: 60 } : e) });
    window.simStep(2, 1 / 60);
  });
  const fedBy = await page.evaluate(() => Object.fromEntries(Object.entries(window.simGetState().elec.buses).map(([k, v]) => [k, v.fedBy])));
  expect(fedBy.ac11).toBe('gen1');
  expect([fedBy.ac12, fedBy.ac23, fedBy.ac24].every(f => f && f.startsWith('ac'))).toBe(true);
});
