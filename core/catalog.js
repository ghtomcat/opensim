/* OpenSim — core/catalog.js
   Mission picker catalogue: the titles, briefings and roles shown on the
   selection screen. Loaded from missions/catalog.json so the catalogue is
   data, not code. Top-level await means any importer sees MISSIONS fully
   populated before its own module body runs. */
export const MISSIONS = await fetch(new URL('../missions/catalog.json', import.meta.url))
  .then(r => r.json());
