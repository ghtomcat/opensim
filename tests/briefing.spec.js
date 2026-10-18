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

test('the briefing is a history step: Back returns to the picker, Fly then Back too', async ({ page }) => {
  await openBriefing(page, 'lszf-pattern');
  expect(new URL(page.url()).searchParams.get('briefing')).toBe('lszf-pattern');
  await page.goBack();
  await expect(page.locator('#briefing')).toBeHidden();
  await expect(page.locator('#mission-select')).not.toHaveClass(/hidden/);

  /* A second mission: Back from its briefing must not lead to the first one */
  await page.goForward();
  await expect(page.locator('#briefing')).toHaveClass(/visible/);
  await page.keyboard.press('Escape');                                   // Esc = Back
  await expect(page.locator('#mission-select')).not.toHaveClass(/hidden/);
  await page.evaluate(() => [...document.querySelectorAll('.ms-card')].find(c => /Wolfskopf|Titovka/i.test(c.textContent))?.click());
  await expect(page.locator('#briefing')).toHaveClass(/visible/);
  expect(new URL(page.url()).searchParams.get('briefing')).toBe('wolfskopf-1942');
  await page.click('#bp-fly');
  await flying(page, 'wolfskopf-1942');
  expect(new URL(page.url()).searchParams.get('mission')).toBe('wolfskopf-1942');
  await page.goBack();                                                   // the flight replaced the briefing entry
  await expect(page.locator('#mission-select')).not.toHaveClass(/hidden/);
  await expect(page.locator('#briefing')).toBeHidden();
});

test('a reload on the briefing stays on the briefing', async ({ page }) => {
  await page.goto('/?briefing=bougainville-1943');
  await expect(page.locator('#briefing')).toHaveClass(/visible/);
  await expect(page.locator('#bp-lead img.mb-document')).toBeVisible();
});

test('a takeoff offers the failure at V1 and the engine — and the 777 flies with it', async ({ page }) => {
  await openBriefing(page, 'singapore-london');
  await page.click('.bp-chip[data-kind="failure"]');
  await page.click('.bp-card[data-id="FAILURE"]');
  await expect(page.locator('.bp-seg button[data-e]')).toHaveText(['ENG 1', 'ENG 2', 'Random']);
  await page.click('.bp-seg button[data-t="v1"]');
  await page.click('.bp-seg button[data-e="1"]');
  await expect(page.locator('.bp-chip[data-kind="failure"]')).toContainText('at V1, ENG 1');
  await page.click('#bp-fly');
  await flying(page, 'singapore-london');
  const s = await page.evaluate(() => window.simGetState());
  expect(s.mission.failures.at(-1)).toEqual({ trigger: { type: 'v1' }, type: 'engine_power', value: 0, rampTime: 15, engine: 1 });

  /* the takeoff roll: nothing fails below V1 (= VR, 165 kt, for now); at V1 ENG 1 loses its power, ENG 2 doesn't */
  await page.evaluate(() => window.simSetState({ paused: false, engineState: 'running', enginePower: 1, thrustLever: 1, parkBrake: false, braking: false, athr: false }));
  await page.waitForFunction(() => { window.simStep(6, 1 / 60); return window.simGetState().spd >= 150; }, null, { polling: 10, timeout: 20_000 });
  expect((await page.evaluate(() => window.simGetState())).engines.map(e => e.factors.failure)).toEqual([1, 1]);
  await page.waitForFunction(() => { window.simStep(6, 1 / 60); return window.simGetState().spd >= 170; }, null, { polling: 10, timeout: 20_000 });
  await page.evaluate(() => window.simStep(1200, 1 / 60));         // the ramp (15 s) has run
  const after = await page.evaluate(() => window.simGetState());
  expect(after.engines[0].factors.failure).toBe(0);
  expect(after.engines[1].factors.failure).toBe(1);
});

test('an approach offers no V1; a single-engine aircraft no engine choice', async ({ page }) => {
  await openBriefing(page, 'lszh-approach');
  await page.click('.bp-chip[data-kind="failure"]');
  await page.click('.bp-card[data-id="PARTIAL"]');
  await expect(page.locator('.bp-seg button[data-t="v1"]')).toHaveCount(0);
  await expect(page.locator('.bp-seg button[data-e]')).toHaveCount(3);   // the A350: ENG 1, ENG 2, Random
  await openBriefing(page, 'lszf-pattern');
  await page.click('.bp-chip[data-kind="failure"]');
  await page.click('.bp-card[data-id="PARTIAL"]');
  await expect(page.locator('.bp-seg button[data-t="v1"]')).toHaveCount(1);   // the C172 takes off there
  await expect(page.locator('.bp-seg button[data-e]')).toHaveCount(0);
});
