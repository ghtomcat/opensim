#!/usr/bin/env python3
"""Regenerate display/terminals-data.js: real terminal building footprints and apron
surfaces for the mission airports, from OpenStreetMap via Overpass.

Where OSM maps the actual buildings we don't need to *derive* a terminal by clustering
gates — we draw the real footprint. aeroway=terminal ways/relations give the polygon;
aeroway=apron gives the paved surface. Polygons are simplified (Douglas-Peucker, ~3 m)
and capped so they stay cheap to draw as ground-LOD wireframe massing.

Merge-safe: an airport that fails to fetch keeps its previously-bundled data, so a
flaky Overpass run never drops airports. OSM data is ODbL (openstreetmap.org/copyright).

    python3 scripts/build-terminals.py            # all mission airports
    python3 scripts/build-terminals.py LSGG KBZN  # only these
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ["https://overpass.kumi.systems/api/interpreter",
            "https://overpass-api.de/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
RADIUS_M = 4000
GAP_S    = 4
DP_EPS_M = 3.0      # Douglas-Peucker tolerance (m)
MAX_PTS  = 40       # cap vertices per polygon (decimate if still over)


def _obj_after(src, name):
    i = src.index(name); i = src.index("{", i); depth = 0
    for j in range(i, len(src)):
        if src[j] == "{": depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(src[i:j + 1])
    raise ValueError(f"unbalanced braces after {name}")


def airport_centres():
    src = open(os.path.join(ROOT, "display", "runways-data.js")).read()
    runways = _obj_after(src, "RUNWAYS")
    out = {}
    for ic, rws in runways.items():
        pts = [p for r in rws for p in (r["a"], r["b"])]
        out[ic] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return out


def existing(name):
    path = os.path.join(ROOT, "display", "terminals-data.js")
    if not os.path.exists(path):
        return {}
    src = open(path).read()
    m = re.search(name + r" = (\{.*?\});", src)
    return json.loads(m.group(1)) if m else {}


def _run(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    for url in OVERPASS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=body, headers={
                    "User-Agent": "OpenSim/1.0 (flight sim; terminal-footprint data)"})
                return json.load(urllib.request.urlopen(req, timeout=120))["elements"]
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"  {url.split('/')[2]}: {e}; retry in {wait}s ...")
                time.sleep(wait)
    raise RuntimeError("all Overpass mirrors failed")


def _m(a, b):                              # local metres between (lat,lon)
    return ((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])))


def dp(poly, eps):
    """Douglas-Peucker on a lat/lon ring (open list), tolerance in metres."""
    if len(poly) < 3:
        return poly
    a, b = poly[0], poly[-1]
    abx, aby = _m(a, b); ab2 = abx * abx + aby * aby
    dmax, idx = 0, 0
    for i in range(1, len(poly) - 1):
        px, py = _m(a, poly[i])
        t = 0 if ab2 == 0 else max(0, min(1, (px * abx + py * aby) / ab2))
        d = math.hypot(px - abx * t, py - aby * t)
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return dp(poly[:idx + 1], eps)[:-1] + dp(poly[idx:], eps)
    return [a, b]


def simplify(ring):
    """Close → DP-simplify → cap vertices. ring is a list of [lat,lon]."""
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 3:
        return None
    s = dp(ring + [ring[0]], DP_EPS_M)[:-1]
    if len(s) > MAX_PTS:                    # decimate evenly if still huge
        step = len(s) / MAX_PTS
        s = [s[int(i * step)] for i in range(MAX_PTS)]
    return [[round(p[0], 6), round(p[1], 6)] for p in s] if len(s) >= 3 else None


def height_of(tags):
    h = tags.get("height")
    if h:
        m = re.match(r"([\d.]+)", str(h))
        if m: return round(float(m.group(1)))
    lv = tags.get("building:levels")
    if lv:
        try: return round(float(lv) * 3.5)
        except ValueError: pass
    return 16                               # default terminal height (m)


def rings_from(el):
    """Yield closed lat/lon rings from a way (geometry) or relation (outer members)."""
    if el["type"] == "way" and el.get("geometry"):
        yield [[p["lat"], p["lon"]] for p in el["geometry"]]
    elif el["type"] == "relation":
        for mem in el.get("members", []):
            if mem.get("role") in ("outer", "") and mem.get("geometry"):
                yield [[p["lat"], p["lon"]] for p in mem["geometry"]]


def main():
    centres = airport_centres()
    only = [a.upper() for a in sys.argv[1:]]
    if only:
        centres = {k: v for k, v in centres.items() if k in only}
    print(f"{len(centres)} airport(s); querying Overpass ...")
    terms, aprons = existing("TERMINALS"), existing("APRONS")
    for ic, (la, lo) in centres.items():
        q = (f'[out:json][timeout:90];'
             f'(way["aeroway"="terminal"](around:{RADIUS_M},{la:.5f},{lo:.5f});'
             f' relation["aeroway"="terminal"](around:{RADIUS_M},{la:.5f},{lo:.5f}););out geom;'
             f'way["aeroway"="apron"](around:{RADIUS_M},{la:.5f},{lo:.5f});out geom;')
        try:
            els = _run(q)
        except RuntimeError:
            print(f"  {ic}: failed, kept existing"); continue
        T, A = [], []
        for e in els:
            tags = e.get("tags", {})
            kind = tags.get("aeroway")
            for ring in rings_from(e):
                s = simplify(ring)
                if not s: continue
                if kind == "terminal":
                    T.append({"poly": s, "h": height_of(tags)})
                elif kind == "apron":
                    A.append(s)
        if T: terms[ic] = T
        if A: aprons[ic] = A
        print(f"  {ic}: {len(T)} terminal(s), {len(A)} apron(s)")
        time.sleep(GAP_S)

    terms = {k: terms[k] for k in sorted(terms)}
    aprons = {k: aprons[k] for k in sorted(aprons)}
    js = ("/* Real terminal building footprints + apron surfaces from OpenStreetMap (ODbL,\n"
          "   openstreetmap.org/copyright) for the mission airports. Regenerate with\n"
          "   scripts/build-terminals.py. TERMINALS[ic]=[{poly:[[lat,lon]...],h:metres}];\n"
          "   APRONS[ic]=[[[lat,lon]...], ...]. Where an airport has TERMINALS, the\n"
          "   renderer draws these real footprints instead of the derived gate-cluster mass. */\n"
          "export const TERMINALS = " + json.dumps(terms, separators=(",", ":")) + ";\n"
          "export const APRONS = " + json.dumps(aprons, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "terminals-data.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: "
          f"{sum(len(v) for v in terms.values())} terminals, "
          f"{sum(len(v) for v in aprons.values())} aprons at {len(terms)}/{len(aprons)} airports")


if __name__ == "__main__":
    main()
