/* ── Taxiway network graph + routing, derived from OSM ──────────────────────────────
   The OSM taxiway ways share node coordinates at junctions, so keying nodes by exact
   lat/lon reconstructs the topology. Dijkstra over edge lengths gives a taxi route;
   collapsing consecutive edges by their `ref` yields the clearance ("T5, A, A5").

   This is the foundation for ground operations: routing, ATC taxi clearances,
   junction direction signs, and route/incursion grading. Fetched once per airport. */

const _graphs = new Map();   // icao -> graph | 'loading' | 'error'

const _key = p => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
const _m   = (a, b) => {
  const dN = (a.lat - b.lat) * 111320;
  const dE = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dN, dE);
};

/* Build the undirected graph from OSM taxiway ways (with inline geometry). */
function _build(elements) {
  const nodes = new Map();   // key -> { lat, lon, edges: [{ to, w, ref }] }
  const node = p => { const k = _key(p); let n = nodes.get(k);
    if (!n) { n = { lat: p.lat, lon: p.lon, edges: [] }; nodes.set(k, n); } return k; };
  for (const w of elements) {
    if (w.tags?.aeroway !== 'taxiway' || !w.geometry || w.geometry.length < 2) continue;
    const g = w.geometry, ref = w.tags.ref || '';
    for (let i = 0; i < g.length - 1; i++) {
      const a = node(g[i]), b = node(g[i + 1]), d = _m(g[i], g[i + 1]);
      nodes.get(a).edges.push({ to: b, w: d, ref });
      nodes.get(b).edges.push({ to: a, w: d, ref });
    }
  }
  const stands = [];   // parking stands (head of each lead-in line) for arrival routing
  for (const w of elements) {
    if (w.tags?.aeroway === 'parking_position' && w.geometry?.length) {
      const p = w.geometry[w.geometry.length - 1];
      stands.push({ lat: p.lat, lon: p.lon, ref: w.tags.ref || '' });
    }
  }
  return { nodes, stands };
}

/* Nearest parking stand to a point (for arrival → gate routing). */
export function nearestStand(graph, lat, lon) {
  if (!graph?.stands?.length) return null;
  let best = null, bd = 1e9;
  for (const s of graph.stands) { const d = _m({ lat, lon }, s); if (d < bd) { bd = d; best = s; } }
  return best;
}

/* Nearest graph node to a point, within `maxM` metres (else null). */
function _snap(graph, lat, lon, maxM = 300) {
  let best = null, bd = 1e9;
  for (const [k, n] of graph.nodes) { const d = _m({ lat, lon }, n); if (d < bd) { bd = d; best = k; } }
  return bd <= maxM ? best : null;
}

/* Dijkstra from node s to node t. Returns { pts:[[lat,lon]…], seq:[ref…], distM }. */
function _route(graph, s, t) {
  const dist = new Map([[s, 0]]), prev = new Map(), pq = [[0, s]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, k] = pq.shift();
    if (k === t) break;
    if (d > (dist.get(k) ?? 1e18)) continue;
    for (const e of graph.nodes.get(k).edges) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? 1e18)) { dist.set(e.to, nd); prev.set(e.to, [k, e.ref]); pq.push([nd, e.to]); }
    }
  }
  if (s !== t && !prev.has(t)) return null;
  const pts = [], refs = []; let k = t;
  while (k !== s) { const n = graph.nodes.get(k); pts.unshift([n.lat, n.lon]);
    const [p, ref] = prev.get(k); refs.unshift(ref); k = p; }
  const sn = graph.nodes.get(s); pts.unshift([sn.lat, sn.lon]);
  const seq = [];
  for (const r of refs) if (r && seq[seq.length - 1] !== r) seq.push(r);   // collapse to taxiway names
  return { pts, seq, distM: dist.get(t) };
}

/* Get the taxiway graph for an airport (triggers a one-time OSM fetch; null until ready). */
export function getTaxiGraph(icao, lat, lon) {
  const g = _graphs.get(icao);
  if (g) return (g === 'loading' || g === 'error') ? null : g;
  _graphs.set(icao, 'loading');
  const q = `[out:json][timeout:30];way["aeroway"~"taxiway|parking_position"](around:4500,${lat},${lon});out geom;`;
  fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`)
    .then(r => { if (!r.ok) throw 0; return r.json(); })
    .then(d => _graphs.set(icao, _build(d.elements || [])))
    .catch(() => _graphs.set(icao, 'error'));
  return null;
}

/* Route between two geographic points over the taxiway graph (snaps each to the net). */
export function routeTaxi(graph, from, to) {
  if (!graph) return null;
  const s = _snap(graph, from.lat, from.lon), t = _snap(graph, to.lat, to.lon);
  if (!s || !t) return null;
  return _route(graph, s, t);
}
