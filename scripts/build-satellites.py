#!/usr/bin/env python3
"""Regenerate display/satellites-data.js: round satellite terminals for the mission
airports, detected from OpenStreetMap aeroway=gate nodes via Overpass.

A satellite (e.g. Genève B31-B34, B41-B44) is a round building with a handful of
gates spaced around it — the aircraft nose IN toward the centre. In OSM these are
aeroway=gate nodes arranged in a ring. We cluster nearby gate nodes, then keep only
clusters that form a ring (gates roughly equidistant from a centroid AND wrapped
around it, not strung along a line — which is an ordinary pier). Each kept ring gives
the building centre + radius + the bearing to each gate — everything the renderer
needs to draw a round terminal with radial jet bridges, no authoring.

OSM data is ODbL (openstreetmap.org/copyright). Runs rarely:

    python3 scripts/build-satellites.py
"""
import json, math, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ["https://overpass.kumi.systems/api/interpreter",
            "https://overpass-api.de/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
RADIUS_M  = 5000      # search radius around each airport centre
GAP_S     = 4         # pause between requests
CHAIN_M   = 34        # gate nodes within this distance chain into one cluster
R_MIN, R_MAX = 8, 45  # plausible satellite ring radius (m)
R_SPREAD  = 0.45      # max (rmax-rmin)/rmean — a ring has near-uniform radius
GAP_MAX   = 155       # max angular gap between adjacent gates (deg); a line ~180 → rejected
N_MIN     = 3         # at least this many gates to call it a ring


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


def _run(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    for url in OVERPASS:
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, data=body, headers={
                    "User-Agent": "OpenSim/1.0 (flight sim; satellite-terminal data)"})
                return json.load(urllib.request.urlopen(req, timeout=120))["elements"]
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"  {url.split('/')[2]}: {e}; retry in {wait}s ...")
                time.sleep(wait)
    raise RuntimeError("all Overpass mirrors failed")


def dist_m(a, b):
    dN = (b[0] - a[0]) * 111320
    dE = (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dN, dE)


def clusters(gates):
    """Chain gate nodes (lat,lon) within CHAIN_M into connected clusters (BFS)."""
    n = len(gates); seen = [False] * n; out = []
    for i in range(n):
        if seen[i]:
            continue
        stack, comp = [i], []
        seen[i] = True
        while stack:
            k = stack.pop(); comp.append(k)
            for j in range(n):
                if not seen[j] and dist_m(gates[k], gates[j]) <= CHAIN_M:
                    seen[j] = True; stack.append(j)
        out.append([gates[k] for k in comp])
    return out


def ring(comp):
    """If a cluster of gate nodes forms a round satellite, return its descriptor."""
    if len(comp) < N_MIN:
        return None
    cLat = sum(p[0] for p in comp) / len(comp)
    cLon = sum(p[1] for p in comp) / len(comp)
    cosC = math.cos(math.radians(cLat))
    radii, brgs = [], []
    for la, lo in comp:
        dN = (la - cLat) * 111320; dE = (lo - cLon) * 111320 * cosC
        radii.append(math.hypot(dN, dE))
        brgs.append((math.degrees(math.atan2(dE, dN)) + 360) % 360)
    rmean = sum(radii) / len(radii)
    if not (R_MIN <= rmean <= R_MAX):
        return None
    if (max(radii) - min(radii)) / rmean > R_SPREAD:          # not uniform radius → not round
        return None
    bs = sorted(brgs)
    gaps = [bs[(i + 1) % len(bs)] - bs[i] for i in range(len(bs) - 1)] + [360 - bs[-1] + bs[0]]
    if max(gaps) > GAP_MAX:                                    # gates bunched on one side → a pier, not a ring
        return None
    return {"lat": round(cLat, 6), "lon": round(cLon, 6),
            "r": round(rmean, 1), "gates": [round(b, 1) for b in sorted(brgs)]}


def main():
    centres = airport_centres()
    print(f"{len(centres)} mission airports; querying Overpass ...")
    out = {}
    for ic, (la, lo) in centres.items():
        q = (f'[out:json][timeout:90];'
             f'node["aeroway"="gate"](around:{RADIUS_M},{la:.5f},{lo:.5f});out;')
        try:
            els = _run(q)
        except RuntimeError:
            print(f"  {ic}: query failed, skipped"); continue
        gates = [(e["lat"], e["lon"]) for e in els if "lat" in e]
        sats = [s for comp in clusters(gates) if (s := ring(comp))]
        if sats:
            out[ic] = sorted(sats, key=lambda s: (s["lat"], s["lon"]))
            print(f"  {ic}: {len(gates)} gate nodes → {len(sats)} satellite(s) "
                  + ", ".join(f"r{s['r']:.0f}/{len(s['gates'])}g" for s in sats))
        elif gates:
            print(f"  {ic}: {len(gates)} gate nodes → no rings")
        time.sleep(GAP_S)

    out = {k: out[k] for k in sorted(out)}
    js = ("/* Round satellite terminals detected from OpenStreetMap aeroway=gate rings\n"
          "   (ODbL, openstreetmap.org/copyright) for the mission airports. Regenerate\n"
          "   with scripts/build-satellites.py. Each satellite: lat/lon = building centre,\n"
          "   r = gate-ring radius (m), gates = bearing from centre to each gate (deg). */\n"
          "export const SATELLITES = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "satellites-data.js")
    open(path, "w").write(js)
    total = sum(len(v) for v in out.values())
    print(f"wrote {os.path.relpath(path, ROOT)}: {total} satellites at {len(out)} airports")


if __name__ == "__main__":
    main()
