/**
 * The audio switch (X) — core/audio.js. Everything the sim plays goes through it, on three paths;
 * muted speech keeps running, so the mission script's chain doesn't stop.
 *
 * Run:  node --test tests/audio-output.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/* A speech engine that speaks one line at a time, finished by finish() */
class Utt {
  constructor(text) { this.text = text; this.volume = 1; this.onend = null; this.onerror = null; this._l = {}; }
  addEventListener(t, f) { (this._l[t] ??= []).push(f); }
  fire(t) { this[`on${t}`]?.(); (this._l[t] ?? []).forEach(f => f()); }
}
const engine = {
  queue: [],
  speak(u) { this.queue.push(u); },
  cancel() { const q = this.queue; this.queue = []; q.forEach(u => u.fire('error')); },   // as browsers do
  finish() { this.queue.shift().fire('end'); },
};
globalThis.speechSynthesis = engine;
globalThis.SpeechSynthesisUtterance = Utt;
const { speak, setAudioMuted, audioMuted, cancelSpeech } = await import('../core/audio.js');

beforeEach(() => { setAudioMuted(false); cancelSpeech(); engine.queue = []; });

test('a line spoken while muted is silent, and its end still fires', () => {
  setAudioMuted(true);
  let ended = false;
  const u = new Utt('Cleared for takeoff'); u.volume = 0.9; u.onend = () => { ended = true; };
  speak(u);
  assert.equal(engine.queue[0].volume, 0);
  engine.finish();
  assert.equal(ended, true);
});

test('muting while a line plays: lines replaced at volume 0, in order, and the chain goes on', () => {
  const ended = [];
  for (const t of ['one', 'two']) { const u = new Utt(t); u.volume = 0.9; u.onend = () => ended.push(t); speak(u); }
  setAudioMuted(true);
  assert.deepEqual(engine.queue.map(u => [u.text, u.volume]), [['one', 0], ['two', 0]]);
  assert.deepEqual(ended, []);                 // the cancel itself ends nothing
  engine.finish(); engine.finish();
  assert.deepEqual(ended, ['one', 'two']);
});

test('sound back on: the lines at their own volume again', () => {
  const u = new Utt('one'); u.volume = 0.7;
  speak(u);
  setAudioMuted(true);
  setAudioMuted(false);
  assert.deepEqual(engine.queue.map(q => [q.text, q.volume]), [['one', 0.7]]);
  assert.equal(audioMuted(), false);
});

test('a finished line is not spoken again by the switch', () => {
  speak(new Utt('done'));
  engine.finish();
  setAudioMuted(true);
  assert.equal(engine.queue.length, 0);
});

test('a new mission drops the speech: the switch brings nothing back', () => {
  speak(new Utt('last mission'));
  cancelSpeech();
  setAudioMuted(true);
  assert.equal(engine.queue.length, 0);
});

test('nothing plays around the switch', () => {
  const files = [
    ...['core', 'display', 'app'].flatMap(d => readdirSync(new URL(`../${d}/`, import.meta.url))
      .filter(f => f.endsWith('.js') && f !== 'audio.js' && !f.endsWith('-processor.js')).map(f => `../${d}/${f}`)),
    '../index.html',
  ];
  const bad = files.flatMap(f => readFileSync(new URL(f, import.meta.url), 'utf8').split('\n')
    .filter(l => /\.destination\b(?!\?)/.test(l) && !/fr\.destination/.test(l) || /new Audio\(|speechSynthesis\.speak\(/.test(l))
    .map(l => `${f}: ${l.trim()}`));
  assert.deepEqual(bad, []);
});
