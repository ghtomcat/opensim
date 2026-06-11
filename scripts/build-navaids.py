#!/usr/bin/env python3
"""Regenerate display/navaids-data.js: VOR / VOR-DME stations near the mission airports,
sliced from X-Plane's earth_nav.dat, for the ND's VOR1 / VOR2 radio-navigation display.

earth_nav.dat row (code 3 = VOR):
    3  <lat> <lon> <elev_ft> <freq×100> <range_nm> <slaved_var> <ident> ENRT <region> <name … VOR/DME>
We keep code-3 stations whose name carries "VOR" (VOR / VOR-DME / VORTAC; pure TACAN/NDB
dropped) within a box around any mission airport, de-duplicated by ident.

LICENSING: X-Plane's nav data is "Copyright Navigraph, Datasource Jeppesen" — PROPRIETARY.
The bundle this writes is therefore gitignored (display/navaids-data.js) and must not be
redistributed. For a public, redistributable build use the OurAirports navaids.csv (public
domain, CC0). The script itself contains no data.

    python3 scripts/build-navaids.py
    python3 scripts/build-navaids.py --xplane "/path/X-Plane 12"
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XP = "/Users/markusleutwyler/X-Plane 12"
BBOX_LAT, BBOX_LON = 3.0, 4.0   # ° around each mission airport (~180 nm) — terminal-area VORs


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
            blk = d.get(k)
            ic = blk.get("icao") if isinstance(blk, dict) else None
            if ic:
                ics.add(ic)
    return ics


def airport_centres(icaos):
    """Mean of each airport's runway thresholds, from display/runways-data.js."""
    runways = {}
    for ln in open(os.path.join(ROOT, "display", "runways-data.js")):
        if ln.lstrip().startswith("export const RUNWAYS"):
            runways = json.loads(ln.split("=", 1)[1].strip().rstrip(";").rstrip())
            break
    out = {}
    for ic in icaos:
        rws = runways.get(ic)
        if not rws:
            continue
        pts = [p for r in rws for p in (r["a"], r["b"])]
        out[ic] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return out


def main():
    xp = sys.argv[sys.argv.index("--xplane") + 1] if "--xplane" in sys.argv else DEFAULT_XP
    nav = os.path.join(xp, "Resources", "default data", "earth_nav.dat")
    if not os.path.exists(nav):
        sys.exit(f"no earth_nav.dat at {nav} — pass --xplane <X-Plane install>")

    centres = airport_centres(mission_airports())
    if not centres:
        sys.exit("no mission-airport coordinates (need display/runways-data.js)")
    cs = list(centres.values())

    def near(la, lo):
        return any(abs(la - c[0]) <= BBOX_LAT and abs(lo - c[1]) <= BBOX_LON for c in cs)

    vors = {}
    for ln in open(nav, encoding="latin-1"):
        p = ln.split()
        if len(p) < 11 or p[0] != "3":
            continue
        name = " ".join(p[10:])
        if "VOR" not in name.upper():               # VOR / VOR-DME / VORTAC; skip TACAN, NDB
            continue
        try:
            la, lo, freq = float(p[1]), float(p[2]), int(p[4]) / 100.0
        except ValueError:
            continue
        if not near(la, lo):
            continue
        ident = p[7]
        if ident not in vors:
            vors[ident] = {"id": ident, "freq": round(freq, 2),
                           "lat": round(la, 5), "lon": round(lo, 5), "name": name}

    out = sorted(vors.values(), key=lambda v: v["id"])
    js = ("/* VOR / VOR-DME stations near the mission airports, sliced from X-Plane earth_nav.dat\n"
          "   for the ND VOR1/VOR2 display. SOURCE IS PROPRIETARY (Navigraph / Jeppesen) — this\n"
          "   file is gitignored and must not be redistributed. Regenerate: scripts/build-navaids.py.\n"
          "   VORS = [{ id, freq, lat, lon, name }]. */\n"
          "export const VORS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "navaids-data.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: {len(out)} VORs across {len(centres)} airports "
          f"({os.path.getsize(path)//1024} KB)")


if __name__ == "__main__":
    main()
