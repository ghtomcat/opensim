/* Livery + national-marking draw helpers — SVG decal projection (per-face
   affine / cylindrical / bounding-box), Swiss cross, winglet logo billboard,
   Polish szachownica roundel. Extracted from outside.js. */
import { S } from '../core/state.js';

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
