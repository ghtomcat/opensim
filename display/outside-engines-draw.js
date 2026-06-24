/* Engine face draw helpers — nacelle intake lip + black strip, turbofan fan
   disk (with module-local spin state), perspective fan ellipse fit, and the
   thrust-reverser / chevron overlays. Extracted from outside.js. */
import { S } from '../core/state.js';
import { _r, _ey, _ez, _er, _WB_WING_DEFAULT } from './outside-wb.js';
import { _m15ir } from './outside-mig15.js';

/* ── Nacelle inlet lip ring — polished metal leading edge at intake face ─────
   Drawn as a thick silver stroke at the outer rim of the fan face projection.
   Uses the same hub/rim as the fan disk so it's always co-centred with the fan. */
export function _drawIntakeLip(ctx, hubPt, rimPt, dpr, foreshorten = 1, fsAngle = 0) {
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  ctx.save();
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));   // ellipse off-axis, sliver edge-on
  ctx.strokeStyle = 'rgba(218, 224, 232, 0.90)';
  ctx.lineWidth = Math.max(2.5, r * 0.11);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* Black strip just inside the intake lip — the dark annular band between
   the silver lip and the fan blade area visible on real turbofan engines. */
export function _drawIntakeBlackStrip(ctx, hubPt, rimPt, dpr, foreshorten = 1, fsAngle = 0) {
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const stripW = Math.max(1.5, r * 0.13);
  const rInner = r - stripW * 0.5;
  ctx.save();
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.88)';
  ctx.lineWidth = stripW;
  ctx.beginPath();
  ctx.arc(0, 0, rInner, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ── Generic turbofan fan-face renderer (screen-space) ───────────────────────
   hubPt  projected center of fan disk  {x, y, d}
   rimPt  projected rim vertex (sets disk radius in pixels)
   power  enginePower 0→1 (0=static blades, <0.30=slow, ≥0.30=blur disk)
   nBlades  fan blade count (22 typical CFM56 / LEAP)                        */
let _fanAngle = 0;

/* Advance fan rotation angle — capped so it doesn't spin during static frames */
export function advanceFanAngle() {
  _fanAngle = (_fanAngle + ((S.engineState === 'off' || S.engineState === 'shutdown')
                ? 0 : Math.min(0.06, (S.enginePower ?? 0) * 0.35))) % (Math.PI * 2);
}

export function _drawTurbofanFace(ctx, hubPt, rimPt, power, dpr, nBlades = 22, foreshorten = 1, fsAngle = 0) {
  if (!hubPt || !rimPt) return;
  const r = Math.hypot(rimPt.x - hubPt.x, rimPt.y - hubPt.y);
  if (r < 3) return;
  const hubR = r * 0.28, tipR = r * 0.94;
  ctx.save();
  /* Draw the disk in an origin-centred frame, then squash it along the engine
     axis so the fan reads as a foreshortened ellipse from oblique views (and
     collapses to a sliver edge-on) rather than a billboard always facing us. */
  ctx.translate(hubPt.x, hubPt.y);
  ctx.rotate(fsAngle);
  ctx.scale(1, Math.max(0.04, foreshorten));

  if (power < 0.05) {
    /* Static — N tapered blade quads */
    ctx.fillStyle = 'rgba(96,110,126,0.92)';
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.085, aR = a + 0.085;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(aL), hubR * Math.sin(aL));
      ctx.lineTo(tipR * Math.cos(aL - 0.10), tipR * Math.sin(aL - 0.10));
      ctx.lineTo(tipR * Math.cos(aR - 0.14), tipR * Math.sin(aR - 0.14));
      ctx.lineTo(hubR * Math.cos(aR), hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
  } else if (power < 0.30) {
    /* Slow rotation — blades + translucent blur overlay */
    const t     = power / 0.30;
    const alpha = (0.72 - t * 0.48).toFixed(2);
    ctx.fillStyle = `rgba(90,104,120,${alpha})`;
    for (let i = 0; i < nBlades; i++) {
      const a  = _fanAngle + i / nBlades * Math.PI * 2;
      const aL = a - 0.10, aR = a + 0.10;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(aL), hubR * Math.sin(aL));
      ctx.lineTo(tipR * Math.cos(aL - 0.12), tipR * Math.sin(aL - 0.12));
      ctx.lineTo(tipR * Math.cos(aR - 0.16), tipR * Math.sin(aR - 0.16));
      ctx.lineTo(hubR * Math.cos(aR), hubR * Math.sin(aR));
      ctx.closePath(); ctx.fill();
    }
    /* Blur wash */
    const bGrad = ctx.createRadialGradient(0, 0, hubR, 0, 0, tipR);
    bGrad.addColorStop(0, `rgba(138,152,168,${(t * 0.32).toFixed(2)})`);
    bGrad.addColorStop(1, `rgba(78,90,106,${(t * 0.20).toFixed(2)})`);
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(0, 0, tipR, 0, Math.PI*2); ctx.fill();
  } else {
    /* Running — solid blur disk + faint streaks */
    const bGrad = ctx.createRadialGradient(0, 0, hubR, 0, 0, tipR);
    bGrad.addColorStop(0,   'rgba(152,165,180,0.58)');
    bGrad.addColorStop(0.5, 'rgba(112,124,140,0.44)');
    bGrad.addColorStop(1,   'rgba(72,84,100,0.32)');
    ctx.fillStyle = bGrad; ctx.beginPath(); ctx.arc(0, 0, tipR, 0, Math.PI*2); ctx.fill();
    /* Radial streaks */
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = 'rgba(210,222,235,1)';
    ctx.lineWidth   = Math.max(0.5, dpr * 0.4);
    for (let i = 0; i < 9; i++) {
      const a = _fanAngle + i / 9 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(hubR * Math.cos(a), hubR * Math.sin(a));
      ctx.lineTo(tipR * Math.cos(a), tipR * Math.sin(a));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* Spinner cone — radial highlight reads as a 3-D nose cone, plus the spinning
     warning swirl you see on turbofan spinners (rotates with the fan). */
  const _spG = ctx.createRadialGradient(-hubR*0.32, -hubR*0.32, hubR*0.08, 0, 0, hubR);
  _spG.addColorStop(0, 'rgba(120,128,140,0.98)');
  _spG.addColorStop(1, 'rgba(36,42,54,0.98)');
  ctx.fillStyle = _spG;
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(232,236,242,0.80)';
  ctx.lineWidth   = Math.max(0.5, dpr * 0.45);
  ctx.beginPath();
  for (let t = 0; t <= 1.001; t += 0.06) {
    const a = _fanAngle + t * Math.PI * 2.2, rr = hubR * 0.88 * t;
    const x = rr * Math.cos(a), y = rr * Math.sin(a);
    t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  /* Outer cowl ring */
  ctx.strokeStyle = 'rgba(158,172,188,0.78)';
  ctx.lineWidth   = Math.max(0.8, dpr * 0.7);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();

  ctx.restore();
}

/* Fit an ellipse to a circular ring's projected vertices (perspective image of
   a circle ≈ ellipse). Returns centroid, major/minor screen radii and the
   major-axis angle — used to draw the recessed fan foreshortened. */
export function _fanEllipse(ringPts) {
  let cx = 0, cy = 0;
  for (const p of ringPts) { cx += p.x; cy += p.y; }
  cx /= ringPts.length; cy /= ringPts.length;
  let majorR = 0, angle = 0, minorR = Infinity;
  for (const p of ringPts) {
    const dx = p.x - cx, dy = p.y - cy, rr = Math.hypot(dx, dy);
    if (rr > majorR) { majorR = rr; angle = Math.atan2(dy, dx); }
    if (rr < minorR) minorR = rr;
  }
  return { cx, cy, majorR, minorR, angle };
}

/* ── Engine overlays: thrust-reverser cascade + nozzle chevrons ── */
export function _engineOverlays(pts, faces, acEng, _b = 162) {
  const trOn  = !!(S.thrustReverser);
  const chev  = !!(acEng?.chevrons);

  /* R/L nozzle exit rings and TR zone ring indices (b-relative: R TR_fwd=b+36, TR_aft=b+44, noz=b+52) */
  const engines = [
    { trFwd: _b+36, trAft: _b+44, noz: _b+52, sign:  1 },  // R engine
    { trFwd: _b+76, trAft: _b+84, noz: _b+92, sign: -1 },  // L engine
  ];

  for (const { trFwd, trAft, noz, sign } of engines) {
    /* Collect projected ring points — bail if any missing */
    const pFwd  = Array.from({length: 8}, (_, i) => pts[trFwd + i]);
    const pAft  = Array.from({length: 8}, (_, i) => pts[trAft + i]);
    const pNoz  = Array.from({length: 8}, (_, i) => pts[noz   + i]);
    if (pFwd.some(p => !p) || pAft.some(p => !p) || pNoz.some(p => !p)) continue;

    /* Thrust-reverser cascade: replace C→D faces with lighter cascade panels */
    if (trOn) {
      const cascadeCol = [130, 120, 110];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const ps = [pFwd[i], pFwd[j], pAft[j], pAft[i]];
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: 0.85, avgD: avgD + 0.0001, col: cascadeCol });
      }
      /* Blocker door: partial cap at nozzle exit (blocks ~40% of flow) */
      const nozPts = pNoz.filter(Boolean);
      if (nozPts.length >= 3) {
        const cx = nozPts.reduce((s, p) => s + p.x, 0) / nozPts.length;
        const cy = nozPts.reduce((s, p) => s + p.y, 0) / nozPts.length;
        const avgD = nozPts.reduce((s, p) => s + p.d, 0) / nozPts.length;
        for (let i = 0; i < 4; i++) {
          const a = i * 2, c = (i * 2 + 2) % 8;   // every other nozzle point; wrap 8→0 (was (i+1)%8*2 → pNoz[8] = undefined)
          const half = { x: cx, y: cy, d: avgD };
          faces.push({ ps: [pNoz[a], pNoz[c], half], br: 0.6, avgD: avgD + 0.0002, col: cascadeCol });
        }
      }
    }

    /* Chevron tabs at nozzle exit — each tab is a triangle pointing inward */
    if (chev) {
      const chevCol = [30, 32, 38];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        const pA = pNoz[i], pB = pNoz[j];
        /* Tip: midpoint pushed slightly toward engine center (inward) */
        const mx = (pA.x + pB.x) * 0.5, my = (pA.y + pB.y) * 0.5;
        /* Engine center in screen is midpoint of all nozzle pts */
        const ex = pNoz.reduce((s, p) => s + p.x, 0) / 8;
        const ey = pNoz.reduce((s, p) => s + p.y, 0) / 8;
        const tip = { x: mx + (ex - mx) * 0.28, y: my + (ey - my) * 0.28, d: (pA.d + pB.d) * 0.5 };
        const avgD = (pA.d + pB.d + tip.d) / 3;
        faces.push({ ps: [pA, pB, tip], br: 0.55, avgD: avgD + 0.00005, col: chevCol });
      }
    }
  }
}


const DEG = Math.PI / 180;

/* ── Outer-engine station math (4-engine WB, ey2 defined) ────────────────────
   X offset and Z height of the outboard nacelle pair, derived by walking the
   wing LE sweep and Z-centre from the inner to the outer span station.
   Shared by the pylon pass and the fan-face pass. */
function _outerEngineStation(_wbGeo) {
  const _oey2 = _wbGeo?.ey2;
  /* Pre-compute outer engine X offset: base exOff + LE sweep delta from inner to outer span station.
     Pre-compute outer engine Z: same approach — walk wing Z-centre at both span stations.
     Both values are shared by the nacelle AND fan-face sections below. */
  const _oXOffForOuter = (() => {
    if (!_oey2 || !_wbGeo) return _wbGeo?.exOff ?? 0;
    const base   = _wbGeo.exOff ?? 0;
    const _oWD2  = _wbGeo.wing ?? _WB_WING_DEFAULT;       // actual wing, not the generic default
    const _oEyI2 = _wbGeo.ey ?? _ey;
    const _oR2   = _wbGeo.r ?? _r;
    const _oDen  = Math.max((_oWD2.span ?? 0.0267) - _oR2 * 0.7071, 1e-9);
    return base + (_oey2 - _oEyI2) / _oDen * ((_oWD2.tipLE ?? -0.015) - (_oWD2.rootLE ?? 0));
  })();
  const _oEzForOuter = (() => {
    if (!_oey2 || !_wbGeo) return _wbGeo?.ez ?? _ez;
    const _oWD  = _wbGeo.wing ?? _WB_WING_DEFAULT;        // actual wing, not the generic default
    const _oR   = _wbGeo.r  ?? _r;
    const _oWR  = _oR * 0.7071;
    const _oSpn = _oWD.span ?? 0.0267;
    const _oFB  = _oWD.flapBreak ?? 0.58;
    const _oWH  = _oWR + (_oSpn - _oWR) * _oFB;
    const _oDih = _oWD.dihedral ?? 0;
    const _oSh  = _wbGeo.wzShift ?? 0;                    // wing vertical shift (wing.rootZ)
    const _oWzR = -_oWR + _oSh;
    const _oWzB = -_oWR + _oFB * (_oDih + _oWR) + _oSh;
    const _oWzT = _oDih + _oSh;
    const wCz   = (y) => y <= _oWH
      ? _oWzR + (y - _oWR) / Math.max(_oWH - _oWR, 1e-9) * (_oWzB - _oWzR)
      : _oWzB + (y - _oWH) / Math.max(_oSpn - _oWH, 1e-9) * (_oWzT - _oWzB);
    const _oEzI = _wbGeo.ez ?? _ez;
    const _oEyI = _wbGeo.ey ?? _ey;
    return wCz(_oey2) + (_oEzI - wCz(_oEyI));
  })();
  return { oey2: _oey2, xOff: _oXOffForOuter, ez: _oEzForOuter };
}

/* ── Engine pylons + TR/chevron overlays — pre-painter, pushes into rc.faces ── */
export function drawEnginePylons(rc) {
  const { pts, faces, b: _b, wbGeo: _wbGeo, wingView, project, COL_,
          isRocket, isC172, isPP, isBf109, isF4U, isMig15 } = rc;
  /* Engine overlays: thrust-reverser cascade + chevrons */
  if (!isRocket && !isC172 && !isPP && !isBf109 && !isF4U && !isMig15) _engineOverlays(pts, faces, S.aircraft?.engine, _b);

  /* Outer-engine cowls are now built into the wireframe geometry (the 16-vert nacelle
     skin in outside-wb.js loops over all four engines), so they render identically to the
     inboard pair via the main painter. The station math above (_oXOffForOuter /
     _oEzForOuter) is kept — the pylons + outer fan-face still reference it. */
  const { oey2: _oey2, xOff: _oXOffForOuter, ez: _oEzForOuter } = _outerEngineStation(_wbGeo);
  /* ── Engine pylons — parametric streamlined struts (all 4 engines) ───────────
     Bottom edge saddles onto the nacelle top (ez + nacelle radius along the chord),
     top edge fairs into the wing underside; forward of the wing LE the strut tapers
     down to a nose on the cowl. Thin thickness in y. Debug-blue for now. */
  if (_wbGeo && !wingView) {
    const _pR   = _wbGeo.r ?? _r;
    const _pWR  = _pR * 0.7071;
    const _pW   = _wbGeo.wing ?? _WB_WING_DEFAULT;
    const _pSh  = _wbGeo.wzShift ?? 0;
    const _pSpn = _pW.span ?? 0.0267, _pFB = _pW.flapBreak ?? 0.58, _pDih = _pW.dihedral ?? 0;
    const _pWH  = _pWR + (_pSpn - _pWR) * _pFB;
    const _pZ0  = -_pWR + _pSh, _pZB = -_pWR + _pFB*(_pDih+_pWR) + _pSh, _pZT = _pDih + _pSh;
    const _wingLowZ = (y) => { const a = Math.abs(y);
      return a <= _pWH ? _pZ0 + (a-_pWR)/Math.max(_pWH-_pWR,1e-9)*(_pZB-_pZ0)
                       : _pZB + (a-_pWH)/Math.max(_pSpn-_pWH,1e-9)*(_pZT-_pZB); };
    const _wingLE = (y) => { const ts = Math.abs(y) / Math.max(_pSpn,1e-9);
      return (_pW.rootLE ?? 0) + ((_pW.tipLE ?? -0.015) - (_pW.rootLE ?? 0)) * ts; };
    const _wingTE = (y) => { const ts = Math.abs(y) / Math.max(_pSpn,1e-9);
      return (_pW.rootTE ?? -0.009) + ((_pW.tipTE ?? -0.019) - (_pW.rootTE ?? -0.009)) * ts; };

    const _pushTri = (a,b,c,col) => {
      if (!a||!b||!c) return;
      const cr = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      if (cr < 0) return;
      faces.push({ ps:[a,b,c], br:0.66, avgD:(a.d+b.d+c.d)/3, col });
    };
    const _pushQuad = (a,b,c,d,col) => { _pushTri(a,b,c,col); _pushTri(a,c,d,col); };

    // engine configs: inner (ey) + outer (ey2 if present)
    const _engs = [{
      ey: _wbGeo.ey ?? _ey, ez: _wbGeo.ez ?? _ez, er: _wbGeo.er ?? _er, efr: _wbGeo.efr ?? (_wbGeo.er ?? _er)*1.2,
      eA: _wbGeo.eApos, eB: _wbGeo.eBpos, eC: _wbGeo.eCpos, eE: _wbGeo.eEpos, cn: _wbGeo.coreNozzle,
    }];
    if (_oey2) _engs.push({
      ey: _oey2, ez: _oEzForOuter, er: _wbGeo.er ?? _er, efr: (_wbGeo.er ?? _er)*1.2,
      eA: 0.005 + _oXOffForOuter, eB: 0.001 + _oXOffForOuter, eC: -0.001 + _oXOffForOuter, eE: -0.003 + _oXOffForOuter,
    });
    const _ilerp = (x,x0,y0,x1,y1) => y0 + (x-x0)/((x1-x0)||1e-9)*(y1-y0);

    for (const e of _engs) {
      if (e.eA == null || e.eB == null || e.eC == null || e.eE == null) continue;
      const halfT = e.er * 0.22, M = 10;
      // nacelle radius along x: intake→fan bulge (efr@eB) → core (er@eC) → core aft
      const nacR = (x) => x >= e.eB ? _ilerp(x, e.eA, e.er, e.eB, e.efr)
                        : x >= e.eC ? _ilerp(x, e.eB, e.efr, e.eC, e.er) : e.er;
      for (const sgn of [1, -1]) {
        const yc = sgn * e.ey, wz = _wingLowZ(yc), le = _wingLE(yc), te = _wingTE(yc);
        const xFwd = le + 0.75 * (e.eA - le);      // nose: forward 75% of the engine's forward section
        const xAft = te;                            // covers the whole wing chord, out to the TE
        const noseZ = e.ez + nacR(xFwd);
        // top edge: wing underside under the wing (x ≤ LE), tapering down to the nose forward of it
        const topZ = (x) => x <= le ? wz : _ilerp(x, le, wz, xFwd, noseZ);
        // bottom edge: rides the fan cowl top, drops onto the silver core-nozzle section 1 and rides
        // it, then fairs up to the wing TE aft of section 1. (No core nozzle → cowl saddle + fair-up.)
        const _cn = e.cn;
        const s1x1 = _cn ? e.eA - _cn[1][0] : e.eE;            // section 1 aft end (silver)
        const coreR1 = (x) => _ilerp(x, e.eE, _cn[0][1], s1x1, _cn[1][1]);   // section 1 top radius
        const botZ = (x) =>
            x >= e.eE       ? e.ez + nacR(x)                                      // fan cowl top
          : _cn && x >= s1x1 ? e.ez + coreR1(x)                                   // section 1 top
          :                   _ilerp(x, s1x1, e.ez + (_cn ? coreR1(s1x1) : nacR(e.eE)), te, wz);  // → wing TE
        const bN=[], bF=[], tN=[], tF=[];
        for (let i=0;i<=M;i++){
          const x = xFwd + (xAft - xFwd)*i/M;
          const zb = botZ(x), zt = topZ(x);
          bN.push(project([x, yc-halfT, zb])); bF.push(project([x, yc+halfT, zb]));
          tN.push(project([x, yc-halfT, zt])); tF.push(project([x, yc+halfT, zt]));
        }
        const col = COL_[0];
        for (let i=0;i<M;i++){
          _pushQuad(bN[i], tN[i], tN[i+1], bN[i+1], col);   // near side
          _pushQuad(bF[i], bF[i+1], tF[i+1], tF[i], col);   // far side
          _pushQuad(tN[i], tF[i], tF[i+1], tN[i+1], col);   // top (wing fair)
          _pushQuad(bN[i], bN[i+1], bF[i+1], bF[i], col);   // bottom (nacelle saddle)
        }
        _pushQuad(bN[0], bF[0], tF[0], tN[0], col);         // front nose cap
        _pushQuad(bN[M], tN[M], tF[M], bF[M], col);         // aft face (at wing LE)
      }
    }
  }
}

/* ── Flap-track fairings — 3D teardrop pods, pre-painter ── */
export function drawFlapTrackFairings(rc) {
  const { ctx, faces, project, COL_, wbGeo: _wbGeo } = rc;
  /* Flap track fairings — 3D teardrop pods, depth-sorted with fuselage */
  if (_wbGeo && (S.aircraft?.flapTracks ?? 0) > 0) {
    const _ftN   = S.aircraft.flapTracks;
    const _ftPS  = Math.round(_ftN / 2);
    /* Use the aircraft's actual wing (same source the wing surface is built from)
       so the pods sit on the real trailing edge — _wbGeo doesn't carry .wing, so
       the old _wbGeo.wing silently fell back to the generic default. */
    const _ftwg  = S.aircraft?.wing ?? _wbGeo.wing ?? _WB_WING_DEFAULT;
    const _ftSpan = _ftwg.span;
    const _ftFB   = _ftwg.flapBreak ?? 0.72;
    const _ftFH   = _ftwg.flapHinge ?? 0.70;
    const _ftRootY = _wbGeo.r;
    const _ftBrkY  = _ftSpan * _ftFB;
    /* Pod dimensions — width and depth relative to fuselage radius */
    const ftW = _wbGeo.r * 0.26;    // half-width of pod at widest point
    const ftD = _wbGeo.r * 0.24;    // max depth below wing lower surface
    /* Correct wing lower surface Z — linear interpolation root→break→tip */
    const ftWR   = _wbGeo.r * 0.7071;
    const _ftSh  = (_ftwg.rootZ ?? -ftWR) + ftWR;   // wing vertical shift (wing.rootZ)
    const ftzR   = -ftWR + _ftSh;
    const ftzB   = -ftWR + _ftFB * (_ftwg.dihedral + ftWR) + _ftSh;
    const ftzT   = _ftwg.dihedral + _ftSh;
    const wLowerZ = (yAbs) => {
      if (yAbs <= _ftBrkY)
        return ftzR + (yAbs - ftWR) / Math.max(_ftBrkY - ftWR, 1e-9) * (ftzB - ftzR);
      return ftzB + (yAbs - _ftBrkY) / Math.max(_ftSpan - _ftBrkY, 1e-9) * (ftzT - ftzB);
    };

    for (const side of [1, -1]) {
      for (let ti = 0; ti < _ftPS; ti++) {
        const t     = (ti + 0.5) / _ftPS;
        const fY    = side * (_ftRootY + (_ftBrkY - _ftRootY) * t);
        const yAbs  = Math.abs(fY);
        const ts2   = yAbs / _ftSpan;
        const fxLE  = _ftwg.rootLE + (_ftwg.tipLE - _ftwg.rootLE) * ts2;
        const fxTE  = _ftwg.rootTE + (_ftwg.tipTE - _ftwg.rootTE) * ts2;
        const fChord = fxLE - fxTE;
        const fxH   = fxLE - fChord * _ftFH;          // hinge — never moves
        const fZtop  = wLowerZ(yAbs);                  // wing lower surface z at this station
        /* Spine runs forward→aft.  TE is at fxH - fChord*(1-_ftFH) = fxH - 0.30·fChord.
           Hinge (fxH) is the aft end of the fixed fairing and the pivot for the movable can. */
        const fxFwdTip = fxH + fChord * 0.22;  // deep into wing structure (22% fwd of hinge)
        const fxBelly  = fxH + fChord * 0.03;  // belly/max-depth just ahead of hinge
        const fxAft1   = fxH - fChord * 0.12;  // aft body — folds with flap
        const fxAft2   = fxH - fChord * 0.33;  // aft tip  — 3% past TE (folds)

        /* Spine: monotonically forward→aft; hinge is back of fixed section */
        const spine = [
          { x: fxFwdTip, zt: fZtop, dp: ftD*0.05, hw: 0,          fixed: true  },  // fwd tip (into wing)
          { x: fxBelly,  zt: fZtop, dp: ftD,       hw: ftW,        fixed: true  },  // belly max
          { x: fxH,      zt: fZtop, dp: ftD*0.80,  hw: ftW*0.88,   fixed: true  },  // hinge — back of fixed
          { x: fxAft1,   zt: fZtop, dp: ftD*0.42,  hw: ftW*0.46,   fixed: false },  // aft body — folds
          { x: fxAft2,   zt: fZtop, dp: ftD*0.05,  hw: 0,          fixed: false },  // aft tip
        ];

        /* Flap fold angle + Fowler aft-slide for aft fairing section */
        const _ftFa     = (S.flaps ?? 0) * 15 * DEG;
        const _cosFa    = Math.cos(_ftFa), _sinFa = Math.sin(_ftFa);
        const _ftFowler = _ftFa * fChord * (1 - _ftFH) * 1.5;  // matches flap anim fowlerShift

        /* Cross-section at each station: TL, TR, BL, BR
           Aft (non-fixed) points rotate + Fowler-slide to match flap motion */
        const csAt = ({ x, zt, dp, hw, fixed }) => {
          let x0 = x, zt0 = zt, ztB = zt - dp;
          if (!fixed && _ftFa > 0) {
            const dx = x - fxH;
            x0  = fxH + dx * _cosFa - _ftFowler;  // rotate + aft slide
            zt0 = fZtop + dx * _sinFa;
            ztB = fZtop + dx * _sinFa - dp * _cosFa;
          }
          return [
            project([x0, fY + hw,      zt0]),   // TL
            project([x0, fY - hw,      zt0]),   // TR
            project([x0, fY + hw*0.26, ztB]),   // BL
            project([x0, fY - hw*0.26, ztB]),   // BR
          ];
        };

        const cs = spine.map(csAt);

        for (let si = 0; si < spine.length - 1; si++) {
          const A = cs[si], B = cs[si + 1];
          /* 4 lateral face quads per segment */
          const quads = [
            [A[0], A[1], B[1], B[0]],   // top   (flush with wing)
            [A[0], A[2], B[2], B[0]],   // +Y side
            [A[2], A[3], B[3], B[2]],   // belly (most visible)
            [A[1], A[3], B[3], B[1]],   // -Y side
          ];
          for (const q of quads) {
            if (q.some(p => !p)) continue;
            const avgD = (q[0].d + q[1].d + q[2].d + q[3].d) / 4;
            faces.push({ avgD, draw: () => {
              ctx.beginPath();
              ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y);
              ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y);
              ctx.closePath();
              ctx.fillStyle = COL_[0]; ctx.fill();
              ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.stroke();
            }});
          }
        }
      }
    }
  }
}

/* ── Cowl air intake (prop planes) — pre-painter ── */
export function drawCowlIntake(rc) {
  const { ctx, pts, faces, isPP, ppGeo: _ppGeo } = rc;
  /* Cowl air intake — black oval at the spinner face plane */
  if (isPP && _ppGeo?.cabinVerts?.intakeCtr != null) {
    const cv = _ppGeo.cabinVerts;
    const pCtr = pts[cv.intakeCtr], pPY = pts[cv.intakeCtr + 1], pPZ = pts[cv.intakeCtr + 2];
    if (pCtr && pPY && pPZ) {
      faces.push({ avgD: pCtr.d, draw: () => {
        const dyx = pPY.x - pCtr.x, dyy = pPY.y - pCtr.y;
        const dzx = pPZ.x - pCtr.x, dzy = pPZ.y - pCtr.y;
        ctx.save(); ctx.beginPath();
        for (let i = 0; i <= 32; i++) {
          const θ = i * Math.PI * 2 / 32;
          const px = pCtr.x + dyx * Math.cos(θ) + dzx * Math.sin(θ);
          const py = pCtr.y + dyy * Math.cos(θ) + dzy * Math.sin(θ);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(10,12,16,0.97)'; ctx.fill();
        ctx.restore();
      }});
    }
  }
}

/* ── Prop disk — static blades / blur disk; post-painter.
   propAngle is per-frame spin state owned by outside.js. */
export function drawPropDisk(rc, _propAngle) {
  const { ctx, pts, reg: _reg, ppGeo: _ppGeo, isPP } = rc;
  /* Prop — static blades (engine off) or blur disk (engine running).
     Hub/tip/ztip anchors come from the geometry module. */
  const _propAnchors = _reg?.prop ?? _ppGeo?.prop ?? null;
  if (_propAnchors) {
    const p0    = pts[_propAnchors.hub];
    const pTip  = pts[_propAnchors.tip];
    const pZtip = _propAnchors.ztip != null ? pts[_propAnchors.ztip] : null;
    if (p0 && pTip) {
      const r = Math.hypot(pTip.x - p0.x, pTip.y - p0.y);
      if (r > 2) {
        const ePow    = S.enginePower ?? 0;
        const running = S.engineState === 'running' || S.engineState === 'starting';
        const blur    = running && ePow >= 0.3;

        // Y and Z axes of the prop disk in screen space, scaled by r
        const dyx = pTip.x - p0.x, dyy = pTip.y - p0.y;
        const dzx = pZtip ? pZtip.x - p0.x : -dyy;
        const dzy = pZtip ? pZtip.y - p0.y :  dyx;

        ctx.save();
        if (blur) {
          ctx.fillStyle   = 'rgba(200,210,220,0.22)';
          ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(200,215,225,0.70)';
          ctx.lineWidth   = Math.max(1, devicePixelRatio);
          ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2); ctx.stroke();
        } else if (!isPP) {
          // PP blades are 3D geometry in V_/F_ — skip canvas drawing; only non-PP gets 2D blades + cap
          const nBlades  = S.aircraft?.propplane?.nBlades ?? 2;
          const _ppSpec  = S.aircraft?.propplane;
          const hubFrac  = (_ppSpec?.spinner?.radius && _ppSpec?.propDiskRadius)
            ? _ppSpec.spinner.radius / _ppSpec.propDiskRadius : 0.13;
          const inset    = hubFrac * 0.8;
          ctx.fillStyle   = 'rgba(45,47,52,0.95)';
          ctx.strokeStyle = 'rgba(25,27,30,0.85)';
          ctx.lineWidth   = Math.max(0.8, devicePixelRatio * 0.7);
          for (let i = 0; i < nBlades; i++) {
            const θ    = _propAngle + i * Math.PI * 2 / nBlades;
            const cosθ = Math.cos(θ), sinθ = Math.sin(θ);
            const tx   = p0.x + dyx * cosθ + dzx * sinθ;
            const ty   = p0.y + dyy * cosθ + dzy * sinθ;
            const ix   = p0.x - (dyx * cosθ + dzx * sinθ) * inset;
            const iy   = p0.y - (dyy * cosθ + dzy * sinθ) * inset;
            const cpx  = -dyx * sinθ + dzx * cosθ;
            const cpy  = -dyy * sinθ + dzy * cosθ;
            const cl   = Math.hypot(cpx, cpy) || 1;
            const cux  = cpx / cl, cuy = cpy / cl;
            const rw   = r * 0.09, tw = r * 0.04;
            ctx.beginPath();
            ctx.moveTo(ix + cux * rw, iy + cuy * rw);
            ctx.lineTo(tx + cux * tw, ty + cuy * tw);
            ctx.lineTo(tx - cux * tw, ty - cuy * tw);
            ctx.lineTo(ix - cux * rw, iy - cuy * rw);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          const hubPx = r * hubFrac;
          ctx.beginPath(); ctx.arc(p0.x, p0.y, hubPx, 0, Math.PI * 2);
          ctx.fillStyle   = 'rgba(215,218,222,0.97)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(130,138,150,0.85)';
          ctx.lineWidth   = Math.max(0.8, devicePixelRatio * 0.6);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
}

/* ── Turbofan fan faces — WB inlets (inner pair + A340 outer pair); post-painter ── */
export function drawFanFaces(rc) {
  const { ctx, dpr, pts, b: _b, COL_, project, wbGeo: _wbGeo, cpCamF: _cpCamF,
          isC172, isPP, isRocket, isBf109, isF4U, isMig15 } = rc;
  /* Turbofan fan face — wide-body (WB) aircraft only */
  if (!isC172 && !isPP && !isRocket && !isBf109 && !isF4U && !isMig15) {
    const ePow = (S.engineState === 'off' || S.engineState === 'shutdown') ? 0 : (S.enginePower ?? 0);
    {   // always draw the inlet — static blades when off (ePow 0), spinning when running
      /* Draw one engine inlet: dark bore + black strip + recessed fan (fitted to
         the fan-plane ring's projected ellipse, so it sets back into the inlet and
         foreshortens off-axis) + front lip ring. Shared by the inner pair and the
         A340 outer pair. Gating per engine: hub.d < fan.d → intake faces us;
         hub.d < fusCenter → not behind the body; _cpCamF > 0.10 → camera has a small
         forward component (the mouth clip below then reveals the fan progressively). */
      const _drawEngineInlet = (lipHub, lipR, fanRing, fanScale) => {
        if (!lipHub || lipR < 3) return;
        /* One foreshorten ellipse for the whole inlet, taken from the fan-plane
           ring: fs = minor/major (1 head-on → ~0 edge-on), ang = major axis.
           The lip ring, black strip, dark bore and fan all share it so the inlet
           reads as a single oval from the side rather than a circle + ellipse. */
        const e   = fanRing.length >= 4 ? _fanEllipse(fanRing) : null;
        const fs  = e ? Math.max(0.04, e.minorR / e.majorR) : 1;
        const ang = e ? e.angle : 0;
        const rim = { x: lipHub.x, y: lipHub.y - lipR };
        /* Clip the recessed interior (bore · black strip · fan) to the intake MOUTH (the
           lip ellipse). The fan sits set back from the lip, so as the view angles the near
           nacelle wall hides part of it — clipping to the mouth cuts the fan at the lip seam
           (parallax occlusion) and reveals it progressively instead of a hard pop. The mouth
           foreshortens to a sliver edge-on, so nothing shows from abeam. The path is baked
           under the rotate/scale transform, then the transform is reset before clip(). */
        ctx.save();
        ctx.save();
        ctx.translate(lipHub.x, lipHub.y); ctx.rotate(ang); ctx.scale(1, fs);
        ctx.beginPath(); ctx.arc(0, 0, lipR, 0, Math.PI * 2);
        ctx.restore();
        ctx.clip();
        /* dark inlet bore — foreshortened disc at the lip */
        ctx.save();
        ctx.translate(lipHub.x, lipHub.y); ctx.rotate(ang); ctx.scale(1, fs);
        ctx.fillStyle = COL_[4]; ctx.globalAlpha = 0.32;
        ctx.beginPath(); ctx.arc(0, 0, lipR * 0.82, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        _drawIntakeBlackStrip(ctx, lipHub, rim, dpr, fs, ang);
        if (e) {
          const maj = e.majorR * fanScale;
          if (maj > 3) _drawTurbofanFace(ctx, { x: e.cx, y: e.cy },
            { x: e.cx + maj, y: e.cy }, ePow, dpr, 22, fs, ang);
        }
        ctx.restore();   // drop the mouth clip
        _drawIntakeLip(ctx, lipHub, rim, dpr, fs, ang);   // lip rim on top, unclipped
      };
      /* Mean screen radius from a hub to ring vertices (all same x → same depth). */
      const _ringRad = (hub, idxs) => {
        const rs = idxs.map(i => pts[_b+i]).filter(Boolean)
          .map(p => Math.hypot(p.x - hub.x, p.y - hub.y));
        return rs.length ? rs.reduce((a, b) => a + b) / rs.length : 0;
      };
      /* Project 8 points around a circle in the y-z plane (engine disc face). */
      const _projRing = (x, yc, zc, rad) => {
        const ring = [];
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2;
          const p = project([x, yc + Math.cos(a) * rad, zc + Math.sin(a) * rad]);
          if (p) ring.push(p); }
        return ring;
      };

      const _eXpos  = _wbGeo?.eApos ?? (0.005 + (_wbGeo?.exOff ?? 0));
      /* Cull a fan only when it's genuinely occluded by the fuselage: its screen position
         falls inside the body silhouette (at its own x-station, so aft-swept outboard
         engines are handled) AND it sits behind the body centre. The outboard engine reads
         deeper head-on from its sweep + lateral offset, but it's clearly beside the body,
         so it isn't occluded — the old depth-threshold cull wrongly hid it. */
      const _fusR = _wbGeo?.r ?? _r;
      const _fusOccluded = (p, ex) => {
        if (!p) return true;
        const c = project([ex, 0, 0]), e = project([ex, _fusR, 0]);
        if (!c || !e) return false;
        const rS = Math.hypot(e.x - c.x, e.y - c.y) * 1.12;
        return p.d > c.d && Math.hypot(p.x - c.x, p.y - c.y) < rS;
      };

      /* Inner engines — geometry carries explicit intake (eA) + fan (eB) rings.
         Fan ring is the fan cowl (≈1.2× bore), so scale 0.83 → bore-sized fan. */
      const _rHub = pts[_b+158], _rFan = pts[_b+28];
      const _lHub = pts[_b+159], _lFan = pts[_b+68];
      if (_rHub && _rFan && _rHub.d < _rFan.d && !_fusOccluded(_rHub, _eXpos) && _cpCamF > 0.10)
        _drawEngineInlet(_rHub, _ringRad(_rHub, [20,21,22,23,24,25,26,27]),
          [28,29,30,31,32,33,34,35].map(i=>pts[_b+i]).filter(Boolean), 0.83);
      if (_lHub && _lFan && _lHub.d < _lFan.d && !_fusOccluded(_lHub, _eXpos) && _cpCamF > 0.10)
        _drawEngineInlet(_lHub, _ringRad(_lHub, [60,61,62,63,64,65,66,67]),
          [68,69,70,71,72,73,74,75].map(i=>pts[_b+i]).filter(Boolean), 0.83);

      /* Outer engines (A340) — no ring vertices; project the lip hub/rim and a
         fan-plane ring (radius _er2 = bore) at the same nacelle position. */
      const _ey2 = _wbGeo?.ey2;
      if (_ey2) {
        const { xOff: _oXOffForOuter, ez: _oEzForOuter } = _outerEngineStation(_wbGeo);
        const _ez2 = _oEzForOuter, _er2 = _wbGeo.er ?? _er, _ex2 = _oXOffForOuter;
        const _efr2 = _wbGeo.efr ?? (_er2 * 1.20);          // fan-cowl radius (matches inner efr)
        const _lipX = 0.005 + _ex2;                         // intake lip plane (= inner eApos + sweep)
        const _fanX = _lipX - ((_wbGeo.eApos ?? _lipX) - (_wbGeo.eBpos ?? _lipX));  // fan-cowl plane: same setback as inner (eApos→eBpos), so blades sit at the same depth
        const _outerInlet = (ySign) => {
          const lipHub = project([_lipX, ySign * _ey2, _ez2]);
          const lipRim = project([_lipX, ySign * _ey2, _ez2 + _er2]);
          const fanHub = project([_fanX, ySign * _ey2, _ez2]);
          if (!lipHub || !lipRim || !fanHub) return;
          if (!(lipHub.d < fanHub.d && !_fusOccluded(lipHub, _lipX) && _cpCamF > 0.10)) return;
          _drawEngineInlet(lipHub, Math.hypot(lipRim.x - lipHub.x, lipRim.y - lipHub.y),
            _projRing(_fanX, ySign * _ey2, _ez2, _efr2), 0.83);
        };
        _outerInlet(+1); _outerInlet(-1);
      }
    }
  }
}

/* ── MiG-15 intake — compressor disk + splitter vane; post-painter ── */
export function drawMigIntake(rc) {
  const { ctx, dpr, pts, project, isMig15 } = rc;
  /* MiG-15 intake — centrifugal compressor disk (10 impeller vanes) + splitter vane */
  if (isMig15) {
    const ePow = S.engineState === 'off' || S.engineState === 'shutdown'
                 ? 0 : (S.enginePower ?? 0);
    const pHub = project([0.013, 0, 0]);   // centre of intake ring plane
    const pRim = pts[0];                    // ring A vertex 0 — sets disc radius
    /* Draw only when intake faces camera: noseTip closer than intake ring vertex */
    if (pHub && pRim && pts[96] && pts[96].d < pts[0].d) {
      _drawTurbofanFace(ctx, pHub, pRim, ePow, dpr, 10);
      /* Splitter vane — vertical diameter across intake face */
      const pTop = project([0.013, 0,  _m15ir]);
      const pBot = project([0.013, 0, -_m15ir]);
      if (pTop && pBot) {
        ctx.save();
        ctx.strokeStyle = 'rgba(155,168,182,0.80)';
        ctx.lineWidth   = Math.max(1, dpr * 0.8);
        ctx.beginPath(); ctx.moveTo(pTop.x, pTop.y); ctx.lineTo(pBot.x, pBot.y); ctx.stroke();
        ctx.restore();
      }
    }
  }
}
