/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/airway-graph.js
   En-route routing over the real airway network (the air analogue of the taxiway graph).

   AIRWAYS (display/airways-data.js, sliced from X-Plane nav data) is already the graph —
   each entry is an edge between two fixes. We reconstruct the topology (nodes keyed by
   coordinate) and Dijkstra over great-circle leg lengths gives the departure → destination
   route: snap each airport to its nearest fix, shortest-path between them.
   ═══════════════════════════════════════════════════════════════ */

import { AIRWAYS } from '../display/airways-data.js';

const DEG = Math.PI / 180;
const _key = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

function _gcNm(aLat, aLon, bLat, bLon) {                 // great-circle distance, nm
  const φ1 = aLat*DEG, φ2 = bLat*DEG, dφ = (bLat-aLat)*DEG, dλ = (bLon-aLon)*DEG;
  const h = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

let _graph = null;
function _build() {
  const nodes = new Map();   // key -> { key, lat, lon, id, adj:[{to,w}] }
  const node = (lat, lon, id) => {
    const k = _key(lat, lon); let n = nodes.get(k);
    if (!n) { n = { key: k, lat, lon, id, adj: [] }; nodes.set(k, n); }
    if (!n.id && id) n.id = id;
    return n;
  };
  for (const e of AIRWAYS) {
    const a = node(e[0], e[1], e[4]), b = node(e[2], e[3], e[5]);
    if (a === b) continue;
    const w = _gcNm(a.lat, a.lon, b.lat, b.lon);
    a.adj.push({ to: b.key, w });
    b.adj.push({ to: a.key, w });                        // airways treated bidirectional for v1
  }
  return nodes;
}
export function getAirwayGraph() { return _graph ?? (_graph = _build()); }

function _nearest(nodes, lat, lon) {
  let best = null, bd = Infinity;
  for (const n of nodes.values()) {
    const d = (n.lat-lat)**2 + (n.lon-lon)**2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/* Dijkstra over the airway graph from the fix nearest departure to the fix nearest
   destination. Returns { pts:[[lat,lon]…], seq:[fixId…], distNm } or null if unreachable. */
export function routeAirway(depLat, depLon, arrLat, arrLon) {
  const nodes = getAirwayGraph();
  if (!nodes.size) return null;
  const s = _nearest(nodes, depLat, depLon), t = _nearest(nodes, arrLat, arrLon);
  if (!s || !t) return null;

  const dist = new Map([[s.key, 0]]), prev = new Map(), pq = [[0, s.key]];
  while (pq.length) {
    let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, k] = pq.splice(bi, 1)[0];
    if (d > (dist.get(k) ?? 1e18)) continue;
    if (k === t.key) break;
    for (const e of nodes.get(k).adj) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? 1e18)) { dist.set(e.to, nd); prev.set(e.to, k); pq.push([nd, e.to]); }
    }
  }
  if (s.key !== t.key && !prev.has(t.key)) return null;

  const pts = [], seq = []; let k = t.key;
  while (k) { const n = nodes.get(k); pts.unshift([n.lat, n.lon]); if (n.id) seq.unshift(n.id);
    if (k === s.key) break; k = prev.get(k); }
  return { pts, seq, distNm: dist.get(t.key) ?? 0, entry: s.id, exit: t.id };
}
