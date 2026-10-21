/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/airframe.js
   The airframe geometry the physics needs, from the aircraft's
   `dimensions` (real measurements, mm — docs/architecture.md §3.4).

   Physics reads positions from here, never from the render geometry.
   Everything is in metres, measured aft of the nose tip (x) and to
   the right of the centreline (y); the arms are from the CG.

   The CG is nominal until weight and balance exists (issues.md
   "Weight and balance"): the share of the weight on the nose gear
   puts it that fraction of the wheelbase ahead of the main gear.
   ═══════════════════════════════════════════════════════════════ */

/** Typical static nose-gear share of an airliner (6–12 %) when the aircraft gives none. */
export const DEFAULT_NOSE_GEAR_SHARE = 0.08;

const m = (mm) => (typeof mm === 'number' ? mm / 1000 : null);

/** Nominal CG, m aft of the nose tip — or null without the gear stations. */
export function nominalCg(ac) {
  const d = ac?.dimensions;
  const nose = m(d?.noseTipToNoseGear), main = m(d?.noseTipToMainGear);
  if (nose === null || main === null || !(main > nose)) return null;
  const share = ac.balance?.noseGearLoadShare ?? DEFAULT_NOSE_GEAR_SHARE;
  return main - share * (main - nose);
}

/** Lateral engine positions, m right of the centreline, in engine order (ENG 1 = left) — or null. */
export function engineY(ac) {
  const n = ac?.engine?.count, y = m(ac?.dimensions?.engineCenterlineToAircraftCenterline);
  if (n === 2 && y !== null) return [-y, y];
  return null;                                   // four engines: inboard/outboard not measured yet
}

/** The vertical tail (fin + rudder as one trapezoid) — or null without its outline. */
export function vstab(ac) {
  const d = ac?.dimensions ?? {};
  const cr = m(d.vstabRootChord), ct = m(d.vstabTipChord), h = m(d.vstabHeight);
  const xr = m(d.noseTipToVstabRootLE), xt = m(d.noseTipToVstabTipLE);
  if ([cr, ct, h, xr, xt].includes(null)) return null;
  const taper = ct / cr;
  const area = (cr + ct) / 2 * h;
  const tanLE = (xt - xr) / h;
  /* mean aerodynamic chord of a trapezoid, and its height above the root */
  const mac = 2 / 3 * cr * (1 + taper + taper * taper) / (1 + taper);
  const macHeight = h / 3 * (1 + 2 * taper) / (1 + taper);
  const xQuarterMac = xr + macHeight * tanLE + mac / 4;
  const cg = nominalCg(ac);
  return {
    area, height: h, rootChord: cr, tipChord: ct, taper,
    sweepLE: Math.atan(tanLE), aspectRatio: h * h / area,
    mac, macHeight, xQuarterMac,
    arm: cg === null ? null : xQuarterMac - cg,  // CG → the tail's aerodynamic centre
    rudder: rudder(d, cr, ct, h, area),
  };
}

/* The rudder: hinged on the fin's trailing part, from the root up to its top edge. */
function rudder(d, cr, ct, h, finArea) {
  const rb = m(d.vstabRudderRootChord), rt = m(d.vstabRudderTopChord), rh = m(d.vstabRudderTopHeight) ?? h;
  if (rb === null || rt === null) return null;
  const finChordAtTop = cr + (ct - cr) * rh / h;
  const area = (rb + rt) / 2 * rh;
  return {
    area, height: rh,
    areaRatio: area / finArea,                     // rudder area / tail area
    chordRatio: { root: rb / cr, top: rt / finChordAtTop },
    spanRatio: rh / h,
  };
}
