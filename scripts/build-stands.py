#!/usr/bin/env python3
"""Regenerate display/stands-data.js: named parking stands (gates) for the mission
airports, from OpenStreetMap via Overpass.

aeroway=parking_position is a LINE — the painted lead-in line the nosewheel follows.
Its last vertex is the stop point (where the aircraft parks) and the last segment's
bearing is the nose-in heading. So one stand gives position + heading for free, which
is exactly what a mission "start": {"stand": "B7"} needs.

Only stands with a ref (or name) are kept — those are the ones a mission can address.
Airport centres come from display/runways-data.js (mean of the runway thresholds).

OSM data is ODbL (openstreetmap.org/copyright) — already credited in README.
Runs rarely; re-run when adding mission airports or to refresh:

    python3 scripts/build-stands.py
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
RADIUS_M = 5000          # search radius around each airport centre
CHUNK    = 1             # airports per Overpass request (gentle on rate limits)
GAP_S    = 4             # pause between requests
BRIDGE_M = 40            # a stand is "bridged" if its stop point is within this of a jet_bridge


def _obj_after(src, name):
    """Extract the brace-balanced JSON object that follows `const <name> =`."""
    i = src.index(name); i = src.index("{", i)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{": depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(src[i:j + 1])
    raise ValueError(f"unbalanced braces after {name}")


def airport_centres():
    """ICAO -> (lat, lon), the mean of all runway thresholds."""
    src = open(os.path.join(ROOT, "display", "runways-data.js")).read()
    runways = _obj_after(src, "RUNWAYS")
    out = {}
    for ic, rws in runways.items():
        pts = [p for r in rws for p in (r["a"], r["b"])]
        out[ic] = (sum(p[0] for p in pts) / len(pts),
                   sum(p[1] for p in pts) / len(pts))
    return out


def _run(q):
    """POST a query, retrying each mirror with backoff (handles 429/504)."""
    body = urllib.parse.urlencode({"data": q}).encode()
    for url in OVERPASS:
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, data=body, headers={
                    "User-Agent": "OpenSim/1.0 (flight sim; parking-stand data)"})
                return json.load(urllib.request.urlopen(req, timeout=120))["elements"]
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"  {url.split('/')[2]}: {e}; retry in {wait}s ...")
                time.sleep(wait)
    raise RuntimeError("all Overpass mirrors failed")


def bearing(a, b):
    """Compass bearing a -> b (deg), a/b = (lat, lon)."""
    dN = b[0] - a[0]
    dE = (b[1] - a[1]) * math.cos(math.radians(a[0]))
    return (math.degrees(math.atan2(dE, dN)) + 360) % 360


def dist_m(a, b):
    """Great-circle-ish distance in metres, a/b = (lat, lon) (flat-earth, fine at <1 km)."""
    dN = (b[0] - a[0]) * 111320
    dE = (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dN, dE)


def _existing(name):
    """Parse a named export (STANDS / BRIDGE_COVERAGE) from the current stands-data.js."""
    path = os.path.join(ROOT, "display", "stands-data.js")
    if not os.path.exists(path):
        return {}
    m = re.search(name + r" = (\{.*?\});", open(path).read())
    return json.loads(m.group(1)) if m else {}


def main():
    centres = airport_centres()
    only = [a.upper() for a in sys.argv[1:]]
    if only:
        centres = {k: v for k, v in centres.items() if k in only}
    print(f"{len(centres)} airport(s); querying Overpass ...")
    items = list(centres.items())
    out = _existing("STANDS")            # start from existing → airports not fetched this run persist
    coverage = list(_existing("BRIDGE_COVERAGE").keys())
    for i in range(0, len(items), CHUNK):
        for ic, (la, lo) in items[i:i + CHUNK]:
            # one request: parking_position lead-in lines + jet_bridge ways
            q = (f'[out:json][timeout:90];'
                 f'way["aeroway"="parking_position"](around:{RADIUS_M},{la:.5f},{lo:.5f});out geom;'
                 f'way["aeroway"="jet_bridge"](around:{RADIUS_M},{la:.5f},{lo:.5f});out geom;')
            stands, bridges = [], []     # bridges: [(endA, endB)] = the two endpoints of each jet_bridge
            for w in _run(q):
                g = w.get("geometry") or []
                t = w.get("tags", {})
                if t.get("aeroway") == "jet_bridge":
                    if len(g) >= 2:
                        bridges.append(((g[0]["lat"], g[0]["lon"]), (g[-1]["lat"], g[-1]["lon"])))
                    continue
                ref = t.get("ref") or t.get("name")
                if not ref or len(g) < 2:
                    continue
                stop = g[-1]
                prev = g[-2]
                hdg = bearing((prev["lat"], prev["lon"]), (stop["lat"], stop["lon"]))
                stands.append({"ref": str(ref),
                               "lat": round(stop["lat"], 6),
                               "lon": round(stop["lon"], 6),
                               "hdg": round(hdg, 1),
                               "_stop": (stop["lat"], stop["lon"])})
            # match each stand to its nearest jet bridge → bundle both endpoints
            if bridges:
                coverage.append(ic)
                for s in stands:
                    best, bd = None, 1e9
                    for ep in bridges:
                        d = min(dist_m(s["_stop"], ep[0]), dist_m(s["_stop"], ep[1]))
                        if d < bd: bd, best = d, ep
                    if best and bd <= BRIDGE_M:
                        s["bridge"] = 1
                        # nearer endpoint = aircraft (cab), farther = building (att)
                        cab, att = (best[0], best[1]) if dist_m(s["_stop"], best[0]) <= dist_m(s["_stop"], best[1]) else (best[1], best[0])
                        s["cab"] = [round(cab[0], 6), round(cab[1], 6)]
                        s["att"] = [round(att[0], 6), round(att[1], 6)]
            for s in stands:
                s.pop("_stop", None)
            if stands:
                # de-dup by ref (keep first), sort by ref
                seen, uniq = set(), []
                for s in sorted(stands, key=lambda s: s["ref"]):
                    if s["ref"] in seen:
                        continue
                    seen.add(s["ref"]); uniq.append(s)
                out[ic] = uniq
                nb = sum(1 for s in uniq if s.get("bridge"))
                print(f"  {ic}: {len(uniq)} named stands" + (f", {nb} bridged" if nb else ""))
        time.sleep(GAP_S)

    for ic, rec in _existing("STANDS").items():     # hand-added stands persist
        if isinstance(rec, dict) and rec.get("manual"):
            out[ic] = rec

    out = {k: out[k] for k in sorted(out)}
    cov = {k: 1 for k in sorted(set(coverage))}
    js = ("/* Bundled parking stands (gates) from OpenStreetMap (ODbL,\n"
          "   openstreetmap.org/copyright) for the airports referenced in missions/.\n"
          "   Regenerate with scripts/build-stands.py. Each stand: ref (designator),\n"
          "   lat/lon = the stop point, hdg = nose-in heading (degrees), bridge:1 when a\n"
          "   real OSM jet_bridge sits next to it. BRIDGE_COVERAGE lists the airports where\n"
          "   OSM maps jet bridges — there the flags are authoritative; elsewhere the\n"
          "   renderer falls back to a clustering heuristic. */\n"
          "export const STANDS = " + json.dumps(out, separators=(",", ":")) + ";\n"
          "export const BRIDGE_COVERAGE = " + json.dumps(cov, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "stands-data.js")
    open(path, "w").write(js)
    total = sum(len(v) for v in out.values() if isinstance(v, list))
    print(f"wrote {os.path.relpath(path, ROOT)}: {total} stands at {len(out)} airports")


if __name__ == "__main__":
    main()
