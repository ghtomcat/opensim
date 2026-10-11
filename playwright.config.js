import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:  './tests',
  /* Calibration specs tune mission/aircraft JSON (calibrate_ift12 rewrites
     starship.json + ift-12.json) — not part of a normal run. `npm run calibrate`. */
  testIgnore: process.env.CALIBRATE ? [] : ['**/calibrate_*.spec.js'],
  timeout:  30_000,
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
