#!/usr/bin/env python3
"""Regenerate display/navaids-data.js: VOR / VOR-DME / VORTAC stations near the mission
airports, from OurAirports' navaids.csv, for the ND's VOR1 / VOR2 radio-navigation display.

OurAirports data is PUBLIC DOMAIN (David Megginson / OurAirports — "all of OurAirports' data
into the public domain"), so unlike the X-Plane / Navigraph nav data the bundle this writes
(display/navaids-data.js) is committable and reproducible without any proprietary source.

The CSV is fetched once to scripts/ourairports/navaids.csv (gitignored) and reused. We keep
VOR-azimuth stations (VOR / VOR-DME / VORTAC; pure TACAN / DME / NDB dropped) within a box
around any mission airport. frequency_khz / 1000 = MHz.

    python3 scripts/build-navaids.py
"""
import csv, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_URL  = "https://davidmegginson.github.io/ourairports-data/navaids.csv"
CSV_PATH = os.path.join(ROOT, "scripts", "ourairports", "navaids.csv")
BBOX_LAT, BBOX_LON = 3.0, 4.0          # ° around each mission airport (~180 nm) — terminal-area VORs
VOR_TYPES = {"VOR", "VOR-DME", "VORTAC"}


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


def fetch_csv():
    if os.path.exists(CSV_PATH):
        return
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    print(f"fetching {CSV_URL} …")
    urllib.request.urlretrieve(CSV_URL, CSV_PATH)


def main():
    fetch_csv()
    centres = airport_centres(mission_airports())
    if not centres:
        sys.exit("no mission-airport coordinates (need display/runways-data.js)")
    cs = list(centres.values())

    def near(la, lo):
        return any(abs(la - c[0]) <= BBOX_LAT and abs(lo - c[1]) <= BBOX_LON for c in cs)

    vors = {}
    with open(CSV_PATH, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("type") not in VOR_TYPES:
                continue
            try:
                la, lo = float(row["latitude_deg"]), float(row["longitude_deg"])
                freq = int(row["frequency_khz"]) / 1000.0
            except (ValueError, KeyError):
                continue
            if not near(la, lo):
                continue
            key = (row["ident"], round(la, 2), round(lo, 2))     # ident isn't globally unique
            if key not in vors:
                vors[key] = {"id": row["ident"], "freq": round(freq, 2),
                             "lat": round(la, 5), "lon": round(lo, 5), "name": row["name"]}

    out = sorted(vors.values(), key=lambda v: (v["id"], v["lat"]))
    js = ("/* VOR / VOR-DME / VORTAC stations near the mission airports, from OurAirports'\n"
          "   navaids.csv (PUBLIC DOMAIN — OurAirports). Regenerate: scripts/build-navaids.py.\n"
          "   VORS = [{ id, freq(MHz), lat, lon, name }]. */\n"
          "export const VORS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "navaids-data.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: {len(out)} VORs across {len(centres)} airports "
          f"({os.path.getsize(path)//1024} KB)")


if __name__ == "__main__":
    main()
