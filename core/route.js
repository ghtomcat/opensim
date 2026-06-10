/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/route.js
   The gate-to-gate flight plan: departure SID → en-route airways → arrival STAR →
   final approach, assembled from the CIFP procedures and the airway graph.

   Single source of truth shared by the pre-flight briefing (index.html) and the in-flight
   navigation display (display/map.js) — so the magenta line you study on the ground is the
   exact same route you fly. buildFullRoute(dep, arr) returns the ordered legs; the briefing
   renders them as charts, the ND draws them around the aircraft.

   Procedures (display/procedures-data-xp.js) are X-Plane CIFP — PROPRIETARY (Navigraph /
   Jeppesen), gitignored, optional. With no procedures loaded the route degrades to the old
   airport → airport airway plan.
   ═══════════════════════════════════════════════════════════════ */

import { routeAirway } from './airway-graph.js';
import { RUNWAYS }     from '../display/runways-data.js';

/* SID/STAR/approach procedures — loaded lazily (the bundle is gitignored and may be absent). */
let PROCEDURES = {};
import('../display/procedures-data-xp.js').then(m => { PROCEDURES = m.PROCEDURES || {}; }).catch(() => {});
export function getProcedures() { return PROCEDURES; }

const DEG = Math.PI / 180;
function gcNm(aLat, aLon, bLat, bLon) {                    // great-circle distance, nm
  const p1 = aLat*DEG, p2 = bLat*DEG, dp = (bLat-aLat)*DEG, dl = (bLon-aLon)*DEG;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Airport centre = mean of its runway thresholds. */
export function airportCentre(icao) {
  const rws = icao && RUNWAYS[icao];
  if (!rws || !rws.length) return null;
  const pts = rws.flatMap(r => [r.a, r.b]);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length,
          pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/* A STAR in CIFP is split into records sharing a name: enroute transitions (entry fix →
   common point), a common middle (trans empty), and runway transitions (RWxx, common →
   approach). Assemble the full arrival path for one entry transition + the arrival runway. */
function assembleStarLegs(stars, name, arrRwId, entryTrans) {
  const lp = (pr) => (pr?.legs || []).filter(l => l.lat != null);
  const enr    = stars.find(s => s.name === name && s.trans === entryTrans);
  const common = stars.find(s => s.name === name && !s.trans);
  const rwt    = arrRwId && stars.find(s => s.name === name && s.trans === arrRwId);
  const legs = [];
  for (const p of [enr, common, rwt]) { if (!p) continue;
    for (const l of lp(p)) { const last = legs[legs.length - 1];
      if (last && last.fix === l.fix) continue;                 // dedupe the shared join fix
      legs.push(l); } }
  return legs;
}
/* One assembled option per STAR name: enroute transition (entry nearest the departure)
   + common + the arrival-runway transition. */
export function arrStarOptions(aP, arrRwId, depLL) {
  if (!aP?.stars?.length) return [];
  const lp = (pr) => (pr?.legs || []).filter(l => l.lat != null);
  const enrOf = new Map();
  for (const s of aP.stars) {
    if (/^RW/.test(s.trans || '') || !s.trans || !lp(s).length) continue;   // enroute transitions only
    if (!enrOf.has(s.name)) enrOf.set(s.name, []);
    enrOf.get(s.name).push(s);
  }
  const opts = [];
  for (const [name, recs] of enrOf) {
    let best = null;
    for (const s of recs) { const en = lp(s)[0], d = depLL ? gcNm(en.lat, en.lon, depLL[0], depLL[1]) : 0;
      if (!best || d < best.d) best = { s, en, d }; }
    const legs = assembleStarLegs(aP.stars, name, arrRwId, best.s.trans);
    if (legs.length) opts.push({ name, legs, en: { lat: best.en.lat, lon: best.en.lon }, d: best.d });
  }
  return opts;
}
/* Final approach for the arrival runway: pick the best published approach (ILS > RNAV >
   LOC > VOR), take its legs up to the runway threshold — the missed-approach legs that
   follow the runway are dropped. Closes the last few miles from the STAR to touchdown. */
export function approachLegs(aP, arrRunway) {
  if (!aP?.apprs?.length || !arrRunway) return { legs: [], name: null };
  const rwId = 'RW' + arrRunway, order = { I: 0, R: 1, L: 2, D: 3, V: 4 };
  const finals = aP.apprs.filter(a => !a.trans && a.name && a.name.slice(1).startsWith(String(arrRunway)));
  if (!finals.length) return { legs: [], name: null };
  finals.sort((a, b) => (order[a.name[0]] ?? 9) - (order[b.name[0]] ?? 9));
  const appr = finals[0], legs = [];
  for (const l of appr.legs) { if (l.fix === rwId) break; if (l.lat != null) legs.push(l); }   // stop before the missed approach
  return { legs, name: appr.name };
}

/* Gate-to-gate route: SID (runway → exit fix) + en-route airways (SID exit → STAR entry) +
   STAR (entry → arrival) + final approach. Each piece is optional — with no procedures it
   degrades to the old airport → airport airway route. Returns
   { legs:[{lat,lon,id,seg,alt}], distNm, sid, star, appr } with seg ∈ dep|sid|awy|star|app|arr. */
export function buildFullRoute(dep, arr) {
  const depIc = dep?.icao, arrIc = arr?.icao;
  const depLL = airportCentre(depIc), arrLL = airportCentre(arrIc);
  if (!depLL || !arrLL) return null;
  const dP = PROCEDURES[depIc], aP = PROCEDURES[arrIc];
  const legPts = (pr) => (pr?.legs || []).filter(l => l.lat != null);
  const depRwLL = (dep?.runway && dP?.rwys?.['RW' + dep.runway]) || depLL;
  const arrRwLL = (arr?.runway && aP?.rwys?.['RW' + arr.runway]) || arrLL;

  /* arrival STAR — full assembled path (enroute + common + runway transition). Mission may
     pin the STAR by name (arr.star); otherwise the one whose entry is nearest the departure. */
  const arrRwId = arr?.runway ? ('RW' + arr.runway) : null;
  const starOpts = arrStarOptions(aP, arrRwId, depLL);
  let star = starOpts.length
    ? ((arr?.star && starOpts.find(o => o.name === arr.star)) ||
       starOpts.reduce((b, o) => (!b || o.d < b.d) ? o : b, null))
    : null;
  const starEntry = star ? star.en : { lat: arrRwLL[0], lon: arrRwLL[1] };

  /* departure SID for the runway. Empty airspace → just pick the shortest: the exit fix
     that minimises (runway→exit)+(exit→STAR entry). Mission may pin it (dep.sid);
     later ATC would assign it in the clearance. */
  let sid = null;
  if (dP?.sids?.length) {
    const rwy = dep?.runway ? 'RW' + dep.runway : null;
    let cands = dP.sids.filter(s => legPts(s).length && (!rwy || s.trans === rwy));
    if (!cands.length) cands = dP.sids.filter(s => legPts(s).length);
    const pin = dep?.sid && (cands.find(s => s.name === dep.sid) || dP.sids.find(s => s.name === dep.sid && legPts(s).length));
    if (pin) sid = { s: pin, ex: legPts(pin).at(-1) };
    else for (const s of cands) {
      const lp = legPts(s), ex = lp.at(-1);
      let flown = 0, prev = depRwLL;                       // actual flown SID distance — penalises doglegs
      for (const l of lp) { flown += gcNm(prev[0], prev[1], l.lat, l.lon); prev = [l.lat, l.lon]; }
      const d = flown + gcNm(ex.lat, ex.lon, starEntry.lat, starEntry.lon);
      if (!sid || d < sid.d) sid = { s, ex, d };
    }
  }
  const sidExit = sid ? sid.ex : { lat: depRwLL[0], lon: depRwLL[1] };

  let awy = null;
  try { awy = routeAirway(sidExit.lat, sidExit.lon, starEntry.lat, starEntry.lon); } catch {}

  const legs = [];
  const push = (lat, lon, id, seg, alt) => {
    const last = legs[legs.length - 1];
    if (last && Math.abs(last.lat - lat) < 1e-5 && Math.abs(last.lon - lon) < 1e-5) return;   // drop dup
    legs.push({ lat, lon, id: id || null, seg, alt: alt || null });
  };
  push(depRwLL[0], depRwLL[1], depIc, 'dep');
  if (sid)      for (const l of legPts(sid.s)) push(l.lat, l.lon, l.fix, 'sid', l.alt);
  if (awy?.wpts) for (const w of awy.wpts)     push(w.lat, w.lon, w.id, 'awy');
  if (star)     for (const l of star.legs) push(l.lat, l.lon, l.fix, 'star', l.alt);
  const appr = approachLegs(aP, arr?.runway);
  for (const l of appr.legs) push(l.lat, l.lon, l.fix, 'app', l.alt);
  push(arrRwLL[0], arrRwLL[1], arrIc, 'arr');

  let dist = 0;
  for (let i = 1; i < legs.length; i++) dist += gcNm(legs[i-1].lat, legs[i-1].lon, legs[i].lat, legs[i].lon);
  return { legs, distNm: dist, sid: sid?.s || null, star: star || null, appr: appr.name || null };
}

/* Segment colours — Airbus-ish FMS palette, shared by the briefing charts and the ND. */
export const SEG_COL = { dep: '#5dd47e', sid: '#56c7e6', awy: '#d96ec8', star: '#e6b455', app: '#ef9a5a', arr: '#ff6e6e' };
