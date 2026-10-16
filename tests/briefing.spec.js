/**
 * Briefing page — one page between the mission picker and flying: the main content by layout
 * (doc · chart · text), a strip with only the choices the mission offers, and Fly (or Enter),
 * which hands the picks to init() as the setup. The choice rules themselves are in
 * tests/briefing.test.mjs; the setup reaching the sim in tests/scenario-setup.spec.js.
 */

import { test, expect } from '@playwright/test';

/** Picker → the mission's card → its briefing page. */
async function openBriefing(page, id) {
  await page.goto('/?test=1');
  await page.waitForSelector('.ms-card');
  await page.evaluate(async (id) => {
    const { MISSIONS } = await import('/core/catalog.js');
    const m = MISSIONS.find(m => m.id === id);
    const tab = m.era === 'LAB' ? 'lab' : m.era === 'ORBIT' ? 'orbit' : 'fly';
    document.querySelector(`.ms-tab[data-tab="${tab}"]`).click();
    [...document.querySelectorAll('.ms-card')].find(c => c.querySelector('.ms-title').textContent === m.title).click();
  }, id);
  await expect(page.locator('#briefing')).toHaveClass(/visible/);
}

const chips = (page) => page.locator('#bp-strip .bp-chip').evaluateAll(cs => cs.map(c => c.dataset.kind));
const flying = (page, id) => page.waitForFunction(id => window.simReady === true && window.simGetState().mission?.id === id, id, { timeout: 15_000 });

test('a fixed-story mission offers nothing to choose: Controls and Fly', async ({ page }) => {
  await openBriefing(page, 'wolfskopf-1942');
  await expect(page.locator('#bp-lead img.mb-document')).toBeVisible();
  expect(await chips(page)).toEqual(['controls']);
  await page.keyboard.press('Enter');
  await flying(page, 'wolfskopf-1942');
  await expect(page.locator('#briefing')).toBeHidden();
});

test('a rocket offers its crew, no weather or engine failure', async ({ page }) => {
  await openBriefing(page, 'crew-demo2');
  expect(await chips(page)).toEqual(['crew']);
});

test('the airliner gets its charts; the Controls chip opens the key list and closes again', async ({ page }) => {
  await openBriefing(page, 'lszh-approach');
  await expect(page.locator('#fb-inner')).toBeVisible();
  await expect(page.locator('#fb-params')).not.toContainText('CRUISE');
  expect(await chips(page)).toEqual(['weather', 'crew', 'failure', 'controls']);
  const pop = page.locator('#bp-pop');
  await page.click('.bp-chip[data-kind="controls"]');
  await expect(pop.locator('.bp-keys')).toBeVisible();
  await page.click('.bp-chip[data-kind="controls"]');
  await expect(pop).toBeHidden();
  await page.click('.fb-tab[data-tab="airport"]');                     // both airports, departure first
  await expect(page.locator('#fb-apt button')).toHaveText(['KSFO', 'LSZH']);
  await expect(page.locator('#fb-apt button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.click('#fb-apt button:text("LSZH")');
  await expect(page.locator('#fb-apt button').last()).toHaveAttribute('aria-pressed', 'true');
  await page.click('.fb-tab[data-tab="route"]');
  await expect(page.locator('#fb-apt')).toBeHidden();
});

test('the picks are the setup the mission flies with', async ({ page }) => {
  await openBriefing(page, 'lszf-pattern');
  await page.click('.bp-chip[data-kind="weather"]');
  await page.click('.bp-card[data-id="OVC 1500"]');
  await expect(page.locator('#bp-pop')).toBeVisible();          // stays open after a pick
  await page.click('.bp-chip[data-kind="failure"]');
  await page.click('.bp-card[data-id="PARTIAL"]');
  await page.click('.bp-seg button[data-t="fixed"]');
  await page.fill('#bp-fixed-t', '90');
  await page.press('#bp-fixed-t', 'Tab');
  await expect(page.locator('.bp-chip[data-kind="failure"]')).toContainText('at 90 s');
  await page.click('#bp-fly');
  await flying(page, 'lszf-pattern');
  const s = await page.evaluate(() => window.simGetState());
  expect(s.metar.clouds).toEqual([{ cover: 'OVC', base: 1500 }]);
  expect(s.mission.failures.at(-1)).toEqual({ trigger: { type: 'time', t: 90 }, type: 'engine_power', value: 0.5, rampTime: 30 });
});
