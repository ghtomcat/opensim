/* Rocket render passes — extracted from _drawWireframe in outside.js.
   Booster faces/edges, cryo venting, the Moon, engine plumes, every nozzle
   family (F-1, J-2, SPS, Raptor, Merlin), the Saturn V staging tumble and
   the launch pads (LC-39A MLP+LUT, Starbase OLP+Mechazilla). All take the
   per-frame render context `rc`; pre-painter passes push into rc.faces. */
import { S } from '../core/state.js';
import { moonECI } from '../core/rocket.js';
import {
  _sv1r, _sv3r, _svcr, _svFS, _svLT,
  _COLORS_sv, _V_sv, _F_sv, _FC_sv,
  _svSepAnims, _dir, _DIR_SHOTS,
  _rf9, _nzO, _nzO7, _nzVac, _f9S2Base,
  _COLORS_f9, _F_f9, _FC_f9, _E_f9, _FN_f9
} from './outside-space.js';
import { _drawSSReentryPlasma } from './outside-rocket.js';

const DEG   = Math.PI / 180;
const FT_NM = 1 / 6076.12;

/* Plume colours — shared by exit discs so they stay in sync with the plume.
   ROOT = gradient stop 0 (outer root), HOT = stop 0.08 (inner glow / disc face) */
/* Plume colours — shared by exit discs so they stay in sync with the plume.
   ROOT = gradient stop 0 (outer root), HOT = stop 0.08 (inner glow / disc face) */
const _PLUME_ROOT = { rp1: [255, 240, 160], lh2: [215, 240, 255], ch4: [255, 252, 235] };
const _PLUME_HOT  = { rp1: [255, 165,  60], lh2: [170, 215, 255], ch4: [255, 230, 170] };
const _PLUME_OFF  = { rp1: [ 22,  18,  15], lh2: [ 15,  18,  24], ch4: [ 20,  18,  14] };

/* ── J-2 nozzle helper — shared by S-II (5×) and S-IVB (1×) ─────
   baseVF      vF of the aft base ring where nozzles attach
   bodyR       body radius at that ring (scales nozzle proportions)
   engCenters  array of [cR, cU] radial offsets for each engine centre
   j2On        true while engines are burning (gates glow colours)
   Renders: lateral bell faces (side cam only), exit disc + top cap.
   Colours coupled to _PLUME_HOT/OFF.lh2 — LH2/LOX blue-white.      */
const _drawJ2Nozzles = (rc, baseVF, bodyR, engCenters, j2On, style = 'lh2', opts = {}) => {
const { project, camSide, rotateNormal, litBr, faces, H: _H } = rc;
  const nNoz  = 8;
  const nzLen = bodyR * (opts.lenR ?? 0.36);   // nozzle length  (J-2 ≈ 1.78 m)
  const nzRt  = bodyR * (opts.rtR  ?? 0.12);   // radius at attachment
  const nzRx  = bodyR * (opts.rxR  ?? 0.28);   // radius at exit  (J-2 exit dia ≈ 2.74 m)
  for (const [cR, cU] of engCenters) {
    const topR = [], botR = [];
    for (let i = 0; i < nNoz; i++) {
      const a = (i / nNoz) * Math.PI * 2;
      topR.push(project([baseVF,         cR + nzRt * Math.cos(a), cU + nzRt * Math.sin(a)]));
      botR.push(project([baseVF - nzLen, cR + nzRx * Math.cos(a), cU + nzRx * Math.sin(a)]));
    }
    if (camSide > 0) for (let i = 0; i < nNoz; i++) {
      const j  = (i + 1) % nNoz;
      const ps = [topR[i], botR[i], botR[j], topR[j]];
      if (ps.some(p => !p)) continue;
      const p0 = ps[0], p1 = ps[1], p2 = ps[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
      const aMid = ((i + 0.5) / nNoz) * Math.PI * 2;
      const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
      const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
      const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
      faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.18) + 0.4 * spec), avgD, col: [52, 50, 48] });
    }
    if (!botR.some(p => !p)) {
      const p0 = botR[0], p1 = botR[1], p2 = botR[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
        const avgD = botR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: botR, br: j2On ? 1.0 : 0.07, avgD,
                     col: j2On ? _PLUME_HOT[style] : _PLUME_OFF[style] });
      }
    }
    if (!topR.some(p => !p)) {
      const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
      faces.push({ ps: topR, br: 0.06, avgD, col: _PLUME_OFF[style] });
    }
  }
};

/* ── Booster faces — F9 S1 + SS Super Heavy, depth-sorted into rc.faces ── */
export function drawBoosterFaces(rc) {
  const { faces, project, rotateNormal, litBr, rStage, isSS, ssGeo: _ssGeo,
          bPts, ssBPts, cosdP, sindP, ssCosdP, ssSindP } = rc;
  /* Starship stage sep: fill open bottom ring of Ship with a disc cap */
  if (isSS && rStage >= 2 && _ssGeo) {
    const _ssRg = S.aircraft?.rocketGeometry;
    const _sepRi = (_ssRg?.stageSep ?? [])[0] ?? 5;
    const _ssRb  = _ssGeo.rb;
    const _ssV   = _ssGeo.V_;
    const _ssN   = _ssRg?.nSides ?? 16;
    if (_ssRb && _ssV && _sepRi < _ssRb.length) {
      const _capPts = [];
      for (let si = 0; si < _ssN; si++) _capPts.push(project(_ssV[_ssRb[_sepRi] + si]));
      if (!_capPts.some(p => !p)) {
        const _capD = _capPts.reduce((s,p)=>s+p.d,0)/_ssN;
        faces.push({ ps: _capPts, br: 0.10, avgD: _capD, col: _ssGeo.COLORS_[1] ?? [200,205,210] });
      }
    }
  }

  /* Booster faces — Stage 1 body + grid fins */
  if (bPts) {
    const s1Idx = [...Array.from({length:48},(_,k)=>k), ...Array.from({length:8},(_,k)=>96+k), ...Array.from({length:40},(_,k)=>120+k)];   // body + fins + hinge mounts + fin thickness
    for (const i of s1Idx) {
      const fi = _F_f9[i];
      const ps = fi.map(vi => bPts[vi]);
      if (ps.some(p => !p)) continue;
      const p0=ps[0],p1=ps[1],p2=ps[2];
      const cross=(p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x);
      if (cross < 0) continue;
      const [nF,nR,nU] = _FN_f9[i];
      const rnF = nF*cosdP - nU*sindP;
      const rnU = nF*sindP + nU*cosdP;
      const [wF,wR,wU] = rotateNormal([rnF, nR, rnU]);
      const amb = (_FC_f9[i] === 4) ? 0.55 : 0.18;
      const br  = litBr(wF, wR, wU, amb);
      const avgD = ps.reduce((s,p)=>s+p.d,0)/ps.length;
      faces.push({ ps, br, avgD, col: _COLORS_f9[_FC_f9[i]] });
    }
    /* Aft base cap (octaweb floor, ring 0 = verts 0-15) — plugs the open base on the spent booster */
    const _capPts = [];
    for (let si = 0; si < 16; si++) { if (bPts[si]) _capPts.push(bPts[si]); }
    if (_capPts.length >= 3) {
      const _capD = _capPts.reduce((s,p)=>s+p.d,0)/_capPts.length;
      faces.push({ ps: _capPts, br: 0.55, avgD: _capD, col: [26, 26, 30] });
    }
  }

  /* Starship Super Heavy booster faces — SH body + grid fins + end caps */
  if (ssBPts && _ssGeo) {
    const sr0  = _ssGeo.stageRanges?.[0];
    const fEnd = sr0?.faceEnd          ?? 0;
    const gfS  = sr0?.gridFinFaceStart ?? fEnd;
    const gfE  = sr0?.gridFinFaceEnd   ?? fEnd;
    const _ssRg   = S.aircraft?.rocketGeometry;
    const _nSidesB = _ssRg?.nSides ?? 16;
    const _sepRiB  = (_ssRg?.stageSep ?? [])[0] ?? 5;
    /* Top cap — sep plane ring, covers the open top where Ship pulled away */
    if (_ssGeo.rb && _sepRiB < _ssGeo.rb.length) {
      const _topPts = [];
      for (let si = 0; si < _nSidesB; si++) _topPts.push(ssBPts[_ssGeo.rb[_sepRiB] + si]);
      if (!_topPts.some(p => !p)) {
        const _topD = _topPts.reduce((s,p)=>s+p.d,0)/_nSidesB;
        faces.push({ ps: _topPts, br: 0.10, avgD: _topD, col: _ssGeo.COLORS_[1] ?? [200,205,210] });
      }
    }
    for (let i = 0; i < _ssGeo.F_.length; i++) {
      if (i >= fEnd && !(i >= gfS && i < gfE)) continue;
      const fi = _ssGeo.F_[i];
      const ps = fi.map(vi => ssBPts[vi]);
      if (ps.some(p => !p)) continue;
      const p0=ps[0], p1=ps[1], p2=ps[2];
      if ((p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
      const [nF, nR, nU] = _ssGeo.FN_[i];
      const rnF = nF * ssCosdP - nU * ssSindP;
      const rnU = nF * ssSindP + nU * ssCosdP;
      const [wF, wR, wU] = rotateNormal([rnF, nR, rnU]);
      const br   = litBr(wF, wR, wU, 0.18);
      const avgD = ps.reduce((s,p) => s+p.d, 0) / ps.length;
      const col  = _ssGeo.COLORS_[_ssGeo.FC_[i]];
      if (col) faces.push({ ps, br, avgD, col });
    }
    /* Aft disc cap (engine side, ring 0) — plugs the open base when booster flips */
    const _ssN0 = _ssGeo.rb?.[0];
    if (_ssN0 != null) {
      const _aftPts = [];
      for (let si = 0; si < _nSidesB; si++) _aftPts.push(ssBPts[_ssN0 + si]);
      if (!_aftPts.some(p => !p)) {
        const _aftD = _aftPts.reduce((s,p)=>s+p.d,0)/_nSidesB;
        faces.push({ ps: _aftPts, br: 0.12, avgD: _aftD, col: _ssGeo.COLORS_[0] ?? [130,135,145] });
      }
    }
  }
}

/* ── Cryo venting, Moon, engine plumes + nozzle bells (F-1/J-2/SPS/Raptor),
   Starship reentry plasma — pre-painter ── */
export function drawRocketPlumesAndNozzles(rc) {
  const { canvas, ctx, dpr, pts, faces, project, projectCSM: _projectCSM,
          inTDSep: _inTDSep, camSide, camBack, cx, cy, focal, cosCP, sinCP,
          cosEl, sinEl, orbitElDeg, rotateNormal, litBr, rStage,
          svRise: _svRise, ssGeo: _ssGeo, isF9, isSS, isSV, H: _H } = rc;
  /* Cryogenic effects — LOX vent + tank vapor (ground gas closeout phase).
     Venting represents strongback/GSE line disconnects before ignition.   */
  if (isF9 && (S.spd ?? 0) < 5) {
    const now = Date.now() * 0.001;
    const dpr = devicePixelRatio;
    ctx.save();

    /* Animated vapor cloud emitter — puffs expand, drift upward, fade out */
    function _vCloud(px, py, n, period, maxR, drift, rgb, aMax) {
      for (let i = 0; i < n; i++) {
        const t    = ((now / period + i / n) % 1);
        const ease = 1 - Math.pow(1 - t, 2.2);
        const a    = Math.pow(1 - t, 1.5) * aMax;
        if (a < 0.008) continue;
        const r  = (4 + ease * maxR) * dpr;
        const dx = Math.sin(i * 2.3 + now * 0.35) * ease * drift * dpr;
        const dy = -ease * drift * 1.6 * dpr;
        ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(px + dx, py + dy, r * 1.25, r * 0.68,
                    Math.atan2(dy, dx || 0.001), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* S1 LOX vent — dense cloud from Ring 2 (top of S1 tank, interstage level) */
    if (pts[36]) _vCloud(pts[36].x, pts[36].y, 10, 1.7, 32, 26, '212,228,255', 0.65);
    if (pts[44]) _vCloud(pts[44].x, pts[44].y,  8, 2.0, 24, 20, '212,228,255', 0.50);

    /* S1 tank body wisps — cryo boil-off from Ring 1 and Ring 0 */
    for (const vi of [16, 17, 18, 22, 23, 0, 2, 6]) {
      if (!pts[vi]) continue;
      _vCloud(pts[vi].x, pts[vi].y, 4, 2.6 + vi * 0.13, 11, 11, '222,235,255', 0.24);
    }

    /* S2 LOX vent — from Ring 4 (top of S2 body, Dragon base level) */
    if (pts[68]) _vCloud(pts[68].x, pts[68].y, 7, 2.2, 20, 18, '208,226,255', 0.50);
    if (pts[76]) _vCloud(pts[76].x, pts[76].y, 5, 2.5, 15, 14, '208,226,255', 0.38);

    /* S2 body wisps */
    for (const vi of [48, 52, 60]) {
      if (!pts[vi]) continue;
      _vCloud(pts[vi].x, pts[vi].y, 3, 3.1 + vi * 0.05, 8, 9, '218,232,255', 0.20);
    }

    ctx.restore();
  }

  /* Moon — visible from orbit onward; drawn before rocket body so spacecraft occludes it */
  if (S.rocketOrbit && S.orbitVec) {
    const { rx, ry, rz, vx, vy, vz } = S.orbitVec;
    const { mx, my } = moonECI(S.time ?? 0);

    const dx = mx - rx, dy = my - ry, dz = 0;  // Moon in XY plane; rz is inclination artifact
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 1) {
      /* Orbital frame basis — fixed in ECI (no body pitch/roll, Moon is sky background) */
      const spd = Math.sqrt(vx*vx + vy*vy + vz*vz);
      const rr  = Math.sqrt(rx*rx + ry*ry + rz*rz);
      const pF = spd > 0 ? vx/spd : 1, pR = spd > 0 ? vy/spd : 0, pU = spd > 0 ? vz/spd : 0; // prograde = body +F
      const rF = rr  > 0 ? rx/rr  : 0, rR = rr  > 0 ? ry/rr  : 0, rU = rr  > 0 ? rz/rr  : 1; // radial-out = body +U
      /* right = prograde × radial-out (body +R) */
      const bF = pR*rU - pU*rR, bR = pU*rF - pF*rU, bU = pF*rR - pR*rF;

      const ndx = dx/dist, ndy = dy/dist, ndz = dz/dist;
      let mF = ndx*pF + ndy*pR + ndz*pU;  // forward component
      let mR = ndx*bF + ndy*bR + ndz*bU;  // right component
      let mU = ndx*rF + ndy*rR + ndz*rU;  // up component

      /* Apply orbit elevation rotation (same as project()) */
      if (orbitElDeg !== 0 && camSide > 0) {
        const mR2 = mR * cosEl + mU * sinEl;
        mU = -mR * sinEl + mU * cosEl;
        mR = mR2;
      }

      /* Camera-space depth and horizontal for a direction vector at infinity */
      const cfW = camSide > 0 ? -mR : mF;
      const crW = camSide > 0 ?  mF : mR;
      const cuW = mU;
      const cf  = cfW * cosCP + cuW * sinCP;
      const cu  = cuW * cosCP - cfW * sinCP;

      if (cf > 0) {
        const mpx = cx + crW / cf * focal;
        const mpy = cy - cu  / cf * focal;

        /* Angular radius: Moon r = 1737 km */
        const moonPx = Math.max(3 * dpr, (1_737_000 / dist) * focal);

        const g = ctx.createRadialGradient(mpx - moonPx*0.3, mpy - moonPx*0.3, 0, mpx, mpy, moonPx);
        g.addColorStop(0,   'rgba(228, 226, 218, 0.98)');
        g.addColorStop(0.5, 'rgba(172, 170, 162, 0.95)');
        g.addColorStop(1,   'rgba(72,  70,  65,  0.85)');
        ctx.beginPath();
        ctx.arc(mpx, mpy, moonPx, 0, 2 * Math.PI);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  /* Engine plumes — drawn before faces so body renders on top.
     S1: active until MECO.  S2: active after coast, until SECO. */
  const t0 = S.aircraft?.ignitionTime ?? 0;
  const pastIgnition = (S.time ?? 0) >= t0;


  /* style: 'rp1' = RP-1/LOX yellow-white (F-1, Merlin)
            'lh2' = LH2/LOX blue-white (J-2)            */
  function _drawPlume(pN, bodyR, originVec, baseLen, widthScale, style = 'rp1') {
    const altM  = (S.alt ?? 0) * 0.3048;
    const altT  = Math.min(1, altM / 65000);          /* 0 = pad, 1 = 65 km */
    const len   = baseLen * (1 + altT * 2.8);         /* plume lengthens in vacuum */
    const flick = 1 + 0.04 * Math.sin(Date.now() * 0.047)
                    + 0.025 * Math.sin(Date.now() * 0.083);

    const plumeEnd = project(originVec.map((v, i) => i === 0 ? v - len : v));
    if (!pN || !plumeEnd) return;
    const dx = plumeEnd.x - pN.x, dy = plumeEnd.y - pN.y;
    const pxLen = Math.hypot(dx, dy);
    if (pxLen < 2) return;
    const px = -dy / pxLen, py = dx / pxLen;
    /* Billboard: project nozzle radius in both transverse body axes, take max.
       Prevents plume collapsing to a sliver in side/front/any-angle views. */
    const pEy = project([originVec[0], originVec[1] + bodyR, originVec[2]]);
    const pEz = project([originVec[0], originVec[1], originVec[2] + bodyR]);
    const ry = pEy ? Math.hypot(pEy.x - pN.x, pEy.y - pN.y) : 0;
    const rz = pEz ? Math.hypot(pEz.x - pN.x, pEz.y - pN.y) : 0;
    const nozR = Math.max(ry, rz, 4 * devicePixelRatio) * widthScale * flick;

    /* Tip flares wider at altitude (vacuum expansion) */
    const tipS = 2.8 + altT * 5.0;
    const midS = 1.6 + altT * 2.2;
    const mx   = (pN.x + plumeEnd.x) / 2, my = (pN.y + plumeEnd.y) / 2;

    ctx.save();
    const grad = ctx.createLinearGradient(pN.x, pN.y, plumeEnd.x, plumeEnd.y);
    if (style === 'lh2') {
      grad.addColorStop(0,    `rgba(215,240,255,${(0.90 * flick).toFixed(2)})`);
      grad.addColorStop(0.10, 'rgba(170,215,255,0.68)');
      grad.addColorStop(0.30, 'rgba( 90,155,245,0.36)');
      grad.addColorStop(0.60, 'rgba( 50, 90,210,0.12)');
      grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    } else if (style === 'ch4') {
      /* Methane/LOX (Raptor) — near-white, no orange/soot; cool grey fade */
      grad.addColorStop(0,    `rgba(255,255,248,${(0.92 * flick).toFixed(2)})`);
      grad.addColorStop(0.08, 'rgba(255,250,225,0.65)');
      grad.addColorStop(0.25, 'rgba(220,228,225,0.28)');
      grad.addColorStop(0.55, 'rgba(160,178,185,0.09)');
      grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    } else {
      grad.addColorStop(0,    `rgba(255,240,160,${(0.88 * flick).toFixed(2)})`);
      grad.addColorStop(0.08, 'rgba(255,165, 60,0.72)');
      grad.addColorStop(0.25, 'rgba(210, 80, 18,0.42)');
      grad.addColorStop(0.55, 'rgba(130, 28,  5,0.18)');
      grad.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pN.x + px * nozR,       pN.y + py * nozR);
    ctx.quadraticCurveTo(mx + px * nozR * midS, my + py * nozR * midS,
                         plumeEnd.x + px * nozR * tipS, plumeEnd.y + py * nozR * tipS);
    ctx.lineTo(plumeEnd.x - px * nozR * tipS,   plumeEnd.y - py * nozR * tipS);
    ctx.quadraticCurveTo(mx - px * nozR * midS, my - py * nozR * midS,
                         pN.x - px * nozR,       pN.y - py * nozR);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /* Engine fraction — scales plume width by √(active/total) so a partial
     engine cluster (CECO, engine-out) produces a visibly smaller plume. */
  const _plumeStgIdx  = (S.rocketStage ?? 1) - 1;
  const _plumeStg     = (S.aircraft?.performance?.stages ?? [])[_plumeStgIdx] ?? {};
  const _plumeTotalEng = _plumeStg.engineCount ?? 1;
  const _plumeActEng   = S.rocketActiveEngines ?? _plumeTotalEng;
  const _engFrac       = Math.sqrt(_plumeTotalEng > 0 ? _plumeActEng / _plumeTotalEng : 1);

  if (isF9) {
    /* Stage 1 — 9× Merlin 1D octaweb (must push faces BEFORE the flush; the MVac glow stays
       in drawF9Nozzles which draws directly, after the flush). */
    if (rStage < 2) {
      const merlinOn = pastIgnition && !(S.rocketCoast ?? false) && !S.rocketMECO;
      const _mCenters = [
        [0, 0],
        [_nzO, 0], [_nzO7, _nzO7], [0, _nzO], [-_nzO7, _nzO7],
        [-_nzO, 0], [-_nzO7, -_nzO7], [0, -_nzO], [_nzO7, -_nzO7],
      ];
      _drawJ2Nozzles(rc, -0.016, _rf9, _mCenters, merlinOn, 'rp1', { rxR: 0.25, rtR: 0.10, lenR: 0.45 });

      /* Stowed landing legs — 4 black 3D leg housings against the lower S1 (45° from the grid
         fins). Each = a raised ridge (two shaded panels) standing off the body, so it reads as
         a 3D structure, not a flat strip. They stay stowed until they deploy (drawBoosterEdges). */
      const Ri = _rf9, Ro = _rf9 * 1.13, lwiB = Math.PI / 4, lwiT = 0.13, lvFb = -0.016, lvFt = -0.002;
      const _legPanel = (bv, midA) => {
        const ps = bv.map(p => project(p));
        if (ps.some(p => !p)) return;
        const q0 = ps[0], q1 = ps[1], q2 = ps[2];
        if ((q1.x - q0.x) * (q2.y - q0.y) - (q1.y - q0.y) * (q2.x - q0.x) < 0) return;
        const A = bv[0], B = bv[1], C = bv[3];
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let n = [e1[1]*e2[2] - e1[2]*e2[1], e1[2]*e2[0] - e1[0]*e2[2], e1[0]*e2[1] - e1[1]*e2[0]];
        if (n[1]*Math.cos(midA) + n[2]*Math.sin(midA) < 0) n = [-n[0], -n[1], -n[2]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        const [nF, nR, nU] = rotateNormal([n[0]/l, n[1]/l, n[2]/l]);
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: litBr(nF, nR, nU, 0.13), avgD, col: [14, 16, 22] });
      };
      for (const th of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
        /* wider at the bottom (foot/hinge), tapering narrower at the top */
        const a0t = th - lwiT, a1t = th + lwiT, a0b = th - lwiB, a1b = th + lwiB;
        const iT0 = [lvFt, Ri*Math.cos(a0t), Ri*Math.sin(a0t)], iB0 = [lvFb, Ri*Math.cos(a0b), Ri*Math.sin(a0b)];
        const iT1 = [lvFt, Ri*Math.cos(a1t), Ri*Math.sin(a1t)], iB1 = [lvFb, Ri*Math.cos(a1b), Ri*Math.sin(a1b)];
        const rT  = [lvFt, Ro*Math.cos(th), Ro*Math.sin(th)],   rB  = [lvFb, Ro*Math.cos(th), Ro*Math.sin(th)];
        _legPanel([iT0, iB0, rB, rT], th - lwiT * 0.5);   // panel toward a0
        _legPanel([rT, rB, iB1, iT1], th + lwiT * 0.5);   // panel toward a1
      }
    }

    /* S1 plume: ignition → MECO */
    if (pastIgnition && rStage < 2 && !S.rocketCoast && !S.rocketMECO)
      _drawPlume(pts[113], _nzO, [-0.018, 0, 0], 0.030, 2.8 * _engFrac);

    /* S2 plume: coast ends → SECO. One MVac → narrow exhaust, from the MVac exit plane. */
    if (rStage >= 2 && !S.rocketCoast && !S.rocketSECO) {
      const _ex = _f9S2Base - 0.0024;   // MVac exit (matches the geometry exit ring)
      _drawPlume(project([_ex, 0, 0]), _nzVac, [_ex, 0, 0], 0.032, 1.3 * _engFrac);
    }
  }

  if (isSS && _ssGeo && pastIgnition && !S.rocketCoast && !S.rocketSECO) {
    const ssClusters = _ssGeo.engineClusters ?? [];
    const activeClusters = ssClusters.filter(c => c.stage === rStage);
    for (const cluster of activeClusters) {
      /* Plume origin at engine plane, scaled by cluster's outermost ring radius */
      const outerR = cluster.rings[cluster.rings.length - 1]?.radius ?? 0.002;
      const pNoz = project([cluster.vF, 0, 0]);
      if (pNoz) _drawPlume(pNoz, outerR, [cluster.vF, 0, 0], 0.014, 1.8 * _engFrac, 'ch4');
    }
  }

  if (isSV && pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO) {
    const svStage = S.rocketStage ?? 1;
    /* S-IC — 5× F-1, RP-1/LOX orange plume, emits from nozzle exit plane */
    if (svStage === 1) {
      const _nzExit = -0.030 - _sv1r * 0.58;
      const pNoz = project([_nzExit, 0, 0]);
      _drawPlume(pNoz, _sv1r, [_nzExit, 0, 0], 0.030, 1.4 * _engFrac);
    }
    /* S-II — 5× J-2, LH2/LOX blue-white, emits from nozzle exit plane */
    else if (svStage === 2) {
      const _s2Exit = -0.006 - _sv1r * 0.36;
      const pNoz = project([_s2Exit, 0, 0]);
      _drawPlume(pNoz, _sv1r, [_s2Exit, 0, 0], 0.022, 0.45 * _engFrac, 'lh2');
    }
    /* S-IVB — 1× J-2, LH2/LOX, emits from nozzle exit plane */
    else if (svStage >= 3) {
      const _sivbExit = 0.010 - _sv3r * 0.36;
      const pNoz = project([_sivbExit, 0, 0]);
      _drawPlume(pNoz, _sv3r, [_sivbExit, 0, 0], 0.018, 0.28 * _engFrac, 'lh2');
    }
  }

  /* S-IVB plume during TLI re-ignition (orbit mode) */
  if (isSV && S.rocketOrbit && S.rocketTLI && (S.time ?? 0) <= (S.rocketTLIBurnEnd ?? 0)) {
    const _sivbExit = 0.010 - _sv3r * 0.36;
    const pNoz = project([_sivbExit, 0, 0]);
    _drawPlume(pNoz, _sv3r, [_sivbExit, 0, 0], 0.018, 0.28, 'lh2');
  }

  /* ── F1 engine nozzles — Saturn V S-IC, 5× truncated bell frustums ─
     Hidden while inside MLP slab (riseNm < nozzle length ≈ 0.0016 NM).  */
  if (isSV && rStage === 1 && _svRise > _sv1r * 0.58) {
    const nNoz  = 8;              // octagon cross-section
    const nzVF  = -0.030;         // S-IC aft base
    const nzLen = _sv1r * 0.58;   // nozzle length aft of base  (F1 ≈ 2.9 m)
    const nzRt  = _sv1r * 0.20;   // radius at attachment
    const nzRx  = _sv1r * 0.38;   // radius at exit  (F1 exit dia ≈ 3.76 m)
    const nzE   = _sv1r * 0.68;   // outer engine radial offset  (≈ 3.4 m)
    const f1On  = pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO;

    for (const [cR, cU] of [[0,0],[nzE,0],[-nzE,0],[0,nzE],[0,-nzE]]) {
      const topR = [], botR = [];
      for (let i = 0; i < nNoz; i++) {
        const a = (i / nNoz) * Math.PI * 2;
        topR.push(project([nzVF,         cR + nzRt * Math.cos(a), cU + nzRt * Math.sin(a)]));
        botR.push(project([nzVF - nzLen, cR + nzRx * Math.cos(a), cU + nzRx * Math.sin(a)]));
      }

      /* Lateral bell faces — side cam only (chase cam depth-sorting fails for
         faces inside the body cylinder; exit discs cover the chase-cam view) */
      if (camSide > 0) for (let i = 0; i < nNoz; i++) {
        const j  = (i + 1) % nNoz;
        const ps = [topR[i], botR[i], botR[j], topR[j]];
        if (ps.some(p => !p)) continue;
        const p0 = ps[0], p1 = ps[1], p2 = ps[2];
        if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
        const aMid = ((i + 0.5) / nNoz) * Math.PI * 2;
        const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
        const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
        const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
        faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.14) + 0.4 * spec), avgD, col: [44, 38, 32] });
      }

      /* Exit disc — inner glow color matches plume stop 0.08 */
      if (!botR.some(p => !p)) {
        const p0 = botR[0], p1 = botR[1], p2 = botR[2];
        if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
          const avgD = botR.reduce((s,p)=>s+p.d,0)/nNoz;
          faces.push({ ps: botR, br: f1On ? 1.0 : 0.07, avgD,
                       col: f1On ? _PLUME_HOT.rp1 : _PLUME_OFF.rp1 });
        }
      }

      /* Top attachment cap — dark backing plate inside bell */
      if (!topR.some(p => !p)) {
        const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: topR, br: 0.06, avgD, col: _PLUME_OFF.rp1 });
      }
    }
  }

  /* ── S-IC aft end cap — flat floor
     2D cross-product is unreliable for this face (sign flips with view angle,
     same problem as cylinder quads). 3D normal [-1,0,0] is always toward rear/side
     camera at any normal viewing angle → never back-facing → always render.     */
  if (isSV) {
    /* Aft base cap for each exposed stage bottom:
       stage 1 → ring 0, base  0 (vF=-0.030, S-IC)
       stage 2 → ring 3, base 48 (vF=-0.006, S-II)
       stage 3+ → ring 5, base 80 (vF=+0.010, S-IVB)  */
    const sivbSepDone = S.sivbSep ?? false;
    const capBase = rStage === 1 ? 0 : rStage === 2 ? 48 : sivbSepDone ? 112 : 80;
    const capPts = [];
    for (let si = 0; si < 16; si++) { if (pts[capBase + si]) capPts.push(pts[capBase + si]); }
    if (capPts.length >= 3) {
      const avgD = capPts.reduce((s, p) => s + p.d, 0) / capPts.length;
      faces.push({ ps: capPts, br: 1.0, avgD, col: [42, 36, 30] });
    }
  }


  /* ── Falcon 9 aft base caps — flat engine-bay floor where the nozzles attach.
     Same 3D-normal reasoning as the S-IC cap: always render (it's a floor).
       rStage 1 → ring 0, base  0 (vF _F9_vf0, octaweb floor under the 9 Merlins)
       rStage ≥ 2 → ring 3, base 48 (vF _f9S2Base, S2 floor under the MVac — exposed after sep) */
  if (isF9) {
    const capBase = rStage >= 2 ? 48 : 0;
    const capPts = [];
    for (let si = 0; si < 16; si++) { if (pts[capBase + si]) capPts.push(pts[capBase + si]); }
    if (capPts.length >= 3) {
      const avgD = capPts.reduce((s, p) => s + p.d, 0) / capPts.length;
      faces.push({ ps: capPts, br: 1.0, avgD, col: [26, 26, 30] });
    }
  }

  const j2On = pastIgnition && !(S.rocketCoast ?? false) && !S.rocketSECO;

  /* S-II — 5× J-2, visible from stage 2 onward */
  if (isSV && rStage === 2) {
    const nzE = _sv1r * 0.55;   // outer engine radial offset  (≈ 2.75 m)
    _drawJ2Nozzles(rc, -0.006, _sv1r, [[0,0],[nzE,0],[-nzE,0],[0,nzE],[0,-nzE]], j2On);
  }

  /* S-IVB — 1× J-2, centered, visible from stage 3 onward (not after sivbSep) */
  if (isSV && rStage >= 3 && !(S.sivbSep ?? false)) {
    _drawJ2Nozzles(rc, 0.010, _sv3r, [[0, 0]], j2On);
  }

  /* SM SPS engine bell — visible after sivbSep and during T&D (rotated CSM) */
  if (isSV && ((S.sivbSep ?? false) || _inTDSep)) {
    const nNoz  = 8;
    const sMvF  = 0.024;          // SM aft ring vF (Ring 7)
    const spsL  = _svcr * 1.60;  // nozzle length
    const spsRt = _svcr * 0.08;  // throat radius
    const spsRx = _svcr * 0.53;  // exit radius (≈ 54 % of SM radius)
    const spsTopR = [], spsBotR = [];
    for (let i = 0; i < nNoz; i++) {
      const a = (i / nNoz) * Math.PI * 2;
      spsTopR.push(_projectCSM(sMvF,         spsRt * Math.cos(a), spsRt * Math.sin(a)));
      spsBotR.push(_projectCSM(sMvF - spsL,  spsRx * Math.cos(a), spsRx * Math.sin(a)));
    }
    if (camSide > 0) for (let i = 0; i < nNoz; i++) {
      const j  = (i + 1) % nNoz;
      const ps = [spsTopR[i], spsBotR[i], spsBotR[j], spsTopR[j]];
      if (ps.some(p => !p)) continue;
      const p0 = ps[0], p1 = ps[1], p2 = ps[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
      const aMid = ((i + 0.5) / nNoz) * Math.PI * 2;
      const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
      const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
      const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
      faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.18) + 0.4 * spec), avgD, col: [52, 50, 48] });
    }
    if (!spsBotR.some(p => !p)) {
      const p0 = spsBotR[0], p1 = spsBotR[1], p2 = spsBotR[2];
      if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
        const avgD = spsBotR.reduce((s,p)=>s+p.d,0)/nNoz;
        faces.push({ ps: spsBotR, br: 0.07, avgD, col: _PLUME_OFF.lh2 });
      }
    }
    if (!spsTopR.some(p => !p)) {
      const avgD = spsTopR.reduce((s,p)=>s+p.d,0)/nNoz;
      faces.push({ ps: spsTopR, br: 0.06, avgD, col: [52, 50, 48] });
    }
  }

  /* ── Raptor nozzle bells — Starship / Super Heavy ─────────────────
     Iterates over engineClusters from aircraft.rocketGeometry.
     Each cluster has rings of engines; each ring defines count, radius,
     nozzleR (exit radius), nozzleLen.  Renders 6-sided frustum per bell. */
  if (isSS && _ssGeo) {
    const nNoz = 6;  // hexagon cross-section — lighter than 8
    const raptorOn = pastIgnition && !S.rocketCoast && (!S.rocketSECO || !!S.starshipFlipStartT);
    for (const cluster of (_ssGeo.engineClusters ?? [])) {
      if (rStage >= 2 && cluster.stage < 2) continue;  // SH cluster hidden after sep
      for (const ring of cluster.rings) {
        const { count, radius, nozzleR, nozzleLen } = ring;
        const nzRt  = nozzleR * 0.45;  // throat (attachment end)
        const isVac = ring.type === 'Vac';
        for (let ei = 0; ei < count; ei++) {
          const ea = (ei / count) * Math.PI * 2;
          const cR = radius * Math.sin(ea), cU = radius * Math.cos(ea);
          const topR = [], botR = [];
          for (let si = 0; si < nNoz; si++) {
            const a = (si / nNoz) * Math.PI * 2;
            topR.push(project([cluster.vF,              cR + nzRt * Math.cos(a), cU + nzRt * Math.sin(a)]));
            botR.push(project([cluster.vF - nozzleLen,  cR + nozzleR * Math.cos(a), cU + nozzleR * Math.sin(a)]));
          }
          if (camSide > 0) for (let si = 0; si < nNoz; si++) {
            const sj = (si + 1) % nNoz;
            const ps = [topR[si], botR[si], botR[sj], topR[sj]];
            if (ps.some(p => !p)) continue;
            const p0 = ps[0], p1 = ps[1], p2 = ps[2];
            if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
            const aMid = ((si + 0.5) / nNoz) * Math.PI * 2;
            const [nF, nR, nU] = rotateNormal([0, Math.cos(aMid), Math.sin(aMid)]);
            const spec = Math.pow(Math.max(0, nF*_H[0] + nR*_H[1] + nU*_H[2]), 32);
            const avgD = ps.reduce((s, p) => s + p.d, 0) / 4;
            faces.push({ ps, br: Math.min(1, litBr(nF, nR, nU, 0.14) + 0.4 * spec), avgD, col: [30, 28, 28] });
          }
          if (!botR.some(p => !p)) {
            const p0 = botR[0], p1 = botR[1], p2 = botR[2];
            if ((p1.x-p0.x)*(p2.y-p0.y) - (p1.y-p0.y)*(p2.x-p0.x) >= 0) {
              const avgD = botR.reduce((s,p)=>s+p.d,0)/nNoz;
              const pStyle = isVac ? 'lh2' : (isSS ? 'ch4' : 'rp1');
              faces.push({ ps: botR, br: raptorOn ? 1.0 : 0.07, avgD,
                           col: raptorOn ? _PLUME_HOT[pStyle] : _PLUME_OFF[pStyle] });
            }
          }
          if (!topR.some(p => !p)) {
            const avgD = topR.reduce((s,p)=>s+p.d,0)/nNoz;
            faces.push({ ps: topR, br: 0.06, avgD, col: [28, 26, 26] });
          }
        }
      }
    }
  }

  /* Starship reentry plasma — project the actual body midpoint (vF=0.027 =
     centre of stage-2 span 0.013→0.041) rather than cx/cy, because cx is the
     perspective-projection origin and can differ from the on-screen position
     of the rocket centre (especially in side cam after stage sep).           */
  if (isSS) {
    const _pSSMid = project([0.027, 0, 0]);
    const _pCx = _pSSMid?.x ?? cx;
    const _pCy = _pSSMid?.y ?? cy;
    if (camSide > 0) _drawSSReentryPlasma(canvas, _pCx, _pCy, camSide, true);
    else             _drawSSReentryPlasma(canvas, _pCx, _pCy, camBack, false);
  }
}

/* ── Saturn V stage-separation tumble — spent stage drifts aft + tumbles ── */
export function drawSVStageSepTumble(rc) {
  const { ctx, project, isSV } = rc;
  /* ── Stage separation tumble animations (Saturn V) ─────────────── */
  if (isSV && _svSepAnims.length > 0) {
    const ANIM_DUR = 14;   // seconds until fully faded
    const now = Date.now();

    for (let ai = _svSepAnims.length - 1; ai >= 0; ai--) {
      const anim  = _svSepAnims[ai];
      const elapsed = (now - anim.t0) / 1000;
      if (elapsed > ANIM_DUR) { _svSepAnims.splice(ai, 1); continue; }

      const alpha = Math.pow(Math.max(0, 1 - elapsed / ANIM_DUR), 0.55);
      if (alpha < 0.01) continue;

      /* Drift aft (rocket accelerates away) + end-over-end tumble */
      const drift = Math.pow(elapsed, 1.7) * 0.060;   // NM behind rocket
      const θ     = elapsed * Math.PI * 0.80;          // ~144 deg/sec tumble

      /* Which faces to animate, and the stage's centre of mass in vF */
      let fMin, fMax, finFaces, pivotVF;
      if (anim.stage === 1) {
        fMin = 0; fMax = 31; finFaces = true; pivotVF = -0.018;
      } else {
        fMin = 32; fMax = 63; finFaces = false; pivotVF = 0.0005;
      }

      /* Pre-transform: tumble around vR axis + drift in -vF */
      const sepProj = ([vF, vR_, vU_]) => {
        const dF = vF - pivotVF;
        const rF = dF * Math.cos(θ) - vU_ * Math.sin(θ) + pivotVF - drift;
        const rU = dF * Math.sin(θ) + vU_ * Math.cos(θ);
        return project([rF, vR_, rU]);
      };

      const sPts = _V_sv.map(v => sepProj(v));

      const drawRange = (start, end) => {
        const sf = [];
        for (let fi = start; fi <= end; fi++) {
          const ps = _F_sv[fi].map(vi => sPts[vi]);
          if (ps.some(p => !p)) continue;
          const p0=ps[0], p1=ps[1], p2=ps[2];
          if ((p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x) < 0) continue;
          const avgD = ps.reduce((s,p)=>s+p.d,0)/ps.length;
          sf.push({ ps, avgD, col: _COLORS_sv[_FC_sv[fi]] });
        }
        sf.sort((a,b) => b.avgD - a.avgD);
        for (const { ps, col } of sf) {
          ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          ctx.beginPath();
          ctx.moveTo(ps[0].x, ps[0].y);
          for (let k=1; k<ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
          ctx.closePath(); ctx.fill();
        }
      };

      ctx.save();
      ctx.globalAlpha = alpha;
      drawRange(fMin, fMax);
      if (finFaces) drawRange(160, 167);
      ctx.restore();
    }
  }
}

/* ── F9 nozzles post-painter — S2 MVac glow (drawn on top, after the face flush) ── */
export function drawF9Nozzles(rc) {
  const { ctx, pts, isF9, rStage } = rc;
  /* The S2 MVac nozzle interior is geometry now (the dark recessed exit cap, 3D so it foreshortens
     and the bell occludes it from the side). The firing flame is the depth-sorted plume in
     drawRocketPlumesAndNozzles — no camera-facing billboard glow here. */

  /* The Stage 1 Merlin octaweb (9 bells) is drawn in drawRocketPlumesAndNozzles — it pushes
     depth-sorted faces, which must happen before the face flush (this function runs after it). */
}

/* ── F9 booster wireframe edges + plume + nozzles + landing legs ── */
export function drawBoosterEdges(rc) {
  const { ctx, project, edgeCamDir, bPts, cosdP, sindP, bOffF, bOffR, bOffU } = rc;
  /* Booster wireframe edges + dark nozzles after stage separation */
  if (bPts) {
    ctx.save();
    ctx.strokeStyle = 'rgba(175,195,215,0.55)';
    ctx.lineWidth   = Math.max(1, devicePixelRatio);
    ctx.beginPath();
    for (const [a, b] of _E_f9) {
      const inB = v => v <= 47 || (v >= 97 && v <= 121);
      if (!inB(a) || !inB(b)) continue;
      const pa = bPts[a], pb = bPts[b];
      if (!pa || !pb) continue;
      if (edgeCamDir(a) > 0 && edgeCamDir(b) > 0) continue;
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke(); ctx.restore();

    /* Booster plume when powered (boostback / entry burn / landing burn) */
    const boosterFiring = ['boostback','entry','landing'].includes(S.booster?.phase);
    if (boosterFiring) {
      const bpN = bPts[113];
      const bpEdge = bPts[114];
      const boostNozzleWorld = (() => {
        const vF = -0.018, vR = 0, vU = 0;
        const rvF = vF * cosdP - vU * sindP;
        const rvU = vF * sindP + vU * cosdP;
        return project([rvF + bOffF, vR + bOffR, rvU + bOffU]);
      })();
      const boostPlumeTip = (() => {
        const vF = -0.018 - 0.025, vR = 0, vU = 0;
        const rvF = vF * cosdP - vU * sindP;
        const rvU = vF * sindP + vU * cosdP;
        return project([rvF + bOffF, vR + bOffR, rvU + bOffU]);
      })();
      if (boostNozzleWorld && boostPlumeTip) {
        const dx = boostPlumeTip.x - boostNozzleWorld.x;
        const dy = boostPlumeTip.y - boostNozzleWorld.y;
        const len = Math.hypot(dx, dy);
        if (len > 2) {
          const px = -dy/len, py = dx/len;
          const nozR2 = bpN && bpEdge
            ? Math.hypot(bpEdge.x-bpN.x, bpEdge.y-bpN.y) * 2.8
            : 7 * devicePixelRatio;
          ctx.save();
          const g2 = ctx.createLinearGradient(
            boostNozzleWorld.x, boostNozzleWorld.y, boostPlumeTip.x, boostPlumeTip.y);
          g2.addColorStop(0,    'rgba(255,240,160,0.75)');
          g2.addColorStop(0.10, 'rgba(255,165, 60,0.55)');
          g2.addColorStop(0.35, 'rgba(200, 70, 15,0.28)');
          g2.addColorStop(1.0,  'rgba(  0,  0,  0,0.00)');
          ctx.fillStyle = g2;
          const mx2 = (boostNozzleWorld.x+boostPlumeTip.x)/2;
          const my2 = (boostNozzleWorld.y+boostPlumeTip.y)/2;
          ctx.beginPath();
          ctx.moveTo(boostNozzleWorld.x+px*nozR2, boostNozzleWorld.y+py*nozR2);
          ctx.quadraticCurveTo(mx2+px*nozR2*2, my2+py*nozR2*2,
                               boostPlumeTip.x+px*nozR2*3.5, boostPlumeTip.y+py*nozR2*3.5);
          ctx.lineTo(boostPlumeTip.x-px*nozR2*3.5, boostPlumeTip.y-py*nozR2*3.5);
          ctx.quadraticCurveTo(mx2-px*nozR2*2, my2-py*nozR2*2,
                               boostNozzleWorld.x-px*nozR2, boostNozzleWorld.y-py*nozR2);
          ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
    }

    const bC = bPts[113], bEdge = bPts[114];
    if (bC && bEdge) {
      const nR = Math.hypot(bEdge.x-bC.x, bEdge.y-bC.y) * 0.46;
      ctx.save();
      ctx.fillStyle = 'rgba(20,22,28,0.95)';
      ctx.beginPath();
      ctx.arc(bC.x, bC.y, Math.hypot(bEdge.x-bC.x, bEdge.y-bC.y) + nR*1.2, 0, Math.PI*2);
      ctx.fill();
      for (const vi of [113,114,115,116,117,118,119,120,121]) {
        const pt = bPts[vi]; if (!pt) continue;
        const r = vi === 65 ? nR*1.15 : nR;
        ctx.fillStyle = 'rgb(22,25,32)';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(90,100,115,0.65)';
        ctx.lineWidth = Math.max(0.5, 0.6*devicePixelRatio);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }

    /* Landing legs — deploy during 'landing' phase */
    const bLegP = S.booster?.phase === 'landing'
      ? Math.min(1, ((S.time ?? 0) - (S.booster?.phaseStartT ?? 0)) / 5)
      : 0;
    if (bLegP > 0.001) {
      const footXStow = -0.015, footRStow = 0.0024;
      const footXDep  = -0.022, footRDep  = 0.0070;
      const fX   = footXStow + (footXDep - footXStow) * bLegP;
      const fRad = footRStow + (footRDep - footRStow) * bLegP;
      const strutRad = _nzO * 1.8;
      ctx.save();
      ctx.strokeStyle = 'rgba(190,205,220,0.78)';
      ctx.lineWidth = Math.max(1, devicePixelRatio);
      ctx.beginPath();
      for (const [nR2, nU2] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const bxf = (vF, vRv, vUv) => {
          const rvF = vF * cosdP - vUv * sindP;
          const rvU = vF * sindP + vUv * cosdP;
          return project([rvF + bOffF, vRv + bOffR, rvU + bOffU]);
        };
        const pShoulder = bxf(-0.016, nR2 * _rf9,   nU2 * _rf9);
        const pFoot     = bxf(fX,     nR2 * fRad,   nU2 * fRad);
        const pStrut    = bxf(-0.018, nR2 * strutRad, nU2 * strutRad);
        if (pShoulder && pFoot) { ctx.moveTo(pShoulder.x, pShoulder.y); ctx.lineTo(pFoot.x, pFoot.y); }
        if (pStrut    && pFoot) { ctx.moveTo(pStrut.x,    pStrut.y);    ctx.lineTo(pFoot.x, pFoot.y); }
      }
      ctx.stroke(); ctx.restore();
    }
  }
}

/* ── Launch pads — LC-39A MLP + LUT lattice (SV/F9), Starbase OLP +
   Mechazilla tower + catch arms (SS) ── */
export function drawLaunchPads(rc) {
  const { ctx, dpr, pts, project, camSide, camBack, camUp, cx, cy, focal, cosP, sinP,
          cosCP, sinCP, cosEl, sinEl, orbitAzDeg, orbitElDeg, svRise: _svRise, ssGeo: _ssGeo,
          isF9, isSV, isSS, altNm: alt_nm } = rc;
  /* ── Launch pad — MLP box + LUT lattice tower (LC-39A) ─────────── */
  if (isSV || isF9) {
    const riseNm  = _svRise;
  if (riseNm < 0.150) {
    const padAlpha = Math.min(1, Math.max(0, (0.150 - riseNm) / 0.100));
    const _r      = isSV ? 0.0028 : 0.0020;
    const _vFbase = isSV ? -0.030 : -0.016;
    const _vFtop  = isSV ?  0.038 :  0.024;
    /* tvF0: MLP top in body-frame. As rocket rises by riseNm, MLP slides down
       by the same amount — keeping it world-anchored to the pad elevation. */
    const tvF0    = _vFbase - riseNm;

    /* Orbit: camera rotates around the rocket's longitudinal axis.
       Applied to pad geometry (which has no body roll) so it moves with
       the rocket body when the user drags to orbit.                     */
    const cosO = Math.cos(orbitAzDeg * DEG), sinO = Math.sin(orbitAzDeg * DEG);

    /* Pitch-only project: tower is fixed in world space, doesn't roll with rocket.
       Orbit rotation applied to vR/vU so pad tracks camera just like the body. */
    const pw = ([vF, vR_, vU_]) => {
      const vR2 = vR_ * cosO - vU_ * sinO;
      const vU2 = vR_ * sinO + vU_ * cosO;
      let   fP  = vF * cosP - vU2 * sinP;
      let   uR  = vF * sinP + vU2 * cosP;
      let   vR3 = vR2;
      if (orbitElDeg !== 0) {
        const vR4 = vR3 * cosEl + uR * sinEl;
        uR  = -vR3 * sinEl + uR * cosEl;
        vR3 = vR4;
      }
      const cfW = camSide > 0 ? camSide - vR3 : camBack + fP;
      const crW = camSide > 0 ? fP : vR3;
      const cuW = uR - camUp;
      const cf  = cfW * cosCP + cuW * sinCP;
      const cu  = cuW * cosCP - cfW * sinCP;
      if (cf < 0.002) return null;
      return { x: cx + crW / cf * focal, y: cy - cu / cf * focal, d: cfW };
    };

    const _drawPadSegs = (segs, color, lw) => {
      ctx.save();
      ctx.globalAlpha = padAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.beginPath();
      for (const [a, b] of segs) {
        const pa = pw(a), pb = pw(b);
        if (!pa || !pb) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.restore();
    };

    /* MLP (Mobile Launcher Platform) — two solid slabs with flame trench between.
       Real LC-39A MLP: ~160ft × 135ft footprint, ~43ft tall.
       mlpSvR is the half-depth in the vR (camera depth) axis.                    */
    const mlpH      = isSV ? 0.0070 : 0.0045;  // ~43ft SV / ~27ft F9
    const mlpSvU    = _r * 4.8;    // +vU extent (away from LUT)
    const mlpSvUlut = _r * 13.0;   // -vU extent (toward LUT, covers wider tapered base)
    const mlpSvR    = isSV ? _r * 4.0 : _r * 3.0;  // half-depth front-to-back (~68ft SV)
    const mlpT = tvF0, mlpB = tvF0 - mlpH;

    /* Flame trench: rectangular gap centred on the rocket, running vU direction.
       Width ≈ 4.4r  ≈ 12.3 m — matches LC-39A trench opening.                   */
    const trenchH = isSV ? _r * 2.2 : _r * 1.6;   // half-width in vU

    const _drawMlpSlice = (vUlo, vUhi) => {
      const mc = [
        [mlpT,-mlpSvR,vUlo],[mlpT,+mlpSvR,vUlo],[mlpT,+mlpSvR,vUhi],[mlpT,-mlpSvR,vUhi],
        [mlpB,-mlpSvR,vUlo],[mlpB,+mlpSvR,vUlo],[mlpB,+mlpSvR,vUhi],[mlpB,-mlpSvR,vUhi],
      ];
      const mcpd = mc.map(pw);
      const mFaces = [
        { idx: [0,3,2,1], col: '#707580' },  // top
        { idx: [7,6,5,4], col: '#1e2230' },  // bottom
        { idx: [0,4,7,3], col: '#404855' },  // -vR side (far)
        { idx: [0,1,5,4], col: '#4a5260' },  // vUlo end
        { idx: [3,7,6,2], col: '#4a5260' },  // vUhi end
        { idx: [1,2,6,5], col: '#5a6270' },  // +vR side (near cam)
      ];
      mFaces.sort((a, b) => {
        const da = a.idx.reduce((s, i) => s + (mcpd[i]?.d ?? 0), 0) / 4;
        const db = b.idx.reduce((s, i) => s + (mcpd[i]?.d ?? 0), 0) / 4;
        return db - da;
      });
      for (const { idx, col } of mFaces) {
        const ps = idx.map(i => mcpd[i]);
        if (ps.some(p => !p)) continue;
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.fillStyle   = col;
        ctx.strokeStyle = 'rgba(130,140,155,0.5)';
        ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    };

    _drawMlpSlice(-mlpSvUlut, -trenchH);   // LUT side
    _drawMlpSlice(+trenchH, +mlpSvU);      // away-from-LUT side

    /* Trench interior — three dark faces that make the hole read as a deep shaft:
       near wall (+vR), far wall (-vR), and floor (mlpB).
       Drawn after the slabs so they overdraw rocket pixels inside the gap.       */
    {
      const _trenchFace = (pts, color) => {
        const ps = pts.map(pw);
        if (!ps.every(Boolean)) return;
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.fillStyle   = color;
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        ps.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      // near wall — camera-facing vertical face at +mlpSvR
      _trenchFace([
        [mlpT, +mlpSvR, -trenchH], [mlpT, +mlpSvR, +trenchH],
        [mlpB, +mlpSvR, +trenchH], [mlpB, +mlpSvR, -trenchH],
      ], '#0c0f18');
      // far wall — back vertical face at -mlpSvR
      _trenchFace([
        [mlpT, -mlpSvR, -trenchH], [mlpT, -mlpSvR, +trenchH],
        [mlpB, -mlpSvR, +trenchH], [mlpB, -mlpSvR, -trenchH],
      ], '#080b15');
      // floor — horizontal face at mlpB (bottom of MLP, inside trench)
      _trenchFace([
        [mlpB, -mlpSvR, -trenchH], [mlpB, +mlpSvR, -trenchH],
        [mlpB, +mlpSvR, +trenchH], [mlpB, -mlpSvR, +trenchH],
      ], '#060810');
    }

    /* Tail Service Arms — 4 tapered lattice towers at fin positions (Saturn V only).
       Each tower is fixed to the MLP. The swing arm at the top releases outward
       as the rocket lifts off.
       Bug guard: riseNm counts from departure.elevation (6ft) but the rocket starts
       at 46ft on top of the MLP — use lift from initial pad altitude instead.      */
    if (isSV) {
      const initialAlt_nm = (S.mission?.initialState?.alt ?? 0) * FT_NM;
      const liftRise  = Math.max(0, alt_nm - initialAlt_nm);
      const swingAng  = Math.min(Math.PI / 2, (liftRise / (_r * 0.6)) * (Math.PI / 2));
      const cosSw = Math.cos(swingAng), sinSw = Math.sin(swingAng);

      const twrH  = _r * 2.6;
      const twrWB = _r * 0.42;
      const twrWT = _r * 0.20;
      const armL  = _r * 1.5;
      const armHW = _r * 0.16;

      /* Solid tapered box section — 4 depth-sorted side faces */
      const _drawTsmSection = (lo, hi, cLo, cHi) => {
        const faces = [
          { k0: 0, k1: 1, col: '#353d48' },   // inner (toward rocket)
          { k0: 2, k1: 3, col: '#505b68' },   // outer
          { k0: 3, k1: 0, col: '#424e5a' },   // -pR side
          { k0: 1, k1: 2, col: '#424e5a' },   // +pR side
        ].map(({ k0, k1, col }) => {
          const pts = [
            pw([lo, cLo[k0][0], cLo[k0][1]]),
            pw([lo, cLo[k1][0], cLo[k1][1]]),
            pw([hi, cHi[k1][0], cHi[k1][1]]),
            pw([hi, cHi[k0][0], cHi[k0][1]]),
          ];
          const d = pts.reduce((s, p) => s + (p?.d ?? 0), 0) / 4;
          return { pts, col, d };
        });
        faces.sort((a, b) => b.d - a.d);
        for (const { pts, col } of faces) {
          if (pts.some(p => !p)) continue;
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = col;
          ctx.strokeStyle = 'rgba(90,105,120,0.35)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      };

      for (const [aR, aU] of [[0,_sv1r],[0,-_sv1r],[_sv1r,0],[-_sv1r,0]]) {
        const mag = Math.hypot(aR, aU) || 1;
        const oR = aR / mag, oU = aU / mag;
        const pR = oU, pU = -oR;
        const cR = aR * 1.55, cU = aU * 1.55;

        const lBot = mlpT, lTop = mlpT + twrH;
        const lMid = (lBot + lTop) * 0.5;

        const corners = (w) => [
          [cR - w * pR - w * oR, cU - w * pU - w * oU],
          [cR + w * pR - w * oR, cU + w * pU - w * oU],
          [cR + w * pR + w * oR, cU + w * pU + w * oU],
          [cR - w * pR + w * oR, cU - w * pU + w * oU],
        ];
        const cB = corners(twrWB), cM = corners((twrWB + twrWT) * 0.5), cT = corners(twrWT);

        _drawTsmSection(lBot, lMid, cB, cM);
        _drawTsmSection(lMid, lTop, cM, cT);

        /* Top cap */
        const topPts = cT.map(c => pw([lTop, c[0], c[1]]));
        if (topPts.every(Boolean)) {
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = '#5a6875';
          ctx.beginPath();
          ctx.moveTo(topPts[0].x, topPts[0].y);
          for (let k = 1; k < topPts.length; k++) ctx.lineTo(topPts[k].x, topPts[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        /* Swing arm — solid quad, pivots outward as rocket lifts */
        const tipF = lTop + armL * cosSw;
        const tipR = cR   + armL * sinSw * oR;
        const tipU = cU   + armL * sinSw * oU;
        const arm = [
          [tipF, tipR - armHW * pR, tipU - armHW * pU],
          [tipF, tipR + armHW * pR, tipU + armHW * pU],
          [lTop, cR   + armHW * pR, cU   + armHW * pU],
          [lTop, cR   - armHW * pR, cU   - armHW * pU],
        ].map(pw);
        if (arm.every(Boolean)) {
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = '#5a6875';
          ctx.strokeStyle = 'rgba(120,140,155,0.4)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(arm[0].x, arm[0].y);
          arm.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* LUT (Launch Umbilical Tower) — rust-orange lattice to rocket's right.
       The tower tapers: base section is wider in both vU and vR, narrowing
       over the bottom two bays to give the A-frame look in the reference photos. */
    const vUi = -_r * 4.5, vUo = -_r * 9.8;   // top dimensions
    const vUiB = -_r * 2.8, vUoB = -_r * 12.5; // base dimensions (wider spread)
    const vRh = _r, vRhB = _r * 1.8;            // base also wider in vR
    const lutTop = tvF0 + (_vFtop - _vFbase) + _r * 2;
    const nLev = 7;
    const lvs = Array.from({ length: nLev }, (_, i) =>
      tvF0 + (i / (nLev - 1)) * (lutTop - tvF0));
    /* Taper: 1.0 at MLP level, 0.0 at lvs[2] and above */
    const _taperAt = lv => Math.max(0, 1 - (lv - tvF0) / (lvs[2] - tvF0));
    const _lc = lv => {
      const t = _taperAt(lv);
      return { ui: vUi + t * (vUiB - vUi), uo: vUo + t * (vUoB - vUo), rh: vRh + t * (vRhB - vRh) };
    };
    const lutSegs = [];
    /* Legs — four vertical corners, each tapering with height */
    for (let i = 0; i < nLev - 1; i++) {
      const l0 = lvs[i], l1 = lvs[i + 1];
      const c0 = _lc(l0), c1 = _lc(l1);
      lutSegs.push(
        [[l0,-c0.rh,c0.ui],[l1,-c1.rh,c1.ui]], [[l0,+c0.rh,c0.ui],[l1,+c1.rh,c1.ui]],
        [[l0,-c0.rh,c0.uo],[l1,-c1.rh,c1.uo]], [[l0,+c0.rh,c0.uo],[l1,+c1.rh,c1.uo]],
      );
    }
    /* Level rings at each floor */
    for (const lv of lvs) {
      const { ui, uo, rh } = _lc(lv);
      lutSegs.push(
        [[lv,-rh,ui],[lv,+rh,ui]], [[lv,-rh,uo],[lv,+rh,uo]],
        [[lv,-rh,ui],[lv,-rh,uo]], [[lv,+rh,ui],[lv,+rh,uo]],
      );
    }
    /* Diagonals per bay */
    for (let i = 0; i < nLev - 1; i++) {
      const l0 = lvs[i], l1 = lvs[i + 1];
      const c0 = _lc(l0), c1 = _lc(l1);
      lutSegs.push([[l0,-c0.rh,c0.ui],[l1,+c1.rh,c1.ui]], [[l0,+c0.rh,c0.ui],[l1,-c1.rh,c1.ui]]);
      const [vU0, vU1] = i % 2 === 0 ? [c0.ui, c1.uo] : [c0.uo, c1.ui];
      lutSegs.push([[l0,-c0.rh,vU0],[l1,-c1.rh,vU1]], [[l0,+c0.rh,vU0],[l1,+c1.rh,vU1]]);
    }
    _drawPadSegs(lutSegs, '#b06830', Math.max(1.5, 1.5 * dpr));

    /* Exhaust / steam clouds — start at engine ignition, grow for ~8 s
       (F-1 spin-up / hold-down period), then fade as rocket climbs. */
    if (isSV) {
      const ignT        = S.aircraft?.ignitionTime ?? 0;
      const sinceIgn    = Math.max(0, (S.time ?? 0) - ignT);
      const growFactor  = Math.min(1, sinceIgn / 8.0);   // 0→1 over first 8 s
      const steamFade   = Math.max(0, 1 - riseNm / 0.040);
      const steamAlpha  = padAlpha * steamFade * growFactor;

      if (steamAlpha > 0.01) {
        const steamSides = [
          { vU: -(trenchH + _r * 0.5) },   // LUT side
          { vU: +(trenchH + _r * 0.5) },   // far side
        ];
        const steamR = growFactor * (_r * 6 + riseNm * 4) * focal / Math.max(0.01, camSide);
        for (const { vU: sU } of steamSides) {
          const cPt = pw([mlpT, 0, sU]);
          if (!cPt) continue;
          /* Outer white steam cloud */
          const g1 = ctx.createRadialGradient(cPt.x, cPt.y, 0, cPt.x, cPt.y, steamR);
          g1.addColorStop(0,   `rgba(240,240,235,${(steamAlpha * 0.70).toFixed(3)})`);
          g1.addColorStop(0.5, `rgba(230,230,225,${(steamAlpha * 0.35).toFixed(3)})`);
          g1.addColorStop(1,   `rgba(210,215,220,0)`);
          ctx.save();
          ctx.fillStyle = g1;
          ctx.beginPath();
          ctx.arc(cPt.x, cPt.y, steamR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          /* Inner amber exhaust glow at trench level */
          const hotPt = pw([mlpT - _r * 0.5, 0, sU * 0.5]);
          if (hotPt) {
            const hotR = steamR * 0.45;
            const g2 = ctx.createRadialGradient(hotPt.x, hotPt.y, 0, hotPt.x, hotPt.y, hotR);
            g2.addColorStop(0,   `rgba(255,200,80,${(steamAlpha * 0.55).toFixed(3)})`);
            g2.addColorStop(0.6, `rgba(220,120,40,${(steamAlpha * 0.20).toFixed(3)})`);
            g2.addColorStop(1,   `rgba(180,90,20,0)`);
            ctx.save();
            ctx.fillStyle = g2;
            ctx.beginPath();
            ctx.arc(hotPt.x, hotPt.y, hotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  } // riseNm < 0.150
  } // isSV || isF9

  /* ── Starbase OLP + Mechazilla tower + catch arms ──────────────── */
  if (isSS) {
    const riseNm   = _svRise;
    if (riseNm < 0.150 && !S.rocketSECO) {
      const padAlpha = Math.min(1, Math.max(0, (0.150 - riseNm) / 0.100));
      const _r       = 0.00243;
      const _vFbase  = -0.025;
      const _vFtop   =  0.040;
      const tvF0     = _vFbase - riseNm;   // world-anchored platform top

      const cosO = Math.cos(orbitAzDeg * DEG), sinO = Math.sin(orbitAzDeg * DEG);
      const pw = ([vF, vR_, vU_]) => {
        const vR2 = vR_ * cosO - vU_ * sinO;
        const vU2 = vR_ * sinO + vU_ * cosO;
        let   fP  = vF * cosP - vU2 * sinP;
        let   uR  = vF * sinP + vU2 * cosP;
        let   vR3 = vR2;
        if (orbitElDeg !== 0) {
          const vR4 = vR3 * cosEl + uR * sinEl;
          uR  = -vR3 * sinEl + uR * cosEl;
          vR3 = vR4;
        }
        const cfW = camSide > 0 ? camSide - vR3 : camBack + fP;
        const crW = camSide > 0 ? fP : vR3;
        const cuW = uR - camUp;
        const cf  = cfW * cosCP + cuW * sinCP;
        const cu  = cuW * cosCP - cfW * sinCP;
        if (cf < 0.002) return null;
        return { x: cx + crW / cf * focal, y: cy - cu / cf * focal, d: cfW };
      };

      const _drawPadSegs = (segs, color, lw) => {
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth   = lw;
        ctx.beginPath();
        for (const [a, b] of segs) {
          const pa = pw(a), pb = pw(b);
          if (!pa || !pb) continue;
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
        }
        ctx.stroke();
        ctx.restore();
      };

      /* ── OLP (permanent launch platform) — solid slab + flame trench ── */
      const olpH    = _r * 3.0;    // ~27 m tall
      const trenchH = _r * 2.0;    // flame trench half-width (~18 m)
      const olpSvU  = _r * 4.5;    // away from tower
      const olpSvUt = _r * 12.5;   // toward tower
      const olpSvR  = _r * 4.2;    // half-depth front-to-back
      const olpT = tvF0, olpB = tvF0 - olpH;

      const _drawOlpSlice = (vUlo, vUhi) => {
        const mc = [
          [olpT,-olpSvR,vUlo],[olpT,+olpSvR,vUlo],[olpT,+olpSvR,vUhi],[olpT,-olpSvR,vUhi],
          [olpB,-olpSvR,vUlo],[olpB,+olpSvR,vUlo],[olpB,+olpSvR,vUhi],[olpB,-olpSvR,vUhi],
        ];
        const mcpd = mc.map(pw);
        const mFaces = [
          { idx:[0,3,2,1], col:'#606570' },
          { idx:[7,6,5,4], col:'#1a1e28' },
          { idx:[0,4,7,3], col:'#3a4050' },
          { idx:[0,1,5,4], col:'#454c5c' },
          { idx:[3,7,6,2], col:'#454c5c' },
          { idx:[1,2,6,5], col:'#525a68' },
        ];
        mFaces.sort((a,b) => {
          const da = a.idx.reduce((s,i)=>s+(mcpd[i]?.d??0),0)/4;
          const db = b.idx.reduce((s,i)=>s+(mcpd[i]?.d??0),0)/4;
          return db - da;
        });
        for (const {idx,col} of mFaces) {
          const ps = idx.map(i => mcpd[i]);
          if (ps.some(p=>!p)) continue;
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = col;
          ctx.strokeStyle = 'rgba(120,130,145,0.4)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(ps[0].x, ps[0].y);
          for (let k=1;k<ps.length;k++) ctx.lineTo(ps[k].x, ps[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      };
      _drawOlpSlice(-olpSvUt, -trenchH);
      _drawOlpSlice(+trenchH, +olpSvU);

      /* Flame trench interior */
      const _trF = (pts, col) => {
        const ps = pts.map(pw);
        if (!ps.every(Boolean)) return;
        ctx.save();
        ctx.globalAlpha = padAlpha;
        ctx.fillStyle   = col;
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        ps.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      _trF([[olpT,+olpSvR,-trenchH],[olpT,+olpSvR,+trenchH],[olpB,+olpSvR,+trenchH],[olpB,+olpSvR,-trenchH]], '#0c0f18');
      _trF([[olpT,-olpSvR,-trenchH],[olpT,-olpSvR,+trenchH],[olpB,-olpSvR,+trenchH],[olpB,-olpSvR,-trenchH]], '#08090e');
      _trF([[olpB,-olpSvR,-trenchH],[olpB,+olpSvR,-trenchH],[olpB,+olpSvR,+trenchH],[olpB,-olpSvR,+trenchH]], '#06070c');

      /* ── Mechazilla tower — heavy steel lattice, close to rocket ── */
      const towerTop = tvF0 + (_vFtop - _vFbase) + _r * 3.5;
      const vUi  = -_r * 2.2;    // inner face — just outside the rocket body
      const vUo  = -_r * 6.8;    // outer face — ~20 m wide tower
      const vRh  = _r * 1.25;    // half-depth front-to-back
      const nLev = 10;
      const lvs  = Array.from({length:nLev}, (_,i) => tvF0 + (i/(nLev-1)) * (towerTop - tvF0));
      const twrSegs = [];
      for (let i = 0; i < nLev - 1; i++) {
        const l0 = lvs[i], l1 = lvs[i+1];
        twrSegs.push(
          [[l0,-vRh,vUi],[l1,-vRh,vUi]], [[l0,+vRh,vUi],[l1,+vRh,vUi]],
          [[l0,-vRh,vUo],[l1,-vRh,vUo]], [[l0,+vRh,vUo],[l1,+vRh,vUo]],
        );
      }
      for (const lv of lvs) {
        twrSegs.push(
          [[lv,-vRh,vUi],[lv,+vRh,vUi]], [[lv,-vRh,vUo],[lv,+vRh,vUo]],
          [[lv,-vRh,vUi],[lv,-vRh,vUo]], [[lv,+vRh,vUi],[lv,+vRh,vUo]],
        );
      }
      for (let i = 0; i < nLev - 1; i++) {
        const l0 = lvs[i], l1 = lvs[i+1];
        twrSegs.push([[l0,-vRh,vUi],[l1,+vRh,vUi]], [[l0,+vRh,vUi],[l1,-vRh,vUi]]);
        const [vU0,vU1] = i%2===0 ? [vUi,vUo] : [vUo,vUi];
        twrSegs.push([[l0,-vRh,vU0],[l1,-vRh,vU1]], [[l0,+vRh,vU0],[l1,+vRh,vU1]]);
      }
      _drawPadSegs(twrSegs, '#7a8898', Math.max(1.5, 1.5 * dpr));

      /* ── Mechazilla catch arms — slide up/down the tower ──
         armVF drives arm height. Pre-launch: at grid-fin level.
         S.mechazillaArmVF can override for assembly / animated catch. */
      const _gridFinWorldVF = tvF0 + (0.013 - _vFbase);   // grid-fin height in world frame
      const armVF    = S.mechazillaArmVF != null
                       ? (tvF0 + S.mechazillaArmVF)        // mission-driven position
                       : _gridFinWorldVF;                   // default: catch-ready
      const armHT    = _r * 0.22;   // half-thickness (vF axis)
      const armHW    = _r * 0.32;   // half-width (vR axis)
      const armTip   = +_r * 1.6;   // tip reaches past rocket to far side
      const armRoot  = vUi;         // root attached to tower inner face

      const _drawArm = (vRc) => {
        const ac = [
          [armVF+armHT, vRc-armHW, armTip],  [armVF+armHT, vRc+armHW, armTip],
          [armVF+armHT, vRc+armHW, armRoot], [armVF+armHT, vRc-armHW, armRoot],
          [armVF-armHT, vRc-armHW, armTip],  [armVF-armHT, vRc+armHW, armTip],
          [armVF-armHT, vRc+armHW, armRoot], [armVF-armHT, vRc-armHW, armRoot],
        ].map(pw);
        const aFaces = [
          {idx:[0,3,2,1], col:'#909aa8'},   // top
          {idx:[7,6,5,4], col:'#404850'},   // bottom
          {idx:[0,4,7,3], col:'#686e7a'},   // -vR side
          {idx:[1,2,6,5], col:'#787e8a'},   // +vR side
          {idx:[0,1,5,4], col:'#585f6a'},   // tip
          {idx:[2,3,7,6], col:'#585f6a'},   // root
        ];
        aFaces.sort((a,b) => {
          const da = a.idx.reduce((s,i)=>s+(ac[i]?.d??0),0)/4;
          const db = b.idx.reduce((s,i)=>s+(ac[i]?.d??0),0)/4;
          return db - da;
        });
        for (const {idx,col} of aFaces) {
          const ps = idx.map(i => ac[i]);
          if (ps.some(p=>!p)) continue;
          ctx.save();
          ctx.globalAlpha = padAlpha;
          ctx.fillStyle   = col;
          ctx.strokeStyle = 'rgba(160,170,185,0.3)';
          ctx.lineWidth   = Math.max(0.5, 0.5 * dpr);
          ctx.beginPath();
          ctx.moveTo(ps[0].x, ps[0].y);
          for (let k=1;k<ps.length;k++) ctx.lineTo(ps[k].x, ps[k].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        /* Truss X-bracing along arm length (5 panels, seen from side) */
        const span = armTip - armRoot;
        const nPan = 5;
        const pW   = span / nPan;
        const tSegs = [];
        for (let i = 0; i <= nPan; i++) {
          const u = armRoot + i * pW;
          tSegs.push([[armVF+armHT, vRc, u], [armVF-armHT, vRc, u]]);   // vertical divider
          if (i < nPan) {
            tSegs.push([[armVF+armHT, vRc, u],    [armVF-armHT, vRc, u+pW]]);  // \ diagonal
            tSegs.push([[armVF-armHT, vRc, u],    [armVF+armHT, vRc, u+pW]]);  // / diagonal
          }
        }
        _drawPadSegs(tSegs, 'rgba(140,158,175,0.28)', Math.max(0.6, 0.7 * dpr));
        /* Fan of diagonal support struts from carriage lower mount to arm underside
           (matches the radiating support structure visible in the reference) */
        const mountF = armVF - _r * 0.9;   // carriage attachment below arm
        const supportSegs = [
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.18]],
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.36]],
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.52]],
          [[mountF, vRc, armRoot], [armVF-armHT, vRc, armRoot + span * 0.65]],
        ];
        _drawPadSegs(supportSegs, '#6a7a8a', Math.max(1, 1.2 * dpr));
      };
      _drawArm(+_r * 0.7);
      _drawArm(-_r * 0.7);

      /* ── Steam / exhaust cloud — 33 Raptors, water deluge ── */
      {
        const ignT       = S.aircraft?.ignitionTime ?? 0;
        const sinceIgn   = Math.max(0, (S.time ?? 0) - ignT);
        const growFactor = Math.min(1, sinceIgn / 4.0);   // grows over ~4 s
        const steamFade  = Math.max(0, 1 - riseNm / 0.040);
        const steamAlpha = padAlpha * steamFade * growFactor;

        if (steamAlpha > 0.01) {
          /* Two emission points flanking the trench, same as SV */
          const steamSides = [
            { vU: -(trenchH + _r * 0.5) },   // tower side
            { vU: +(trenchH + _r * 0.5) },   // far side
          ];
          /* 33 engines → larger cloud than Saturn V */
          const steamR = growFactor * (_r * 9 + riseNm * 5) * focal / Math.max(0.01, camSide);
          for (const { vU: sU } of steamSides) {
            const cPt = pw([olpT, 0, sU]);
            if (!cPt) continue;
            const g1 = ctx.createRadialGradient(cPt.x, cPt.y, 0, cPt.x, cPt.y, steamR);
            g1.addColorStop(0,   `rgba(240,242,245,${(steamAlpha * 0.75).toFixed(3)})`);
            g1.addColorStop(0.5, `rgba(225,228,232,${(steamAlpha * 0.38).toFixed(3)})`);
            g1.addColorStop(1,   `rgba(200,210,220,0)`);
            ctx.save();
            ctx.fillStyle = g1;
            ctx.beginPath();
            ctx.arc(cPt.x, cPt.y, steamR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            /* Inner exhaust glow — methane burns clean, less amber than RP-1 */
            const hotPt = pw([olpT - _r * 0.4, 0, sU * 0.4]);
            if (hotPt) {
              const hotR = steamR * 0.40;
              const g2 = ctx.createRadialGradient(hotPt.x, hotPt.y, 0, hotPt.x, hotPt.y, hotR);
              g2.addColorStop(0,   `rgba(240,220,140,${(steamAlpha * 0.45).toFixed(3)})`);
              g2.addColorStop(0.6, `rgba(180,140, 60,${(steamAlpha * 0.18).toFixed(3)})`);
              g2.addColorStop(1,   `rgba(120, 80, 20,0)`);
              ctx.save();
              ctx.fillStyle = g2;
              ctx.beginPath();
              ctx.arc(hotPt.x, hotPt.y, hotR, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }
    } // riseNm < 0.150

    /* ── Landing steam — Raptor plume hits water, reuses liftoff cloud style ── */
    if (S.starshipFlipStartT && !S.starshipSplashdown && rStage >= 2) {
      const sinceFlip  = Math.max(0, (S.time ?? 0) - S.starshipFlipStartT);
      const growFactor = Math.min(1, sinceFlip / 3.5);
      const steamAlpha = growFactor * 0.72;
      if (steamAlpha > 0.01) {
        const _r    = 0.00243;
        const engPt = project([0.013, 0, 0]);   // ship Raptor cluster — bottom after flip
        if (engPt) {
          const dist  = camSide > 0 ? camSide : camBack;
          const steamR = growFactor * _r * 10 * focal / Math.max(0.01, dist);
          /* Two puffs flanking the engine cluster (left/right), same as liftoff trench sides */
          for (const off of [-1, +1]) {
            const pPt = project([0.013, off * _r * 1.5, 0]) ?? engPt;
            const g1 = ctx.createRadialGradient(pPt.x, pPt.y, 0, pPt.x, pPt.y, steamR);
            g1.addColorStop(0,   `rgba(240,242,245,${(steamAlpha * 0.70).toFixed(3)})`);
            g1.addColorStop(0.5, `rgba(225,228,232,${(steamAlpha * 0.35).toFixed(3)})`);
            g1.addColorStop(1,   'rgba(200,210,220,0)');
            ctx.save();
            ctx.fillStyle = g1;
            ctx.beginPath();
            ctx.arc(pPt.x, pPt.y, steamR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          /* Inner methane exhaust glow — same tint as liftoff */
          const hotR = steamR * 0.42;
          const g2 = ctx.createRadialGradient(engPt.x, engPt.y, 0, engPt.x, engPt.y, hotR);
          g2.addColorStop(0,   `rgba(240,220,140,${(steamAlpha * 0.50).toFixed(3)})`);
          g2.addColorStop(0.6, `rgba(180,140, 60,${(steamAlpha * 0.20).toFixed(3)})`);
          g2.addColorStop(1,   'rgba(120,80,20,0)');
          ctx.save();
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.arc(engPt.x, engPt.y, hotR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  } // isSS
}
