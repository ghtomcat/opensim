/**
 * FCU (glareshield) — the AP 1 and A/THR push-buttons react to clicks, in both layouts:
 *   - panel view (V mode 0): the FCU is a strip at the top of the screen
 *   - combined view (V mode 1): the outside view on top, the FCU dropped to the middle
 * with the parking brake set (the PARK BRK annunciator showing).
 *
 * Regressions:
 *   - the click handler tested `mx >= vsX` without destructuring `vsX` from
 *     _fcuGeometry(), so every click that reached the button branch threw;
 *   - the PARK BRK annunciator (fixed, top centre) sits over the AP buttons in the
 *     panel view and swallowed their clicks.
 * In the combined view the annunciator must not cover the FCU at all.
 */

import { test, expect } from '@playwright/test';

const regions = (page) => page.evaluate(async () => {
  const { fcuButtonRegions } = await import('/display/pfd_instruments.js');
  return fcuButtonRegions();
});

const rect = (page, id) => page.evaluate((id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}, id);

async function clickButton(page, idx) {
  const fcu = await rect(page, 'fcu');
  const dpr = await page.evaluate(() => devicePixelRatio || 1);
  const r = (await regions(page)).find(b => b.idx === idx);
  await page.mouse.click(fcu.left + (r.x + r.w / 2) / dpr, fcu.top + (r.y + r.h / 2) / dpr);
}

/* Press V until the combined (outside + panel) view is on or off. */
async function setCombined(page, on) {
  for (let i = 0; i < 3; i++) {
    if (await page.evaluate(() => document.body.classList.contains('outside-active')) === on) return;
    await page.keyboard.press('v');
  }
  throw new Error(`could not ${on ? 'enter' : 'leave'} the combined view`);
}

for (const layout of ['top', 'middle']) {
  test(`AP 1 and A/THR toggle on click — FCU at the ${layout}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?mission=fimp-takeoff&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setCombined(page, layout === 'middle');
    await expect.poll(async () => (await regions(page)).length).toBe(4);   // drawn on the first panel frame

    /* the layout under test */
    const vh  = page.viewportSize().height;
    const fcu = await rect(page, 'fcu');
    if (layout === 'top') expect(fcu.top).toBeCloseTo(0, 0);
    else                  expect(Math.abs(fcu.top - vh * 0.41)).toBeLessThan(2);
    if (layout === 'middle') await expect(page.locator('#outside')).toBeVisible();

    /* parked → the PARK BRK annunciator is showing */
    expect(await page.evaluate(() => window.simGetState().parkBrake)).toBe(true);
    await expect(page.locator('#parkbrk-ind')).toBeVisible();

    /* combined view: the annunciator never covers the FCU */
    if (layout === 'middle') {
      const pb = await rect(page, 'parkbrk-ind');
      const overlap = pb.left < fcu.right && pb.right > fcu.left && pb.top < fcu.bottom && pb.bottom > fcu.top;
      expect(overlap).toBe(false);
    }

    const ap0   = await page.evaluate(() => window.simGetState().ap);
    const athr0 = await page.evaluate(() => window.simGetState().athr);

    await clickButton(page, 0);
    expect(await page.evaluate(() => window.simGetState().ap)).toBe(!ap0);

    await clickButton(page, 3);
    expect(await page.evaluate(() => window.simGetState().athr)).toBe(!athr0);

    expect(errors).toEqual([]);
  });
}
