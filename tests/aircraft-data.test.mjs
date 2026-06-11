/**
 * Aircraft data lint — pure JSON checks over aircraft/*.json (no browser, no Web Audio).
 *
 * Catches the bug class where a glass-cockpit jet is missing engine.type/count — which
 * silently leaves N1/N2 at 0, because the turbofan physics block is gated on engine.type
 * (the a350 and a220 both hit this) — plus malformed thrustProfiles, which the A/THR
 * detent ceilings (core/thrust.js) read.
 *
 * Run:  node --test tests/aircraft-data.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here  = dirname(fileURLToPath(import.meta.url));
const dir   = join(here, '..', 'aircraft');
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

const GLASS_JET = new Set(['airbus', 'e190']);   // panels that drive the turbofan A/THR + N1 system

for (const file of files) {
  test(`aircraft/${file}`, () => {
    let j;
    assert.doesNotThrow(() => { j = JSON.parse(readFileSync(join(dir, file), 'utf8')); }, `${file}: invalid JSON`);

    /* every aircraft carries a non-empty string id */
    assert.equal(typeof j.id, 'string', `${file}: missing string "id"`);
    assert.ok(j.id.length, `${file}: empty "id"`);

    /* envelope sanity, when present */
    if (j.envelope && j.envelope.maxSpd !== undefined)
      assert.ok(Number.isFinite(j.envelope.maxSpd) && j.envelope.maxSpd > 0, `${file}: envelope.maxSpd must be > 0`);

    /* a declared turbofan must carry a usable engine count + a sane idle */
    if (j.engine?.type === 'turbofan') {
      assert.ok(Number.isInteger(j.engine.count) && j.engine.count >= 1, `${file}: turbofan needs integer engine.count >= 1`);
      if (j.engine.idleN1 !== undefined)
        assert.ok(j.engine.idleN1 >= 0 && j.engine.idleN1 <= 100, `${file}: engine.idleN1 out of range`);
    }

    /* thrustProfiles integrity — the A/THR detents read these */
    if (j.thrustProfiles !== undefined) {
      assert.ok(Array.isArray(j.thrustProfiles) && j.thrustProfiles.length, `${file}: thrustProfiles must be a non-empty array`);
      for (const p of j.thrustProfiles) {
        assert.ok(typeof p.label === 'string' && p.label.length, `${file}: each profile needs a non-empty string label`);
        assert.ok(Number.isFinite(p.spdT) && p.spdT >= 0, `${file}: profile "${p.label}" spdT must be a finite number >= 0`);
        if (p.n1 !== undefined)
          assert.ok(p.n1 >= 0 && p.n1 <= 100, `${file}: profile "${p.label}" n1 out of range`);
      }
      assert.ok(Math.max(...j.thrustProfiles.map(p => p.spdT)) > 0, `${file}: thrustProfiles need a positive max spdT (lever denominator)`);
    }

    /* glass-cockpit jets MUST declare a turbofan, or N1/N2 stay 0 forever */
    if (GLASS_JET.has(j.panel)) {
      assert.equal(j.engine?.type, 'turbofan', `${file}: glass jet (panel ${j.panel}) must have engine.type "turbofan"`);
      assert.ok(Number.isInteger(j.engine?.count) && j.engine.count >= 1, `${file}: glass jet needs engine.count >= 1`);
      assert.ok(j.thrustProfiles?.length, `${file}: glass jet needs thrustProfiles for the A/THR detents`);
    }
  });
}
