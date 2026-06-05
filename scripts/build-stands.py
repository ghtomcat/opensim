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
import json, math, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
RADIUS_M = 5000          # search radius around each airport centre
CHUNK    = 1             # airports per Overpass request (gentle on rate limits)
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


def existing_records():
    """Parse the current stands-data.js so manual entries persist across regeneration."""
    path = os.path.join(ROOT, "display", "stands-data.js")
    if not os.path.exists(path):
        return {}
    src = open(path).read()
    try:
        return json.loads(src[src.index("{"): src.rindex("}") + 1])
    except ValueError:
        return {}


def main():
    centres = airport_centres()
    print(f"{len(centres)} mission airports; querying Overpass ...")
    items = list(centres.items())
    out = {}
    for i in range(0, len(items), CHUNK):
        for ic, (la, lo) in items[i:i + CHUNK]:
            q = (f'[out:json][timeout:90];'
                 f'way["aeroway"="parking_position"](around:{RADIUS_M},{la:.5f},{lo:.5f});'
                 f'out geom;')
            stands = []
            for w in _run(q):
                g = w.get("geometry") or []
                t = w.get("tags", {})
                ref = t.get("ref") or t.get("name")
                if not ref or len(g) < 2:
                    continue
                stop = g[-1]
                prev = g[-2]
                hdg = bearing((prev["lat"], prev["lon"]), (stop["lat"], stop["lon"]))
                stands.append({"ref": str(ref),
                               "lat": round(stop["lat"], 6),
                               "lon": round(stop["lon"], 6),
                               "hdg": round(hdg, 1)})
            if stands:
                # de-dup by ref (keep first), sort by ref
                seen, uniq = set(), []
                for s in sorted(stands, key=lambda s: s["ref"]):
                    if s["ref"] in seen:
                        continue
                    seen.add(s["ref"]); uniq.append(s)
                out[ic] = uniq
                print(f"  {ic}: {len(uniq)} named stands")
        time.sleep(GAP_S)

    prev = existing_records()
    for ic, rec in prev.items():
        if isinstance(rec, dict) and rec.get("manual"):
            out[ic] = rec                       # hand-added stands persist

    out = {k: out[k] for k in sorted(out)}
    js = ("/* Bundled parking stands (gates) from OpenStreetMap (ODbL,\n"
          "   openstreetmap.org/copyright) for the airports referenced in missions/.\n"
          "   Regenerate with scripts/build-stands.py. Each stand: ref (designator),\n"
          "   lat/lon = the stop point, hdg = nose-in heading (degrees). */\n"
          "export const STANDS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "stands-data.js")
    open(path, "w").write(js)
    total = sum(len(v) for v in out.values() if isinstance(v, list))
    print(f"wrote {os.path.relpath(path, ROOT)}: {total} stands at {len(out)} airports")


if __name__ == "__main__":
    main()
