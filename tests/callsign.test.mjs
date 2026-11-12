/**
 * The registration on the radio (core/callsign.js): phonetic, in full on first contact, then shortened.
 *
 * Run:  node --test tests/callsign.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setState } from '../core/state.js';
import { spokenCallsign, radioSpeech } from '../core/callsign.js';
import { runMissionResets } from '../core/lifecycle.js';

test('spelled in the phonetic alphabet — full, and short (the letters after the prefix)', () => {
  assert.equal(spokenCallsign('HB-SYQ'), 'Hotel Bravo Sierra Yankee Quebec');
  assert.equal(spokenCallsign('HB-SYQ', { full: false }), 'Sierra Yankee Quebec');
  assert.equal(spokenCallsign('HB-KLE', { full: false }), 'Kilo Lima Echo');
  assert.equal(spokenCallsign('D-FEML'), 'Delta Foxtrot Echo Mike Lima');
  assert.equal(spokenCallsign('Speedbird 123'), 'Speedbird 123');                  // not a registration: as it is
});

test('in a mission: the first time in full, then short; a new mission starts in full again', () => {
  setState({ aircraft: { id: 'velis', callsign: 'HB-SYQ' } });
  runMissionResets();
  assert.equal(radioSpeech('Grenchen Information, HB-SYQ, good morning'), 'Grenchen Information, Hotel Bravo Sierra Yankee Quebec, good morning');
  assert.equal(radioSpeech('HB-SYQ, Grenchen Information'), 'Sierra Yankee Quebec, Grenchen Information');
  assert.equal(radioSpeech('Wilco, HB-SYQ'), 'Wilco, Sierra Yankee Quebec');
  runMissionResets();
  assert.match(radioSpeech('HB-SYQ, roger'), /^Hotel Bravo Sierra Yankee Quebec/);
});

test("only the aircraft's own registration; other text with a dash is untouched", () => {
  setState({ aircraft: { id: 'dr400', callsign: 'HB-KLE' } });
  runMissionResets();
  assert.equal(radioSpeech('Lycoming IO-360, runway two-six'), 'Lycoming IO-360, runway two-six');
  assert.equal(radioSpeech('HB-SYQ and HB-KLE'), 'HB-SYQ and Hotel Bravo Kilo Lima Echo');
});
