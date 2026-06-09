/* ── Taxiway network graph + routing, derived from OSM ──────────────────────────────
   The OSM taxiway ways share node coordinates at junctions, so keying nodes by exact
   lat/lon reconstructs the topology. Dijkstra over edge lengths gives a taxi route;
   collapsing consecutive edges by their `ref` yields the clearance ("T5, A, A5").

   This is the foundation for ground operations: routing, ATC taxi clearances,
   junction direction signs, and route/incursion grading. Fetched once per airport. */

import { TAXI_WAYS } from '../display/taxi-data.js';

const _graphs = new Map();   // icao -> graph | 'loading' | 'error'

const _key = p => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
const _m   = (a, b) => {
  const dN = (a.lat - b.lat) * 111320;
  const dE = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dN, dE);
};

/* Build the undirected graph from OSM taxiway ways (with inline geometry).
   Stand lead-in lines (parking_position) are added as routable edges and stitched
   onto the nearest taxiway node, so a route runs all the way to the gate — the green
   line reaches the apron, and pushback can walk the lead-in out onto the taxiway. */
function _build(elements) {
  const nodes = new Map();   // key -> { lat, lon, edges: [{ to, w, ref }] }
  const node = p => { const k = _key(p); let n = nodes.get(k);
    if (!n) { n = { lat: p.lat, lon: p.lon, edges: [] }; nodes.set(k, n); } return k; };
  const taxiEdges = [];   // {a, b, ref} segment list — lead-ins stitch by projecting onto these
  for (const w of elements) {
    if (w.tags?.aeroway !== 'taxiway' || !w.geometry || w.geometry.length < 2) continue;
    const g = w.geometry, ref = w.tags.ref || '';
    for (let i = 0; i < g.length - 1; i++) {
      const a = node(g[i]), b = node(g[i + 1]), d = _m(g[i], g[i + 1]);
      nodes.get(a).edges.push({ to: b, w: d, ref });
      nodes.get(b).edges.push({ to: a, w: d, ref });
      taxiEdges.push({ a: g[i], b: g[i + 1], ref });
    }
  }

  /* Closest point on segment a-b to p (+ distance, m). Apron lead-ins meet the taxiway
     mid-segment, so we project rather than snap to a vertex. */
  const _proj = (p, a, b) => {
    const cl = Math.cos(a.lat * Math.PI / 180);
    const bN = (b.lat - a.lat) * 111320, bE = (b.lon - a.lon) * 111320 * cl;
    const pN = (p.lat - a.lat) * 111320, pE = (p.lon - a.lon) * 111320 * cl;
    const L2 = bN * bN + bE * bE; let t = L2 > 0 ? (pN * bN + pE * bE) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const lat = a.lat + (b.lat - a.lat) * t, lon = a.lon + (b.lon - a.lon) * t;
    return { lat, lon, d: Math.hypot(pN - bN * t, pE - bE * t) };
  };

  /* Ray O→dir vs segment a-b: returns hit point + ray distance t (m), or null.
     Used to trace the lead-in's own line outward until it crosses a taxiway. */
  const _ray = (o, dN, dE, a, b, maxT) => {
    const cl = Math.cos(o.lat * Math.PI / 180);
    const aN = (a.lat - o.lat) * 111320, aE = (a.lon - o.lon) * 111320 * cl;
    const bN = (b.lat - o.lat) * 111320, bE = (b.lon - o.lon) * 111320 * cl;
    const sN = bN - aN, sE = bE - aE;
    const det = sN * dE - sE * dN;
    if (Math.abs(det) < 1e-9) return null;
    const t = (aN * sE - aE * sN) / det;                  // distance along the ray (m)
    const s = (aN * dE - aE * dN) / det;                  // position along the segment [0,1]
    if (t < 1 || t > maxT || s < 0 || s > 1) return null;
    return { lat: o.lat + t * dN / 111320, lon: o.lon + t * dE / (111320 * cl), t };
  };

  const RAY_MAX = 140, STITCH_M = 70;   // BZN-style aprons leave a ~45–65 m untagged gap
  const stands = [];     // parking stands (head of each lead-in line) for arrival routing
  for (const w of elements) {
    if (w.tags?.aeroway !== 'parking_position' || !w.geometry?.length) continue;
    const g = w.geometry, head = g[g.length - 1];
    stands.push({ lat: head.lat, lon: head.lon, ref: w.tags.ref || '' });
    if (g.length < 2) continue;
    for (let i = 0; i < g.length - 1; i++) {              // lead-in segments → routable (ref '' = silent in clearance)
      const a = node(g[i]), b = node(g[i + 1]), d = _m(g[i], g[i + 1]);
      nodes.get(a).edges.push({ to: b, w: d, ref: '' });
      nodes.get(b).edges.push({ to: a, w: d, ref: '' });
    }
    // trace the taxiway-side end (g[0]) outward along the painted line until it hits a taxiway
    const o = g[0], nx = g[1];
    const cl = Math.cos(o.lat * Math.PI / 180);
    let dN = (o.lat - nx.lat) * 111320, dE = (o.lon - nx.lon) * 111320 * cl;   // outward = g[0] − g[1]
    const L = Math.hypot(dN, dE);
    let join = null, je = null;
    if (L > 0) {
      dN /= L; dE /= L;
      let bestT = RAY_MAX;
      for (const e of taxiEdges) {
        const h = _ray(o, dN, dE, e.a, e.b, bestT);
        if (h && h.t < bestT) { bestT = h.t; join = h; je = e; }
      }
    }
    if (!join) {                                          // ray missed → nearest-edge projection
      for (const end of [g[0], head]) for (const e of taxiEdges) {
        const pr = _proj(end, e.a, e.b);
        if (pr.d < (join ? join._d : STITCH_M)) { join = { lat: pr.lat, lon: pr.lon, _d: pr.d, _o: end }; je = e; }
      }
    }
    if (join && je) {
      const start = join._o || o;
      const pk = node(join), ek = node(start);            // join point on the taxiway + lead-in end
      const d0 = _m(start, join);
      nodes.get(ek).edges.push({ to: pk, w: d0, ref: '' });
      nodes.get(pk).edges.push({ to: ek, w: d0, ref: '' });
      const ak = node(je.a), bk = node(je.b);             // wire the join into the taxiway segment
      const da = _m(join, je.a), db = _m(join, je.b);
      nodes.get(pk).edges.push({ to: ak, w: da, ref: je.ref }, { to: bk, w: db, ref: je.ref });
      nodes.get(ak).edges.push({ to: pk, w: da, ref: je.ref });
      nodes.get(bk).edges.push({ to: pk, w: db, ref: je.ref });
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
  const bundled = TAXI_WAYS[icao];                       // prefer bundled geometry — no flaky live fetch
  if (bundled?.length) {
    const elements = bundled.map(w => ({
      tags: { aeroway: w.k === 't' ? 'taxiway' : 'parking_position', ref: w.r || '' },
      geometry: w.g.map(p => ({ lat: p[0], lon: p[1] })),
    }));
    const graph = _build(elements);
    _graphs.set(icao, graph);
    return graph;
  }
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
