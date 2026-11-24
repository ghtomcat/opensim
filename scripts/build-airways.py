#!/usr/bin/env python3
"""Regenerate data/airways-data.js: the en-route airway network for the mission
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
BUFFER_NM = 110.0           # corridor half-width around the great circle — widened per pair until it connects
BUFFER_STEP_NM = 50.0
BUFFER_MAX_NM = 600.0
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
    src = open(os.path.join(ROOT, "data", "runways-data.js")).read()
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


def in_corridor(p, a, b, d_ab, buf=BUFFER_NM):
    """True if point p is within `buf` nm of the great-circle capsule between a and b."""
    d_ap, d_bp = _gc(a, p), _gc(b, p)
    if d_ap*R_NM > d_ab*R_NM + buf or d_bp*R_NM > d_ab*R_NM + buf:
        return False                              # past either end (with margin)
    xt = math.asin(max(-1, min(1, math.sin(d_ap)*math.sin(_bear(a, p) - _bear(a, b)))))
    return abs(xt)*R_NM < buf                     # cross-track inside the corridor


def _node_key(ll): return (round(ll[0], 4), round(ll[1], 4))


def connected_buffer(edges, c0, c1):
    """The narrowest corridor (BUFFER_NM, + BUFFER_STEP_NM …, ≤ BUFFER_MAX_NM) whose airways connect the fix
    nearest each airport — as core/airway-graph.js snaps them. A narrow corridor can cut the network in two
    where the airways swing around an airspace (FIMP->LSZH over Sudan); the route then had no airway part."""
    d_ab = _gc(c0, c1)
    buf = BUFFER_NM
    while buf <= BUFFER_MAX_NM:
        adj = {}
        for (_, aLL, bLL, _, _, _, _) in edges:
            if in_corridor(aLL, c0, c1, d_ab, buf) or in_corridor(bLL, c0, c1, d_ab, buf):
                ka, kb = _node_key(aLL), _node_key(bLL)
                adj.setdefault(ka, []).append(kb); adj.setdefault(kb, []).append(ka)
        if adj:
            near = lambda c: min(adj, key=lambda k: (k[0] - c[0])**2 + (k[1] - c[1])**2)
            s, goal = near(c0), near(c1)
            seen, stack = {s}, [s]
            while stack:
                for n in adj[stack.pop()]:
                    if n not in seen: seen.add(n); stack.append(n)
            if goal in seen:
                return buf
        buf += BUFFER_STEP_NM
    return None


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

    corridors = []
    for d, a in pairs:
        c0, c1 = centres[d], centres[a]
        buf = connected_buffer(edges, c0, c1)
        if buf is None:
            print(f"  {d}->{a}: NOT connected even at ±{BUFFER_MAX_NM:.0f} nm — the route will fly direct")
            buf = BUFFER_MAX_NM
        elif buf > BUFFER_NM:
            print(f"  {d}->{a}: widened to ±{buf:.0f} nm to connect")
        corridors.append((c0, c1, _gc(c0, c1), buf))
    kept, seen = [], set()
    for (aId, aLL, bLL, bId, base, top, name) in edges:
        if not any(in_corridor(aLL, c0, c1, dab, buf) or in_corridor(bLL, c0, c1, dab, buf)
                   for (c0, c1, dab, buf) in corridors):
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
    out = os.path.join(ROOT, "data", "airways-data.js")
    open(out, "w").write(js)
    print(f"wrote {os.path.relpath(out, ROOT)}: {len(kept)} edges, {len(fixes)} fixes")


if __name__ == "__main__":
    main()
