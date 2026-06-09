/* ── Pushback path ───────────────────────────────────────────────────────────────
   Derived from the taxi route (the green line). A real pushback rolls BACKWARD the
   whole time (nose trailing) along a smooth curve from the stand onto the taxiway:

     1. straight back — out of the stand along the lead-in, heading held at the nose-in
                        attitude, until a tangent point before the junction;
     2. fillet arc    — a constant-radius arc tangent to both the lead-in and the taxiway
                        centreline; the main gear rolls through it while the heading eases
                        from nose-in to the taxi-out direction, ending on the centreline.

   We precompute the MAIN-GEAR path (the rear axle rolls; the nose is swung in an arc).
   Heading = path tangent + 180° (rolling backwards). The reference point S.lat/lon is the
   model origin, placed (wheelbase − nose station) ahead of the main gear along the heading,
   so the captured start matches mission-start's parked position (no jump). */

const DEG = Math.PI / 180;
const _m   = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos(a[0] * DEG));
const _brg = (a, b) => { const dN = b[0] - a[0], dE = (b[1] - a[1]) * Math.cos(a[0] * DEG);
                         return (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360; };
const _smooth = t => t * t * (3 - 2 * t);
const _lerpHdg = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };

const _ptAt = (pts, cum, d) => {
  d = Math.max(0, Math.min(cum[cum.length - 1], d));
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const segLen = (cum[i] - cum[i - 1]) || 1, f = Math.max(0, Math.min(1, (d - cum[i - 1]) / segLen));
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
          pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
};

const STEP     = 2;     // m: main-gear path sampling resolution
const TURN_DEV = 25;    // deg: route bearing change that marks the lead-in → taxiway junction
const R_MAX    = 42;    // m: max main-gear turn radius (bigger ⇒ the turn starts earlier, sweeps wider)

export function capturePushback(taxiRoute, lat, lon, hdg, wheelbaseM = 15, noseFwdM = 0) {
  const L = wheelbaseM, off = L - noseFwdM;               // main gear → model-origin offset (along heading)
  const mg = [], mgh = [];                                // main-gear points + heading at each
  const cl0 = Math.cos(lat * DEG);
  const back0 = (hdg + 180) % 360;
  const _push = (lat_, lon_, h) => { mg.push([lat_, lon_]); mgh.push((h + 360) % 360); };

  const pts = taxiRoute?.pts;
  if (!pts || pts.length < 2) {                           // no route → straight back ~35 m, no turn
    const M = [lat - off * Math.cos(hdg * DEG) / 111320, lon - off * Math.sin(hdg * DEG) / (111320 * cl0)];
    for (let d = 0; d <= 35; d += STEP)
      _push(M[0] + d * Math.cos(back0 * DEG) / 111320, M[1] + d * Math.sin(back0 * DEG) / (111320 * cl0), hdg);
    const cum = [0]; for (let i = 1; i < mg.length; i++) cum.push(cum[i - 1] + _m(mg[i - 1], mg[i]));
    return { off, mg, mgh, cum, len: cum[cum.length - 1] };
  }

  const cum0 = [0];
  for (let i = 1; i < pts.length; i++) cum0.push(cum0[i - 1] + _m(pts[i - 1], pts[i]));
  let J = pts.length - 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const dev = Math.abs(((_brg(pts[i], pts[i + 1]) - back0 + 540) % 360) - 180);
    if (dev > TURN_DEV) { J = i; break; }
  }
  const backDist = cum0[J];
  let k = J; while (k < pts.length - 1 && cum0[k] - cum0[J] < 20) k++;
  const taxiHdg = _brg(pts[J], pts[Math.min(k + 1, pts.length - 1)]);

  const dlt  = ((taxiHdg - hdg + 540) % 360) - 180;        // signed turn angle
  const half = Math.max(0.05, Math.tan(Math.abs(dlt) / 2 * DEG));
  const T    = Math.min(R_MAX * half, backDist * 0.55);    // tangent length — turn starts T before the junction
  const R    = T / half;

  // Phase 1: main gear straight back along the lead-in to the tangent point (nose to backDist − L − T)
  const pushNose = Math.max(STEP, backDist - L - T);
  for (let d = 0; d <= pushNose; d += STEP) {
    const np = _ptAt(pts, cum0, d);
    _push(np[0] - L * Math.cos(hdg * DEG) / 111320, np[1] - L * Math.sin(hdg * DEG) / (111320 * Math.cos(np[0] * DEG)), hdg);
  }

  // Phase 2: fillet arc — rotate the path tangent back0 → taxiHdg+180; heading = tangent + 180
  let pos = [mg[mg.length - 1][0], mg[mg.length - 1][1]];
  const n = Math.max(1, Math.ceil(R * Math.abs(dlt) * DEG / STEP));
  for (let i = 1; i <= n; i++) {
    const tMid = back0 + dlt * ((i - 0.5) / n), tEnd = back0 + dlt * (i / n);
    const cl = Math.cos(pos[0] * DEG);
    pos = [pos[0] + STEP * Math.cos(tMid * DEG) / 111320, pos[1] + STEP * Math.sin(tMid * DEG) / (111320 * cl)];
    _push(pos[0], pos[1], tEnd + 180);
  }
  // settle: a few metres straight back along the taxiway centreline
  const db = (taxiHdg + 180) % 360;
  for (let s = STEP; s <= 8; s += STEP) {
    const cl = Math.cos(pos[0] * DEG);
    pos = [pos[0] + STEP * Math.cos(db * DEG) / 111320, pos[1] + STEP * Math.sin(db * DEG) / (111320 * cl)];
    _push(pos[0], pos[1], taxiHdg);
  }

  const cum = [0]; for (let i = 1; i < mg.length; i++) cum.push(cum[i - 1] + _m(mg[i - 1], mg[i]));
  return { off, mg, mgh, cum, len: cum[cum.length - 1] };
}

export function pushbackPose(path, p) {
  const { off, mg, mgh, cum, len } = path;
  const d = len * _smooth(p);
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const segLen = (cum[i] - cum[i - 1]) || 1, f = Math.max(0, Math.min(1, (d - cum[i - 1]) / segLen));
  const M0 = mg[i - 1], M1 = mg[i];
  const M = [M0[0] + (M1[0] - M0[0]) * f, M0[1] + (M1[1] - M0[1]) * f];
  const hdg = _lerpHdg(mgh[i - 1], mgh[i], f);

  // nose-wheel aim: heading a short way ahead → centred on the straight leg, deflected through the turn
  let j = i; while (j < cum.length - 1 && cum[j] - d < 8) j++;
  const hdgT = mgh[Math.min(j, mgh.length - 1)];

  const cl = Math.cos(M[0] * DEG);                         // model origin = main gear + (wheelbase − nose station)
  return { lat: M[0] + off * Math.cos(hdg * DEG) / 111320,
           lon: M[1] + off * Math.sin(hdg * DEG) / (111320 * cl), hdg, hdgT };
}

/* ── Tug path ── the tow tug as a two-link trailer towed by the nose gear:
     link 1 = the tow bar (hinged at the nose gear and at the tug hitch),
     link 2 = the tug body (rolls on its wheels — no skid).
   Each link's heading chases the point ahead of it (standard trailer kinematics),
   so the tug cuts its own arc and the bar articulates at both ends. Returns, per
   aircraft-path vertex: the nose-gear point N, the tug hitch H, and the tug heading. */
const _offM = (lat, lon, hdgDeg, dist) => {
  const c = Math.cos(lat * DEG);
  return [lat + dist * Math.cos(hdgDeg * DEG) / 111320, lon + dist * Math.sin(hdgDeg * DEG) / (111320 * c)];
};
const _chase = (ang, target, lead, ds) => {              // integrate a tongue angle chasing `target`
  const diff = ((target - ang + 540) % 360) - 180;
  return ang + (Math.sin(diff * DEG) / lead * ds) * (180 / Math.PI);
};

export function computeTugPath(path, noseFwdM, barLen, tugTongue) {
  const { mg, mgh, off, cum } = path;
  const N = mg.map((m, i) => _offM(m[0], m[1], mgh[i], off + noseFwdM));   // nose-gear path
  const H = new Array(N.length), TH = new Array(N.length);
  let psi = (mgh[0] + 180) % 360, th = (mgh[0] + 180) % 360;               // bar / tug tongue angles
  H[0] = _offM(N[0][0], N[0][1], psi, -barLen); TH[0] = th;
  for (let i = 1; i < N.length; i++) {
    const dsN = _m(N[i-1], N[i]); if (dsN > 1e-4) psi = _chase(psi, _brg(N[i-1], N[i]), barLen, dsN);
    H[i] = _offM(N[i][0], N[i][1], psi, -barLen);
    const dsH = _m(H[i-1], H[i]); if (dsH > 1e-4) th = _chase(th, _brg(H[i-1], H[i]), tugTongue, dsH);
    TH[i] = th;
  }
  return { N, H, hdg: TH, cum };                          // tug render forward = hdg + 180
}

export const pushbackDist = (path, p) => path.len * _smooth(p);   // aircraft-arc distance at progress p

export function tugPose(tp, d) {                          // interpolate the tug path at aircraft-arc distance d
  const { N, H, hdg, cum } = tp;
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const f = Math.max(0, Math.min(1, (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
  const lerp = (a, b) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return { N: lerp(N[i-1], N[i]), H: lerp(H[i-1], H[i]), hdg: _lerpHdg(hdg[i-1], hdg[i], f) };
}
