#!/usr/bin/env python3
"""Re-derive a wide/narrow-body aircraft's render geometry from its real `dimensions`
block, at the honest world scale: model-NM = real-mm / 1,852,000 (1 NM = 1852 m).

The rendered geometry (nose/wing/geometry/gear/...) was hand-authored ~1.6x oversize and
not actually tied to the measured `dimensions`. This applies two scale factors — radial
(from fuselageDiameter) and longitudinal (from length) — field by field, so the model
matches the real envelope. Radial nails fuselage + span + gear track + strut together
(they were a single uniform 1.64x); longitudinal corrects the length independently.

Usage:  python3 scripts/rescale-aircraft.py a340 [--write]
Without --write it only prints the before/after envelope for review.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NM_MM = 1_852_000.0          # mm per NM
S = 1.0 / NM_MM              # NM per mm

def scale_xyz(pt, fX, fR):           # [x, y, z] -> x by fX, y/z by fR
    return [pt[0]*fX, pt[1]*fR, pt[2]*fR]

def main():
    if len(sys.argv) < 2:
        print("usage: rescale-aircraft.py <id> [--write]"); return
    acid = sys.argv[1]; write = "--write" in sys.argv
    path = os.path.join(ROOT, "aircraft", f"{acid}.json")
    j = json.load(open(path))
    dim = j.get("dimensions") or {}
    if "fuselageDiameter" not in dim or "length" not in dim:
        print("no usable dimensions block"); return

    g, nose, wing, gear = j.get("geometry", {}), j.get("nose", {}), j.get("wing", {}), j.get("gear", {})
    cur_r = g.get("r") or nose.get("r") or 0.0025          # effective fuselage radius (NM)
    cur_len = nose.get("tipX", 0) - g.get("tailX", 0)       # nose tip -> tail (NM)

    tgt_r   = (dim["fuselageDiameter"] / 2) * S
    tgt_len = dim["length"] * S
    fR = tgt_r / cur_r
    fX = tgt_len / cur_len
    print(f"{acid}: fR(radial)={fR:.4f}  fX(longitudinal)={fX:.4f}")
    print(f"  before: dia {cur_r*2*NM_MM/1000:.2f}m  len {cur_len*NM_MM/1000:.2f}m")

    # ---- radial fields (Y, Z, radii, thicknesses) ----
    for blk, keys in [
        (g,    ["vstabZ","vstabTipLE","engineY","engineY2","engineZ","engineTopGap","engineR","engineRC","pylonZ"]),
        (wing, ["span","rootZ","dihedral","rootThick","tipThick"]),
        (j.get("bellyFairing",{}), ["maxDepth","maxWidth"]),
    ]:
        for k in keys:
            if k in blk and isinstance(blk[k], (int,float)): blk[k] *= fR
    if "tipCz" in nose: nose["tipCz"] *= fR

    # ---- longitudinal fields (X stations) ----
    for blk, keys in [
        (nose, ["tipX"]),
        (wing, ["rootLE","rootTE","tipLE","tipTE"]),
        (g,    ["tailX"]),
        (j.get("bellyFairing",{}), ["fromX","toX"]),
    ]:
        for k in keys:
            if k in blk and isinstance(blk[k], (int,float)): blk[k] *= fX
    if isinstance(j.get("doors"), list):
        j["doors"] = [d*fX for d in j["doors"]]

    # ---- nose rings: vF = X station, cz = Z (rFrac/rzTopFrac/tilt are fractions, keep) ----
    for rg in nose.get("noseRings", []):
        if "vF" in rg: rg["vF"] *= fX
        if "cz" in rg: rg["cz"] *= fR

    # ---- cockpit panels / windows / mask: [x,y,z] triples ----
    nose["cockpitPanels"] = [[scale_xyz(pt, fX, fR) for pt in panel] for panel in nose.get("cockpitPanels", [])]
    if isinstance(nose.get("windows"), list):     nose["windows"]     = [scale_xyz(pt, fX, fR) for pt in nose["windows"]]
    if isinstance(nose.get("cockpitMask"), list): nose["cockpitMask"] = [scale_xyz(pt, fX, fR) for pt in nose["cockpitMask"]]

    # ---- engine: position is longitudinal (fX); the nacelle is a body of revolution
    #      so its size scales uniformly (fR); its total length is set from the measured
    #      engineLength when available (default nacelle nozzle offset = 0.008). ----
    DEFAULT_NOZZLE = 0.008
    if "engineX" in g: g["engineX"] *= fX
    for k in ["fanCowlLen","nacelleBody","chevronDepth"]:
        if k in g and isinstance(g[k],(int,float)): g[k] *= fR
    if isinstance(g.get("nacelleProfile"), list):     g["nacelleProfile"]   = [v*fR for v in g["nacelleProfile"]]
    if isinstance(g.get("nacelleFlatBottom"), list):  g["nacelleFlatBottom"]= [v*fR for v in g["nacelleFlatBottom"]]
    if isinstance(g.get("coreNozzle"), list):         g["coreNozzle"]       = [[x*fR, d*fR] for x,d in g["coreNozzle"]]
    eng_len = dim.get("engineLength")
    if eng_len:                                       # nacelle length measured -> exact
        nozzle = g["nacelleProfile"][-1] if isinstance(g.get("nacelleProfile"), list) else DEFAULT_NOZZLE
        g["engineLen"] = (eng_len * S) / nozzle
    # else: leave engineLen alone — it's a dimensionless multiplier on nacelleProfile,
    # which already carries the fR length scaling (scaling both double-shrinks the nacelle).

    # ---- gear: x = station, y = half-track, len = strut (vertical) ----
    for leg in gear.values():
        if isinstance(leg, dict):
            if "x" in leg: leg["x"] *= fX
            if "y" in leg: leg["y"] *= fR
            if "len" in leg: leg["len"] *= fR
            if "tireR" in leg: leg["tireR"] *= fR

    # ---- decal placement quads are model-space [x,y,z] (the SVG `d` paths are not) ----
    for dec in (j.get("livery", {}).get("decals") or []):
        if isinstance(dec.get("placement"), list):
            dec["placement"] = [scale_xyz(pt, fX, fR) for pt in dec["placement"]]

    # ---- set explicit fuselage radius so the default _r isn't used post-scale ----
    g["r"] = cur_r * fR
    j["geometry"] = g

    # ---- report resulting envelope vs real ----
    new_len = nose.get("tipX",0) - g.get("tailX",0)
    print(f"  after:  dia {g['r']*2*NM_MM/1000:.2f}m (real {dim['fuselageDiameter']/1000:.2f})"
          f"  len {new_len*NM_MM/1000:.2f}m (real {dim['length']/1000:.2f})"
          f"  half-span {wing.get('span',0)*NM_MM/1000:.2f}m")
    if "mainGearHalfTrack" in dim and "main" in gear:
        print(f"  gear half-track {gear['main'].get('y',0)*NM_MM/1000:.2f}m (real {dim['mainGearHalfTrack']/1000:.2f})"
              f"  strut {gear['main'].get('len',0)*NM_MM/1000:.2f}m (real {dim.get('mainGearStrutLength',0)/1000:.2f})")

    if write:
        json.dump(j, open(path,"w"), indent=2, ensure_ascii=False)
        print(f"  WROTE {os.path.relpath(path, ROOT)}")
    else:
        print("  (dry run — pass --write to apply)")

if __name__ == "__main__":
    main()
