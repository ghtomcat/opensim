import { test, expect } from '@playwright/test';

const MU = 3.986e14;
const R_EARTH = 6371000;

function orbitFromSECO(alt_m, vel_ms, fpa_deg) {
  const r = R_EARTH + alt_m;
  const vt = vel_ms * Math.cos(fpa_deg * Math.PI / 180);
  const eps = vel_ms * vel_ms / 2 - MU / r;
  const a = -MU / (2 * eps);
  const h = r * vt;
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU * MU)));
  return {
    alt_p_km: (a * (1 - e) - R_EARTH) / 1000,
    alt_a_km: (a * (1 + e) - R_EARTH) / 1000,
    e,
    period_min: 2 * Math.PI * Math.sqrt(a * a * a / MU) / 60,
  };
}

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15000 });
}
async function stepSeconds(page, s) {
  await page.evaluate((s) => window.simStep(s, 1.0), s);
}
async function getState(page) {
  return page.evaluate(() => window.simGetState());
}

test('inspiration5 reaches ~590 km circular orbit', async ({ page }) => {
  await loadSim(page, 'inspiration5');
  for (let t = 0; t < 900; t += 5) {
    await stepSeconds(page, 5);
    const s = await getState(page);
    if (s.rocketSECO) {
      const alt_m  = (s.alt ?? 0) * 0.3048;
      const vel_ms = (s.spd ?? 0) * 0.5144;
      const fpa    = s.pitch ?? 0;
      const orb = orbitFromSECO(alt_m, vel_ms, fpa);
      console.log(`SECO at t=${t+5}s | alt: ${(alt_m/1000).toFixed(1)} km | vel: ${vel_ms.toFixed(0)} m/s | fpa: ${fpa.toFixed(2)}°`);
      console.log(`Orbit: ${orb.alt_p_km.toFixed(0)} × ${orb.alt_a_km.toFixed(0)} km | e=${orb.e.toFixed(4)} | T=${orb.period_min.toFixed(1)} min`);
      expect(orb.alt_p_km).toBeGreaterThan(560);
      expect(orb.alt_p_km).toBeLessThan(630);
      expect(orb.e).toBeLessThan(0.05);
      break;
    }
  }
});
