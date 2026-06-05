#!/usr/bin/env python3
"""Regenerate display/runways-data.js from OurAirports runway data, scoped to the
airports referenced in missions/*.json (departure/arrival ICAO).

OurAirports data is public domain (ourairports.com). Runway geometry changes rarely,
so re-run this only when adding mission airports or to refresh occasionally:

    python3 scripts/build-runways.py
"""
import csv, glob, io, json, os, urllib.request

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"


def mission_icaos():
    icaos = set()
    for f in glob.glob(os.path.join(ROOT, "missions", "*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        for k in ("departure", "arrival"):
            v = d.get(k)
            if isinstance(v, dict) and v.get("icao"):
                icaos.add(v["icao"])
    return icaos


def main():
    icaos = mission_icaos()
    print(f"{len(icaos)} mission airports")
    print("fetching OurAirports runways.csv ...")
    data = urllib.request.urlopen(CSV_URL, timeout=60).read().decode()
    out = {}
    for r in csv.DictReader(io.StringIO(data)):
        if r["airport_ident"] not in icaos or r["closed"] == "1":
            continue
        try:
            la, lo = float(r["le_latitude_deg"]), float(r["le_longitude_deg"])
            ha, ho = float(r["he_latitude_deg"]), float(r["he_longitude_deg"])
        except ValueError:
            continue
        w   = float(r["width_ft"] or 0) * 0.3048
        ref = "/".join(x for x in (r["le_ident"], r["he_ident"]) if x)
        out.setdefault(r["airport_ident"], []).append({
            "a": [round(la, 6), round(lo, 6)],
            "b": [round(ha, 6), round(ho, 6)],
            "widthM": round(w, 1), "ref": ref, "surface": r["surface"],
        })
    js = ("/* Bundled OurAirports runway data (public domain, ourairports.com) for the\n"
          "   airports referenced in missions/. Regenerate with scripts/build-runways.py.\n"
          "   thresholds a/b = [lat, lon], widthM = metres, ref = designation, surface. */\n"
          "export const RUNWAYS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "runways-data.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: {len(out)} airports, "
          f"{sum(len(v) for v in out.values())} runways, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
