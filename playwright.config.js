import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:  './tests',
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
