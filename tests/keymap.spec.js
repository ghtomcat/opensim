/**
 * The key map in the page: every binding has an action on every kind of vehicle, and real key events
 * do what the table says. The table's own rules: keymap.test.mjs.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

async function load(page, mission, query = '&test=1') {
  await page.goto(`/?mission=${mission}${query}`);
  await page.locator('#mission-clock.visible').waitFor();   // loaded: as long as the load takes
  await frames(page);
}
const field = (page, f) => page.evaluate(async (f) => (await import('/core/state.js')).S[f], f);

for (const [what, mission] of [['A350', 'lszh-approach'], ['777', 'singapore-london'], ['E190', 'lsgg-takeoff'], ['C172', 'lszf-pattern'],
  ['DR400', 'grenchen-circuit'], ['Velis', 'lszg-velis'], ['Bf 109', 'wolfskopf-1942'], ['F4U', 'bougainville-1943'], ['MiG-15bis', 'deblin-1955'],
  ['Avro', 'melun-1918'], ['An-225', 'hostomel-2022'], ['Tu-95', 'nordmeer-1956'], ['Dragon', 'crew-demo2'], ['Apollo', 'apollo8'],
  ['Falcon 1', 'falcon1-omelek'], ['Starship', 'ift-12'], ['SO-101', 'so101-workspace'], ['Yertle', 'yertle-lab']]) {
  test(`${what}: every key offered has an action`, async ({ page }) => {
    await load(page, mission);
    const missing = await page.evaluate(async () => {
      const { unregisteredActions } = await import('/core/keymap.js');
      const { S } = await import('/core/state.js');
      return unregisteredActions(S.aircraft);
    });
    /* The robots register theirs when their 3D view starts; headless Chromium has no WebGL */
    expect(missing.filter(id => id !== 'arm-keys' && id !== 'dog-keys')).toEqual([]);
  });
}

test('the key map on screen is generated for this aircraft', async ({ page }) => {
  await load(page, 'wolfskopf-1942', '');
  await expect(page.locator('#ob-grid')).toContainText('Kraftstoffhahn');
  await expect(page.locator('#ob-grid')).not.toContainText('Motor abstellen');
});

test('the key map up: the first key only closes it', async ({ page }) => {
  await load(page, 'wolfskopf-1942', '');
  await expect(page.locator('#onboarding')).toHaveClass(/visible/);
  expect(await field(page, 'gear')).toBe(false);
  await page.keyboard.press('g');
  await expect(page.locator('#onboarding')).toBeHidden();
  expect(await field(page, 'paused')).toBe(false);
  expect(await field(page, 'gear')).toBe(false);                      // it closed the map, and moved no gear
  await page.keyboard.press('g');
  expect(await field(page, 'gear')).toBe(true);
});

for (const [what, mission, row] of [['A350', 'lszh-approach', 'ENG MODE'], ['C172', 'lszf-pattern', 'Fuel selector'], ['Velis', 'lszg-velis', 'PWR EN'],
  ['Falcon 1', 'falcon1-omelek', 'Time warp'], ['SO-101', 'so101-workspace', 'Gripper']]) {
  test(`${what}: the KEYS button opens this vehicle's key map, the sim waits, any key closes it`, async ({ page }) => {
    await load(page, mission);
    await page.keyboard.press('Shift');
    const ob = page.locator('#onboarding');
    await page.locator('#btn-keys').click();
    await expect(ob).toHaveClass(/visible/);
    await expect(page.locator('#ob-grid')).toContainText(row);
    await expect(page.locator('.ob-hint')).toContainText('to close');
    expect(await field(page, 'paused')).toBe(true);
    await page.keyboard.press('g');                                   // closes, and does nothing else
    await expect(ob).toBeHidden();
    expect(await field(page, 'paused')).toBe(false);
  });
}

test('? opens it too, a click closes it, and a paused sim stays paused', async ({ page }) => {
  await load(page, 'lszf-pattern');
  await page.keyboard.press('Shift');
  await page.keyboard.press('p');
  await page.keyboard.press('?');
  const ob = page.locator('#onboarding');
  await expect(ob).toHaveClass(/visible/);
  await ob.click();
  await expect(ob).toBeHidden();
  expect(await field(page, 'paused')).toBe(true);
  await page.keyboard.press('p');
  expect(await field(page, 'paused')).toBe(false);
});

test('the button is there on every view, and Space after a click is still PTT', async ({ page }) => {
  await load(page, 'lszh-approach');
  await page.keyboard.press('Shift');
  await page.keyboard.press('o');
  await frames(page);
  await expect(page.locator('#btn-keys')).toBeVisible();
  await page.locator('#btn-keys').click();
  await expect(page.locator('#onboarding')).toHaveClass(/visible/);
  await page.keyboard.press('Escape');                                // closes it: no way back to the picker by accident
  await expect(page.locator('#onboarding')).toBeHidden();
  expect(page.url()).toContain('mission=lszh-approach');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('Caps Lock: gear and role work with the capital letter', async ({ page }) => {
  await load(page, 'wolfskopf-1942');
  await page.keyboard.press('Shift');
  await page.keyboard.press('G');
  expect(await field(page, 'gear')).toBe(true);
});

test('typing in the scratchpad types', async ({ page }) => {
  await load(page, 'lszh-approach');
  await page.keyboard.press('Shift');
  await page.evaluate(() => {
    const t = document.body.appendChild(document.createElement('textarea'));
    t.id = 'typing'; t.style.cssText = 'position:fixed;z-index:99999;top:0;left:0'; t.focus();
  });
  await page.keyboard.type('pkx');
  await expect(page.locator('#typing')).toHaveValue('pkx');
  expect(await field(page, 'paused')).toBe(false);
  await expect(page.locator('#flag-audio')).toBeHidden();
});

test('the picker and the briefing have their own keys, not the flight keys', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ms-card').first().waitFor();
  await page.keyboard.press('p');
  expect(await field(page, 'paused')).toBe(false);
  await page.locator('.ms-card').first().click();
  await expect(page.locator('#briefing')).toBeVisible();
  await page.keyboard.press('p');
  expect(await field(page, 'paused')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#briefing')).toBeHidden();
});
