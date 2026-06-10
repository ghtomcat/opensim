#!/usr/bin/env python3
"""Regenerate display/procedures-data-xp.js: SID / STAR / approach procedures for the
mission airports, sliced from an X-Plane 11/12 install's CIFP data.

The CIFP per-airport files (Resources/default data/CIFP/<ICAO>.dat) are already a clean
list of procedure legs — SID/STAR/APPCH records, one fix per line with a leg type and an
altitude constraint. We resolve each fix id to coordinates via earth_fix.dat (terminal +
en-route waypoints), keep the mission airports, and bundle the lateral path + constraints.

LICENSING: X-Plane's default nav data is "Copyright Navigraph, Datasource Jeppesen" —
PROPRIETARY. The bundle this writes is therefore gitignored (display/procedures-data-xp.js)
and must not be redistributed. The script itself contains no data and is fine to commit.
For a public, redistributable build use the FAA CIFP (public domain, US airports) instead.

    python3 scripts/build-cifp.py                          # default X-Plane path below
    python3 scripts/build-cifp.py --xplane "/path/X-Plane 12"
"""
import json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XP = "/Users/markusleutwyler/X-Plane 12"


def mission_airports():
    ics = set()
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
        for k in ("departure", "arrival"):
            ic = (d.get(k) or {}).get("icao")
            if ic:
                ics.add(ic)
    return sorted(ics)


def parse_cifp(path):
    """One airport's CIFP → {rwys:{id:[lat,lon]}, sids/stars/apprs:[{name,trans,legs:[…]}]}."""
    procs = {"SID": {}, "STAR": {}, "APPCH": {}}
    rwys, needed = {}, set()
    for ln in open(path, encoding="latin-1"):
        kind, _, rest = ln.partition(":")
        kind = kind.strip()
        if kind == "RWY":
            head, _, geo = rest.partition(";")
            rid = head.split(",")[0].strip()
            m = re.match(r"\s*([NS])(\d{2})(\d{2})(\d{2})(\d{2}),\s*([EW])(\d{3})(\d{2})(\d{2})(\d{2})", geo)
            if rid and m:
                la = (int(m[2]) + int(m[3])/60 + (int(m[4]) + int(m[5])/100)/3600) * (1 if m[1] == "N" else -1)
                lo = (int(m[7]) + int(m[8])/60 + (int(m[9]) + int(m[10])/100)/3600) * (1 if m[6] == "E" else -1)
                rwys[rid] = [round(la, 6), round(lo, 6)]
            continue
        if kind not in procs:
            continue
        f = rest.split(",")
        if len(f) < 24:
            continue
        name, trans, fixid, region = f[2].strip(), f[3].strip(), f[4].strip(), f[5].strip()
        legtype = f[11].strip()
        alt = (f[22].strip() + f[23].strip()).strip()        # e.g. "+3500", "FL080"
        key = (name, trans)
        leg = {"fix": fixid, "rgn": region, "t": legtype, "alt": alt}
        procs[kind].setdefault(key, []).append((int(f[0]) if f[0].strip().isdigit() else 0, leg))
        if fixid:
            needed.add(fixid)
    out = {"rwys": rwys, "sids": [], "stars": [], "apprs": []}
    dst = {"SID": "sids", "STAR": "stars", "APPCH": "apprs"}
    for kind, d in procs.items():
        for (name, trans), legs in d.items():
            legs.sort(key=lambda x: x[0])
            out[dst[kind]].append({"name": name, "trans": trans, "legs": [l for _, l in legs]})
    return out, needed


def resolve_fixes(xp, needed):
    """id -> [[lat,lon], …] ALL candidates from earth_fix.dat + earth_nav.dat (a 5-letter
    name isn't globally unique, so keep every match and let the caller pick the nearest)."""
    fixes = {}
    fp = os.path.join(xp, "Resources", "default data", "earth_fix.dat")
    for ln in open(fp, encoding="latin-1"):
        p = ln.split()
        if len(p) < 3:
            continue
        ident = p[2]
        if ident not in needed:
            continue
        try:
            fixes.setdefault(ident, []).append([round(float(p[0]), 6), round(float(p[1]), 6)])
        except ValueError:
            continue
    nv = os.path.join(xp, "Resources", "default data", "earth_nav.dat")
    if os.path.exists(nv):
        for ln in open(nv, encoding="latin-1"):
            p = ln.split()
            if len(p) < 9 or not p[0].isdigit():
                continue
            ident = p[7]
            if ident not in needed:
                continue
            try:
                fixes.setdefault(ident, []).append([round(float(p[1]), 6), round(float(p[2]), 6)])
            except (ValueError, IndexError):
                pass
    return fixes


def main():
    xp = sys.argv[sys.argv.index("--xplane") + 1] if "--xplane" in sys.argv else DEFAULT_XP
    cifp_dir = os.path.join(xp, "Resources", "default data", "CIFP")
    if not os.path.isdir(cifp_dir):
        sys.exit(f"no CIFP folder at {cifp_dir} — pass --xplane <X-Plane install>")

    airports = mission_airports()
    raw, needed = {}, set()
    for ic in airports:
        f = os.path.join(cifp_dir, ic + ".dat")
        if not os.path.exists(f):
            print(f"  {ic}: no CIFP file, skipped"); continue
        data, need = parse_cifp(f)
        raw[ic] = data; needed |= need
    print(f"{len(raw)} airport(s), {len(needed)} distinct fixes to resolve …")

    fixes = resolve_fixes(xp, needed)

    def coord(fixid, ref):
        cand = fixes.get(fixid)
        if not cand:
            return None
        if ref is None or len(cand) == 1:
            return cand[0]
        cl = math.cos(ref[0] * math.pi / 180)
        return min(cand, key=lambda c: (c[0] - ref[0]) ** 2 + ((c[1] - ref[1]) * cl) ** 2)   # nearest the airport

    procs = {}
    for ic, data in raw.items():
        rw = list(data["rwys"].values())
        ref = [sum(r[0] for r in rw) / len(rw), sum(r[1] for r in rw) / len(rw)] if rw else None
        for grp in ("sids", "stars", "apprs"):
            for pr in data[grp]:
                for l in pr["legs"]:
                    c = coord(l["fix"], ref) if l["fix"] else None
                    if c: l["lat"], l["lon"] = c[0], c[1]
                    l.pop("rgn", None)
        procs[ic] = data

    js = ("/* SID / STAR / approach procedures for the mission airports, sliced from an\n"
          "   X-Plane CIFP install. SOURCE IS PROPRIETARY (Navigraph / Jeppesen) — this file\n"
          "   is gitignored and must not be redistributed. Regenerate: scripts/build-cifp.py.\n"
          "   PROCEDURES[ic] = { rwys:{id:[lat,lon]}, sids/stars/apprs:[{name,trans,legs:[\n"
          "     {fix,t(legtype),alt,lat,lon}]}] }. */\n"
          "export const PROCEDURES = " + json.dumps(procs, separators=(",", ":")) + ";\n")
    out = os.path.join(ROOT, "display", "procedures-data-xp.js")
    open(out, "w").write(js)
    tot = sum(len(d["sids"]) + len(d["stars"]) + len(d["apprs"]) for d in procs.values())
    print(f"wrote {os.path.relpath(out, ROOT)}: {tot} procedures across {len(procs)} airports "
          f"({os.path.getsize(out)//1024} KB)")


if __name__ == "__main__":
    main()
