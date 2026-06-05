#!/usr/bin/env python3
"""Regenerate display/runways-data.js from OurAirports (public domain, ourairports.com),
scoped to the airports referenced in missions/*.json (departure/arrival ICAO).

Bundles per runway: thresholds, width, surface, the official per-end designators
(le_ident/he_ident — runways are named by magnetic heading, so these beat deriving the
number from geometry) and the `lighted` flag (so night lighting is truthful per runway).
Plus a small AIRPORTS table from airports.csv (type/tier, elevation, name).

Runway data changes rarely; re-run only when adding mission airports or to refresh:

    python3 scripts/build-runways.py
"""
import csv, glob, io, json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://davidmegginson.github.io/ourairports-data"


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


def fetch_csv(name):
    print(f"fetching {name} ...")
    return list(csv.DictReader(io.StringIO(
        urllib.request.urlopen(f"{BASE}/{name}", timeout=120).read().decode())))


def main():
    icaos = mission_icaos()
    print(f"{len(icaos)} mission airports")

    runways = {}
    for r in fetch_csv("runways.csv"):
        if r["airport_ident"] not in icaos or r["closed"] == "1":
            continue
        try:
            la, lo = float(r["le_latitude_deg"]), float(r["le_longitude_deg"])
            ha, ho = float(r["he_latitude_deg"]), float(r["he_longitude_deg"])
        except ValueError:
            continue
        w   = float(r["width_ft"] or 0) * 0.3048
        ref = "/".join(x for x in (r["le_ident"], r["he_ident"]) if x)
        rec = {
            "a": [round(la, 6), round(lo, 6)],
            "b": [round(ha, 6), round(ho, 6)],
            "widthM": round(w, 1), "ref": ref, "surface": r["surface"],
            "leId": r["le_ident"], "heId": r["he_ident"],
        }
        if r["lighted"] == "1":
            rec["lit"] = 1                       # only emit the truthy case (keeps the file small)
        runways.setdefault(r["airport_ident"], []).append(rec)

    airports = {}
    for r in fetch_csv("airports.csv"):
        if r["ident"] not in icaos:
            continue
        try:
            elevM = round(float(r["elevation_ft"]) * 0.3048, 1)
        except ValueError:
            elevM = None
        airports[r["ident"]] = {
            "type": r["type"].replace("_airport", ""),   # small | medium | large | heliport ...
            "name": r["name"],
            **({"elevM": elevM} if elevM is not None else {}),
        }

    runways = {k: runways[k] for k in sorted(runways)}
    airports = {k: airports[k] for k in sorted(airports)}
    js = ("/* Bundled OurAirports data (public domain, ourairports.com) for the airports\n"
          "   referenced in missions/. Regenerate with scripts/build-runways.py.\n"
          "   RUNWAYS: thresholds a/b = [lat,lon], widthM, ref, surface, leId/heId =\n"
          "   official per-end designators, lit = 1 if lighted. AIRPORTS: type (tier),\n"
          "   name, elevM. */\n"
          "export const RUNWAYS = "  + json.dumps(runways,  separators=(",", ":")) + ";\n"
          "export const AIRPORTS = " + json.dumps(airports, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "runways-data.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: {len(runways)} airports, "
          f"{sum(len(v) for v in runways.values())} runways, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
