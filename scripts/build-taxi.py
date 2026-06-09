#!/usr/bin/env python3
"""Regenerate display/taxi-data.js: the taxiway network (and stand lead-in lines) for
the mission airports, from OpenStreetMap via Overpass.

The browser builds a routing graph from these ways (core/taxi-graph.js) to draw the
green taxi route and to walk a pushback out onto the taxiway. Overpass is flaky at
runtime, so — like stands/terminals/satellites — we bundle the geometry once here and
read it offline. Airports without bundled data fall back to a live fetch.

Each way is stored compactly: {"k":"t"|"p", "r": ref, "g": [[lat,lon], ...]}
  k = 't' taxiway / 'p' parking_position (lead-in line)
  r = taxiway designator (only kept for taxiways; drives the clearance "A, A5, …")

OSM data is ODbL (openstreetmap.org/copyright) — credited in README.
Re-run when adding mission airports or to refresh:

    python3 scripts/build-taxi.py            # all mission airports
    python3 scripts/build-taxi.py KBZN LSZH  # just these
"""
import json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
RADIUS_M = 4500          # search radius around each airport centre
GAP_S    = 4             # pause between requests


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
    """POST a query, retrying each mirror with backoff (handles 429/504/busy)."""
    body = urllib.parse.urlencode({"data": q}).encode()
    for url in OVERPASS:
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, data=body, headers={
                    "User-Agent": "OpenSim/1.0 (flight sim; taxiway network data)"})
                return json.load(urllib.request.urlopen(req, timeout=120))["elements"]
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"  {url.split('/')[2]}: {e}; retry in {wait}s ...")
                time.sleep(wait)
    raise RuntimeError("all Overpass mirrors failed")


def _existing():
    """Parse TAXI_WAYS from the current taxi-data.js (so un-fetched airports persist)."""
    path = os.path.join(ROOT, "display", "taxi-data.js")
    if not os.path.exists(path):
        return {}
    m = re.search(r"TAXI_WAYS = (\{.*?\});", open(path).read())
    return json.loads(m.group(1)) if m else {}


def main():
    centres = airport_centres()
    only = [a.upper() for a in sys.argv[1:]]
    if only:
        centres = {k: v for k, v in centres.items() if k in only}
    print(f"{len(centres)} airport(s); querying Overpass ...")
    out = _existing()                    # start from existing → airports not fetched this run persist
    for ic, (la, lo) in centres.items():
        q = (f'[out:json][timeout:90];'
             f'way["aeroway"="taxiway"](around:{RADIUS_M},{la:.5f},{lo:.5f});out geom;'
             f'way["aeroway"="parking_position"](around:{RADIUS_M},{la:.5f},{lo:.5f});out geom;')
        ways = []
        for w in _run(q):
            g = w.get("geometry") or []
            if len(g) < 2:
                continue
            t = w.get("tags", {})
            geom = [[round(p["lat"], 6), round(p["lon"], 6)] for p in g]
            if t.get("aeroway") == "taxiway":
                rec = {"k": "t", "g": geom}
                if t.get("ref"):
                    rec["r"] = str(t["ref"])
                ways.append(rec)
            elif t.get("aeroway") == "parking_position":
                ways.append({"k": "p", "g": geom})
        if ways:
            out[ic] = ways
            nt = sum(1 for w in ways if w["k"] == "t")
            np = sum(1 for w in ways if w["k"] == "p")
            print(f"  {ic}: {nt} taxiways, {np} lead-ins")
        time.sleep(GAP_S)

    out = {k: out[k] for k in sorted(out)}
    js = ("/* Bundled taxiway network from OpenStreetMap (ODbL, openstreetmap.org/copyright)\n"
          "   for the airports referenced in missions/. core/taxi-graph.js builds a routing\n"
          "   graph from these ways for the green taxi route and pushback. Each way:\n"
          "   k = 't' taxiway / 'p' parking_position lead-in, r = taxiway ref, g = [[lat,lon]…].\n"
          "   Regenerate with scripts/build-taxi.py. */\n"
          "export const TAXI_WAYS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "taxi-data.js")
    open(path, "w").write(js)
    total = sum(len(v) for v in out.values())
    print(f"wrote {os.path.relpath(path, ROOT)}: {total} ways at {len(out)} airports")


if __name__ == "__main__":
    main()
