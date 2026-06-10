/* Livery + national-marking draw helpers — SVG decal projection (per-face
   affine / cylindrical / bounding-box), Swiss cross, winglet logo billboard,
   Polish szachownica roundel. Extracted from outside.js. */
import { S } from '../core/state.js';
import { _r } from './outside-wb.js';   /* default fuselage radius — vtail placement fallback */
import { _m15r } from './outside-mig15.js';

/* ── Livery decals — SVG paths projected onto named surface group ─
   Per-face affine mapping: each visible face gets its own SVG→screen
   transform derived from UV coordinates, eliminating cylinder distortion.
   Fallback to bounding-box for decals without placement.               */
export function _drawLiveryDecals(ctx, decals, pts, verts, FC_, F_, project, camSide = 0, faceBr = null, wCol = null) {
  /* Shade a CSS hex fill by a face brightness (warm sun tint), so painted decals pick up
     the same per-face lighting as the fuselage instead of reading as flat colour. */
  let _shadeBr = 1;
  const _shadeCol = (c) => {
    if (!faceBr || !wCol || _shadeBr >= 0.999 || typeof c !== 'string') return c;
    const m = /^#([0-9a-fA-F]{6})$/.exec(c);
    if (!m) return c;
    const n = parseInt(m[1], 16);
    return wCol([(n >> 16) & 255, (n >> 8) & 255, n & 255], _shadeBr);
  };
  /* engine maps to both regular nacelle (4) and TR zone (7) so the logo is uninterrupted */
  const SURF = { vtail: 2, nose: 6, fuselage: 0, engine: [4, 7], winglet: 9, noseband: [6, 0] };
  for (const decal of decals) {
    const cIdxVal = SURF[decal.surface];
    if (cIdxVal === undefined) continue;
    const cIdxList = Array.isArray(cIdxVal) ? cIdxVal : [cIdxVal];
    const vb = (decal.viewBox ?? '0 0 100 100').split(' ').map(Number);
    const [vbX, vbY, vbW, vbH] = vb;
    const elems = decal.elements ?? [];
    if (!elems.length) continue;

    /* Vtail decals: synthesize a placement quad from the fin corners (vstab block), so
       the logo maps onto the real fin surface and follows any fin change. finFill 1 =
       fills the whole fin (Edelweiss flower); other liveries use a smaller fraction. */
    let _pl = decal.placement;
    let _flipV = false;   // synthesized fin placement maps v=0 at the root; flip so SVG-top → fin-tip
    if (!_pl && decal.surface === 'vtail' && S.aircraft?.vstab) {
      _flipV = true;
      const _vs = S.aircraft.vstab;
      const _fr = S.aircraft.geometry?.r ?? S.aircraft.nose?.r ?? _r;
      const _ff = decal.finFill ?? 1;
      /* finFill 1 = the placement hugs the full fin outline (the Edelweiss flower is
         drawn to fill the whole swept tail); smaller liveries use a fraction. The
         inverse-bilinear UV map below follows the swept/tapered quad exactly. */
      const _cnr = [[_vs.rootLE,0,_fr],[_vs.rootTE,0,_fr],[_vs.tipTE,0,_vs.tipZ],[_vs.tipLE,0,_vs.tipZ]];
      const _cx = (_cnr[0][0]+_cnr[1][0]+_cnr[2][0]+_cnr[3][0])/4;
      const _cz = (_cnr[0][2]+_cnr[1][2]+_cnr[2][2]+_cnr[3][2])/4;
      _pl = _cnr.map(p => [_cx+(p[0]-_cx)*_ff, 0, _cz+(p[2]-_cz)*_ff]);
    }

    function drawElems() {
      for (const el of elems) {
        ctx.save();
        if (el.rotate) {
          const rcx = el.rcx ?? (vbX + vbW / 2);
          const rcy = el.rcy ?? (vbY + vbH / 2);
          ctx.translate(rcx, rcy);
          ctx.rotate(el.rotate * Math.PI / 180);
          ctx.translate(-rcx, -rcy);
        }
        ctx.fillStyle = _shadeCol(el.fill ?? '#ffffff');
        ctx.globalAlpha = el.opacity ?? 1;
        if (el.text != null) {
          /* Text element (registrations, simple titles) — drawn in the same
             SVG→surface affine, so it wraps/perspectives like a path decal. */
          ctx.font = `${el.weight ?? '700'} ${el.size ?? 16}px ${el.font ?? 'Arial, Helvetica, sans-serif'}`;
          ctx.textAlign = el.align ?? 'center';
          ctx.textBaseline = el.baseline ?? 'middle';
          ctx.fillText(el.text, el.x ?? 0, el.y ?? 0);
        } else {
          const _path = new Path2D(el.d);
          if (el.fill !== 'none') ctx.fill(_path);
          if (el.stroke) {                         // optional outline (e.g. logo blue edging)
            ctx.strokeStyle = _shadeCol(el.stroke);
            ctx.lineWidth   = el.strokeWidth ?? 1;
            ctx.lineJoin    = 'round';
            ctx.stroke(_path);
          }
        }
        ctx.restore();
      }
    }

    if ((_pl || decal.cylindrical) && verts) {
      const _cyl = decal.cylindrical;   // { x0, x1, a0, a1 } unrolled fuselage: u=station, v=angle°
      let _faceUV;
      if (_cyl) {
        /* Cylindrical (unrolled-fuselage) mapping: u = fuselage station (x0→x1), v =
           circumferential angle θ = atan2(z, y) in degrees (right 0°, crown +90°, belly
           −90°, left ±180°). Per-face the angles are unwrapped relative to the first vertex,
           so a triangle straddling the ±180° seam doesn't smear the whole artwork. */
        const _xr = (_cyl.x1 - _cyl.x0) || 1e-9, _ar = (_cyl.a1 - _cyl.a0) || 1e-9;
        _faceUV = (fv) => {
          const raw = fv.map(vi => { const W = verts[vi];
            /* normalise into [a0, a0+360) so a PARTIAL wrap (crown+sides, no belly) picks
               the right branch for every face, not just seam-straddling ones */
            let ang = Math.atan2(W[2], W[1]) * 180 / Math.PI;
            ang = ((ang - _cyl.a0) % 360 + 360) % 360 + _cyl.a0;
            return { u: (W[0] - _cyl.x0) / _xr, ang }; });
          const a0r = raw[0].ang;
          return raw.map(r => { let ang = r.ang;
            if (ang - a0r > 180) ang -= 360; else if (ang - a0r < -180) ang += 360;
            return { u: r.u, v: (ang - _cyl.a0) / _ar }; });
        };
      } else {
      /* Per-face affine: placement[0..3] defines a UV quad in 3D world space.
         U = placement[0]→placement[1], V = placement[0]→placement[3].        */
      const pl = _pl;
      const P0 = pl[0], P1 = pl[1], P3 = pl[3];
      const P2 = pl[2] ?? [P1[0]+P3[0]-P0[0], P1[1]+P3[1]-P0[1], P1[2]+P3[2]-P0[2]];
      const Ux = P1[0]-P0[0], Uy = P1[1]-P0[1], Uz = P1[2]-P0[2];
      const Vx = P3[0]-P0[0], Vy = P3[1]-P0[1], Vz = P3[2]-P0[2];
      const lenU2 = Ux*Ux + Uy*Uy + Uz*Uz;
      const lenV2 = Vx*Vx + Vy*Vy + Vz*Vz;
      if (lenU2 < 1e-20 || lenV2 < 1e-20) continue;
      /* Inverse-bilinear UV over the full quad P0,P1,P2,P3 (not just the P0/U/V
         parallelogram). For a swept/tapered placement (the v-stab) the 4th corner P2
         (tip TE) sits well inside the parallelogram, so the linear map shears the decal
         off the surface; the bilinear solve follows the real quad. Reduces exactly to the
         linear map when P2 = P1+P3-P0 (flat panels: fuselage, engine, nose). The quad is
         planar, so we solve in a 2-D in-plane basis (a1 along U, a2 = (U×V)×U ⟂ U). */
      const _nx = Uy*Vz-Uz*Vy, _ny = Uz*Vx-Ux*Vz, _nz = Ux*Vy-Uy*Vx;   // plane normal U×V
      const _a2x = _ny*Uz-_nz*Uy, _a2y = _nz*Ux-_nx*Uz, _a2z = _nx*Uy-_ny*Ux; // n×U (in-plane ⟂ U)
      const _uLen = Math.sqrt(lenU2) || 1, _a2L = Math.hypot(_a2x,_a2y,_a2z) || 1;
      const _to2D = (px,py,pz) => { const dx=px-P0[0], dy=py-P0[1], dz=pz-P0[2];
        return [ (dx*Ux+dy*Uy+dz*Uz)/_uLen, (dx*_a2x+dy*_a2y+dz*_a2z)/_a2L ]; };
      const _q1 = _to2D(P1[0],P1[1],P1[2]), _q2 = _to2D(P2[0],P2[1],P2[2]), _q3 = _to2D(P3[0],P3[1],P3[2]);
      const _crz = (ax,ay,bx,by) => ax*by - ay*bx;
      const _ex=_q1[0], _ey=_q1[1], _fx=_q3[0], _fy=_q3[1];              // q0 is the origin (0,0)
      const _gx=_q2[0]-_q1[0]-_q3[0], _gy=_q2[1]-_q1[1]-_q3[1];          // q0-q1+q2-q3 (q0=0)
      const _invBilin = (W) => {
        const p = _to2D(W[0],W[1],W[2]);
        const hx=p[0], hy=p[1];
        const k2=_crz(_gx,_gy,_fx,_fy);
        const k1=_crz(_ex,_ey,_fx,_fy)+_crz(hx,hy,_gx,_gy);
        const k0=_crz(hx,hy,_ex,_ey);
        let v;
        if (Math.abs(k2) < 1e-12*(Math.abs(k1)||1)) { v = -k0/(k1||1e-20); }
        else { const disc=Math.max(0,k1*k1-4*k2*k0), sq=Math.sqrt(disc);
          const v1=(-k1+sq)/(2*k2), v2=(-k1-sq)/(2*k2);
          v = (v1>=-0.02 && v1<=1.02) ? v1 : v2; }
        const dnx=_ex+_gx*v, dny=_ey+_gy*v;
        const u = Math.abs(dnx) > Math.abs(dny) ? (hx-_fx*v)/(dnx||1e-20) : (hy-_fy*v)/(dny||1e-20);
        return { u, v };
      };
      _faceUV = (fv) => fv.map(vi => _invBilin(verts[vi]));
      }

      for (let fi = 0; fi < F_.length; fi++) {
        if (!cIdxList.includes(FC_[fi])) continue;
        const fv = F_[fi];
        const fp = fv.map(vi => pts[vi]);
        if (fp.some(p => !p)) continue;
        /* Front-face cull */
        const cross = (fp[1].x-fp[0].x)*(fp[2].y-fp[0].y)
                    - (fp[1].y-fp[0].y)*(fp[2].x-fp[0].x);
        if (cross < 0) continue;

        /* Engine decals: only render on the near-side engine (prevents far engine bleeding through) */
        if (decal.surface === 'engine' && camSide !== 0 && verts) {
          const avgY = fv.reduce((s, vi) => s + verts[vi][1], 0) / fv.length;
          if (camSide > 0 && avgY < 0) continue;
          if (camSide < 0 && avgY > 0) continue;
        }

        /* Vtail LE-nose round faces (+ the dorsal-fin centreplane triangle) have mixed
           UV chirality — skip them. They're the only col-2 faces with a vertex *exactly*
           on the y=0 centreline; the airfoil's own LE/TE verts are thin but non-zero, so
           the threshold must stay below them (a thin fin can put a TE vert at ~1e-5). */
        if (FC_[fi] === 2 && verts && fv.some(vi => Math.abs(verts[vi][1]) < 1e-6)) continue;

        /* Vertex → UV ∈ [0,1]×[0,1] (placement quad, or unrolled-fuselage cylinder) */
        _shadeBr = faceBr ? faceBr(fi) : 1;   // per-face lighting → shade the decal like the skin
        const uvs = _faceUV(fv);
        if (_flipV) for (const uv of uvs) uv.v = 1 - uv.v;

        /* Skip faces entirely outside the placement quad */
        if (uvs.every(uv => uv.u < -0.05) || uvs.every(uv => uv.u > 1.05) ||
            uvs.every(uv => uv.v < -0.05) || uvs.every(uv => uv.v > 1.05)) continue;

        /* Draw per TRIANGLE (fan from vert 0). A quad's per-face affine can be exact for
           only 3 of its 4 corners, so on a non-parallelogram surface (the swept v-stab)
           the 4th corner is mis-mapped and neighbouring faces tear at their shared edge.
           Splitting into triangles gives each an exact affine, so shared edges register.
           Chirality (autoFlip) is detected per-triangle: if the UV triangle is CW, flip u
           so the affine stays orientation-preserving (tube vs flat panels wind oppositely). */
        for (let _t = 1; _t + 1 < fv.length; _t++) {
          const _ix = [0, _t, _t + 1];
          const _tuv = _ix.map(i => uvs[i]);
          const _tfp = _ix.map(i => fp[i]);
          const svgR = _tuv.map(uv => ({ x: vbX + uv.u*vbW, y: vbY + uv.v*vbH }));
          const detUV = (svgR[1].x-svgR[0].x)*(svgR[2].y-svgR[0].y)
                      - (svgR[1].y-svgR[0].y)*(svgR[2].x-svgR[0].x);
          const doFlip = decal.flipU ? !(detUV < 0) : (detUV < 0);
          const svgs = doFlip
            ? _tuv.map(uv => ({ x: vbX + (1 - uv.u)*vbW, y: vbY + uv.v*vbH }))
            : svgR;
          const s0=svgs[0], s1=svgs[1], s2=svgs[2];
          const d0=_tfp[0], d1=_tfp[1], d2=_tfp[2];
          const ds1x=s1.x-s0.x, ds1y=s1.y-s0.y;
          const ds3x=s2.x-s0.x, ds3y=s2.y-s0.y;
          const dd1x=d1.x-d0.x, dd1y=d1.y-d0.y;
          const dd3x=d2.x-d0.x, dd3y=d2.y-d0.y;
          const det = ds1x*ds3y - ds1y*ds3x;
          if (Math.abs(det) < 0.01) continue;
          const ma = (dd1x*ds3y - dd3x*ds1y) / det;
          const mc = (ds1x*dd3x - ds3x*dd1x) / det;
          const mb = (dd1y*ds3y - dd3y*ds1y) / det;
          const md = (ds1x*dd3y - ds3x*dd1y) / det;
          const me = d0.x - ma*s0.x - mc*s0.y;
          const mf = d0.y - mb*s0.x - md*s0.y;
          /* Inflate the clip triangle ~0.5px outward from its centroid so adjacent
             triangles overlap a hair — hides the anti-alias hairline along shared edges. */
          const _gx=(d0.x+d1.x+d2.x)/3, _gy=(d0.y+d1.y+d2.y)/3;
          const _infl = (p) => { const vx=p.x-_gx, vy=p.y-_gy, l=Math.hypot(vx,vy)||1;
            return { x: p.x + vx/l*0.6, y: p.y + vy/l*0.6 }; };
          const c0=_infl(d0), c1=_infl(d1), c2=_infl(d2);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
          ctx.closePath();
          ctx.clip();
          ctx.transform(ma, mb, mc, md, me, mf);
          drawElems();
          ctx.restore();
        }
      }

      /* Debug: project placement quad to screen and draw colored outline */
      if (decal.debug && _pl) {
        const pl = _pl, P0 = pl[0], P1 = pl[1], P3 = pl[3];
        const sp = [pl[0], pl[1], pl[2] ?? [P1[0]+P3[0]-P0[0], P1[1]+P3[1]-P0[1], P1[2]+P3[2]-P0[2]], pl[3]].map(c => project(c));
        if (sp.every(p => p)) {
          ctx.save();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ff3300';
          ctx.beginPath();
          ctx.moveTo(sp[0].x, sp[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(sp[i].x, sp[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.strokeStyle = '#0088ff';  // U: P0→P1
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y); ctx.lineTo(sp[1].x, sp[1].y); ctx.stroke();
          ctx.strokeStyle = '#00cc44';  // V: P0→P3
          ctx.beginPath(); ctx.moveTo(sp[0].x, sp[0].y); ctx.lineTo(sp[3].x, sp[3].y); ctx.stroke();
          ctx.fillStyle = '#ff3300';
          ctx.font = 'bold 11px monospace';
          ['P0','P1','P2','P3'].forEach((lbl, i) => ctx.fillText(lbl, sp[i].x+3, sp[i].y-4));
          ctx.restore();
        }
      }
    } else {
      /* Fallback: fit SVG into screen bounding box of all visible surface faces */
      const sPts = [];
      for (let fi = 0; fi < F_.length; fi++) {
        if (!cIdxList.includes(FC_[fi])) continue;
        const fv = F_[fi], fp = fv.map(vi => pts[vi]);
        if (fp.some(p => !p)) continue;
        const cross = (fp[1].x-fp[0].x)*(fp[2].y-fp[0].y)
                    - (fp[1].y-fp[0].y)*(fp[2].x-fp[0].x);
        if (cross < 0) continue;
        for (const p of fp) sPts.push(p);
      }
      if (sPts.length < 3) continue;
      let bx0=Infinity, bx1=-Infinity, by0=Infinity, by1=-Infinity;
      for (const p of sPts) {
        if (p.x<bx0) bx0=p.x; if (p.x>bx1) bx1=p.x;
        if (p.y<by0) by0=p.y; if (p.y>by1) by1=p.y;
      }
      const sw=bx1-bx0, sh=by1-by0;
      if (sw<4 || sh<4) continue;
      const sx=sw/vbW, sy=sh/vbH;
      ctx.save();
      ctx.beginPath();
      for (let fi2 = 0; fi2 < F_.length; fi2++) {
        if (!cIdxList.includes(FC_[fi2])) continue;
        const fv2 = F_[fi2].map(vi => pts[vi]);
        if (fv2.some(p => !p)) continue;
        const cr2 = (fv2[1].x-fv2[0].x)*(fv2[2].y-fv2[0].y)
                  - (fv2[1].y-fv2[0].y)*(fv2[2].x-fv2[0].x);
        if (cr2 < 0) continue;
        ctx.moveTo(fv2[0].x, fv2[0].y);
        for (let i2 = 1; i2 < fv2.length; i2++) ctx.lineTo(fv2[i2].x, fv2[i2].y);
        ctx.closePath();
      }
      ctx.clip();
      ctx.transform(sx, 0, 0, sy, bx0 - vbX*sx, by0 - vbY*sy);
      drawElems();
      ctx.restore();
    }
  }
}

/* ── Swiss cross on V-stab tail fin ──────────────────────────── */
export function _drawSwissCross(ctx, p0, p1, p2, p3, vFrac = 0.5) {
  if (!p0 || !p1 || !p2 || !p3) return;
  // p0=fwd_base, p1=aft_base, p2=aft_top, p3=fwd_top
  const bmx = (p0.x + p1.x) * 0.5, bmy = (p0.y + p1.y) * 0.5;
  const tmx = (p2.x + p3.x) * 0.5, tmy = (p2.y + p3.y) * 0.5;
  const fcx = bmx*(1-vFrac) + tmx*vFrac, fcy = bmy*(1-vFrac) + tmy*vFrac;
  const upLen = Math.hypot(tmx - bmx, tmy - bmy);
  if (upLen < 4) return;
  const uux = 0, uuy = -1;                // screen up (fixed vertical)
  const urx = 1, ury =  0;               // screen right (fixed horizontal)
  const sc  = upLen * 0.38;               // cross fits ~76% of fin height

  /* plus-sign polygon — 12 vertices in local (right, up) space */
  function pt(r, u) {
    return [fcx + r*urx*sc + u*uux*sc, fcy + r*ury*sc + u*uuy*sc];
  }
  const [x0,y0]=pt(-0.2, 0.6), [x1,y1]=pt( 0.2, 0.6);
  const [x2,y2]=pt( 0.2, 0.2), [x3,y3]=pt( 0.6, 0.2);
  const [x4,y4]=pt( 0.6,-0.2), [x5,y5]=pt( 0.2,-0.2);
  const [x6,y6]=pt( 0.2,-0.6), [x7,y7]=pt(-0.2,-0.6);
  const [x8,y8]=pt(-0.2,-0.2), [x9,y9]=pt(-0.6,-0.2);
  const [xA,yA]=pt(-0.6, 0.2), [xB,yB]=pt(-0.2, 0.2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y);
  ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.beginPath();
  ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.lineTo(x3,y3); ctx.lineTo(x4,y4); ctx.lineTo(x5,y5);
  ctx.lineTo(x6,y6); ctx.lineTo(x7,y7); ctx.lineTo(x8,y8);
  ctx.lineTo(x9,y9); ctx.lineTo(xA,yA); ctx.lineTo(xB,yB);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ── Winglet logo — billboard an SVG decal (e.g. the Edelweiss flower) onto the
   winglet quad, centred and scaled to it, clipped to the quad. Reuses the same
   path elements as the surface decal (fill + optional stroke).                */
export function _drawWingletLogo(ctx, p0, p1, p2, p3, els, vb) {
  if (!p0 || !p1 || !p2 || !p3 || !els) return;
  const bmx = (p0.x + p1.x) * 0.5, bmy = (p0.y + p1.y) * 0.5;
  const tmx = (p2.x + p3.x) * 0.5, tmy = (p2.y + p3.y) * 0.5;
  const upLen = Math.hypot(tmx - bmx, tmy - bmy);
  if (upLen < 5) return;
  const cx = (bmx + tmx) * 0.5, cy = (bmy + tmy) * 0.5;
  const [vbx, vby, vbw, vbh] = vb;
  const sc = upLen * 0.85 / vbh;                       // fit ~85% of the winglet height
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
  ctx.closePath(); ctx.clip();                         // clip to the winglet (screen space)
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.translate(-(vbx + vbw / 2), -(vby + vbh / 2));   // centre the viewBox on the quad
  for (const el of els) {
    if (el.d == null) continue;
    const path = new Path2D(el.d);
    if (el.fill && el.fill !== 'none') { ctx.fillStyle = el.fill; ctx.fill(path); }
    if (el.stroke) { ctx.strokeStyle = el.stroke; ctx.lineWidth = (el.strokeWidth ?? 1); ctx.lineJoin = 'round'; ctx.stroke(path); }
  }
  ctx.restore();
}

/* ── Polish szachownica roundel (2×2 red/white checkerboard) ───────────────
   pBL = base LE, pBR = base TE, pTR = tip TE, pTL = tip LE                 */
export function _drawPolishRoundel(ctx, pBL, pBR, pTR, pTL) {
  if (!pBL || !pBR || !pTR || !pTL) return;
  const bx = (pBL.x + pBR.x) * 0.5, by = (pBL.y + pBR.y) * 0.5;
  const tx = (pTR.x + pTL.x) * 0.5, ty = (pTR.y + pTL.y) * 0.5;
  const hLen = Math.hypot(tx - bx, ty - by);
  if (hLen < 6) return;
  const uux = (tx - bx) / hLen, uuy = (ty - by) / hLen;   // "up" unit vec
  const chLen = Math.hypot(pBR.x - pBL.x, pBR.y - pBL.y);
  const urx = chLen > 0.5 ? (pBR.x - pBL.x) / chLen : uuy;  // "right" unit vec
  const ury = chLen > 0.5 ? (pBR.y - pBL.y) / chLen : -uux;
  /* Centre at 65% up, mid-chord */
  const cx = bx + uux * hLen * 0.65, cy = by + uuy * hLen * 0.65;
  const sz  = hLen * 0.12;  // half-side of checkerboard square
  const pt  = (r, u) => [cx + r*urx*sz + u*uux*sz, cy + r*ury*sz + u*uuy*sz];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pBL.x, pBL.y); ctx.lineTo(pBR.x, pBR.y);
  ctx.lineTo(pTR.x, pTR.y); ctx.lineTo(pTL.x, pTL.y);
  ctx.closePath(); ctx.clip();
  /* White background */
  ctx.fillStyle = 'rgba(240,240,240,0.93)';
  const [c0x,c0y]=pt(-1,-1),[c1x,c1y]=pt(1,-1),[c2x,c2y]=pt(1,1),[c3x,c3y]=pt(-1,1);
  ctx.beginPath(); ctx.moveTo(c0x,c0y); ctx.lineTo(c1x,c1y); ctx.lineTo(c2x,c2y); ctx.lineTo(c3x,c3y); ctx.closePath(); ctx.fill();
  /* Red quadrants: top-left and bottom-right */
  ctx.fillStyle = 'rgba(192,24,24,0.93)';
  const [tl0x,tl0y]=pt(-1,0),[tl1x,tl1y]=pt(0,0),[tl2x,tl2y]=pt(0,1),[tl3x,tl3y]=pt(-1,1);
  ctx.beginPath(); ctx.moveTo(tl0x,tl0y); ctx.lineTo(tl1x,tl1y); ctx.lineTo(tl2x,tl2y); ctx.lineTo(tl3x,tl3y); ctx.closePath(); ctx.fill();
  const [br0x,br0y]=pt(0,-1),[br1x,br1y]=pt(1,-1),[br2x,br2y]=pt(1,0),[br3x,br3y]=pt(0,0);
  ctx.beginPath(); ctx.moveTo(br0x,br0y); ctx.lineTo(br1x,br1y); ctx.lineTo(br2x,br2y); ctx.lineTo(br3x,br3y); ctx.closePath(); ctx.fill();
  ctx.restore();
}


/* Per-face brightness for decals — same lighting as the fuselage skin (litBr on
   the rotated face normal), so painted livery shades instead of reading flat. */
const _mkDecalBr = (rc) => (fi) => {
  const [nF, nR, nU] = rc.rotateNormal(rc.FN_[fi]);
  return rc.litBr(nF, nR, nU, 0.18);
};

const _DBG_PANELS = false;  // ← set true to label cockpitPanel corners with coords

/* ── Cockpit glazing — cylindrical livery bands, silver window frames,
   front glass, windshield ring outline; post-painter. ── */
export function drawCockpitGlazing(rc) {
  const { ctx, dpr, pts, verts, FC_, F_, project, camSide, wCol: _wCol,
          wbGeo: _wbGeo, cpCamF: _cpCamF, cpCamR: _cpCamR, cpCamU: _cpCamU,
          edgeCamDir } = rc;
  /* ── Cockpit window frames — silver stroke + rounded corners, drawn on top of the
        glass faces (the dark glass itself is now a real depth-sorted face). ──────
     Post-painter pass, bypasses depth sort ──
     Painter's algorithm can't reliably order window faces against the tube faces they
     sit on (the outermost tube sectors sort closer than the window centroid).
     Project and fill each panel directly here, after all fuselage faces are done.
     Shared edges between adjacent panels are detected and suppressed so they don't
     draw a silver divider line through what should look like a single window.         */
  /* Cylindrical livery base (e.g. the red nose) is drawn here — after the fuselage faces
     but BEFORE the cockpit panels/windows — so the glazing sits on top of the paint. */
  /* Per-face brightness for decals — same lighting as the fuselage skin (litBr on the
     rotated face normal), so painted livery shades instead of reading flat. */
  const _decalBr = _mkDecalBr(rc);
  {
    const _bandDecals = (S.aircraft?.livery?.decals ?? []).filter(d => d.cylindrical);
    if (_bandDecals.length) _drawLiveryDecals(ctx, _bandDecals, pts, verts, FC_, F_, project, camSide, _decalBr, _wCol);
  }
  if (_wbGeo?.cockpitPanels) {
    /* Rounded-corner path for a projected polygon — arcTo rounds each corner by its
       own radius rs[i] (0 = sharp). */
    const _rPoly = (pts, rs) => {
      const n = pts.length;
      ctx.moveTo((pts[n-1].x + pts[0].x) * 0.5, (pts[n-1].y + pts[0].y) * 0.5);
      for (let i = 0; i < n; i++) {
        const p = pts[(i-1+n) % n], c = pts[i], e = pts[(i+1) % n];
        const d1 = Math.hypot(c.x - p.x, c.y - p.y) * 0.5;
        const d2 = Math.hypot(e.x - c.x, e.y - c.y) * 0.5;
        ctx.arcTo(c.x, c.y, (c.x + e.x) * 0.5, (c.y + e.y) * 0.5, Math.min(rs[i], d1, d2));
      }
    };
    const rr = (_wbGeo.cockpitPanelR ?? 12) * dpr;
    /* A corner shared with another panel rounds sharp (0) so adjacent windows meet
       cleanly instead of each arcing away from the vertex and leaving a notch. */
    const _vKey = (x,y,z) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    const _vCount = {};
    for (const panel of _wbGeo.cockpitPanels)
      for (const [x,y,z] of panel) { const k = _vKey(x,y,z); _vCount[k] = (_vCount[k]||0) + 1; }
    for (const ySign of [+1, -1]) {
      const projPanels = _wbGeo.cockpitPanels.map(corners => {
        /* 3D face normal backface cull — 2D cross-product is unreliable at orbit
           elevations (sign flips, wrong-side panel bleeds through fuselage). */
        const [ax, ay, az] = corners[0];
        const [bx, by, bz] = corners[3];
        const [cx, cy, cz] = corners[2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        /* Far-side guard: never draw the panel on the opposite side of the fuselage.
           The 3D normal cull alone fails at high elevation — the nz*_cpCamU term can
           carry the far-side panel into positive territory even when the camera is clearly
           on the opposite side.  ySign*_cpCamR < 0 means "camera is on the wrong side." */
        if (ySign * _cpCamR < -0.15) return null;
        /* Mirror for port side: correct normal is [nx, -ny, nz], so negate _cpCamR. */
        if (nx * _cpCamF + ny * (ySign * _cpCamR) + nz * _cpCamU <= 0) return null;
        /* Reverse winding for the fill, for any corner count (was hardcoded to 4). */
        const order = [corners[0], ...corners.slice(1).reverse()];
        const vs = order.map(([x, y, z]) => project([x, ySign * y, z]));
        if (vs.some(v => !v)) return null;
        /* Skip degenerate sliver projections — a window that wraps the nose collapses
           to a near-line at grazing angles (tiny area for a long perimeter). */
        let area = 0, perim = 0;
        for (let i = 0; i < vs.length; i++) {
          const a = vs[i], b = vs[(i + 1) % vs.length];
          area  += a.x * b.y - b.x * a.y;
          perim += Math.hypot(b.x - a.x, b.y - a.y);
        }
        if (perim < 1e-3 || Math.abs(area) * 0.5 / (perim * perim) < 0.003) return null;
        const rs = order.map(([x,y,z]) => _vCount[_vKey(x,y,z)] >= 2 ? 0 : rr);
        return { vs, rs };
      });
      ctx.save();
      ctx.strokeStyle = 'rgb(168,173,180)';   // silver window frame (glass is a real face)
      ctx.lineWidth   = 2.5 * dpr;
      for (const pp of projPanels) {
        if (!pp) continue;
        ctx.beginPath(); _rPoly(pp.vs, pp.rs); ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ── cockpitPanels vertex debug overlay ───────────────────────────────────── */
  if (_DBG_PANELS && _wbGeo?.cockpitPanels) {
    const _pCols = ['#00ffff','#ffff00','#ff66ff','#66ff66'];
    ctx.save();
    ctx.font = `bold ${Math.round(9 * dpr)}px monospace`;
    ctx.textAlign = 'left';
    for (const ySign of [+1, -1]) {
      for (let pi = 0; pi < _wbGeo.cockpitPanels.length; pi++) {
        const panel = _wbGeo.cockpitPanels[pi];
        const col   = _pCols[pi % _pCols.length];
        for (let ci = 0; ci < panel.length; ci++) {
          const [cx, cy, cz] = panel[ci];
          const sp = project([cx, ySign * cy, cz]);
          if (!sp) continue;
          /* dot */
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
          /* label — show JSON coords × 10000 as integers */
          const label = `p${pi}c${ci}`;
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          const tw = ctx.measureText(label).width;
          ctx.fillRect(sp.x + 6 * dpr, sp.y - 9 * dpr, tw + 4 * dpr, 12 * dpr);
          ctx.fillStyle = col;
          ctx.fillText(label, sp.x + 8 * dpr, sp.y);
        }
      }
    }
    ctx.restore();
  }

  /* Front glass windows — post-painter fill + silver outline, side view only.
     These panels face outward-starboard/port so they are only visible from the side
     camera (camSide > 0).  The winding gives cross>0 from the near side, <0 from far. */
  if (_wbGeo?.frontWin && camSide > 0 && !_wbGeo.cockpitPanels) {
    ctx.save();
    for (const [vA, vB, vC, vD] of _wbGeo.frontWin) {
      const vs = [pts[vA], pts[vB], pts[vC], pts[vD]];
      if (vs.some(v => !v)) continue;
      const cross = (vs[1].x - vs[0].x) * (vs[2].y - vs[0].y)
                  - (vs[1].y - vs[0].y) * (vs[2].x - vs[0].x);
      if (cross < 0) continue;   // back-facing — cull
      ctx.beginPath();
      ctx.moveTo(vs[0].x, vs[0].y);
      for (let k = 1; k < vs.length; k++) ctx.lineTo(vs[k].x, vs[k].y);
      ctx.closePath();
      ctx.fillStyle   = 'rgba(8,18,35,0.62)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,195,208,0.88)';
      ctx.lineWidth   = Math.max(1.2, dpr * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Cockpit windshield — rectangle from sI (inner) to sO (outer) ── */
  if (_wbGeo?.rb && _wbGeo.winFwdRi != null && _wbGeo.winAftRi != null && !_wbGeo.cockpitPanels) {
    const _rb = _wbGeo.rb;
    const _fR = _wbGeo.winFwdRi, _aR = _wbGeo.winAftRi;
    const _sI = _wbGeo.winSiInner ?? 2, _sO = _wbGeo.winSiOuter ?? 4;
    const _drawCW = (siA, siB) => {
      const vs = [
        pts[_rb[_fR] + siA],  // fwd inner
        pts[_rb[_fR] + siB],  // fwd outer
        pts[_rb[_aR] + siB],  // aft outer
        pts[_rb[_aR] + siA],  // aft inner
      ];
      if (vs.some(v => !v)) return;
      /* cull only if ALL four ring-vertex normals face away from camera */
      const vis = [_rb[_fR]+siA, _rb[_fR]+siB, _rb[_aR]+siB, _rb[_aR]+siA];
      if (vis.every(vi => edgeCamDir(vi) > 0)) return;
      ctx.save();
      ctx.lineWidth = Math.max(1.4, devicePixelRatio * 1.4);
      ctx.strokeStyle = 'rgba(180,80,220,0.95)';
      ctx.beginPath();
      ctx.moveTo(vs[0].x, vs[0].y);
      for (let k = 1; k < vs.length; k++) ctx.lineTo(vs[k].x, vs[k].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };
    _drawCW(_sI,        _sO       );  // R: starboard inner → outer
    _drawCW(16 - _sO,  16 - _sI  );  // L: port outer → inner (mirror)
  }
}

/* ── National markings + livery decals — Swiss cross, winglet logo, Polish
   szachownica + "602", SVG livery decals, rudder gap line, registration,
   near-wing re-stamp; post-painter. ── */
export function drawMarkingsAndLivery(rc) {
  const { ctx, dpr, pts, verts, faces, FC_, F_, project, camSide, wingView,
          b: _b, wbGeo: _wbGeo, cpCamR: _cpCamR, wCol: _wCol, isMig15 } = rc;
  const _decalBr = _mkDecalBr(rc);
  /* Swiss cross — winglets always; vtail only when no livery decal covers it.
     Winglet outer-face normals are ±rR: show R cross when camera is starboard (_cpCamR > 0),
     L cross when camera is port (_cpCamR < 0).  V-stab is on the centreline — show from
     either side using the 2D cross-product of its projected face. */
  if (S.aircraft?.livery?.swissCross) {
    const _hasVtailDecal = S.aircraft?.livery?.decals?.some(d => d.surface === 'vtail');
    const _crossV = S.aircraft.livery.swissCrossV ?? 0.5;
    const _vsFront = (a, b, c) => a && b && c &&
      Math.abs((b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)) > 0;
    if (!_hasVtailDecal && _vsFront(pts[_b+8], pts[_b+9], pts[_b+11]))
      _drawSwissCross(ctx, pts[_b+8], pts[_b+9], pts[_b+11], pts[_b+10], _crossV);   // v-stab
    if (_cpCamR > 0)
      _drawSwissCross(ctx, pts[_b+118], pts[_b+147], pts[_b+101], pts[_b+100]);  // R winglet
    if (_cpCamR < 0)
      _drawSwissCross(ctx, pts[_b+122], pts[_b+151], pts[_b+103], pts[_b+102]);  // L winglet
  }

  /* Winglet logo (e.g. Edelweiss flower) — billboards the vtail decal's flower onto
     the near-side winglet. Enable with livery.wingletLogo. */
  if (S.aircraft?.livery?.wingletLogo && _wbGeo) {
    const _wlDec = S.aircraft.livery.decals?.find(d => d.surface === 'vtail');
    if (_wlDec?.elements) {
      const _wlVb = (_wlDec.viewBox ?? '0 0 50 50').split(' ').map(Number);
      if (_cpCamR > 0) _drawWingletLogo(ctx, pts[_b+118], pts[_b+147], pts[_b+101], pts[_b+100], _wlDec.elements, _wlVb);
      if (_cpCamR < 0) _drawWingletLogo(ctx, pts[_b+122], pts[_b+151], pts[_b+103], pts[_b+102], _wlDec.elements, _wlVb);
    }
  }

  /* MiG-15 Polish markings: szachownica on V-stab + "602" painted on port fuselage */
  if (isMig15) {
    _drawPolishRoundel(ctx, pts[142], pts[143], pts[145], pts[144]);

    /* Fuselage szachownica — port side, aft of cockpit */
    const _rfBL = project([-0.001, -_m15r, -_m15r * 0.20]);
    const _rfBR = project([-0.004, -_m15r, -_m15r * 0.20]);
    const _rfTR = project([-0.004, -_m15r,  _m15r * 0.90]);
    const _rfTL = project([-0.001, -_m15r,  _m15r * 0.90]);
    const _rfSt = project([-0.002,  _m15r,  _m15r * 0.20]);
    if (_rfBL && _rfBR && _rfTR && _rfTL && _rfSt &&
        (_rfBL.d + _rfTL.d) * 0.5 < _rfSt.d) {
      _drawPolishRoundel(ctx, _rfBL, _rfBR, _rfTR, _rfTL);
    }

    /* "602" — fixed to port fuselage surface.
       Project fore and aft anchor points on port side; use their screen-space
       direction and foreshortening to rotate/scale the text so it lies on the hull. */
    const _pFwd  = project([0.008, -_m15r, _m15r * 0.08]);   // forward anchor
    const _pAft  = project([0.003, -_m15r, _m15r * 0.08]);   // aft anchor
    const _pTop2 = project([0.006, -_m15r, _m15r * 0.55]);   // vertical top ref
    const _pBot2 = project([0.006, -_m15r, -_m15r * 0.20]);  // vertical bot ref
    const _pStb2 = project([0.006,  _m15r, _m15r * 0.08]);   // starboard depth ref
    if (_pFwd && _pAft && _pTop2 && _pBot2 && _pStb2 &&
        (_pFwd.d + _pAft.d) * 0.5 < _pStb2.d) {
      const _fdx  = _pAft.x - _pFwd.x, _fdy = _pAft.y - _pFwd.y;  // aft direction
      const _fLen = Math.hypot(_fdx, _fdy);                          // fore-aft screen length
      const _hLen = Math.hypot(_pTop2.x - _pBot2.x, _pTop2.y - _pBot2.y); // vert screen height
      if (_fLen > 1 && _hLen > 3) {
        const _angle  = Math.atan2(_fdy, _fdx);
        const _textH  = _hLen * 0.68;
        /* xScale: normalise fore-aft foreshortening.
           Body span sampled: fwd=0.008, aft=0.003 → 5 mm.  Vert span: 2×_m15r ≈ 4.2 mm.
           At full side-on both map equally; ratio deviates as azimuth changes. */
        const _xScale = (_fLen / _hLen) / (0.005 / (_m15r * 2));
        const _cx = (_pFwd.x + _pAft.x) * 0.5, _cy = (_pFwd.y + _pAft.y) * 0.5;
        ctx.save();
        ctx.translate(_cx, _cy);
        ctx.rotate(_angle);
        ctx.scale(_xScale, 1);
        ctx.font         = `900 ${Math.max(5, _textH)}px sans-serif`;
        ctx.fillStyle    = 'rgba(192,24,24,0.95)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('602', 0, 0);
        ctx.restore();
      }
    }
  }

  /* Livery decals — SVG paths mapped onto named surfaces. Cylindrical bases (red nose)
     were already drawn earlier, under the cockpit windows. */
  const _livDecals = (S.aircraft?.livery?.decals ?? []).filter(d => !d.cylindrical);
  if (_livDecals.length) _drawLiveryDecals(ctx, _livDecals, pts, verts, FC_, F_, project, camSide, _decalBr, _wCol);

  /* Rudder gap line — thin black outline around the rudder (hinge line · tip · TE · root)
     on whichever side of the fin faces the camera. Drawn after the livery so the gap
     reads on top of any tail decal. Rudder quad = hinge→TE corners of the v-stab airfoil
     (+Y: b+162,164,170,168 / -Y: b+163,169,171,165). */
  if (_wbGeo) {
    const _ruOutline = (a, b, c, d) => {
      const P = [pts[a], pts[b], pts[c], pts[d]];
      if (P.some(p => !p)) return false;
      const cr = (P[1].x-P[0].x)*(P[2].y-P[0].y) - (P[1].y-P[0].y)*(P[2].x-P[0].x);
      if (cr <= 0) return false;   // back-facing side
      ctx.save();
      ctx.strokeStyle = 'rgba(22,24,30,0.40)';   // subtle panel-gap, not a bold divider through the flower
      ctx.lineWidth   = Math.max(0.6, dpr * 0.45);
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(P[i].x, P[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return true;
    };
    if (!_ruOutline(_b+162, _b+164, _b+170, _b+168)) _ruOutline(_b+163, _b+169, _b+171, _b+165);
  }

  /* Aircraft registration — small text on the aft fuselage, placed from the
     fuselage geometry so it works for any WB/NB. European-style registrations
     ride below the window line; US (N-prefix) registrations sit above it. */
  if (S.aircraft?.registration && _wbGeo) {
    const _rgR = _wbGeo.r, _rgReg = S.aircraft.registration;
    const _rgVbW = Math.max(48, _rgReg.length * 12);
    const _rgUS  = /^N/i.test(_rgReg);                    // US registration → above windows
    const _rgZT  = _rgUS ?  _rgR * 0.44 :  -_rgR * 0.10;  // band edges, above or below windows
    const _rgZB  = _rgUS ?  _rgR * 0.10 :  -_rgR * 0.44;
    const _rgU  = (_rgZT - _rgZB) * (_rgVbW / 20);        // x-width matched to text aspect
    /* Scale the position with the actual fuselage length (tailX lives in geometry)
       so the registration always sits in the back, just ahead of the tailcone,
       on any aircraft from the short 737 to the long 777. */
    const _rgTailX = S.aircraft?.geometry?.tailX ?? S.aircraft?.tailX ?? -0.021;
    const _rgXF = _rgTailX * 0.55;                        // front edge, well aft on the fuselage
    _drawLiveryDecals(ctx, [{
      surface: 'fuselage',
      viewBox: `0 0 ${_rgVbW} 20`,
      placement: [[_rgXF, _rgR, _rgZT], [_rgXF - _rgU, _rgR, _rgZT],
                  [_rgXF - _rgU, _rgR, _rgZB], [_rgXF, _rgR, _rgZB]],
      elements: [{ text: _rgReg, fill: 'rgb(45,48,56)', x: _rgVbW / 2, y: 11, size: 15 }],
    }], pts, verts, FC_, F_, project, camSide, _decalBr, _wCol);
  }

  /* Re-stamp near-side wing + winglet faces after livery to prevent livery bleeding over them.
     Near-side faces have avgD < camSide (they're between camera and fuselage centre).
     Far-side faces have avgD > camSide and must stay behind the fuselage — skip them. */
  if (_wbGeo && !wingView && camSide > 0) {
    for (const f of faces) {
      if (f.draw || (f.fc !== 1 && f.fc !== 9)) continue;
      if (f.avgD >= camSide) continue;
      const { ps, br, col, grad, spec } = f;
      if (grad) {
        const { pL, pR, brL, brR } = grad;
        const gl = ctx.createLinearGradient(pL.x, pL.y, pR.x, pR.y);
        gl.addColorStop(0, _wCol(col, brL));
        gl.addColorStop(1, _wCol(col, brR));
        ctx.fillStyle = gl;
      } else {
        ctx.fillStyle = _wCol(col, br);
      }
      ctx.beginPath();
      ctx.moveTo(ps[0].x, ps[0].y);
      for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
      ctx.closePath();
      ctx.fill();
      if (spec > 0.04) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,255,255,${(spec * 0.30).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(ps[0].x, ps[0].y);
        for (let k = 1; k < ps.length; k++) ctx.lineTo(ps[k].x, ps[k].y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

/* ── Prop-plane cabin edges + vertex debug labels — post-painter. ── */
export function drawCabinEdges(rc) {
  const { ctx, pts, camSide, isPP, ppGeo: _ppGeo } = rc;
  /* Rear window vertex debug labels */
  if (isPP && _ppGeo?.cabinVerts?.rwR != null) {
    const rw = _ppGeo.cabinVerts.rwR;
    const _rwLabels = [[rw,'r0TL'],[rw+1,'r1TR'],[rw+2,'r2BL'],[rw+3,'r3BR'],[rw+4,'r4TC'],[rw+5,'r5BC']];
    const lfs2 = Math.round(8 * devicePixelRatio);
    ctx.save();
    ctx.font = `bold ${lfs2}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [vi, label] of _rwLabels) {
      const p = pts[vi]; if (!p) continue;
      const tw = label.length * lfs2 * 0.62;
      ctx.fillStyle = 'rgba(0,0,0,0.80)';
      ctx.fillRect(p.x - tw*0.5, p.y - lfs2*0.7, tw, lfs2*1.4);
      ctx.fillStyle = 'rgba(255,220,80,1)';
      ctx.fillText(label, p.x, p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5*devicePixelRatio, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,80,40,1)'; ctx.fill();
    }
    ctx.restore();
  }

  /* Windshield vertex debug labels */
  if (isPP && _ppGeo?.cabinVerts?.wsBL != null) {
    const bL = _ppGeo.cabinVerts.wsBL;
    const _wsLabels = [[bL,'BL'],[bL+1,'BR'],[bL+2,'TR'],[bL+3,'TL'],[bL+4,'IBL'],[bL+5,'IBR']];
    const lfs = Math.round(8 * devicePixelRatio);
    ctx.save();
    ctx.font = `bold ${lfs}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [vi, label] of _wsLabels) {
      const p = pts[vi]; if (!p) continue;
      const tw = label.length * lfs * 0.62;
      ctx.fillStyle = 'rgba(0,0,0,0.80)';
      ctx.fillRect(p.x - tw*0.5, p.y - lfs*0.7, tw, lfs*1.4);
      ctx.fillStyle = 'rgba(80,220,255,1)';
      ctx.fillText(label, p.x, p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5*devicePixelRatio, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,80,40,1)'; ctx.fill();
    }
    ctx.restore();
  }

  /* PP aircraft: cabin structural edges — windshield, pillars, roofline, windows, door detail */
  if (isPP && _ppGeo) {
    const cv = _ppGeo.cabinVerts;
    const firstCabin = cv?.wsBL;
    if (firstCabin != null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.90)';
      ctx.lineWidth = Math.max(1.4, devicePixelRatio * 1.2);
      ctx.beginPath();
      const V0 = _ppGeo.V_;
      for (const [ea, eb] of _ppGeo.E_) {
        if (ea < firstCabin && eb < firstCabin) continue;
        const pa = pts[ea], pb = pts[eb];
        if (!pa || !pb) continue;
        // Back-face cull: skip edges on the side facing away from camera
        const avgY = (V0[ea][1] + V0[eb][1]) * 0.5;
        if (avgY < -0.000001 && camSide > 0) continue;
        if (avgY >  0.000001 && camSide < 0) continue;
        ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ── Passenger windows, cheatline, doors, overwing exits — WB/NB only,
   perspective-projected with wing occlusion; post-painter. ── */
export function drawPassengerWindows(rc) {
  const { ctx, pts, project, F_, FC_, wbGeo: _wbGeo,
          isF9, isSV, isSS, isC172, isPP, isBf109, isF4U, isMig15 } = rc;
  /* Passenger windows + door outlines — wide-body only, properly perspective-projected */
  if (!isF9 && !isSV && !isSS && !isC172 && !isPP && !isBf109 && !isF4U && !isMig15) {
    const _fr = _wbGeo?.r ?? _r;
    /* Wing occlusion (no depth buffer): the windows/doors are a post-painter pass, so
       the near wing can't hide the fuselage rows behind it. Collect the visible
       (front-facing) wing-surface polygons (col 1) once; _quad3d then skips any decal
       whose centre falls behind a closer wing face. */
    const _ptInPoly = (px, py, ps) => {
      let inside = false;
      for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
        const yi = ps[i].y, yj = ps[j].y;
        if ((yi > py) !== (yj > py) &&
            px < (ps[j].x - ps[i].x) * (py - yi) / (yj - yi) + ps[i].x) inside = !inside;
      }
      return inside;
    };
    const _wingOcc = [];
    for (let i = 0; i < F_.length; i++) {
      if (FC_[i] !== 1) continue;                       // wing surfaces only
      const wp = F_[i].map(vi => pts[vi]);
      if (wp.some(p => !p)) continue;
      const cr = (wp[1].x - wp[0].x) * (wp[2].y - wp[0].y) - (wp[1].y - wp[0].y) * (wp[2].x - wp[0].x);
      if (cr < 0) continue;                             // back-facing → not drawn → can't occlude
      _wingOcc.push({ ps: wp, d: wp.reduce((s, p) => s + p.d, 0) / wp.length });
    }
    /* Draw a quad from 4 body-space corners. Cull unless the decal's outward
       radial normal faces the camera: push the centre outward along the body
       radius and require it to come closer. This hides the far-side rows AND
       the near-edge-on rows in a head-on/axial view, where the round fuselage
       occludes them. */
    const _quad3d = (x, y, z, hw, hh, fill, stroke, round = false, rFrac = 0.30) => {
      const pw = project([x, y, z]);
      if (!pw) return;
      const rn  = Math.hypot(y, z) || 1;
      const eps = _fr * 0.6;
      const po  = project([x, y + (y / rn) * eps, z + (z / rn) * eps]);
      /* Require the outward point to come meaningfully closer (normal faces the
         camera by a margin); edge-on rows in a head-on view are culled. */
      if (!po || po.d > pw.d - eps * 0.35) return;
      /* Behind the near wing? A closer wing face covering the centre hides this decal. */
      for (const wo of _wingOcc) if (wo.d < pw.d - _fr * 0.15 && _ptInPoly(pw.x, pw.y, wo.ps)) return;
      const p0 = project([x + hw, y, z + hh]);
      const p1 = project([x - hw, y, z + hh]);
      const p2 = project([x - hw, y, z - hh]);
      const p3 = project([x + hw, y, z - hh]);
      if (!p0 || !p1 || !p2 || !p3) return;
      if (round && ctx.roundRect) {
        const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
        const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
        /* Use edge midpoints so orientation is stable across all camera azimuths.
           sw = fore-aft screen extent, sh = up-down screen extent.
           angle derived from Z-axis projection (always portrait, never flips). */
        const topCx = (p0.x+p1.x)*0.5, topCy = (p0.y+p1.y)*0.5;
        const botCx = (p2.x+p3.x)*0.5, botCy = (p2.y+p3.y)*0.5;
        const fwdCx = (p0.x+p3.x)*0.5, fwdCy = (p0.y+p3.y)*0.5;
        const aftCx = (p1.x+p2.x)*0.5, aftCy = (p1.y+p2.y)*0.5;
        const sh = Math.hypot(topCx-botCx, topCy-botCy);
        const sw = Math.hypot(fwdCx-aftCx, fwdCy-aftCy);
        const angle = Math.atan2(topCy - botCy, topCx - botCx) + Math.PI * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.roundRect(-sw / 2, -sh / 2, sw, sh, Math.min(sw, sh) * rFrac);
        if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
      }
    };

    ctx.save();
    ctx.lineWidth = Math.max(0.75, devicePixelRatio * 0.75);

    /* Use per-aircraft fuselage radius so narrow-body windows sit on the body surface */
    const _wbR = _wbGeo?.r ?? _r;

    /* Cheatline — coloured band(s) along the window line that sweep up toward the
       tail (Singapore Airlines style). Tiled strips on both sides so the band hugs
       the fuselage; drawn before the windows so the glazing sits on top of it.
         cheatline.lines[] : { z (band centre), h (half-height), col }
         fromX→toX along the fuselage; aft of sweepFromX the band rises by sweepRise. */
    const _chl = S.aircraft?.cheatline;
    if (_chl?.lines?.length) {
      const _cF = _chl.fromX, _cT = _chl.toX;
      const _cSwF = _chl.sweepFromX ?? _cT;
      const _cSwA = (_chl.sweepAngle ?? 70) * Math.PI / 180;   // angle swept up the side at the tail
      const _cN  = Math.max(12, Math.round(Math.abs(_cF - _cT) / (_wbR * 0.20)));
      const _cDx = (_cF - _cT) / _cN;
      for (const _ln of _chl.lines) {
        /* Base angle on the cross-section so the straight run sits at the line's z;
           aft of sweepFromX the band climbs the rounded side (y shrinks as z rises). */
        const _a0 = Math.asin(Math.max(-0.99, Math.min(0.99, _ln.z / _wbR)));
        for (let i = 0; i < _cN; i++) {
          const _cx = _cF - (i + 0.5) * _cDx;
          const _t  = _cx < _cSwF ? (_cSwF - _cx) / (_cSwF - _cT) : 0;
          const _a  = _a0 + _cSwA * _t;
          const _cy = _wbR * Math.cos(_a), _cz = _wbR * Math.sin(_a);
          _quad3d(_cx,  _cy, _cz, _cDx * 0.55, _ln.h, _ln.col, null, false);
          _quad3d(_cx, -_cy, _cz, _cDx * 0.55, _ln.h, _ln.col, null, false);
        }
      }
    }

    /* Window row — count and range from aircraft JSON when available */
    const hw = _wbR * 0.088;
    const hh = _wbR * 0.128;
    const wZ = _wbR * 0.05;
    const wFill   = 'rgba(48,72,110,0.88)';
    const wStroke = 'rgba(110,140,175,0.50)';
    const _nCabW = S.aircraft?.cabinWindows;
    const nW  = _nCabW ? Math.round(_nCabW / 2) : 12;
    /* Window row begins just aft of the forward door (forward-most door entry),
       so the cabin windows start right after it rather than leaving a gap. */
    const _doorXsW  = S.aircraft?.doors;
    const _fwdDoorX = _doorXsW?.length ? Math.max(..._doorXsW) : null;
    const xA  = _fwdDoorX != null ? _fwdDoorX - _wbR * 0.33
              : (_nCabW ? 0.008 : 0.011);
    /* Window pitch can be anchored to a reference: "windowsToEngineLip" gives the
       number of windows counted from the first window (just aft of the fwd door)
       to the engine inlet lip (x == wing.rootLE). That fixes a realistic pitch
       instead of a guessed aft end. */
    const _winToLip = S.aircraft?.windowsToEngineLip;
    const _engLipX  = S.aircraft?.wing?.rootLE;
    const _winEndX = S.aircraft?.windowEndX ?? (_nCabW ? -0.025 : -0.008);
    /* DWG anchor: N windows between door 1 and door 2 → pitch = doorGap/(N+1). */
    const _wbd = S.aircraft?.dimensions?.windowsBetweenDoor1and2;
    const _wPitch = (_wbd > 0 && _doorXsW?.length >= 2)
      ? Math.abs(_doorXsW[0] - _doorXsW[1]) / (_wbd + 1)
      : (_winToLip > 1 && _engLipX != null && _fwdDoorX != null)
        ? (xA - _engLipX) / (_winToLip - 1)
        : (nW > 1 ? (xA - _winEndX) / (nW - 1) : 0);
    /* Extra spacing over the wing box: "windowGaps" lists 1-based window numbers
       after which an additional gap (windowGapSize, in pitch units) is inserted,
       shifting every following window aft — this reproduces the 737's uneven
       spacing at the centre-section frames (e.g. after windows 14 and 15). */
    const _wGaps  = S.aircraft?.windowGaps;
    const _wGapSz = S.aircraft?.windowGapSize ?? 1;
    const winXs = [];
    for (let i = 0, _acc = 0; i < nW; i++) {
      if (_wGaps?.includes(i)) _acc += _wPitch * _wGapSz;  // gap after window i (1-based)
      winXs.push(nW > 1 ? xA - _wPitch * i - _acc : xA - _wPitch / 2);
    }
    /* Skip any window the doors would cover: a window is hidden when its glass
       overlaps a door in x (door half-width dhw=_wbR*0.190 + window half-width hw).
       winXs keeps all entries (overwing-exit indices stay valid) — we just don't
       draw the covered ones, reproducing the real frame-for-door substitution. */
    const _winDoorClear = _wbR * 0.190 + hw;
    const _winUnderDoor = wx => _doorXsW?.some(dx => Math.abs(wx - dx) < _winDoorClear);
    for (let i = 0; i < nW; i++) {
      if (_winUnderDoor(winXs[i])) continue;
      _quad3d(winXs[i],  _wbR, wZ, hw, hh, wFill, wStroke, true);
      _quad3d(winXs[i], -_wbR, wZ, hw, hh, wFill, wStroke, true);
    }

    /* Doors — positions from aircraft JSON or default pairs. Each door: black
       border, silver inner outline, a small window in the upper part, and a
       handle at mid-height. */
    const _doorXs3 = S.aircraft?.doors ?? [0.009, -0.006];
    const dhw = _wbR * 0.190;
    const dhh = _wbR * 0.360;
    const dZ  = _wbR * 0.08;
    const _dBlk    = 'rgba(16,20,26,0.90)';     // outer black border
    const _dSilver = 'rgba(198,204,213,0.80)';  // inner silver outline
    const _dGlass  = 'rgba(38,54,80,0.88)';     // door-window glass
    const _dHandle = 'rgba(70,76,88,0.95)';     // handle
    for (const dx of _doorXs3) {
      for (const yS of [_wbR, -_wbR]) {
        _quad3d(dx, yS, dZ,              dhw,        dhh,        null,    _dBlk,    true);  // black border
        _quad3d(dx, yS, dZ,              dhw * 0.84, dhh * 0.90, null,    _dSilver, true);  // silver inner
        _quad3d(dx, yS, dZ + dhh * 0.50, dhw * 0.34, dhw * 0.34, _dGlass, _dSilver, true, 0.5); // upper circular window
        _quad3d(dx, yS, dZ,              dhw * 0.34, dhh * 0.05, _dHandle, null,     true);       // mid handle
      }
    }

    /* Overwing emergency exits — rounded near-black frame around specific cabin
       windows, given by 1-based window index in the JSON ("overwingExits":
       [19, 20]). Drawn on both sides; N entries = N exits per side. */
    const _owExits = S.aircraft?.overwingExits;
    if (_owExits) {
      const ohw = hw * 1.18, ohh = hh * 1.55;
      const oStroke = 'rgba(14,16,22,0.92)';
      for (const wi of _owExits) {
        const ox = winXs[wi - 1] ?? winXs[0];
        _quad3d(ox,  _wbR, wZ, ohw, ohh, null, oStroke, true);
        _quad3d(ox, -_wbR, wZ, ohw, ohh, null, oStroke, true);
      }
    }

    ctx.restore();
  }
}
