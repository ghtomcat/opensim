/* Probe — run a snippet inside the sim page and print what it returns.

   Loads /?mission=<id>&test=1 in headless Chromium, waits for simReady, then runs the
   function body read from stdin in the page (window.simStep / simGetState / simSetState
   are available — see docs/testing.md). Used for the "Reproduce" steps in docs/issues.md.

     python3 -m http.server 8080 &          # from the repo root
     node tools/probe.mjs crew-demo2 <<'EOF'
     window.simStep(600, 0.1);
     return window.simGetState().alt;
     EOF
*/
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const mission = process.argv[2];
if (!mission) { console.error('usage: node tools/probe.mjs <mission-id> < snippet.js'); process.exit(1); }
const body = readFileSync(0, 'utf8');

const browser = await chromium.launch();
const page    = await browser.newPage();
await page.goto(`http://localhost:8080/?mission=${mission}&test=1`);
await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
console.log(JSON.stringify(await page.evaluate(new Function(body))));
await browser.close();
