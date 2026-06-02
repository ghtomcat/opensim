/* OpenSim — display/outside-pp.js
   Generic single-engine prop-plane geometry, driven by the aircraft JSON
   `propplane` spec section. Vertex/face/edge conventions match outside-c172.js
   so both share the same animation model and rendering pipeline. */
import { buildTube, computeFaceNormals, animHinge } from './outside-shared.js';

const DEG = Math.PI / 180;

export const _PP_COLORS_DEFAULT = [
  [240, 240, 240],  // 0 fuselage / tail — white
  [230, 235, 238],  // 1 wings / h-stabs
  [ 85,  90, 100],  // 2 cowl — dark gray
  [ 35,  50,  65],  // 3 glass
  [ 45,  47,  52],  // 4 propeller blades
];

/* Build complete prop-plane geometry from a spec object (= aircraft.propplane). */
export function _buildPP(spec) {
  const N    = 16;
  const fs   = spec.fuselage;
  const ws   = spec.wing;
  const em   = spec.empennage;
  const sp   = spec.spinner;
  const rings = fs.rings;   // [{x, r|ry/rz, col?}] — 5 or 6 entries; ring[2]=cabin, ring[4]=vstab

  /* Derived radii — ring[2] may use ry/rz for an elliptical cabin cross-section */
  const cabinR = rings[2].rz ?? rings[2].r;
  const tailR  = rings[4].r;
  const lastRi = rings.length - 1;

  /* Wing-root Z: high wing sits on top of fuselage, low wing hangs below */
  const wrz  = ws.rootZ !== undefined ? ws.rootZ
             : ws.position === 'high' ? cabinR : -cabinR;

  /* Wing geometry */
  const whs  = ws.span,    wry  = ws.rootY;
  const wtz  = wrz + ws.tipDihedral;
  const wrLE = ws.rootLE,  wrTE = ws.rootTE;
  const wtLE = ws.tipLE,   wtTE = ws.tipTE;
  const wtr  = ws.rootThick, wtt = ws.tipThick;
  const wfb  = ws.flapBreak;

  const whY  = wry + (whs - wry) * wfb;
  const whLE = wrLE + wfb * (wtLE - wrLE);
  const whTE = wrTE + wfb * (wtTE - wrTE);
  const whZ  = wrz + wfb * (wtz - wrz);
  const whT  = wtr + wfb * (wtt - wtr);

  const wfh  = ws.flapHinge;
  const wfxR = wrLE + wfh * (wrTE - wrLE);
  const wfxH = whLE + wfh * (whTE - whLE);
  const r_fl = wfxR - wrTE;
  const wuh  = 1 - wfh * 0.85;

  /* Aileron hinge at 70% chord of outboard panel */
  const wafh  = 0.70;
  const waxH  = whLE + wafh * (whTE - whLE);
  const waxT  = wtLE + wafh * (wtTE - wtLE);
  const r_ail = waxH - whTE;
  const wAuh  = 1 - wafh * 0.85;

  /* H-stab */
  const hs   = em.hstab;
  const hRY  = hs.rootY ?? (tailR + 0.0003);
  const hFwd = hs.rootFwdX, hAft = hs.rootAftX;
  const hTFwd = hs.tipFwdX,  hTAft = hs.tipAftX;
  const hTZ  = hs.tipZ,    hThk = hs.thickness;
  const hEH  = hs.elevatorHinge, hspan = hs.span;
  const hRHx = hFwd  + hEH * (hAft  - hFwd);
  const hTHx = hTFwd + hEH * (hTAft - hTFwd);
  const r_el = hRHx - hAft;
  const huh  = 1 - hEH * 0.85;

  /* V-stab */
  const vs    = em.vstab;
  const vBFwd = vs.baseFwdX, vBAft = vs.baseAftX;
  const vTFwd = vs.topFwdX,  vTAft = vs.topAftX;
  const vRH   = vs.rudderHinge;
  const vBHx  = vBFwd + vRH * (vBAft - vBFwd);
  const vTHx  = vTFwd + vRH * (vTAft - vTFwd);
  const vTHz  = vs.topFwdZ + vRH * (vs.topAftZ - vs.topFwdZ);
  const r_ru  = vBHx - vBAft;
  const vThkH = (vs.thickness ?? Math.abs(vBAft - vBFwd) * 0.10) * 0.5;

  /* Ring vertex index at wing attachment: top (si=0) for high wing, bottom (si=8) for low */
  const wRingIdx = ws.position === 'high' ? 0 : 8;

  /* ── Fuselage tube ─────────────────────────────────────────── */
  const { V_, F_, FC_, E_, rb } = buildTube(N,
    rings.map((rg, i) => {
      const entry = { vF: rg.x, r: rg.r, ry: rg.ry, rz: rg.rz, rzTop: rg.rzTop };
      if (i < rings.length - 1) entry.col = rg.col ?? (i === 0 ? 2 : 0);
      return entry;
    })
  );

  const noseTip = V_.length;  V_.push([fs.noseTipX, 0, 0]);
  const tailTip = V_.length;  V_.push([fs.tailTipX, 0, 0]);

  /* ── Wing strut geometry (shared between centre-line and tube verts) ── */
  const _sYtop  = ws.strutY ?? whs * 0.95;
  const _sYfrac = _sYtop / whs;
  const _sXtop  = (wrLE + _sYfrac * (wtLE - wrLE)) - (ws.strutAttachChord ?? 0);
  const _sBotX  = ws.strutBotX ?? (ws.strutX ?? 0.001);

  /* Strut bottom: find fuselage surface Y by interpolating rings at _sBotX */
  const sBotZ = -cabinR * 0.4;
  let sYbot = cabinR;
  for (let ri = 0; ri < rings.length - 1; ri++) {
    if (_sBotX <= rings[ri].x && _sBotX >= rings[ri + 1].x) {
      const t   = (_sBotX - rings[ri].x) / (rings[ri + 1].x - rings[ri].x);
      const ry0 = rings[ri].ry    ?? rings[ri].r;
      const ry1 = rings[ri + 1].ry ?? rings[ri + 1].r;
      const rz0 = rings[ri].rz    ?? rings[ri].r;
      const rz1 = rings[ri + 1].rz ?? rings[ri + 1].r;
      const sRy = ry0 + t * (ry1 - ry0);
      const sRz = rz0 + t * (rz1 - rz0);
      sYbot = sRy * Math.sqrt(Math.max(0, 1 - (sBotZ / sRz) ** 2));
      break;
    }
  }

  /* ── Non-tube vertices 98-126 ──────────────────────────────── */
  V_.push(
    [ wrLE,  wry,   wrz  ],                    // 98  R wing root LE
    [ wrTE,  wry,   wrz  ],                    // 99  R wing root TE
    [ wtLE,  whs,   wtz  ],                    // 100 R wing tip LE
    [ wtTE,  whs,   wtz  ],                    // 101 R wing tip TE
    [ wrLE, -wry,   wrz  ],                    // 102 L wing root LE
    [ wrTE, -wry,   wrz  ],                    // 103 L wing root TE
    [ wtLE, -whs,   wtz  ],                    // 104 L wing tip LE
    [ wtTE, -whs,   wtz  ],                    // 105 L wing tip TE
    [ vBFwd, +vThkH, tailR      ],             // 106 V-stab stbd base fwd
    [ vBAft, +vThkH, tailR      ],             // 107 V-stab stbd base aft
    [ vTFwd, +vThkH, vs.topFwdZ ],             // 108 V-stab stbd top fwd
    [ vTAft, +vThkH, vs.topAftZ ],             // 109 V-stab stbd top aft
    [ hFwd,  hRY,  0     ],                    // 110 R h-stab root fwd
    [ hAft,  hRY,  0     ],                    // 111 R h-stab root aft
    [ hTFwd, hspan, hTZ  ],                    // 112 R h-stab tip fwd
    [ hTAft, hspan, hTZ  ],                    // 113 R h-stab tip aft
    [ hFwd, -hRY,  0     ],                    // 114 L h-stab root fwd
    [ hAft, -hRY,  0     ],                    // 115 L h-stab root aft
    [ hTFwd,-hspan, hTZ  ],                    // 116 L h-stab tip fwd
    [ hTAft,-hspan, hTZ  ],                    // 117 L h-stab tip aft
    [ _sXtop,  _sYtop,  wrz          ],  // 118 R strut top
    [ _sBotX,  sYbot, sBotZ ],  // 119 R strut bottom
    [ _sXtop, -_sYtop,  wrz ],  // 120 L strut top
    [ _sBotX, -sYbot, sBotZ ],  // 121 L strut bottom
    [ fs.noseTipX, spec.propDiskRadius, 0 ],   // 122 prop tip (arc ref)
    [ whLE,  whY,  whZ  ],                     // 123 R break LE
    [ whTE,  whY,  whZ  ],                     // 124 R break TE
    [ whLE, -whY,  whZ  ],                     // 125 L break LE
    [ whTE, -whY,  whZ  ],                     // 126 L break TE
  );

  /* ── Spinner base ring 127-142 ─────────────────────────────── */
  const spBase = V_.length;  // = 127
  for (let si = 0; si < N; si++) {
    const a = Math.PI * 0.5 - si / N * Math.PI * 2;
    V_.push([sp.x, sp.radius * Math.cos(a), sp.radius * Math.sin(a)]);
  }

  /* ── Upper wing surface 143-154 ────────────────────────────── */
  V_.push(
    [ wrLE,  wry,   wrz + wtr          ],  // 143 R root upper LE
    [ wrTE,  wry,   wrz + wtr * 0.15   ],  // 144 R root upper TE
    [ wtLE,  whs,   wtz + wtt          ],  // 145 R tip  upper LE
    [ wtTE,  whs,   wtz + wtt * 0.15   ],  // 146 R tip  upper TE
    [ whLE,  whY,   whZ + whT          ],  // 147 R break upper LE
    [ whTE,  whY,   whZ + whT * 0.15   ],  // 148 R break upper TE
    [ wrLE, -wry,   wrz + wtr          ],  // 149 L root upper LE
    [ wrTE, -wry,   wrz + wtr * 0.15   ],  // 150 L root upper TE
    [ wtLE, -whs,   wtz + wtt          ],  // 151 L tip  upper LE
    [ wtTE, -whs,   wtz + wtt * 0.15   ],  // 152 L tip  upper TE
    [ whLE, -whY,   whZ + whT          ],  // 153 L break upper LE
    [ whTE, -whY,   whZ + whT * 0.15   ],  // 154 L break upper TE
  );

  /* ── Flap hinge vertices 155-162 ───────────────────────────── */
  V_.push(
    [ wfxR,  wry,  wrz              ],  // 155 R root lower hinge
    [ wfxH,  whY,  whZ              ],  // 156 R break lower hinge
    [ wfxR, -wry,  wrz              ],  // 157 L root lower hinge
    [ wfxH, -whY,  whZ              ],  // 158 L break lower hinge
    [ wfxR,  wry,  wrz + wtr * wuh  ],  // 159 R root upper hinge
    [ wfxH,  whY,  whZ + whT * wuh  ],  // 160 R break upper hinge
    [ wfxR, -wry,  wrz + wtr * wuh  ],  // 161 L root upper hinge
    [ wfxH, -whY,  whZ + whT * wuh  ],  // 162 L break upper hinge
  );

  /* ── H-stab upper surface + elevator hinges 163-178 ────────── */
  V_.push(
    [ hFwd,  hRY,   hThk               ],  // 163 R root upper LE
    [ hAft,  hRY,   hThk * 0.15        ],  // 164 R root upper TE
    [ hTFwd, hspan, hTZ + hThk         ],  // 165 R tip  upper LE
    [ hTAft, hspan, hTZ + hThk * 0.15  ],  // 166 R tip  upper TE
    [ hRHx,  hRY,   0                  ],  // 167 R root lower hinge
    [ hRHx,  hRY,   hThk * huh         ],  // 168 R root upper hinge
    [ hTHx,  hspan, hTZ                ],  // 169 R tip  lower hinge
    [ hTHx,  hspan, hTZ + hThk * huh   ],  // 170 R tip  upper hinge
    [ hFwd, -hRY,   hThk               ],  // 171 L root upper LE
    [ hAft, -hRY,   hThk * 0.15        ],  // 172 L root upper TE
    [ hTFwd,-hspan, hTZ + hThk         ],  // 173 L tip  upper LE
    [ hTAft,-hspan, hTZ + hThk * 0.15  ],  // 174 L tip  upper TE
    [ hRHx, -hRY,   0                  ],  // 175 L root lower hinge
    [ hRHx, -hRY,   hThk * huh         ],  // 176 L root upper hinge
    [ hTHx, -hspan, hTZ                ],  // 177 L tip  lower hinge
    [ hTHx, -hspan, hTZ + hThk * huh   ],  // 178 L tip  upper hinge
  );

  /* ── V-stab rudder hinge vertices 179-180 ──────────────────── */
  V_.push(
    [ vBHx, +vThkH, tailR ],  // 179 V-stab stbd base hinge
    [ vTHx, +vThkH, vTHz  ],  // 180 V-stab stbd top  hinge
  );

  /* ── Aileron hinge vertices 181-188 ────────────────────────── */
  V_.push(
    [ waxH,  whY,  whZ               ],  // 181 R lower break hinge
    [ waxT,  whs,  wtz               ],  // 182 R lower tip  hinge
    [ waxH,  whY,  whZ + whT * wAuh  ],  // 183 R upper break hinge
    [ waxT,  whs,  wtz + wtt * wAuh  ],  // 184 R upper tip  hinge
    [ waxH, -whY,  whZ               ],  // 185 L lower break hinge
    [ waxT, -whs,  wtz               ],  // 186 L lower tip  hinge
    [ waxH, -whY,  whZ + whT * wAuh  ],  // 187 L upper break hinge
    [ waxT, -whs,  wtz + wtt * wAuh  ],  // 188 L upper tip  hinge
  );

  /* ── Wing strut tube vertices 189-196 ──────────────────────── */
  const t_strut = ws.strutChord != null ? ws.strutChord / 2 : 0.00014;
  const d_strut = ws.strutThick ?? t_strut * 0.7;
  V_.push(
    [ _sXtop+t_strut,  _sYtop,  wrz   ],  // 189 R top fore
    [ _sXtop-t_strut,  _sYtop,  wrz   ],  // 190 R top aft
    [ _sBotX+t_strut,  sYbot,   sBotZ ],  // 191 R bot fore
    [ _sBotX-t_strut,  sYbot,   sBotZ ],  // 192 R bot aft
    [ _sXtop+t_strut, -_sYtop,  wrz   ],  // 193 L top fore
    [ _sXtop-t_strut, -_sYtop,  wrz   ],  // 194 L top aft
    [ _sBotX+t_strut, -sYbot,   sBotZ ],  // 195 L bot fore
    [ _sBotX-t_strut, -sYbot,   sBotZ ],  // 196 L bot aft
  );

  /* ── Aileron break-TE duplicates 197-200 ───────────────────── */
  V_.push(
    [ whTE,  whY,  whZ               ],  // 197 R break lower TE (aileron)
    [ whTE,  whY,  whZ + whT * 0.15  ],  // 198 R break upper TE (aileron)
    [ whTE, -whY,  whZ               ],  // 199 L break lower TE (aileron)
    [ whTE, -whY,  whZ + whT * 0.15  ],  // 200 L break upper TE (aileron)
  );

  /* ── V-stab port-side vertices 201-206 ─────────────────────── */
  const vsPort = V_.length;
  V_.push(
    [ vBFwd, -vThkH, tailR      ],  // vp+0 port base fwd
    [ vBAft, -vThkH, tailR      ],  // vp+1 port base aft
    [ vTFwd, -vThkH, vs.topFwdZ ],  // vp+2 port top fwd
    [ vTAft, -vThkH, vs.topAftZ ],  // vp+3 port top aft
    [ vBHx,  -vThkH, tailR      ],  // vp+4 port base hinge
    [ vTHx,  -vThkH, vTHz       ],  // vp+5 port top hinge
  );

  /* ── Wing strut depth vertices 207-214 ─────────────────────── */
  // 189-196 are the upper-Z edge (at wrz / sBotZ); these are the lower-Z edge
  const strutDepth = V_.length;
  V_.push(
    [ _sXtop+t_strut,  _sYtop,  wrz  -d_strut ],  // sd+0 R top fore lower
    [ _sXtop-t_strut,  _sYtop,  wrz  -d_strut ],  // sd+1 R top aft  lower
    [ _sBotX+t_strut,  sYbot,   sBotZ-d_strut ],  // sd+2 R bot fore lower
    [ _sBotX-t_strut,  sYbot,   sBotZ-d_strut ],  // sd+3 R bot aft  lower
    [ _sXtop+t_strut, -_sYtop,  wrz  -d_strut ],  // sd+4 L top fore lower
    [ _sXtop-t_strut, -_sYtop,  wrz  -d_strut ],  // sd+5 L top aft  lower
    [ _sBotX+t_strut, -sYbot,   sBotZ-d_strut ],  // sd+6 L bot fore lower
    [ _sBotX-t_strut, -sYbot,   sBotZ-d_strut ],  // sd+7 L bot aft  lower
  );

  /* ── LE nose vertices ──────────────────────────────────────── */
  // Each nose vertex sits slightly forward of the LE chord point, at mid-thickness Z,
  // giving the appearance of a blunt rounded leading edge when viewed from ahead.
  const wLeNose = V_.length;
  V_.push(
    [wrLE + wtr * 0.35,  wry,  wrz + wtr * 0.5],  // wn+0 R root nose
    [whLE + whT * 0.35,  whY,  whZ + whT * 0.5],  // wn+1 R break nose
    [wtLE + wtt * 0.35,  whs,  wtz + wtt * 0.5],  // wn+2 R tip  nose
    [wrLE + wtr * 0.35, -wry,  wrz + wtr * 0.5],  // wn+3 L root nose
    [whLE + whT * 0.35, -whY,  whZ + whT * 0.5],  // wn+4 L break nose
    [wtLE + wtt * 0.35, -whs,  wtz + wtt * 0.5],  // wn+5 L tip  nose
  );
  const hLeNose = V_.length;
  V_.push(
    [hFwd  + hThk * 0.35,  hRY,    hThk * 0.5       ],  // hn+0 R root nose
    [hTFwd + hThk * 0.35,  hspan,  hTZ + hThk * 0.5 ],  // hn+1 R tip  nose
    [hFwd  + hThk * 0.35, -hRY,    hThk * 0.5       ],  // hn+2 L root nose
    [hTFwd + hThk * 0.35, -hspan,  hTZ + hThk * 0.5 ],  // hn+3 L tip  nose
  );
  const vLeNose = V_.length;
  V_.push(
    [vBFwd + vThkH * 0.5, 0, tailR      ],  // vn+0 V-stab base nose
    [vTFwd + vThkH * 0.5, 0, vs.topFwdZ ],  // vn+1 V-stab top  nose
  );

  /* ── Dorsal spine vertices ──────────────────────────────────── */
  // Ridge starts on fuselage top at noseTip+4052mm, rises +4° to kink, then +23° to vBFwd.
  const _dorsalScale = (fs.noseTipX - vBFwd) / 6397;
  const _dX1 = fs.noseTipX - 4052 * _dorsalScale;
  const _dX2 = fs.noseTipX - 6177 * _dorsalScale;
  let _dZ1 = tailR;
  for (let ri = 0; ri < rings.length - 1; ri++) {
    if (_dX1 <= rings[ri].x && _dX1 >= rings[ri + 1].x) {
      const t = (_dX1 - rings[ri].x) / (rings[ri + 1].x - rings[ri].x);
      _dZ1 = (rings[ri].rz ?? rings[ri].r) + t * ((rings[ri + 1].rz ?? rings[ri + 1].r) - (rings[ri].rz ?? rings[ri].r));
      break;
    }
  }
  const _dZ2 = _dZ1 + Math.abs(_dX2 - _dX1) * Math.tan(4 * DEG);
  const _dZ3 = _dZ2 + Math.abs(vBFwd - _dX2) * Math.tan(23 * DEG);
  const dorsalP = V_.length;
  V_.push(
    [_dX1,  +vThkH, _dZ1],  // dp+0 stbd start
    [_dX1,  -vThkH, _dZ1],  // dp+1 port start
    [_dX2,  +vThkH, _dZ2],  // dp+2 stbd kink
    [_dX2,  -vThkH, _dZ2],  // dp+3 port kink
    [vBFwd, +vThkH, _dZ3],  // dp+4 stbd tip
    [vBFwd, -vThkH, _dZ3],  // dp+5 port tip
  );

  /* ── Cabin fairing ─────────────────────────────────────────── */
  const cbn = spec.cabin;
  const cabinVerts = {};
  if (cbn?.windshield) {
    const cw = cbn.windshield;
    const wsZ = rings[1].r;
    cabinVerts.wsBL = V_.length;
    V_.push(
      [cw.baseX, -cw.halfY, wsZ      ],  // b+0 BL:  windshield outer bottom-left
      [cw.baseX, +cw.halfY, wsZ      ],  // b+1 BR:  windshield outer bottom-right
      [cw.topX,  +cw.halfY, cw.topZ  ],  // b+2 TR:  A-pillar top-right
      [cw.topX,  -cw.halfY, cw.topZ  ],  // b+3 TL:  A-pillar top-left
      [cw.topX,  -cw.halfY, wsZ      ],  // b+4 IBL: inner bottom-left  (sill-forward)
      [cw.topX,  +cw.halfY, wsZ      ],  // b+5 IBR: inner bottom-right
    );
    // Cabin box: B-pillar at wing trailing edge
    const sZ = cbn.sillZ ?? wsZ;
    cabinVerts.cboxR = V_.length;
    V_.push(
      [wrTE, -cw.halfY, wrz ],  // c+0 RTL: B-pillar top-left
      [wrTE, +cw.halfY, wrz ],  // c+1 RTR: B-pillar top-right
      [wrTE, -cw.halfY, sZ  ],  // c+2 RBL: B-pillar bottom-left
      [wrTE, +cw.halfY, sZ  ],  // c+3 RBR: B-pillar bottom-right
    );
    // Rear window: C-pillar (two panes + center spar, tapered)
    if (cbn.rearWindowX != null) {
      cabinVerts.rwR = V_.length;
      const rwX    = cbn.rearWindowX;
      const rwBotY = cbn.rearWindowBotHalfY ?? cw.halfY;
      // Outer C-pillar corners bow forward (toward B-pillar) so the back window
      // curves around the rear of the cabin rather than sitting as a flat wall.
      const rwBow  = (wrTE - rwX) * 0.40;
      V_.push(
        [wrTE,         -cw.halfY, wrz ],  // r+0 RWTL: outer top-left
        [wrTE,         +cw.halfY, wrz ],  // r+1 RWTR: outer top-right
        [rwX + rwBow,  -rwBotY,   sZ  ],  // r+2 RWBL: outer bot-left (bowed)
        [rwX + rwBow,  +rwBotY,   sZ  ],  // r+3 RWBR: outer bot-right (bowed)
        [wrTE,          0,        wrz ],  // r+4 RWTC: center top — all top vertices at wrTE
        [rwX,           0,        sZ  ],  // r+5 RWBC: center bottom (no bow)
      );
      // Glass overlay vertices for rear side windows: r+6..r+9 left, r+10..r+13 right
      // Rear edges follow the bowed C-pillar (rwX+rwBow) not the structural rwX.
      const rwfX = cabinR * 0.06;  // fore-aft frame margin
      const rwfZ = cabinR * 0.04;  // vertical frame margin
      const rwRX = rwX + rwBow - rwfX;  // rear edge of side glass: inside bowed C-pillar
      V_.push(
        [wrTE + rwfX, -cw.halfY, wrz - rwfZ],  // r+6  L front top
        [rwRX,        -cw.halfY, wrz - rwfZ],  // r+7  L rear top
        [rwRX,        -cw.halfY, sZ  + rwfZ],  // r+8  L rear bot
        [wrTE + rwfX, -cw.halfY, sZ  + rwfZ],  // r+9  L front bot
        [wrTE + rwfX, +cw.halfY, wrz - rwfZ],  // r+10 R front top
        [rwRX,        +cw.halfY, wrz - rwfZ],  // r+11 R rear top
        [rwRX,        +cw.halfY, sZ  + rwfZ],  // r+12 R rear bot
        [wrTE + rwfX, +cw.halfY, sZ  + rwfZ],  // r+13 R front bot
      );
      // Mid-column vertices for horizontal bow.
      // Top row (Z=wrz): all top verts at wrTE — mid-top also at wrTE, no curvature needed.
      // Bot row (Z=sZ):  corner at rwX+rwBow, center at rwX.  Mid at rwBow*0.8.
      const rwMidBow = rwBow * 0.80;
      V_.push(
        [wrTE,           -cw.halfY * 0.5, wrz ],  // r+14 L mid-top (at wrTE, flat top edge)
        [wrTE,           +cw.halfY * 0.5, wrz ],  // r+15 R mid-top (at wrTE, flat top edge)
        [rwX + rwMidBow, -rwBotY   * 0.5, sZ  ],  // r+16 L mid-bot (bowed)
        [rwX + rwMidBow, +rwBotY   * 0.5, sZ  ],  // r+17 R mid-bot (bowed)
      );
    }
    // Door window: chamfered octagon vertices (8 per side = 16 total)
    if (cbn.doorWindow != null) {
      const dw  = cbn.doorWindow;
      const xF  = cw.topX - (dw.frontXOffset ?? 0);
      const xB  = xF - dw.width;
      const zBF = dw.botFrontZ;
      const zBB = dw.botBackZ;
      const zTF = zBF + dw.height;
      const zTB = zBB + dw.height;
      const dc  = dw.chamfer ?? 0;
      const dHY = cw.halfY;
      cabinVerts.dwL = V_.length;
      V_.push(
        [xF,    -dHY, zTF-dc],  // dw+0  left TL near-top
        [xF-dc, -dHY, zTF   ],  // dw+1  left TL top
        [xB+dc, -dHY, zTB   ],  // dw+2  left TR top
        [xB,    -dHY, zTB-dc],  // dw+3  left TR near-top
        [xB,    -dHY, zBB+dc],  // dw+4  left BR near-bot
        [xB+dc, -dHY, zBB   ],  // dw+5  left BR bot
        [xF-dc, -dHY, zBF   ],  // dw+6  left BL bot
        [xF,    -dHY, zBF+dc],  // dw+7  left BL near-bot
        [xF,    +dHY, zTF-dc],  // dw+8  right TL near-top
        [xF-dc, +dHY, zTF   ],  // dw+9  right TL top
        [xB+dc, +dHY, zTB   ],  // dw+10 right TR top
        [xB,    +dHY, zTB-dc],  // dw+11 right TR near-top
        [xB,    +dHY, zBB+dc],  // dw+12 right BR near-bot
        [xB+dc, +dHY, zBB   ],  // dw+13 right BR bot
        [xF-dc, +dHY, zBF   ],  // dw+14 right BL bot
        [xF,    +dHY, zBF+dc],  // dw+15 right BL near-bot
      );
      // Door outline: bottom chamfer + hinge + handle vertices
      if (cbn.doorBottomZ != null) {
        const dBotZ = cbn.doorBottomZ;
        const dbC   = cbn.doorBotChamfer ?? 0;
        const xDA   = cw.topX;
        const xDB   = xB;             // door rear = window rear edge (not B-pillar)
        const zHup  = wrz - 0.000400;
        const zHlo  = wrz - 0.001200;
        const zHL   = (sZ + dBotZ) * 0.5;
        cabinVerts.doorBotL = V_.length;
        V_.push(
          [xDA,         -dHY, dBotZ+dbC],  // db+0  L front edge above corner
          [xDA-dbC,     -dHY, dBotZ    ],  // db+1  L bottom just behind front
          [xDB+dbC,     -dHY, dBotZ    ],  // db+2  L bottom just before rear
          [xDB,         -dHY, dBotZ+dbC],  // db+3  L rear edge above corner
          [xDA,         +dHY, dBotZ+dbC],  // db+4  R front edge above corner
          [xDA-dbC,     +dHY, dBotZ    ],  // db+5  R bottom just behind front
          [xDB+dbC,     +dHY, dBotZ    ],  // db+6  R bottom just before rear
          [xDB,         +dHY, dBotZ+dbC],  // db+7  R rear edge above corner
          [xDA,         -dHY, zHup     ],  // db+8  L upper hinge A-pillar
          [xDA-0.000120,-dHY, zHup     ],  // db+9  L upper hinge inner
          [xDA,         -dHY, zHlo     ],  // db+10 L lower hinge A-pillar
          [xDA-0.000120,-dHY, zHlo     ],  // db+11 L lower hinge inner
          [xDB+0.000100,-dHY, zHL+0.000080],  // db+12 L handle TL
          [xDB+0.000300,-dHY, zHL+0.000080],  // db+13 L handle TR
          [xDB+0.000300,-dHY, zHL-0.000080],  // db+14 L handle BR
          [xDB+0.000100,-dHY, zHL-0.000080],  // db+15 L handle BL
          [xDA,         +dHY, zHup     ],  // db+16 R upper hinge A-pillar
          [xDA-0.000120,+dHY, zHup     ],  // db+17 R upper hinge inner
          [xDA,         +dHY, zHlo     ],  // db+18 R lower hinge A-pillar
          [xDA-0.000120,+dHY, zHlo     ],  // db+19 R lower hinge inner
          [xDB+0.000100,+dHY, zHL+0.000080],  // db+20 R handle TL
          [xDB+0.000300,+dHY, zHL+0.000080],  // db+21 R handle TR
          [xDB+0.000300,+dHY, zHL-0.000080],  // db+22 R handle BR
          [xDB+0.000100,+dHY, zHL-0.000080],  // db+23 R handle BL
          [xDB,         -dHY, sZ       ],  // db+24 L rear post top (sill height)
          [xDB,         +dHY, sZ       ],  // db+25 R rear post top (sill height)
        );
      }
    }
  }
  if (cbn?.intake) {
    const ci = cbn.intake;
    cabinVerts.intakeCtr = V_.length;
    V_.push(
      [rings[0].x, 0,        0        ],  // intake center
      [rings[0].x, ci.halfY, 0        ],  // intake +Y
      [rings[0].x, 0,        ci.halfZ ],  // intake +Z
    );
  }

  /* ── Faces ──────────────────────────────────────────────────── */
  for (let si = 0; si < N; si++) { F_.push([noseTip, spBase+(si+1)%N, spBase+si]); FC_.push(0); }
  for (let si = 0; si < N; si++) { F_.push([spBase+si, spBase+(si+1)%N, rb[0]+(si+1)%N, rb[0]+si]); FC_.push(0); }
  for (let si = 0; si < N; si++) { F_.push([tailTip, rb[lastRi]+si, rb[lastRi]+(si+1)%N]); FC_.push(0); }

  F_.push(
    [98,155,156,123],       // R lower fixed
    [155,99,124,156],       // R lower flap
    [123,181,182,100],      // R lower aileron fixed
    [181,197,101,182],      // R lower aileron moving
    [143,147,160,159],      // R upper fixed
    [159,160,148,144],      // R upper flap
    [147,145,184,183],      // R upper aileron fixed
    [183,184,146,198],      // R upper aileron moving
    [100,182,184,145],      // R tip cap fixed
    [182,101,146,184],      // R tip cap moving
    [102,125,158,157],      // L lower fixed
    [157,158,126,103],      // L lower flap
    [125,104,186,185],      // L lower aileron fixed
    [185,186,105,199],      // L lower aileron moving
    [149,161,162,153],      // L upper fixed
    [161,150,154,162],      // L upper flap
    [153,187,188,151],      // L upper aileron fixed
    [187,200,152,188],      // L upper aileron moving
    [104,151,188,186],      // L tip cap fixed
    [186,188,152,105],      // L tip cap moving
    [110,167,169,112],[167,111,113,169],      // R h-stab lower
    [163,165,170,168],[168,170,166,164],      // R h-stab upper
    [112,113,166,165],                        // R tip cap
    [114,116,177,175],[175,177,117,115],      // L h-stab lower
    [171,176,178,173],[176,172,174,178],      // L h-stab upper
    [116,173,174,117],                        // L tip cap
  );
  FC_.push(1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1, 0,0,0,0,0,0,0,0,0,0);

  // V-stab with Y-axis thickness (stbd = +vThkH, port = -vThkH)
  { const vp = vsPort;
    F_.push(
      [106,108,180,179],                                        // fixed stbd
      [vp+0,vp+4,vp+5,vp+2],                                   // fixed port
      [108,vp+2,vp+5,180],                                      // fixed top cap
      // Rounded LE: two faces angle from stbd and port toward the nose vertex
      [106,108,vLeNose+1,vLeNose+0],[vLeNose+0,vLeNose+1,108,106],  // stbd-to-nose
      [vLeNose+0,vLeNose+1,vp+2,vp+0],[vp+0,vp+2,vLeNose+1,vLeNose+0],  // nose-to-port
      [179,180,109,107],              // rudder stbd
      [vp+4,vp+1,vp+3,vp+5],         // rudder port
      [109,vp+3,vp+1,107],            // rudder TE cap
      [180,vp+5,vp+3,109],            // rudder top cap
    );
    FC_.push(0,0,0, 0,0,0,0, 0,0,0,0);
  }

  // Dorsal spine — fin with v-stab thickness rising from fuselage top
  { const dp = dorsalP;
    F_.push(
      // Stbd outer face (visible from +Y)
      [rb[3]+0, dp+0, dp+2, dp+4, rb[4]+0], [rb[4]+0, dp+4, dp+2, dp+0, rb[3]+0],
      // Port outer face (visible from -Y)
      [rb[3]+0, rb[4]+0, dp+5, dp+3, dp+1], [dp+1, dp+3, dp+5, rb[4]+0, rb[3]+0],
      // Top ridge cap — fwd segment
      [dp+0, dp+2, dp+3, dp+1], [dp+1, dp+3, dp+2, dp+0],
      // Top ridge cap — aft segment
      [dp+2, dp+4, dp+5, dp+3], [dp+3, dp+5, dp+4, dp+2],
      // Forward end cap (at spine start)
      [rb[3]+0, dp+1, dp+0], [dp+0, dp+1, rb[3]+0],
    );
    FC_.push(0,0, 0,0, 0,0, 0,0, 0,0);
  }

  // Wing LE — two-face rounded strip per section (lower→nose, nose→upper)
  { const wn = wLeNose;
    F_.push(
      // R root-to-break
      [98,  123, wn+1, wn+0], [wn+0, wn+1, 123, 98  ],   // lower half
      [143, wn+0, wn+1, 147], [147,  wn+1, wn+0, 143],   // upper half
      // R break-to-tip
      [123, 100, wn+2, wn+1], [wn+1, wn+2, 100, 123 ],   // lower half
      [147, wn+1, wn+2, 145], [145,  wn+2, wn+1, 147],   // upper half
      // L root-to-break
      [102, wn+3, wn+4, 125], [125,  wn+4, wn+3, 102],   // lower half
      [149, 153,  wn+4, wn+3],[wn+3, wn+4, 153,  149],   // upper half
      // L break-to-tip
      [125, wn+4, wn+5, 104], [104,  wn+5, wn+4, 125],   // lower half
      [153, wn+4, wn+5, 151], [151,  wn+5, wn+4, 153],   // upper half
    );
    FC_.push(1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1);
  }

  // H-stab LE — rounded strip (root-to-tip per side)
  { const hn = hLeNose;
    F_.push(
      [110, hn+0, hn+1, 112], [112, hn+1, hn+0, 110],   // R lower half
      [163, 165,  hn+1, hn+0],[hn+0, hn+1, 165, 163],   // R upper half
      [114, 116,  hn+3, hn+2],[hn+2, hn+3, 116, 114],   // L lower half
      [171, hn+2, hn+3, 173], [173,  hn+3, hn+2, 171],  // L upper half
    );
    FC_.push(0,0,0,0, 0,0,0,0);
  }

  if (ws.struts) {
    const sd = strutDepth;
    F_.push(
      // R strut — fore, aft, lower (outer), upper (inner, hidden by wing)
      [189,191,sd+2,sd+0],[sd+0,sd+2,191,189],  // R fore
      [190,sd+1,sd+3,192],[192,sd+3,sd+1,190],  // R aft
      [sd+0,sd+1,sd+3,sd+2],                     // R lower face
      // L strut
      [193,195,sd+6,sd+4],[sd+4,sd+6,195,193],  // L fore
      [194,sd+5,sd+7,196],[196,sd+7,sd+5,194],  // L aft
      [sd+4,sd+5,sd+7,sd+6],                     // L lower face
    );
    FC_.push(0,0,0,0,0, 0,0,0,0,0);
  }
  if (cbn?.windshield) {
    const b = cabinVerts.wsBL;
    // b: BL=b+0 BR=b+1 TR=b+2 TL=b+3 IBL=b+4 IBR=b+5
    F_.push(
      [b+2, b+3, b,   b+1  ],  // windshield front pane (TR TL BL BR)
      [b+2, b+1, b,   b+3  ],  // front pane back-face
      [b+3, b,   b+4       ],  // left side pane (TL BL IBL)
      [b+3, b+4, b         ],  // left side pane back-face
      [b+2, b+5, b+1       ],  // right side pane (TR IBR BR)
      [b+2, b+1, b+5       ],  // right side pane back-face
    );
    FC_.push(3,3,3,3,3,3);

    const c = cabinVerts.cboxR;
    if (c != null) {
      // Door area: A-pillar to B-pillar (topX → wrTE) — white body panels
      F_.push(
        [b+3, b+2, c+1, c+0],  // door roof (TL TR RTR RTL)
        [b+3, c+0, c+1, b+2],  // door roof back-face
        [b+3, c+0, c+2, b+4],  // left door panel (TL RTL RBL IBL)
        [b+3, b+4, c+2, c+0],  // left door panel back-face
        [b+2, b+5, c+3, c+1],  // right door panel (TR IBR RBR RTR)
        [b+2, c+1, c+3, b+5],  // right door panel back-face
      );
      FC_.push(0, 0, 0, 0, 0, 0);

      const r = cabinVerts.rwR;
      if (r != null) {
        // Rear quarter window: B-pillar to C-pillar (wrTE → rearWindowX)
        F_.push(
          [c+0, c+1, r+1, r+0],  // rear roof (RTL RTR RWTR RWTL)
          [c+0, r+0, r+1, c+1],  // rear roof back-face
          [c+0, r+0, r+2, c+2],  // left rear window (RTL RWTL RWBL RBL)
          [c+0, c+2, r+2, r+0],  // left rear window back-face
          [c+1, c+3, r+3, r+1],  // right rear window (RTR RBR RWBR RWTR)
          [c+1, r+1, r+3, c+3],  // right rear window back-face
          // C-pillar left pane — outer half (outer corner → mid-column)
          [r+0,  r+14, r+16, r+2 ], [r+2,  r+16, r+14, r+0 ],
          // C-pillar left pane — inner half (mid-column → center spar)
          [r+14, r+4,  r+5,  r+16], [r+16, r+5,  r+4,  r+14],
          // C-pillar right pane — inner half (center spar → mid-column)
          [r+4,  r+15, r+17, r+5 ], [r+5,  r+17, r+15, r+4 ],
          // C-pillar right pane — outer half (mid-column → outer corner)
          [r+15, r+1,  r+3,  r+17], [r+17, r+3,  r+1,  r+15],
        );
        FC_.push(0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3);  // roof+sides: white, C-pillar: glass
      } else {
        F_.push([c+0, c+1, c+3, c+2], [c+0, c+2, c+3, c+1]);
        FC_.push(0, 0);
      }


      // Glass octagon overlaid on white door panels — added after so painter sorts on top
      const dw = cabinVerts.dwL;
      if (dw != null) {
        F_.push(
          [dw+0, dw+1, dw+2, dw+3, dw+4, dw+5, dw+6, dw+7],  // left glass (outer)
          [dw+7, dw+6, dw+5, dw+4, dw+3, dw+2, dw+1, dw+0],  // left glass (inner)
          [dw+8, dw+15, dw+14, dw+13, dw+12, dw+11, dw+10, dw+9],  // right glass (outer)
          [dw+9, dw+10, dw+11, dw+12, dw+13, dw+14, dw+15, dw+8],  // right glass (inner)
        );
        FC_.push(3, 3, 3, 3);
      }
    }
  }

  /* ── Edges ──────────────────────────────────────────────────── */
  for (const si of [0, 4, 8, 12]) {
    E_.push([noseTip, spBase+si]);
    E_.push([spBase+si, rb[0]+si]);
    for (let ri = 0; ri < lastRi; ri++) E_.push([rb[ri]+si, rb[ri+1]+si]);
    E_.push([rb[lastRi]+si, tailTip]);
  }
  for (let si = 0; si < N; si++) E_.push([spBase+si, spBase+(si+1)%N]);

  E_.push(
    [98,123],[123,100],[99,124],
    [98,155],[155,99],[123,156],[156,181],[181,197],[197,101],[100,182],[182,101],[155,156],[181,182],
    [rb[2]+wRingIdx, 98],[rb[2]+wRingIdx, 99],
    [102,125],[125,104],[103,126],
    [102,157],[157,103],[125,158],[158,185],[185,199],[199,105],[104,186],[186,105],[157,158],[185,186],
    [rb[2]+wRingIdx, 102],[rb[2]+wRingIdx, 103],
    [98,143],[99,144],[123,147],[124,148],[100,145],[101,146],[197,198],
    [181,183],[182,184],
    [155,159],[156,160],
    [143,147],[147,145],
    [144,148],[198,146],
    [143,159],[159,144],[147,160],[160,183],[183,198],[145,184],[184,146],[159,160],[183,184],
    [102,149],[103,150],[125,153],[126,154],[104,151],[105,152],[199,200],
    [185,187],[186,188],
    [157,161],[158,162],
    [149,153],[153,151],
    [150,154],[200,152],
    [149,161],[161,150],[153,162],[162,187],[187,200],[151,188],[188,152],[161,162],[187,188],
    [106,108],[107,109],[106,179],[179,107],[108,180],[180,109],[179,180],[rb[4]+0,106],[rb[4]+0,107],
    [110,112],[111,113],[110,167],[167,111],[112,169],[169,113],[167,169],[rb[4]+4,110],
    [110,163],[111,164],[112,165],[113,166],[167,168],[169,170],
    [163,165],[164,166],[163,168],[168,164],[165,170],[170,166],[168,170],
    [114,116],[115,117],[114,175],[175,115],[116,177],[177,117],[175,177],[rb[4]+12,114],
    [114,171],[115,172],[116,173],[117,174],[175,176],[177,178],
    [171,173],[172,174],[171,176],[176,172],[173,178],[178,174],[176,178],
  );

  // LE nose edges — span-wise nose ridge and cross-section ties at each station
  { const wn = wLeNose, hn = hLeNose, vn = vLeNose;
    E_.push(
      [wn+0,wn+1],[wn+1,wn+2],              // R wing nose ridge
      [98,wn+0],[143,wn+0],[wn+0,123],[wn+0,147],   // R root ties
      [wn+1,123],[wn+1,147],[wn+1,100],[wn+1,145],  // R break ties
      [wn+3,wn+4],[wn+4,wn+5],              // L wing nose ridge
      [102,wn+3],[149,wn+3],[wn+3,125],[wn+3,153],  // L root ties
      [wn+4,125],[wn+4,153],[wn+4,104],[wn+4,151],  // L break ties
      [hn+0,hn+1],[hn+2,hn+3],              // h-stab nose ridges
      [110,hn+0],[163,hn+0],[hn+1,112],[hn+1,165],  // R h-stab ties
      [114,hn+2],[171,hn+2],[hn+3,116],[hn+3,173],  // L h-stab ties
      [vn+0,vn+1],                           // v-stab nose ridge
      [106,vn+0],[vn+0,vsPort+0],            // v-stab base ties
      [108,vn+1],[vn+1,vsPort+2],            // v-stab top  ties
    );
  }

  // Dorsal spine edges
  { const dp = dorsalP;
    E_.push(
      [rb[3]+0, dp+0], [rb[3]+0, dp+1],    // forward transition stbd/port
      [dp+0, dp+2], [dp+2, dp+4],           // stbd ridge
      [dp+1, dp+3], [dp+3, dp+5],           // port ridge
      [dp+0, dp+1], [dp+2, dp+3], [dp+4, dp+5],  // width edges at each station
    );
  }

  if (ws.struts) {
    const sd = strutDepth;
    E_.push(
      // R strut outline (upper edge + depth lines at ends)
      [189,191],[191,192],[192,190],[190,189],
      [sd+0,sd+2],[sd+2,sd+3],[sd+3,sd+1],[sd+1,sd+0],
      [189,sd+0],[190,sd+1],[191,sd+2],[192,sd+3],
      // L strut
      [193,195],[195,196],[196,194],[194,193],
      [sd+4,sd+6],[sd+6,sd+7],[sd+7,sd+5],[sd+5,sd+4],
      [193,sd+4],[194,sd+5],[195,sd+6],[196,sd+7],
    );
  }
  if (cbn?.windshield) {
    const b = cabinVerts.wsBL;
    E_.push(
      [b,   b+1 ],  // windshield outer bottom (forward sill)
      [b,   b+3 ],  // left A-pillar outer
      [b+1, b+2 ],  // right A-pillar outer
      [b+2, b+3 ],  // windshield top
      [b+4, b+5 ],  // inner bottom
      [b+3, b+4 ],  // left A-pillar post
      [b+2, b+5 ],  // right A-pillar post
      [b,   b+4 ],  // left side sill
      [b+1, b+5 ],  // right side sill
    );
    const c = cabinVerts.cboxR;
    if (c != null) {
      E_.push(
        [b+3, c+0],  // left roofline A→B
        [b+2, c+1],  // right roofline A→B
        [b+4, c+2],  // left sill A→B
        [b+5, c+3],  // right sill A→B
        [c+0, c+1],  // B-pillar top
        [c+2, c+3],  // B-pillar sill
        [c+0, c+2],  // B-pillar left post
        [c+1, c+3],  // B-pillar right post
      );
      const r = cabinVerts.rwR;
      if (r != null) {
        E_.push(
          [c+0, r+0],  // left roofline B→C
          [c+1, r+1],  // right roofline B→C
          [c+2, r+2],  // left sill B→C
          [c+3, r+3],  // right sill B→C
          [r+0, r+4],  // C-pillar top-left
          [r+4, r+1],  // C-pillar top-right
          [r+2, r+5],  // C-pillar sill-left
          [r+5, r+3],  // C-pillar sill-right
          [r+0, r+2],  // C-pillar left post
          [r+1, r+3],  // C-pillar right post
          [r+4, r+5],  // C-pillar center spar
        );
      }
      const dw = cabinVerts.dwL;
      if (dw != null) {
        E_.push(
          [dw+0, dw+1], [dw+1, dw+2], [dw+2, dw+3], [dw+3, dw+4],
          [dw+4, dw+5], [dw+5, dw+6], [dw+6, dw+7], [dw+7, dw+0],
          [dw+8, dw+9], [dw+9, dw+10], [dw+10, dw+11], [dw+11, dw+12],
          [dw+12, dw+13], [dw+13, dw+14], [dw+14, dw+15], [dw+15, dw+8],
        );
      }
      const db = cabinVerts.doorBotL;
      if (db != null) {
        E_.push(
          [b+4, db+0], [db+0, db+1], [db+1, db+2], [db+2, db+3], [db+3, db+24],
          [b+5, db+4], [db+4, db+5], [db+5, db+6], [db+6, db+7], [db+7, db+25],
          [db+8,  db+9 ], [db+10, db+11],
          [db+12, db+13], [db+13, db+14], [db+14, db+15], [db+15, db+12],
          [db+16, db+17], [db+18, db+19],
          [db+20, db+21], [db+21, db+22], [db+22, db+23], [db+23, db+20],
        );
      }
    }
  }

  /* ── Gear positions ─────────────────────────────────────────── */
  const g = spec.gear;
  const mainAttZ = -cabinR + (g.mainAttachZ ?? 0);
  const mainAttY = g.mainAttachY ?? g.mainSpan;
  const GV_ = [
    [ g.noseFwdX,  0,           -cabinR                       ],
    [ g.noseFwdX,  0,           -cabinR - g.noseWheelDrop     ],
    [ g.mainFwdX,  mainAttY,    mainAttZ                      ],
    [ g.mainFwdX,  g.mainSpan,  mainAttZ - g.mainWheelDrop    ],
    [ g.mainFwdX, -mainAttY,    mainAttZ                      ],
    [ g.mainFwdX, -g.mainSpan,  mainAttZ - g.mainWheelDrop    ],
  ];

  /* ── Lights ─────────────────────────────────────────────────── */
  const LIGHTS_ = [
    { pos: [ wrLE*0.3,  whs,  wtz ], col: [0,210,80],    key: 'nav'     },
    { pos: [ wrLE*0.3, -whs,  wtz ], col: [220,40,40],   key: 'nav'     },
    { pos: [ fs.tailTipX, 0, vs.topAftZ ], col: [255,255,255], key: 'nav' },
    { pos: [ 0, 0, wrz + 0.001 ],    col: [220,50,50],   key: 'beacon'  },
    { pos: [ wrLE*0.3,  whs,  wtz ], col: [255,255,255], key: 'strobe'  },
    { pos: [ wrLE*0.3, -whs,  wtz ], col: [255,255,255], key: 'strobe'  },
    { pos: [ sp.x, 0, 0 ],           col: [255,248,220], key: 'landing' },
  ];

  /* ── Gear strut tube vertices ─────────────────────────────── */
  // Each leg: 8 verts — +0..+3 are the stbd/upper edge, +4..+7 are the port/lower edge.
  // Nose gear: depth in Y (strut is vertical, centered at Y=0).
  // Main gear: depth in Z (strut runs in Y-Z plane; Z offset gives visible side faces).
  const t_main = cabinR * 0.05;
  const t_nose = cabinR * 0.035;
  const d_main = t_main * 0.8;
  const d_nose = t_nose * 0.8;
  const gvNose  = V_.length;
  V_.push(
    [g.noseFwdX + t_nose, +d_nose, -cabinR                    ],  // n+0 top fore stbd
    [g.noseFwdX - t_nose, +d_nose, -cabinR                    ],  // n+1 top aft  stbd
    [g.noseFwdX + t_nose, +d_nose, -cabinR - g.noseWheelDrop  ],  // n+2 bot fore stbd
    [g.noseFwdX - t_nose, +d_nose, -cabinR - g.noseWheelDrop  ],  // n+3 bot aft  stbd
    [g.noseFwdX + t_nose, -d_nose, -cabinR                    ],  // n+4 top fore port
    [g.noseFwdX - t_nose, -d_nose, -cabinR                    ],  // n+5 top aft  port
    [g.noseFwdX + t_nose, -d_nose, -cabinR - g.noseWheelDrop  ],  // n+6 bot fore port
    [g.noseFwdX - t_nose, -d_nose, -cabinR - g.noseWheelDrop  ],  // n+7 bot aft  port
  );
  const gvMainR = V_.length;
  V_.push(
    [g.mainFwdX + t_main,  mainAttY,   mainAttZ                   ],  // r+0 top fore upper-Z
    [g.mainFwdX - t_main,  mainAttY,   mainAttZ                   ],  // r+1 top aft  upper-Z
    [g.mainFwdX + t_main,  g.mainSpan, mainAttZ - g.mainWheelDrop ],  // r+2 bot fore upper-Z
    [g.mainFwdX - t_main,  g.mainSpan, mainAttZ - g.mainWheelDrop ],  // r+3 bot aft  upper-Z
    [g.mainFwdX + t_main,  mainAttY,   mainAttZ          - d_main ],  // r+4 top fore lower-Z
    [g.mainFwdX - t_main,  mainAttY,   mainAttZ          - d_main ],  // r+5 top aft  lower-Z
    [g.mainFwdX + t_main,  g.mainSpan, mainAttZ - g.mainWheelDrop - d_main ],  // r+6 bot fore lower-Z
    [g.mainFwdX - t_main,  g.mainSpan, mainAttZ - g.mainWheelDrop - d_main ],  // r+7 bot aft  lower-Z
  );
  const gvMainL = V_.length;
  V_.push(
    [g.mainFwdX + t_main, -mainAttY,   mainAttZ                   ],  // l+0 top fore upper-Z
    [g.mainFwdX - t_main, -mainAttY,   mainAttZ                   ],  // l+1 top aft  upper-Z
    [g.mainFwdX + t_main, -g.mainSpan, mainAttZ - g.mainWheelDrop ],  // l+2 bot fore upper-Z
    [g.mainFwdX - t_main, -g.mainSpan, mainAttZ - g.mainWheelDrop ],  // l+3 bot aft  upper-Z
    [g.mainFwdX + t_main, -mainAttY,   mainAttZ          - d_main ],  // l+4 top fore lower-Z
    [g.mainFwdX - t_main, -mainAttY,   mainAttZ          - d_main ],  // l+5 top aft  lower-Z
    [g.mainFwdX + t_main, -g.mainSpan, mainAttZ - g.mainWheelDrop - d_main ],  // l+6 bot fore lower-Z
    [g.mainFwdX - t_main, -g.mainSpan, mainAttZ - g.mainWheelDrop - d_main ],  // l+7 bot aft  lower-Z
  );
  { const n = gvNose, r = gvMainR, l = gvMainL;
    F_.push(
      // Nose gear — 4 sides
      [n+0,n+2,n+6,n+4],[n+4,n+6,n+2,n+0],  // fore
      [n+1,n+5,n+7,n+3],[n+3,n+7,n+5,n+1],  // aft
      [n+0,n+1,n+3,n+2],[n+2,n+3,n+1,n+0],  // stbd (+Y)
      [n+4,n+6,n+7,n+5],[n+5,n+7,n+6,n+4],  // port (-Y)
      // R main gear — fore, aft, upper, lower
      [r+0,r+2,r+6,r+4],[r+4,r+6,r+2,r+0],  // fore
      [r+1,r+5,r+7,r+3],[r+3,r+7,r+5,r+1],  // aft
      [r+0,r+1,r+3,r+2],[r+2,r+3,r+1,r+0],  // upper-Z (+Z)
      [r+4,r+6,r+7,r+5],[r+5,r+7,r+6,r+4],  // lower-Z (-Z)
      // L main gear
      [l+0,l+4,l+6,l+2],[l+2,l+6,l+4,l+0],  // fore
      [l+1,l+3,l+7,l+5],[l+5,l+7,l+3,l+1],  // aft
      [l+0,l+2,l+3,l+1],[l+1,l+3,l+2,l+0],  // upper-Z (+Z)
      [l+4,l+6,l+7,l+5],[l+5,l+7,l+6,l+4],  // lower-Z (-Z)
    );
    FC_.push(0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0);
  }

  const propMidX = sp.x + 0.25 * (fs.noseTipX - sp.x);                   // 25% from spinner base (thicker section)

  /* ── Propeller blade geometry ────────────────────────────────── */
  const nBlades    = spec.nBlades ?? 2;
  const bDiskR     = spec.propDiskRadius;
  const bInnerR    = sp.radius * 0.4;              // root (inside spinner)
  const bMidR      = bInnerR + (bDiskR - bInnerR) * 0.30;  // widest chord position
  const bHW_neck   = bDiskR * 0.050;              // narrow at root/spinner junction
  const bHW_max    = bDiskR * 0.100;              // widest (mid-blade)
  const bHW_t      = bDiskR * 0.040;              // tip half-chord
  const propBlade0 = V_.length;
  for (let i = 0; i < nBlades; i++) {
    const θ = i * Math.PI * 2 / nBlades;
    const cθ = Math.cos(θ), sθ = Math.sin(θ);     // span: (0, cθ, sθ) from +Y; chord: (0, -sθ, cθ)
    V_.push(
      [propMidX,  bInnerR*cθ - bHW_neck*sθ,  bInnerR*sθ + bHW_neck*cθ ],  // b+0 root LE
      [propMidX,  bMidR  *cθ - bHW_max *sθ,  bMidR  *sθ + bHW_max *cθ ],  // b+1 mid  LE
      [propMidX,  bDiskR *cθ - bHW_t   *sθ,  bDiskR *sθ + bHW_t   *cθ ],  // b+2 tip  LE
      [propMidX,  bDiskR *cθ + bHW_t   *sθ,  bDiskR *sθ - bHW_t   *cθ ],  // b+3 tip  TE
      [propMidX,  bMidR  *cθ + bHW_max *sθ,  bMidR  *sθ - bHW_max *cθ ],  // b+4 mid  TE
      [propMidX,  bInnerR*cθ + bHW_neck*sθ,  bInnerR*sθ - bHW_neck*cθ ],  // b+5 root TE
    );
    const b = propBlade0 + i * 6;
    F_.push([b, b+1, b+2, b+3, b+4, b+5], [b+5, b+4, b+3, b+2, b+1, b]);
    FC_.push(4, 4);
  }

  const propHub  = V_.length;  V_.push([propMidX, 0, 0]);               // prop hub center
  const propZTip = V_.length;  V_.push([propMidX, 0, spec.propDiskRadius]); // prop +Z anchor
  const prop = { hub: propHub, tip: 122, ztip: propZTip };
  const COL_ = spec.colors ?? [..._PP_COLORS_DEFAULT];
  const FN_  = computeFaceNormals(V_, F_);

  function animSurfaces({ flapCfg, ailCmd, elevCmd, rudCmd, propAngle = 0 }) {
    const verts = V_.map(v => v.slice());
    if (flapCfg > 0)
      animHinge(verts, [99,124,103,126,144,148,150,154], r_fl, -(flapCfg*10*DEG), 'z', V_);
    if (Math.abs(ailCmd) > 0.01) {
      const aa = ailCmd * 18 * DEG;
      animHinge(verts, [197,101,198,146], r_ail, -aa, 'z');
      animHinge(verts, [199,105,200,152], r_ail, +aa, 'z');
    }
    if (Math.abs(elevCmd) > 0.02)
      animHinge(verts, [111,113,115,117,164,166,172,174], r_el, elevCmd*20*DEG, 'z');
    if (Math.abs(rudCmd) > 0.02)
      animHinge(verts, [107,109, vsPort+1, vsPort+3], r_ru, -(rudCmd*25*DEG), 'y');
    if (propAngle !== 0) {
      const c = Math.cos(propAngle), s = Math.sin(propAngle);
      for (let vi = propBlade0; vi < propBlade0 + nBlades * 6; vi++) {
        const [x, y, z] = verts[vi];
        verts[vi] = [x, y*c - z*s, y*s + z*c];
      }
    }
    return verts;
  }

  return { V_, F_, FC_, E_, FN_, GV_, LIGHTS_, prop, animSurfaces, COL_, cabinVerts, gearTubes: true };
}

/* Convert aircraft JSON to _buildPP spec — pass-through adapter kept
   separate so future normalization doesn't touch callers. */
export function _acPropFromJson(aircraft) {
  return aircraft.propplane;
}
