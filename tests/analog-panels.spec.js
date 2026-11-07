/**
 * The analog panel (display/analog_panel.js) in each aircraft's style. The Tu-95 and the An-225 flew on a
 * leftover glass PFD with the airliner mode strip (2026-11-07, Markus), and so did the Avro 504 — now
 * the analog gauges in the soviet and the wood style, until each has its own sourced panel (issues.md).
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

for (const [what, mission, style] of [['Tu-95', 'nordmeer-1956', 'soviet'], ['An-225', 'hostomel-2022', 'soviet'], ['Avro 504', 'melun-1918', 'wood']]) {
  test(`${what}: the analog panel, ${style} style — no METAR strip`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?mission=${mission}&test=1`);
    await page.waitForFunction(() => window.simReady === true);
    await frames(page);
    const ac = await page.evaluate(() => window.simGetState().aircraft);
    expect([ac.panel, ac.panelStyle]).toEqual(['analog', style]);
    await expect(page.locator('#fma')).toHaveCount(0);
    await expect(page.locator('#metar-strip')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const [what, mission, panel] of [['Bf 109', 'wolfskopf-1942', 'bf109'], ['F4U', 'rabaul-1943', 'f4u']]) {
  test(`${what}: its panel draws from the merged analog module, no page errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?mission=${mission}&test=1`);
    await page.waitForFunction(() => window.simReady === true);
    await frames(page, 5);
    expect(await page.evaluate(() => window.simGetState().aircraft.panel)).toBe(panel);
    await expect(page.locator('#fma')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
