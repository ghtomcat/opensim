import { test, expect } from '@playwright/test';

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}

test('trace F9 CRS-1 trajectory', async ({ page }) => {
  await loadSim(page, 'crs1');
  
  for (let t = 0; t <= 800; t += 50) {
    await page.evaluate(() => window.simStep(50, 1.0));
    const s = await page.evaluate(() => window.simGetState());
    const altKm = ((s.alt ?? 0) * 0.3048 / 1000).toFixed(1);
    const velKms = ((s.spd ?? 0) * 0.5144 / 1000).toFixed(2);
    const fpa = (s.pitch ?? 90).toFixed(1);
    const stage = s.rocketStage ?? 1;
    const seco = s.rocketSECO ? 'SECO' : '';
    const q = (s.rocketDynQ ?? 0).toFixed(0);
    const g = (s.rocketG ?? 0).toFixed(2);
    const eng = s.rocketActiveEngines ?? 1;
    console.log(`T+${String(t+50).padStart(3)}s: alt=${altKm.padStart(6)}km vel=${velKms}km/s fpa=${fpa.padStart(6)}° stg=${stage} eng=${eng} Q=${q.padStart(7)}Pa G=${g} ${seco}`);
  }
});
