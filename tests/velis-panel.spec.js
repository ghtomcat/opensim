/**
 * The Velis cockpit: the switches can be clicked where they are drawn, in any window, and the
 * instruments (NESIS, EPSI and its map, COM) are dark until MASTER, BATT EN and AVIONICS are on.
 * Found 2026-11-07 (Markus): the EPSI showed altitude, V/S and the map with everything off, and
 * the switches sat low with 5-pixel labels.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

async function load(page) {
  await page.goto('/?mission=lszg-velis&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await frames(page);
}
const switches = (page) => page.evaluate(async () => ({ ...(await import('/core/state.js')).S.switches }));
const regions  = (page) => page.evaluate(async () => (await import('/display/velis_epsi.js')).velisHitRegions());

/** Click the middle of a named click area, as a pilot would */
async function click(page, name) {
  const r = (await regions(page)).find(r => r.name === name);
  expect(r, `${name} is drawn`).toBeTruthy();
  const box = await page.locator('#pfd').boundingBox();
  const dpr = await page.evaluate(() => devicePixelRatio);
  await page.mouse.click(box.x + (r.x + r.w / 2) / dpr, box.y + (r.y + r.h / 2) / dpr);
  await frames(page);
}

for (const [w, h] of [[1440, 900], [1280, 720], [1280, 600]]) {
  test(`${w}×${h}: every switch is clicked where it is drawn, below the clock and above the COM`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await load(page);
    const box  = await page.locator('#pfd').boundingBox();
    const dpr  = await page.evaluate(() => devicePixelRatio);
    const keys = await page.locator('#btn-keys').boundingBox();
    const sw   = (await regions(page)).filter(r => r.name !== 'comSwap');
    expect(sw.map(r => r.name).sort()).toEqual(['avionics', 'battEn', 'master', 'pwrEn']);
    for (const r of sw) {
      expect(box.y + r.y / dpr, `${r.name} below the KEYS button`).toBeGreaterThanOrEqual(keys.y + keys.height);
      expect(box.y + (r.y + r.h) / dpr, `${r.name} inside the window`).toBeLessThanOrEqual(h);
      expect(r.h / dpr, `${r.name} big enough to hit`).toBeGreaterThanOrEqual(20);
    }
    for (const name of ['master', 'battEn', 'pwrEn', 'avionics']) await click(page, name);
    expect(await switches(page)).toMatchObject({ master: true, battEn: true, pwrEn: true, avionics: true });
  });
}

test('the EPSI and its map are dark until the avionics have power', async ({ page }) => {
  await load(page);
  const map = page.locator('#velis-map-overlay');
  await expect(map).toBeHidden();                                         // cold and dark
  await click(page, 'master'); await click(page, 'battEn');
  await expect(map).toBeHidden();                                         // AVIONICS still off
  await click(page, 'avionics');
  await expect(map).toBeVisible();
  await click(page, 'avionics');
  await expect(map).toBeHidden();
});
