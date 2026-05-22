/**
 * Verify LOI fires correctly across different browser frame rates.
 *
 * window.simStep(n, dt) calls tickRocket(dt) n times directly — no PHYS_DT
 * accumulator.  To simulate what the browser actually does, we must replicate
 * the accumulator logic from loop.js:
 *
 *   effectiveDt(warp, fps) =
 *     warp/fps >= PHYS_DT  →  PHYS_DT   (accumulator drains in 1 s steps)
 *     warp/fps <  PHYS_DT  →  warp/fps  (low-warp / high-fps path, exact frame dt)
 *
 * At 60 fps, warp=100: warpDt=1.67s → dt=1s   (accumulator, fine)
 * At 120 fps, warp=100: warpDt=0.83s → dt=0.83s (sub-PHYS_DT — different trajectory)
 *
 * LOI must fire at moonDist < 2 000 km in all scenarios.
 */
import { test, expect } from '@playwright/test';

const PHYS_DT = 1.0;   // must match loop.js

function effectiveDt(warp, fps) {
  const warpDt = warp / fps;
  return warpDt >= PHYS_DT ? PHYS_DT : warpDt;
}

async function stepSim(page, simSeconds, dt) {
  const n = Math.ceil(simSeconds / dt);
  await page.evaluate(([n, d]) => window.simStep(n, d), [n, dt]);
}

async function getMoonState(page) {
  return page.evaluate(() => {
    const s = window.simGetState();
    return {
      t:          Math.round(s.time),
      rocketLOI:  s.rocketLOI,
      loiActualT: Math.round(s.loiActualT ?? 0),
      loiMoonRkm: Math.round((s.loiMoonR ?? 0) / 1000),   // moonDist at LOI burn
    };
  });
}

const SCENARIOS = [
  { label: '60 fps  warp=100',  fps: 60,  warpNear: 100 },
  { label: '120 fps warp=100', fps: 120, warpNear: 100 },
  { label: '144 fps warp=100', fps: 144, warpNear: 100 },
];

for (const sc of SCENARIOS) {
  test(`LOI fires at periapsis — ${sc.label}`, async ({ page }) => {
    const logs = [];
    page.on('console', msg => {
      const t = msg.text();
      if (t.includes('[LOI]') || t.includes('[periapsis]') || t.includes('[SOI') || t.includes('[MCC')) logs.push(t);
    });

    await page.goto('/?mission=apollo8&test=1');
    await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

    // Phase 1 — launch at real-time dt (warp=1, 60 fps).  Same for all scenarios.
    await page.evaluate(() => window.simStep(720000, 1 / 60));   // → t ≈ 12 000 s

    // Phase 2 — far cislunar at warp=1000 (warpDt >> PHYS_DT at any fps → dt=1s)
    await stepSim(page, 258000, effectiveDt(1000, sc.fps));      // → t ≈ 270 000 s

    // Phase 3 — Moon approach: warp cap at 50 Mm holds warp=100.
    // At high fps this warpDt < PHYS_DT, giving sub-1s steps — the path the
    // old test never exercised.
    const dtNear = effectiveDt(sc.warpNear, sc.fps);
    await stepSim(page, 60000, dtNear);                          // → t ≈ 330 000 s (past LOI)

    const st = await getMoonState(page);
    console.log(`[${sc.label}]  dt_near=${dtNear.toFixed(3)}s  loiT=${st?.loiActualT}  loiMoonR=${st?.loiMoonRkm}km`);
    for (const l of logs) console.log(l);

    expect(st?.rocketLOI, `LOI must fire (dt_near=${dtNear.toFixed(3)}s)`).toBe(true);
    // loiMoonR is moonDist at the moment the burn fired — must be near periapsis, not a far-field trigger
    expect(st?.loiMoonRkm, 'LOI must fire near periapsis (< 2000 km from Moon center)').toBeLessThan(2000);
  });
}
