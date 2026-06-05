#!/usr/bin/env python3
"""Regenerate display/towers-data.js: real control-tower positions (and heights
where tagged) for the mission airports, from OpenStreetMap via Overpass.

Airport centres are taken from display/runways-data.js (mean of the runway
thresholds), so no extra airport download is needed. For each centre we ask
Overpass for the nearest aircraft-control tower (tower:type=aircraft_control or
aeroway=tower) and keep the closest one.

OSM data is ODbL (openstreetmap.org/copyright) — already credited in README.
Runs rarely; re-run when adding mission airports or to refresh:

    python3 scripts/build-towers.py
"""
import json, os, re, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
RADIUS_M = 7000          # search radius around each airport centre
KEEP_M   = 9000          # max distance a tower may be from the centre to count
CHUNK    = 1             # airports per Overpass request (gentle on rate limits)
GAP_S    = 4             # pause between requests


def airport_centres():
    """ICAO -> (lat, lon), the mean of all runway thresholds."""
    src = open(os.path.join(ROOT, "display", "runways-data.js")).read()
    runways = json.loads(src[src.index("{"): src.rindex("}") + 1])
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
                    "User-Agent": "OpenSim/1.0 (flight sim; control-tower data)"})
                return json.load(urllib.request.urlopen(req, timeout=120))["elements"]
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"  {url.split('/')[2]}: {e}; retry in {wait}s ...")
                time.sleep(wait)
    raise RuntimeError("all Overpass mirrors failed")


def overpass(centres):
    items = list(centres.values())
    els = []
    for i in range(0, len(items), CHUNK):
        parts = []
        for la, lo in items[i:i + CHUNK]:
            for sel in ('["tower:type"="aircraft_control"]', '["aeroway"="tower"]'):
                parts.append(f'node(around:{RADIUS_M},{la:.5f},{lo:.5f}){sel};')
                parts.append(f'way(around:{RADIUS_M},{la:.5f},{lo:.5f}){sel};')
        q = f"[out:json][timeout:90];({''.join(parts)});out center tags;"
        els += _run(q)
        print(f"  {i // CHUNK + 1}/{-(-len(items) // CHUNK)}: {len(els)} elements so far")
        time.sleep(GAP_S)
    return els


def existing_records():
    """Parse the current towers-data.js -> {ICAO: record}, so we can preserve hand-curated
    data across regeneration: the 'style' flag for every airport, and the FULL record for
    'manual': true entries (towers OSM doesn't tag properly, e.g. FIMP)."""
    path = os.path.join(ROOT, "display", "towers-data.js")
    if not os.path.exists(path):
        return {}
    src = open(path).read()
    try:
        return json.loads(src[src.index("{"): src.rindex("}") + 1])
    except ValueError:
        return {}


def height_m(tags):
    m = re.search(r"[\d.]+", tags.get("height", ""))
    return round(float(m.group()), 1) if m else None


def main():
    centres = airport_centres()
    print(f"{len(centres)} mission airports; querying Overpass ...")
    els = overpass(centres)
    print(f"{len(els)} tower elements returned")

    out = {}
    for ic, (cla, clo) in centres.items():
        best = None  # (score, dist, lat, lon, height)
        for e in els:
            la = e.get("lat", e.get("center", {}).get("lat"))
            lo = e.get("lon", e.get("center", {}).get("lon"))
            if la is None:
                continue
            # rough metric distance (deg -> m), fine at this scale
            dx = (lo - clo) * 111320 * __import__("math").cos(__import__("math").radians(cla))
            dy = (la - cla) * 110540
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > KEEP_M:
                continue
            t = e.get("tags", {})
            ctrl = t.get("tower:type") == "aircraft_control" or t.get("aeroway") == "tower"
            score = (1 if ctrl else 0, 1 if height_m(t) else 0)
            cand = (score, -dist, la, lo, height_m(t))
            if best is None or cand[:2] > best[:2]:
                best = cand
        if best:
            rec = {"lat": round(best[2], 6), "lon": round(best[3], 6)}
            if best[4]:
                rec["heightM"] = best[4]
            out[ic] = rec

    prev = existing_records()
    for ic, rec in prev.items():
        if rec.get("manual"):
            out[ic] = dict(rec)                # hand-added towers persist in full
    for ic, rec in prev.items():
        if isinstance(rec, dict) and "style" in rec:
            out.setdefault(ic, {})["style"] = rec["style"]   # keep hand-set style everywhere
    out = {k: out[k] for k in sorted(out)}
    js = ("/* Bundled control-tower positions from OpenStreetMap (ODbL,\n"
          "   openstreetmap.org/copyright) for the airports referenced in missions/.\n"
          "   Regenerate with scripts/build-towers.py. lat/lon = degrees,\n"
          "   heightM = tower height in metres where OSM tags it. */\n"
          "export const TOWERS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "towers-data.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: {len(out)} towers")
    for ic, r in out.items():
        print(f"  {ic}: {r}")


if __name__ == "__main__":
    main()
