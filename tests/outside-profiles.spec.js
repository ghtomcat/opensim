/* Render-profile smoke — every aircraft render profile must load and draw the
   outside view (_drawWireframe) without a runtime error. Guards the geometry
   registry / per-aircraft draw dispatch in display/outside.js. One mission per
   profile; "wb" is the default JSON-driven body. */
import { test, expect } from '@playwright/test';

const CASES = [
  { profile: 'c172',     mission: 'lszf-pattern'      },
  { profile: 'c172(dr)', mission: 'grenchen-circuit'  },
  { profile: 'bf109',    mission: 'hahnweide-1944'    },
  { profile: 'f4u',      mission: 'bougainville-1943' },
  { profile: 'mig15',    mission: 'deblin-1955'       },
  { profile: 'falcon9',  mission: 'crew-demo2'        },
  { profile: 'saturn-v', mission: 'apollo8'           },
  { profile: 'starship', mission: 'ift-12'            },
  { profile: 'wb',       mission: 'lszh-approach'     },
];

for (const c of CASES) {
  test(`${c.profile} — ${c.mission} loads + outside view renders`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(`/?mission=${c.mission}&test=1`);
    await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

    // Cycle view modes (PFD → combined → outside) so the rAF loop renders the
    // outside canvas at least once. Errors during any render frame are captured.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('v');
      await page.waitForTimeout(250);
    }

    const fatal = errors.filter(e =>
      /ReferenceError|TypeError|is not defined|Cannot read|undefined is not/i.test(e));
    expect(fatal, fatal.join('\n')).toEqual([]);
  });
}
