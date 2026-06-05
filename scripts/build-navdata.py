#!/usr/bin/env python3
"""Regenerate display/navdata.js: navaids (VOR/NDB/DME/TACAN) near the mission airports,
and each mission airport's radio frequencies — from OurAirports (public domain).

Airport centres come from display/runways-data.js (mean of the runway thresholds), so no
extra airport download. Re-run when adding mission airports:

    python3 scripts/build-navdata.py
"""
import csv, glob, io, json, math, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://davidmegginson.github.io/ourairports-data"
NAV_RADIUS_NM = 50
NAV_TYPES = {"VOR", "VOR-DME", "VORTAC", "DME", "NDB", "NDB-DME", "TACAN"}


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


def airport_centres():
    src = open(os.path.join(ROOT, "display", "runways-data.js")).read()
    runways = json.loads(src[src.index("{"): src.rindex("}") + 1])
    out = {}
    for ic, rws in runways.items():
        pts = [p for r in rws for p in (r["a"], r["b"])]
        out[ic] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return out


def fetch_csv(name):
    print(f"fetching {name} ...")
    data = urllib.request.urlopen(f"{BASE}/{name}", timeout=180).read().decode()
    return list(csv.DictReader(io.StringIO(data)))


def nm(la1, lo1, la2, lo2):
    dN = (la1 - la2) * 60
    dE = (lo1 - lo2) * 60 * math.cos(math.radians(la1))
    return math.hypot(dN, dE)


def main():
    icaos = mission_icaos()
    centres = {ic: c for ic, c in airport_centres().items() if ic in icaos}
    print(f"{len(icaos)} mission airports ({len(centres)} with bundled coords)")

    navs, seen = [], set()
    for r in fetch_csv("navaids.csv"):
        if r["type"] not in NAV_TYPES:
            continue
        try:
            la, lo = float(r["latitude_deg"]), float(r["longitude_deg"])
        except ValueError:
            continue
        if not any(nm(la, lo, c[0], c[1]) <= NAV_RADIUS_NM for c in centres.values()):
            continue
        key = (r["ident"], round(la, 3), round(lo, 3))
        if key in seen:
            continue
        seen.add(key)
        try:
            khz = int(float(r["frequency_khz"]))
        except (ValueError, KeyError):
            khz = 0
        navs.append({"ident": r["ident"], "name": r["name"], "type": r["type"],
                     "khz": khz, "lat": round(la, 5), "lon": round(lo, 5)})
    navs.sort(key=lambda n: (n["ident"], n["lat"]))
    print(f"{len(navs)} navaids within {NAV_RADIUS_NM} nm of mission airports")

    freqs = {}
    for r in fetch_csv("airport-frequencies.csv"):
        ic = r["airport_ident"]
        if ic not in icaos:
            continue
        try:
            mhz = float(r["frequency_mhz"])
        except ValueError:
            continue
        freqs.setdefault(ic, []).append({"type": r["type"], "desc": r["description"], "mhz": mhz})
    freqs = {k: freqs[k] for k in sorted(freqs)}
    print(f"frequencies for {len(freqs)} airports")

    js = ("/* Bundled navaids + airport frequencies from OurAirports (public domain,\n"
          "   ourairports.com) for the airports referenced in missions/. Regenerate with\n"
          f"   scripts/build-navdata.py. NAVAIDS = VOR/NDB/DME within {NAV_RADIUS_NM} nm of a\n"
          "   mission airport (khz = frequency); AIRPORT_FREQS keyed by ICAO (mhz). */\n"
          "export const NAVAIDS = " + json.dumps(navs, separators=(",", ":")) + ";\n"
          "export const AIRPORT_FREQS = " + json.dumps(freqs, separators=(",", ":")) + ";\n")
    path = os.path.join(ROOT, "display", "navdata.js")
    open(path, "w").write(js)
    print(f"wrote {os.path.relpath(path, ROOT)}: {len(navs)} navaids, "
          f"{len(freqs)} airport freq sets, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
