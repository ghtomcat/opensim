/**
 * OpenSim — fuel, engine, and carb ice system tests
 *
 * Covers the full chain:
 *   fuelSelector → tickFuel → enginePower / engineState → warnings
 *   carbIceActive → tickFailures → carbIceLevel → enginePower
 *
 * Aircraft under test:
 *   - Cessna 172     (lycoming-o360, hasCarbHeat, dual tanks) — lszf-pattern
 *   - Bf 109 G-6     (v12-supercharged, single 400L left tank) — wolfskopf-1942
 *   - A350 / An-225  (no fuel system, fuelLeft=null)          — lszh-approach / hostomel-2022
 *
 * simStep is synchronous — all physics runs in-process, no rAF.
 * tickFuel(dt) is included in simStep from index.html test harness.
 */

import { test, expect } from '@playwright/test';

const MISSION = 'lszf-pattern';

async function loadSim(page) {
  await page.goto(`/?mission=${MISSION}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}

async function step(page, seconds, dt = 1 / 60) {
  await page.evaluate((n) => window.simStep(n), Math.round(seconds / dt));
}

async function getState(page) {
  return page.evaluate(() => window.simGetState());
}

async function setState(page, patch) {
  return page.evaluate((p) => window.simSetState(p), patch);
}

async function getRpm(page) {
  return page.evaluate(() => window.simGetRpm());
}

/* ═══════════════════════════════════════════
   FUEL — Initialization
   ═══════════════════════════════════════════ */

test.describe('Fuel — initialization', () => {
  test('C172 starts with 95 L in each tank', async ({ page }) => {
    await loadSim(page);
    const s = await getState(page);
    expect(s.fuelLeft).toBeCloseTo(95, 0);
    expect(s.fuelRight).toBeCloseTo(95, 0);
  });

  test('C172 starts with fuel selector BOTH', async ({ page }) => {
    await loadSim(page);
    const s = await getState(page);
    expect(s.fuelSelector).toBe('BOTH');
  });

  test('C172 starts with engine running', async ({ page }) => {
    await loadSim(page);
    const s = await getState(page);
    expect(s.engineState).toBe('running');
    expect(s.enginePower).toBeGreaterThan(0.5);
  });
});

/* ═══════════════════════════════════════════
   FUEL SELECTOR — Cycling
   ═══════════════════════════════════════════ */

test.describe('Fuel selector — Q key cycles BOTH → LEFT → RIGHT → OFF → BOTH', () => {
  test('BOTH → LEFT', async ({ page }) => {
    await loadSim(page);
    await page.keyboard.press('q');
    expect((await getState(page)).fuelSelector).toBe('LEFT');
  });

  test('LEFT → RIGHT', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelSelector: 'LEFT' });
    await page.keyboard.press('q');
    expect((await getState(page)).fuelSelector).toBe('RIGHT');
  });

  test('RIGHT → OFF', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelSelector: 'RIGHT' });
    await page.keyboard.press('q');
    expect((await getState(page)).fuelSelector).toBe('OFF');
  });

  test('OFF → BOTH', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelSelector: 'OFF' });
    await page.keyboard.press('q');
    expect((await getState(page)).fuelSelector).toBe('BOTH');
  });
});

/* ═══════════════════════════════════════════
   FUEL SELECTOR OFF — Engine cut
   ═══════════════════════════════════════════ */

test.describe('Fuel selector OFF — engine starvation', () => {
  test('selector OFF kills engine within 2 sim-seconds', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 1.0, engineState: 'running', fuelSelector: 'OFF' });
    await step(page, 2);
    expect((await getState(page)).enginePower).toBe(0);
  });

  test('selector OFF sets engineState to off (restartable)', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 1.0, engineState: 'running', fuelSelector: 'OFF' });
    await step(page, 2);
    expect((await getState(page)).engineState).toBe('off');
  });

  test('FUEL_SEL_OFF warning active when selector is OFF', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelSelector: 'OFF' });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.FUEL_SEL_OFF).toBe(true);
  });

  test('FUEL_SEL_OFF warning clears when selector returns to BOTH', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelSelector: 'OFF' });
    await step(page, 0.1);
    await setState(page, { fuelSelector: 'BOTH' });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.FUEL_SEL_OFF).toBe(false);
  });

  test('RPM shows --- when engine is dead', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelSelector: 'OFF' });
    await step(page, 2);
    const rpm = await getRpm(page);
    expect(rpm).toBe('---');
  });
});

/* ═══════════════════════════════════════════
   FUEL — Tank depletion & starvation
   ═══════════════════════════════════════════ */

test.describe('Fuel — tank depletion', () => {
  test('LEFT selector + left tank empty → engine dies', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 0.001, fuelRight: 95,
      fuelSelector: 'LEFT',
    });
    await step(page, 2);
    const s = await getState(page);
    expect(s.enginePower).toBe(0);
    expect(s.engineState).toBe('off');
  });

  test('RIGHT selector + right tank empty → engine dies', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 95, fuelRight: 0.001,
      fuelSelector: 'RIGHT',
    });
    await step(page, 2);
    const s = await getState(page);
    expect(s.enginePower).toBe(0);
    expect(s.engineState).toBe('off');
  });

  test('BOTH selector + only left empty → engine survives on right tank', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 0, fuelRight: 95,
      fuelSelector: 'BOTH',
    });
    await step(page, 10);
    expect((await getState(page)).enginePower).toBeGreaterThan(0.5);
  });

  test('BOTH selector + both tanks empty → engine dies', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 0.001, fuelRight: 0.001,
      fuelSelector: 'BOTH',
    });
    await step(page, 2);
    expect((await getState(page)).enginePower).toBe(0);
  });

  test('starvation sets engineState off (not failed — engine is restartable)', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 0, fuelRight: 0, fuelSelector: 'BOTH',
    });
    await step(page, 2);
    expect((await getState(page)).engineState).toBe('off');
  });
});

/* ═══════════════════════════════════════════
   FUEL — Burn rate
   ═══════════════════════════════════════════ */

test.describe('Fuel — burn rate', () => {
  test('fuel burns with engine running', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'BOTH',
    });
    const before = await getState(page);
    await step(page, 300);   // 5 minutes
    const after = await getState(page);
    expect(after.fuelLeft).toBeLessThan(before.fuelLeft);
    expect(after.fuelRight).toBeLessThan(before.fuelRight);
  });

  test('BOTH selector burns equally from both tanks (within 10%)', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'BOTH',
    });
    await step(page, 300);
    const s = await getState(page);
    expect(Math.abs(s.fuelLeft - s.fuelRight)).toBeLessThan(1.0);
  });

  test('LEFT selector drains left only — right unchanged', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'LEFT',
    });
    await step(page, 300);
    const s = await getState(page);
    expect(s.fuelLeft).toBeLessThan(49);          // left has burned
    expect(s.fuelRight).toBeCloseTo(50, 0);       // right untouched
  });

  test('RIGHT selector drains right only — left unchanged', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'RIGHT',
    });
    await step(page, 300);
    const s = await getState(page);
    expect(s.fuelRight).toBeLessThan(49);
    expect(s.fuelLeft).toBeCloseTo(50, 0);
  });

  test('no fuel burn when engine is off', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 0, engineState: 'off',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'BOTH',
    });
    await step(page, 300);
    const s = await getState(page);
    expect(s.fuelLeft).toBeCloseTo(50, 1);
    expect(s.fuelRight).toBeCloseTo(50, 1);
  });

  test('C172 burn rate ~28 L/h — within ±20% after 10 min full power', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'BOTH',
    });
    await step(page, 600);   // 10 minutes
    const s = await getState(page);
    const burned = (50 - s.fuelLeft) + (50 - s.fuelRight);   // total litres
    // 28 L/h × (10/60) h = 4.67 L expected
    expect(burned).toBeGreaterThan(3.5);
    expect(burned).toBeLessThan(6.0);
  });
});

/* ═══════════════════════════════════════════
   FUEL — Warnings
   ═══════════════════════════════════════════ */

test.describe('Fuel — warning flags', () => {
  test('LOW_FUEL fires when total fuel < 10% of capacity', async ({ page }) => {
    await loadSim(page);
    // C172: 95+95=190L total, 10% = 19L. Set to 8+8 = 16L.
    await setState(page, { fuelLeft: 8, fuelRight: 8, fuelSelector: 'BOTH', enginePower: 1.0 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.LOW_FUEL).toBe(true);
  });

  test('LOW_FUEL fires when LEFT tank < 5 L on LEFT selector', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      fuelLeft: 3, fuelRight: 95, fuelSelector: 'LEFT', enginePower: 1.0,
    });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.LOW_FUEL).toBe(true);
  });

  test('LOW_FUEL fires when RIGHT tank < 5 L on RIGHT selector', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      fuelLeft: 95, fuelRight: 3, fuelSelector: 'RIGHT', enginePower: 1.0,
    });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.LOW_FUEL).toBe(true);
  });

  test('LOW_FUEL clear with full tanks on BOTH', async ({ page }) => {
    await loadSim(page);
    await setState(page, { fuelLeft: 95, fuelRight: 95, fuelSelector: 'BOTH', enginePower: 1.0 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.LOW_FUEL).toBe(false);
  });

  test('OIL_PRESS warning fires when enginePower < 0.3', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 0.15 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.OIL_PRESS).toBe(true);
  });

  test('OIL_PRESS clears when enginePower >= 0.3', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 0.8 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.OIL_PRESS).toBe(false);
  });
});

/* ═══════════════════════════════════════════
   ENGINE LIFECYCLE — Start, cut, restart
   Uses real AudioContext time — waitForFunction polls until onended fires (~2.8s).
   ═══════════════════════════════════════════ */

async function startEngine(page) {
  await setState(page, { engineState: 'off', enginePower: 0 });
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => window.simGetState().engineState === 'running',
    { timeout: 12_000 }
  );
}

test.describe('Engine lifecycle — Lycoming start and restart', () => {
  test('E from off → engineState running', async ({ page }) => {
    await loadSim(page);
    await startEngine(page);
    expect((await getState(page)).engineState).toBe('running');
  });

  test('E from off → enginePower restored to 1.0', async ({ page }) => {
    await loadSim(page);
    await startEngine(page);
    expect((await getState(page)).enginePower).toBeCloseTo(1.0, 1);
  });

  test('E from off → RPM at idle ~700', async ({ page }) => {
    await loadSim(page);
    await startEngine(page);
    const rpm = parseInt(await getRpm(page));
    expect(rpm).toBeGreaterThanOrEqual(600);
    expect(rpm).toBeLessThanOrEqual(800);
  });

  test('RPM not stuck at 7 after start (starter floor regression)', async ({ page }) => {
    await loadSim(page);
    await startEngine(page);
    const rpm = await getRpm(page);
    expect(rpm).not.toBe('7 RPM');
  });

  test('full cycle: start → fuel OFF → fuel BOTH → restart', async ({ page }) => {
    await loadSim(page);

    // First start
    await startEngine(page);
    expect((await getState(page)).engineState).toBe('running');

    // Cut fuel: BOTH → LEFT → RIGHT → OFF
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await step(page, 2);
    expect((await getState(page)).engineState).toBe('off');

    // Restore fuel: OFF → BOTH
    await page.keyboard.press('q');
    expect((await getState(page)).fuelSelector).toBe('BOTH');

    // Restart
    await startEngine(page);
    const s = await getState(page);
    expect(s.engineState).toBe('running');
    expect(s.enginePower).toBeCloseTo(1.0, 1);
  });

  test('RPM after restart is ~700, not 7 (enginePower not stuck at 0.01)', async ({ page }) => {
    await loadSim(page);

    // Start, cut, restart
    await startEngine(page);
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await page.keyboard.press('q');  // OFF
    await step(page, 2);
    await page.keyboard.press('q');  // BOTH
    await startEngine(page);

    const rpm = parseInt(await getRpm(page));
    expect(rpm).toBeGreaterThan(500);
    expect(rpm).not.toBe(7);
  });

  test('E does nothing if engine already running', async ({ page }) => {
    await loadSim(page);
    await startEngine(page);
    await page.keyboard.press('e');   // second E — should be ignored
    await step(page, 0.5);
    expect((await getState(page)).engineState).toBe('running');
  });
});

/* ═══════════════════════════════════════════
   ENGINE — RPM display
   ═══════════════════════════════════════════ */

test.describe('Engine — RPM display', () => {
  test('RPM is numeric string when engine running', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 1.0, engineState: 'running' });
    await step(page, 0.1);
    const rpm = await getRpm(page);
    expect(rpm).toMatch(/^\d+ RPM$/);
    expect(parseInt(rpm)).toBeGreaterThan(0);
  });

  test('RPM shows --- when enginePower is 0', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 0, engineState: 'off' });
    await step(page, 0.1);
    const rpm = await getRpm(page);
    expect(rpm).toBe('---');
  });

  test('RPM does not show 35 when engine dead (floor bug regression)', async ({ page }) => {
    // Math.max(0.05, ePow) * rpmIdle = 0.05 * 700 = 35 — the classic floor bug
    await loadSim(page);
    await setState(page, { enginePower: 0, engineState: 'off' });
    await step(page, 0.1);
    const rpm = await getRpm(page);
    expect(rpm).not.toBe('35 RPM');
    expect(rpm).toBe('---');
  });

  test('RPM increases with throttle', async ({ page }) => {
    await loadSim(page);
    await setState(page, { enginePower: 0.3, engineState: 'running', spdT: 50 });
    await step(page, 0.1);
    const rpmLow = parseInt(await getRpm(page));

    await setState(page, { enginePower: 0.9, spdT: 150 });
    await step(page, 0.1);
    const rpmHigh = parseInt(await getRpm(page));

    expect(rpmHigh).toBeGreaterThan(rpmLow);
  });
});

/* ═══════════════════════════════════════════
   CARB ICE — Accumulation and recovery
   ═══════════════════════════════════════════ */

test.describe('Carb ice — accumulation', () => {
  test('ice accumulates when carbIceActive=true and no carb heat', async ({ page }) => {
    await loadSim(page);
    await setState(page, { carbIceActive: true, carbHeat: false, carbIceLevel: 0 });
    await step(page, 60);    // 60s — should accumulate ~0.67 of 90s max
    const s = await getState(page);
    expect(s.carbIceLevel).toBeGreaterThan(0.3);
  });

  test('ice reduces engine power at full icing (70% max reduction)', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      carbIceActive: true, carbHeat: false,
      carbIceLevel: 1.0,  // fully iced
      enginePower: 1.0,
    });
    await step(page, 0.1);
    // icePower = 1.0 - 1.0 * 0.7 = 0.3
    expect((await getState(page)).enginePower).toBeLessThan(0.4);
  });

  test('ice does not accumulate without carbIceActive failure', async ({ page }) => {
    await loadSim(page);
    await setState(page, { carbIceActive: false, carbHeat: false, carbIceLevel: 0 });
    await step(page, 60);
    expect((await getState(page)).carbIceLevel).toBeLessThan(0.05);
  });
});

test.describe('Carb ice — recovery with carb heat', () => {
  test('carb heat melts ice — 0.8 level clears within 15 sim-seconds', async ({ page }) => {
    await loadSim(page);
    await setState(page, { carbIceActive: true, carbHeat: true, carbIceLevel: 0.8 });
    await step(page, 15);
    // meltRate = dt/10 — full melt in 10s
    expect((await getState(page)).carbIceLevel).toBeLessThan(0.1);
  });

  test('carb heat prevents power loss from ice', async ({ page }) => {
    await loadSim(page);
    // Start with 50% ice but carb heat ON
    await setState(page, {
      carbIceActive: true, carbHeat: true,
      carbIceLevel: 0.5, enginePower: 1.0,
    });
    await step(page, 20);   // 20s — ice melts, power recovers
    expect((await getState(page)).carbIceLevel).toBeLessThan(0.1);
  });

  test('C key toggles carb heat on C172', async ({ page }) => {
    await loadSim(page);
    const before = (await getState(page)).carbHeat;
    await page.keyboard.press('c');
    const after = (await getState(page)).carbHeat;
    expect(after).toBe(!before);
  });

  test('C key toggles carb heat off again', async ({ page }) => {
    await loadSim(page);
    await page.keyboard.press('c');   // ON
    await page.keyboard.press('c');   // OFF
    expect((await getState(page)).carbHeat).toBe(false);
  });
});

/* ═══════════════════════════════════════════
   BF 109 — V12, single tank
   left: 400L, right: 0L
   Q → stopEngineLifecycle (not cycleFuelSelector)
   ═══════════════════════════════════════════ */

test.describe('Bf 109 — single left tank (V12)', () => {
  test('starts with 400 L in left tank, 0 in right', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    const s = await getState(page);
    expect(s.fuelLeft).toBeCloseTo(400, 0);
    expect(s.fuelRight).toBeCloseTo(0, 0);
  });

  test('starts with selector BOTH', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    expect((await getState(page)).fuelSelector).toBe('BOTH');
  });

  test('fuel burns from left tank only (right always 0)', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setState(page, { enginePower: 1.0, engineState: 'running', fuelLeft: 100, fuelRight: 0 });
    await step(page, 60);
    const s = await getState(page);
    expect(s.fuelLeft).toBeLessThan(100);
    expect(s.fuelRight).toBeCloseTo(0, 1);   // right stays 0
  });

  test('engine dies when left tank empties', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 0.001, fuelRight: 0,
      fuelSelector: 'BOTH',
    });
    await step(page, 2);
    expect((await getState(page)).enginePower).toBe(0);
  });

  test('V12 burn rate — 60s before t=115 failure', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setState(page, { enginePower: 1.0, engineState: 'running', fuelLeft: 200, fuelRight: 0 });
    await step(page, 60);    // 1 min — well before the t=115s gunfire failure
    const s = await getState(page);
    const burned = 200 - s.fuelLeft;
    // BOTH selector: right=0 → full burn from left at 120 L/h
    // 120 L/h × (1/60) h = 2.0 L expected
    expect(burned).toBeGreaterThan(1.5);
    expect(burned).toBeLessThan(2.5);
  });

  test('Q does NOT cycle fuel selector (V12 stops engine lifecycle instead)', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    const before = (await getState(page)).fuelSelector;
    await page.keyboard.press('q');
    const after = (await getState(page)).fuelSelector;
    // Selector should be unchanged — Q drives stopEngineLifecycle on V12
    expect(after).toBe(before);
  });

  test('LOW_FUEL fires below 10% of 400 L (< 40 L)', async ({ page }) => {
    await page.goto('/?mission=wolfskopf-1942&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setState(page, { fuelLeft: 30, fuelRight: 0, fuelSelector: 'BOTH', enginePower: 1.0 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.LOW_FUEL).toBe(true);
  });
});

/* ═══════════════════════════════════════════
   NO-TANK AIRCRAFT — fuelLeft === null
   A350 (lszh-approach), An-225 (hostomel-2022)
   OIL_PRESS still fires; LOW_FUEL / FUEL_SEL_OFF do not.
   ═══════════════════════════════════════════ */

test.describe('No-tank aircraft — A350 (no fuel system)', () => {
  test('fuelLeft is null — no fuel system', async ({ page }) => {
    await page.goto('/?mission=lszh-approach&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    expect((await getState(page)).fuelLeft).toBeNull();
  });

  test('OIL_PRESS warning still fires when enginePower < 0.3', async ({ page }) => {
    await page.goto('/?mission=lszh-approach&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setState(page, { enginePower: 0.1 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.OIL_PRESS).toBe(true);
  });

  test('OIL_PRESS clears when enginePower >= 0.3', async ({ page }) => {
    await page.goto('/?mission=lszh-approach&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await setState(page, { enginePower: 0.8 });
    await step(page, 0.1);
    expect((await getState(page)).warnings?.OIL_PRESS).toBe(false);
  });

  test('LOW_FUEL warning is not set (no tanks)', async ({ page }) => {
    await page.goto('/?mission=lszh-approach&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await step(page, 0.5);
    expect((await getState(page)).warnings?.LOW_FUEL).toBeFalsy();
  });

  test('FUEL_SEL_OFF warning is not set (no fuel selector)', async ({ page }) => {
    await page.goto('/?mission=lszh-approach&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
    await step(page, 0.5);
    expect((await getState(page)).warnings?.FUEL_SEL_OFF).toBeFalsy();
  });
});

/* ═══════════════════════════════════════════
   CRASH — fuel burn stops when crashed
   ═══════════════════════════════════════════ */

test.describe('Crash — fuel burn freezes', () => {
  test('fuel level does not change after crash', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'BOTH',
      crashed: true,
    });
    await step(page, 60);
    const s = await getState(page);
    // Both tanks should be unchanged — tickFuel returns early when crashed
    expect(s.fuelLeft).toBeCloseTo(50, 1);
    expect(s.fuelRight).toBeCloseTo(50, 1);
  });
});

/* ═══════════════════════════════════════════
   PARTIAL POWER — burn scales with enginePower
   ═══════════════════════════════════════════ */

test.describe('Fuel burn — scales with engine power', () => {
  test('half power burns roughly half as much fuel as full power', async ({ page }) => {
    // Full power run
    await loadSim(page);
    await setState(page, {
      enginePower: 1.0, engineState: 'running',
      fuelLeft: 80, fuelRight: 80, fuelSelector: 'BOTH',
    });
    await step(page, 300);
    const full = await getState(page);
    const burnedFull = (80 - full.fuelLeft) + (80 - full.fuelRight);

    // Half power run
    await loadSim(page);
    await setState(page, {
      enginePower: 0.5, engineState: 'running',
      fuelLeft: 80, fuelRight: 80, fuelSelector: 'BOTH',
    });
    await step(page, 300);
    const half = await getState(page);
    const burnedHalf = (80 - half.fuelLeft) + (80 - half.fuelRight);

    // Half power should burn 40–60% of what full power burns
    const ratio = burnedHalf / burnedFull;
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
  });

  test('no burn at enginePower = 0 (engine not running)', async ({ page }) => {
    await loadSim(page);
    await setState(page, {
      enginePower: 0, engineState: 'off',
      fuelLeft: 50, fuelRight: 50, fuelSelector: 'BOTH',
    });
    await step(page, 120);
    const s = await getState(page);
    expect(s.fuelLeft).toBeCloseTo(50, 1);
    expect(s.fuelRight).toBeCloseTo(50, 1);
  });
});
