/**
 * The bottom status strip: the Engine cell shows the engine, and no instructions.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

async function load(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true);
  await frames(page);   // a rendered frame
}
const engine = (page) => page.locator('#pv-rpm').textContent();

test('A340 at its stand: all four engines off', async ({ page }) => {
  await load(page, 'fimp-takeoff');
  await expect(page.locator('#pl-engine')).toHaveText('N1');
  expect(await engine(page)).toBe('-- -- -- --');
});

test('a twin shows each engine: a failed one is told apart, not hidden by the highest N1', async ({ page }) => {
  await load(page, 'singapore-london');
  await expect(page.locator('#pv-rpm')).toHaveText(/^\d+ \d+$/);
  await page.evaluate(() => {
    const [a, b] = window.simGetState().engines;
    window.simSetState({ engines: [{ ...a, n1: 22, power: 0 }, { ...b, n1: 98 }] });
  });
  await expect(page.locator('#pv-rpm')).toHaveText('22 98');
  const [dead, live] = await page.locator('#pv-rpm span').evaluateAll(els => els.map(e => e.className));
  expect(dead).not.toContain('green');
  expect(live).toContain('green');
});

for (const width of [1600, 1280]) {
  test(`four engines at 100 % fit the strip at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await load(page, 'fimp-takeoff');
    await page.evaluate(() => window.simSetState({
      engines: window.simGetState().engines.map(e => ({ ...e, state: 'running', n1: 100 })) }));
    await expect(page.locator('#pv-rpm')).toHaveText('100 100 100 100');
    const overflow = await page.evaluate(() => {
      const pn = document.getElementById('panel');
      const cells = [...pn.querySelectorAll('.panel-section')].filter(e => e.offsetParent);
      return { panel: pn.scrollWidth - pn.clientWidth,
               cells: cells.filter(c => c.scrollWidth > c.clientWidth).map(c => c.innerText.replace(/\n/g, ': ')) };
    });
    expect(overflow).toEqual({ panel: 0, cells: [] });
  });
}

test('Bf 109 on the ground: Motor AUS in its own cell', async ({ page }) => {
  await load(page, 'hahnweide-1944');
  await expect(page.locator('#pl-engine')).toHaveText('Motor');
  expect(await engine(page)).toBe('AUS');
  await expect(page.locator('#ps-rpm')).toBeVisible();
});

test('F4U: the label is Engine, not Motor', async ({ page }) => {
  await load(page, 'bougainville-1943');
  await expect(page.locator('#pl-engine')).toHaveText('Engine');
});

/* The Fuel cell follows the tanks (aircraft.tanks): one tank — "Fuel" and one value, no selector cell; two — L / R */
for (const [what, mission, label, value, sel] of [
  ['Bf 109 (one tank)', 'wolfskopf-1942', 'Fuel', /^\d+ L$/, false],
  ['MiG-15bis (one tank)', 'deblin-1955', 'Fuel', /^1400 L$/, false],
  ['F4U (two tanks: main and wings)', 'rabaul-1943', 'Fuel Main/Wing', /^897 \/ 460 L$/, true],
]) {
  test(`${what}: the Fuel cell shows as many values as tanks`, async ({ page }) => {
    await load(page, mission);
    await expect(page.locator('#pl-fuel')).toHaveText(label);
    expect(await page.locator('#pv-fuel').textContent()).toMatch(value);
    await expect(page.locator('#ps-fsel')).toBeVisible({ visible: sel });
  });
}
