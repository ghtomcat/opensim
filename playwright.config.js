import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:  './tests',
  /* Calibration specs tune mission/aircraft JSON (calibrate_ift12 rewrites
     starship.json + ift-12.json) — not part of a normal run. `npm run calibrate`. */
  testIgnore: process.env.CALIBRATE ? [] : ['**/calibrate_*.spec.js'],
  /* Time limits catch a hang; they don't measure speed. The tests step the sim (window.simStep),
     so their results don't depend on how fast the machine is — but with the CPU busy elsewhere
     the same test takes 3–4× as long (measured 2026-11-07: twice as many busy processes as
     cores, normal tests up to 32 s). A long simulation file sets its own limit
     (test.describe.configure). A wait for "loaded" has no limit of its own: the test's applies. */
  timeout:  120_000,
  expect:   { timeout: 20_000 },
  use: {
    baseURL:           'http://localhost:8080',
    headless:          true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command:   'python3 -m http.server 8080',
    url:       'http://localhost:8080',
    reuseExistingServer: true,
  },
});
