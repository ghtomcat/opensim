#!/usr/bin/env python3
"""Regenerate display/airways-data.js: the en-route airway network for the mission
city-pairs, sliced out of the X-Plane nav data (earth_awy.dat).

The airway file already IS the graph — every line is an edge: a fix → a fix, with the
two endpoints' coordinates, the flight-level band and the airway designator. We keep only
the edges inside a great-circle corridor between each mission's departure and arrival, so
the bundle stays small (the global set is ~70k edges) while the route can still be found
with a shortest-path search over the real airways.

Source: X-Plane earth_awy.dat (data cycle 2012.08, GPL v.3, github.com/mcantsin/x-plane-navdata).
Put the .dat files in scripts/xplane-nav/ (or pass --nav <dir>) and run:

    python3 scripts/build-airways.py
"""
import json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAVDIR = os.path.join(ROOT, "scripts", "xplane-nav")
BUFFER_NM = 110.0           # corridor half-width around the great circle
R_NM = 3440.065


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


def mission_pairs():
    pairs = set()
    mdir = os.path.join(ROOT, "missions")
    for f in os.listdir(mdir):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(mdir, f)))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        dep = (d.get("departure") or {}).get("icao")
        arr = (d.get("arrival") or {}).get("icao")
        if dep and arr and dep != arr:
            pairs.add((dep, arr))
    return sorted(pairs)


def _rad(d): return d * math.pi / 180
def _gc(a, b):                                   # great-circle angular distance (rad)
    φ1, φ2 = _rad(a[0]), _rad(b[0]); dφ = φ2 - φ1; dλ = _rad(b[1] - a[1])
    h = math.sin(dφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(dλ/2)**2
    return 2*math.asin(min(1, math.sqrt(h)))
def _bear(a, b):
    φ1, φ2 = _rad(a[0]), _rad(b[0]); dλ = _rad(b[1] - a[1])
    return math.atan2(math.sin(dλ)*math.cos(φ2),
                      math.cos(φ1)*math.sin(φ2) - math.sin(φ1)*math.cos(φ2)*math.cos(dλ))


def in_corridor(p, a, b, d_ab):
    """True if point p is within BUFFER_NM of the great-circle capsule between a and b."""
    d_ap, d_bp = _gc(a, p), _gc(b, p)
    if d_ap*R_NM > d_ab*R_NM + BUFFER_NM or d_bp*R_NM > d_ab*R_NM + BUFFER_NM:
        return False                              # past either end (with margin)
    xt = math.asin(max(-1, min(1, math.sin(d_ap)*math.sin(_bear(a, p) - _bear(a, b)))))
    return abs(xt)*R_NM < BUFFER_NM               # cross-track inside the corridor


def parse_airways(path):
    edges = []
    with open(path, encoding="latin-1") as fh:
        for ln in fh:
            t = ln.split()
            if len(t) < 10:
                continue
            try:
                a = (float(t[1]), float(t[2])); b = (float(t[4]), float(t[5]))
            except ValueError:
                continue
            edges.append((t[0], a, b, t[3], int(t[7]), int(t[8]), t[9]))   # aId,aLL,bLL,bId,base,top,name
    return edges


def main():
    nav = NAVDIR
    if "--nav" in sys.argv:
        nav = sys.argv[sys.argv.index("--nav") + 1]
    awy = os.path.join(nav, "earth_awy.dat")
    if not os.path.exists(awy):
        sys.exit(f"missing {awy} — drop the X-Plane earth_awy.dat there (see header).")

    centres = airport_centres()
    pairs = [(d, a) for d, a in mission_pairs() if d in centres and a in centres]
    print(f"{len(pairs)} city-pair(s): " + ", ".join(f"{d}->{a}" for d, a in pairs))

    edges = parse_airways(awy)
    print(f"{len(edges)} airway edges in nav data; slicing corridors (±{BUFFER_NM:.0f} nm) ...")

    corridors = [(centres[d], centres[a], _gc(centres[d], centres[a])) for d, a in pairs]
    kept, seen = [], set()
    for (aId, aLL, bLL, bId, base, top, name) in edges:
        if not any(in_corridor(aLL, c0, c1, dab) or in_corridor(bLL, c0, c1, dab)
                   for (c0, c1, dab) in corridors):
            continue
        key = tuple(sorted([(round(aLL[0], 4), round(aLL[1], 4)),
                            (round(bLL[0], 4), round(bLL[1], 4))]))
        if key in seen:
            continue
        seen.add(key)
        kept.append([round(aLL[0], 5), round(aLL[1], 5), round(bLL[0], 5), round(bLL[1], 5),
                     aId, bId, name, base, top])

    fixes = {}
    for e in kept:
        fixes.setdefault(e[4], [e[0], e[1]]); fixes.setdefault(e[5], [e[2], e[3]])

    js = ("/* En-route airway network for the mission city-pairs, sliced from the X-Plane nav\n"
          "   data (earth_awy.dat, data cycle 2012.08, GPL v.3, github.com/mcantsin/x-plane-navdata).\n"
          "   Regenerate with scripts/build-airways.py. Every AIRWAYS entry is a graph edge:\n"
          "   [aLat,aLon,bLat,bLon, aId,bId, name, baseFL, topFL]. FIXES[id]=[lat,lon] for labels. */\n"
          "export const AIRWAYS = " + json.dumps(kept, separators=(",", ":")) + ";\n"
          "export const FIXES = " + json.dumps(fixes, separators=(",", ":")) + ";\n")
    out = os.path.join(ROOT, "display", "airways-data.js")
    open(out, "w").write(js)
    print(f"wrote {os.path.relpath(out, ROOT)}: {len(kept)} edges, {len(fixes)} fixes")


if __name__ == "__main__":
    main()
