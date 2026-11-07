/**
 * PAUSED, AUDIO OFF and TIME WARP: one place, under the mission clock, on every vehicle and view. Shown only
 * while true. No panel draws its own pause text.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';
import { readFileSync, readdirSync } from 'node:fs';

const VEHICLES = [
  ['A350 glass', 'lszh-approach'], ['Bf 109', 'wolfskopf-1942'], ['F4U', 'bougainville-1943'], ['Avro', 'melun-1918'],
  ['C172 G1000', 'lszf-pattern'], ['DR400', 'grenchen-circuit'], ['Velis', 'lszg-velis'],
  ['Dragon', 'crew-demo2'], ['Apollo', 'apollo8'], ['Falcon 1', 'falcon1-omelek'], ['Starship', 'ift-12'],
  ['SO-101', 'so101-workspace'], ['Yertle', 'yertle-lab'],
];

async function load(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true);
}

/** The flag is on screen and nothing covers its centre. */
async function shown(page, id) {
  const flag = page.locator(id);
  await expect(flag).toBeVisible();
  const onTop = await flag.evaluate(el => {
    el.style.pointerEvents = 'auto';                                    // the clock's none would hide it from the hit test
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    el.style.pointerEvents = '';
    return { inView: r.x >= 0 && r.bottom <= innerHeight, covered: hit === el ? null : (hit?.id || hit?.className) };
  });
  return onTop.inView && onTop.covered === null ? true : onTop;
}

for (const [what, mission] of VEHICLES) {
  test(`${what}: both flags appear and go`, async ({ page }) => {
    await load(page, mission);
    await expect(page.locator('#flag-paused')).toBeHidden();
    await expect(page.locator('#flag-audio')).toBeHidden();
    await page.evaluate(() => window.simSetState({ paused: true }));
    await page.keyboard.press('x');
    expect(await shown(page, '#flag-paused')).toBe(true);
    expect(await shown(page, '#flag-audio')).toBe(true);
    await page.evaluate(() => window.simSetState({ paused: false }));
    await page.keyboard.press('x');
    await expect(page.locator('#flag-paused')).toBeHidden();
    await expect(page.locator('#flag-audio')).toBeHidden();
  });
}

for (const [what, mission, key] of [['overhead', 'lszh-approach', 'o'], ['pedestal', 'lszh-approach', 'd'], ['centre', 'lszh-approach', 'm'], ['left console', 'wolfskopf-1942', 'l'], ['right console', 'wolfskopf-1942', 'r']]) {
  test(`the ${what} view doesn't cover them`, async ({ page }) => {
    await load(page, mission);
    await page.keyboard.press(key);
    await frames(page);
    await page.evaluate(() => window.simSetState({ paused: true }));
    await page.keyboard.press('x');
    expect(await shown(page, '#flag-paused')).toBe(true);
    expect(await shown(page, '#flag-audio')).toBe(true);
  });
}

test('time warp on a rocket: the flag shows it, with the next event', async ({ page }) => {
  await load(page, 'crew-demo2');
  await expect(page.locator('#flag-warp')).toBeHidden();
  await page.keyboard.press('w');
  await expect(page.locator('#flag-warp')).toHaveText(/^TIME WARP 2× · \S/);
  expect(await shown(page, '#flag-warp')).toBe(true);
  await page.evaluate(() => window.simSetState({ warpFactor: 1 }));
  await expect(page.locator('#flag-warp')).toBeHidden();
});

for (const [what, mission] of [['airliner', 'lszh-approach'], ['warbird', 'wolfskopf-1942'], ['C172', 'lszf-pattern']]) {
  test(`no time warp on an aircraft: the keys do nothing, and nothing claims it (${what})`, async ({ page }) => {
    await load(page, mission);
    await page.keyboard.press('w');
    await page.keyboard.press('j');
    expect((await page.evaluate(() => window.simGetState())).warpFactor ?? 1).toBe(1);
    await page.evaluate(() => window.simSetState({ warpFactor: 10 }));   // even if it were set: the sim runs at 1×
    await frames(page);
    await expect(page.locator('#flag-warp')).toBeHidden();
    await expect(page.locator('.warp-btn')).toHaveCount(0);
  });
}

test('all three flags together fit on screen, also on a small window', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await load(page, 'crew-demo2');
  await page.evaluate(() => window.simSetState({ paused: true, warpFactor: 1000 }));
  await page.keyboard.press('x');
  await expect(page.locator('#flag-warp')).toBeVisible();
  const right = await page.locator('#flag-warp').evaluate(e => e.getBoundingClientRect().right);
  expect(right).toBeLessThan(1024);
});

test('the P key is what sets it', async ({ page }) => {
  await load(page, 'wolfskopf-1942');
  await page.keyboard.press('p');
  await expect(page.locator('#flag-paused')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.locator('#flag-paused')).toBeHidden();
});

test('no display module draws a pause text of its own', () => {
  const dir = new URL('../display/', import.meta.url);
  const bad = readdirSync(dir).filter(f => f.endsWith('.js') && /fillText\('[^']*PAUSE/.test(readFileSync(new URL(f, dir), 'utf8')));
  expect(bad).toEqual([]);
});

test('in real play too: the first key closes the key map, then P pauses', async ({ page }) => {
  await page.goto('/?mission=wolfskopf-1942');
  await page.locator('#onboarding.visible').waitFor();   // up, not just in the page: a key before that is lost
  await page.keyboard.press('Shift');
  await expect(page.locator('#flag-paused')).toBeHidden();
  await page.keyboard.press('p');
  await expect(page.locator('#flag-paused')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.locator('#flag-paused')).toBeHidden();
});

for (const [what, mission] of [['rocket', 'crew-demo2'], ['Apollo', 'apollo8'], ['robot', 'so101-workspace']]) {
  test(`no key map on a ${what}: the first P pauses`, async ({ page }) => {
    await page.goto(`/?mission=${mission}`);                            // real play: test mode skips the key map on every vehicle
    await page.locator('#mission-clock.visible').waitFor();   // loaded: as long as the load takes
    await frames(page);                                     // the mission's key listeners are on
    await page.keyboard.press('p');
    await expect(page.locator('#flag-paused')).toBeVisible();
    await page.keyboard.press('p');
    await expect(page.locator('#flag-paused')).toBeHidden();
    await page.keyboard.press('p');
    await expect(page.locator('#flag-paused')).toBeVisible();
  });
}
