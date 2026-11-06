/* Writes the generated tables of docs/keybindings.md from the key map (core/keymap.js).

     node tools/keybindings.mjs

   tests/keymap.test.mjs fails when the file and the table differ. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { keyDocTables } from '../core/keymap.js';

const root = new URL('../', import.meta.url);

export const allAircraft = () => readdirSync(new URL('aircraft/', root)).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(new URL(`aircraft/${f}`, root), 'utf8')));

/** The document with its generated block filled in. */
export function withTables(doc, aircraft) {
  return doc.replace(/(<!-- keymap:start -->)[\s\S]*?(<!-- keymap:end -->)/, `$1\n\n${keyDocTables(aircraft)}\n\n$2`);
}

if (process.argv[1]?.endsWith('keybindings.mjs')) {
  const file = new URL('docs/keybindings.md', root);
  writeFileSync(file, withTables(readFileSync(file, 'utf8'), allAircraft()));
}
