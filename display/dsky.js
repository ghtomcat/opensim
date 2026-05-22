/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/dsky.js
   Shared DSKY drawing functions used by both the CM (rocket_display.js)
   and LM (lm_display.js) panels.

   drawDSKY(ctx, cx, cy, w, h, st)
     st = { prog, verb, noun, r1, r2, r3, compActy }
     Callers apply mode/digit/verbOv overrides to st before calling.

   drawDSKYKeyboard(ctx, x, y, w, h, dskyMode, keyRects)
     Fills keyRects[] with { key, x, y, w, h } for click detection.
   ═══════════════════════════════════════════════════════════════ */

const _SEG = {
  '0':[1,1,1,1,1,1,0], '1':[0,1,1,0,0,0,0], '2':[1,1,0,1,1,0,1],
  '3':[1,1,1,1,0,0,1], '4':[0,1,1,0,0,1,1], '5':[1,0,1,1,0,1,1],
  '6':[1,0,1,1,1,1,1], '7':[1,1,1,0,0,0,0], '8':[1,1,1,1,1,1,1],
  '9':[1,1,1,1,0,1,1], '-':[0,0,0,0,0,0,1], ' ':[0,0,0,0,0,0,0],
};

export function seg7(ctx, ox, oy, sw, sh, ch, onCol, offCol) {
  const p = _SEG[ch] ?? _SEG[' '];
  const t = Math.max(1, sw * 0.13);
  const iw = sw - t * 2, ih = sh * 0.5 - t * 2;
  function r(x, y, w, h, on) { ctx.fillStyle = on ? onCol : offCol; ctx.fillRect(x, y, w, h); }
  r(ox+t,      oy,              iw, t,  p[0]);
  r(ox+sw-t,   oy+t,            t, ih, p[1]);
  r(ox+sw-t,   oy+sh*.5+t,     t, ih, p[2]);
  r(ox+t,      oy+sh-t,        iw, t,  p[3]);
  r(ox,        oy+sh*.5+t,     t, ih, p[4]);
  r(ox,        oy+t,            t, ih, p[5]);
  r(ox+t,      oy+sh*.5-t*.5,  iw, t,  p[6]);
}

export function dskyStr(ctx, str, ox, oy, sw, sh, onCol, offCol) {
  const gap = sw * 0.22;
  for (let i = 0; i < str.length; i++)
    seg7(ctx, ox + i * (sw + gap), oy, sw, sh, str[i], onCol, offCol);
}

/* ── Main DSKY display ──────────────────────────────────────────
   Layout matches the real AGC DSKY reference:
   left panel  = 5×2 warning lights grid
   right panel = CMPTR ACTY + PROG at top, VERB/NOUN below, R1/R2/R3
   ─────────────────────────────────────────────────────────────── */
export function drawDSKY(ctx, cx, cy, w, h, st) {
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  const p = Math.round(w * 0.030);

  const ON  = '#a8f050';
  const OFF = '#1c2c14';
  const LBL = '#3a4a30';
  const LIT = '#38b030';
  const DIM = '#0a1208';

  /* Panel body */
  ctx.fillStyle = '#141810';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.round(w * 0.04));
  ctx.fill();
  ctx.strokeStyle = '#252e20';
  ctx.lineWidth = Math.max(1, w * 0.008);
  ctx.stroke();

  /* ── LEFT: Warning lights grid (5 rows × 2 cols) ── */
  const leftW    = Math.round(w * 0.40);
  const warnRows = [
    ['UPLINK ACTY', 'TEMP'],
    ['NO ATT',      'GIMBAL LK'],
    ['STBY',        'PROG'],
    ['KEY REL',     'RESTART'],
    ['OPR ERR',     'TRACKER'],
  ];
  const warnOn = [
    [false, false],
    [false, false],
    [false, st.prog !== '00'],
    [false, false],
    [false, false],
  ];

  const warnTotalH = h - p * 2;
  const warnRowH   = warnTotalH / 5;
  const warnColW   = (leftW - p * 2 - Math.round(p * 0.5)) / 2;
  const warnFontSz = Math.max(7, Math.round(warnRowH * 0.28));
  ctx.font = `${warnFontSz}px "IBM Plex Mono",monospace`;
  ctx.textBaseline = 'middle';

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      const lbl = warnRows[row][col];
      const on  = warnOn[row][col];
      const wx  = x + p + col * (warnColW + Math.round(p * 0.5));
      const wy  = y + p + row * warnRowH;
      const bh  = Math.round(warnRowH * 0.80);

      ctx.fillStyle   = on ? '#0d200d' : '#0c1410';
      ctx.strokeStyle = on ? '#2a6028' : '#1e2a1c';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.roundRect(wx, wy, warnColW, bh, 2);
      ctx.fill();
      ctx.stroke();

      const dotR = Math.max(2, Math.round(bh * 0.14));
      ctx.fillStyle = on ? LIT : DIM;
      ctx.beginPath();
      ctx.arc(wx + dotR * 1.6, wy + bh / 2, dotR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = on ? '#7acc60' : LBL;
      ctx.textAlign = 'left';
      ctx.fillText(lbl, wx + dotR * 3.4, wy + bh / 2);
    }
  }

  /* Vertical divider */
  ctx.fillStyle = '#1a2218';
  ctx.fillRect(x + leftW, y + p, Math.max(1, Math.round(w * 0.005)), h - p * 2);

  /* ── RIGHT: Display section ── */
  const dispX = x + leftW + Math.round(p * 0.8);
  const dispW = w - leftW - Math.round(p * 0.8) - p;
  const dispY = y + p;
  const dispH = h - p * 2;

  const progH = Math.round(dispH * 0.22);
  const vnH   = Math.round(dispH * 0.28);
  const sepH  = Math.max(1, Math.round(h * 0.008));
  const dataH = dispH - progH - vnH - sepH * 2;
  const rowH  = Math.round(dataH / 3);

  /* ── PROG row ── */
  const caFontSz = Math.max(7, Math.round(progH * 0.26));
  ctx.font = `${caFontSz}px "IBM Plex Mono",monospace`;
  ctx.textBaseline = 'middle';

  const caDotR = Math.max(2, Math.round(progH * 0.13));
  const caDotX = dispX + caDotR * 1.8;
  const caDotY = dispY + Math.round(progH * 0.35);
  ctx.fillStyle = st.compActy ? LIT : DIM;
  ctx.beginPath();
  ctx.arc(caDotX, caDotY, caDotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.compActy ? '#7acc60' : LBL;
  ctx.textAlign = 'left';
  ctx.fillText('CMPTR', caDotX + caDotR * 2, caDotY);
  ctx.fillText('ACTY',  caDotX + caDotR * 2, caDotY + caFontSz * 1.1);

  const progSegH = Math.round(progH * 0.68);
  const progSegW = Math.round(progSegH * 0.52);
  const progDigW = 2 * progSegW + Math.round(progSegW * 0.22);
  const progDigX = dispX + dispW - progDigW;
  const progDigY = dispY + Math.round((progH - progSegH) * 0.5);

  const progLblSz = Math.max(7, Math.round(progH * 0.24));
  ctx.font = `${progLblSz}px "IBM Plex Mono",monospace`;
  const progLblY = dispY + Math.round(progH * 0.20);
  const progLblX = progDigX + progDigW / 2;
  ctx.fillStyle = LBL;
  ctx.textAlign = 'center';
  ctx.fillText('PROG', progLblX, progLblY);
  const pLblW = ctx.measureText('PROG').width;
  const pDotR = Math.max(2, Math.round(progLblSz * 0.28));
  ctx.fillStyle = st.prog !== '00' ? LIT : DIM;
  ctx.beginPath();
  ctx.arc(progLblX - pLblW / 2 - pDotR * 1.8, progLblY, pDotR, 0, Math.PI * 2);
  ctx.fill();

  dskyStr(ctx, st.prog, progDigX, progDigY + Math.round(progH * 0.20), progSegW, progSegH, ON, OFF);

  /* Separator 1 */
  const sep1Y = dispY + progH;
  ctx.fillStyle = '#1a2218';
  ctx.fillRect(dispX, sep1Y, dispW, sepH);

  /* ── VERB / NOUN row ── */
  const vnY    = sep1Y + sepH;
  const halfW  = Math.round(dispW / 2);
  const segVH  = Math.round(vnH * 0.58);
  const segVW  = Math.round(segVH * 0.52);
  const vnDigW = 2 * segVW + Math.round(segVW * 0.22);
  const vnLblSz = Math.max(7, Math.round(vnH * 0.22));
  ctx.font = `${vnLblSz}px "IBM Plex Mono",monospace`;
  ctx.textBaseline = 'middle';

  for (const [i, lbl, val] of [[0,'VERB',st.verb],[1,'NOUN',st.noun]]) {
    const vx   = dispX + i * halfW;
    const vcx  = vx + Math.round(halfW / 2);
    const lblY = vnY + Math.round(vnH * 0.20);
    const lw   = ctx.measureText(lbl).width;
    const dotR = Math.max(2, Math.round(vnLblSz * 0.28));

    ctx.fillStyle = DIM;
    ctx.beginPath();
    ctx.arc(vcx - lw / 2 - dotR * 1.8, lblY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LBL;
    ctx.textAlign = 'center';
    ctx.fillText(lbl, vcx, lblY);

    const digY = vnY + Math.round(vnH * 0.42);
    dskyStr(ctx, val, vcx - Math.round(vnDigW / 2), digY, segVW, segVH, ON, OFF);
  }

  /* Separator 2 */
  const sep2Y = vnY + vnH;
  ctx.fillStyle = '#1a2218';
  ctx.fillRect(dispX, sep2Y, dispW, sepH);

  /* ── R1 / R2 / R3 ── */
  const dataY  = sep2Y + sepH;
  const segSH  = Math.round(rowH * 0.72);
  const segSW  = Math.round(segSH * 0.52);
  const rLblSz = Math.max(7, Math.round(rowH * 0.30));
  ctx.font = `${rLblSz}px "IBM Plex Mono",monospace`;
  ctx.textBaseline = 'middle';

  for (const [i, row] of [[0, st.r1],[1, st.r2],[2, st.r3]]) {
    const ry  = dataY + i * rowH;
    const rcy = ry + Math.round(rowH * 0.5);
    const sy  = rcy - Math.round(segSH * 0.5);

    ctx.fillStyle = LBL;
    ctx.textAlign = 'left';
    ctx.fillText(`R${i+1}`, dispX, rcy);
    const lblW = ctx.measureText(`R${i+1}`).width + Math.round(p * 0.4);

    ctx.fillStyle = '#1a2218';
    ctx.fillRect(dispX + lblW - Math.round(p*0.2), ry + Math.round(rowH*0.12),
                 Math.max(1, Math.round(w*0.005)), Math.round(rowH*0.76));

    const signX = dispX + lblW;
    seg7(ctx, signX, sy, segSW * 0.6, segSH, row[0] === '-' ? '-' : ' ', ON, OFF);
    dskyStr(ctx, row.slice(1), signX + segSW * 0.7, sy, segSW, segSH, ON, OFF);
  }
}

/* ── DSKY keyboard ──────────────────────────────────────────────
   7 columns × 3 rows — VERB/NOUN left, ENTR/RSET right
   keyRects is cleared and filled with hit-test rects.
   ─────────────────────────────────────────────────────────────── */
export function drawDSKYKeyboard(ctx, x, y, w, h, dskyMode, keyRects) {
  keyRects.length = 0;

  const COLS = 7, ROWS = 3;
  const gap  = Math.max(2, Math.round(w * 0.018));
  const kw   = (w - gap * (COLS + 1)) / COLS;
  const kh   = (h - gap * (ROWS + 1)) / ROWS;

  ctx.fillStyle = '#0b1209';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.round(w * 0.04));
  ctx.fill();
  ctx.strokeStyle = '#1a2218';
  ctx.lineWidth   = 1;
  ctx.stroke();

  const keys = [
    { k:'VERB',    c:0, r:0, rs:2, type:'vn'         },
    { k:'+',       c:1, r:0,       type:'sign'        },
    { k:'7',       c:2, r:0,       type:'num'         },
    { k:'8',       c:3, r:0,       type:'num'         },
    { k:'9',       c:4, r:0,       type:'num'         },
    { k:'CLR',     c:5, r:0,       type:'fn'          },
    { k:'ENTR',    c:6, r:0, rs:2, type:'fn'          },
    { k:'-',       c:1, r:1,       type:'sign'        },
    { k:'4',       c:2, r:1,       type:'num'         },
    { k:'5',       c:3, r:1,       type:'num'         },
    { k:'6',       c:4, r:1,       type:'num'         },
    { k:'PRO',     c:5, r:1,       type:'fn'          },
    { k:'NOUN',    c:0, r:2,       type:'vn'          },
    { k:'0',       c:1, r:2,       type:'num'         },
    { k:'1',       c:2, r:2,       type:'num'         },
    { k:'2',       c:3, r:2,       type:'num'         },
    { k:'3',       c:4, r:2,       type:'num'         },
    { k:'KEY REL', c:5, r:2,       type:'fn', fs:0.46 },
    { k:'RSET',    c:6, r:2,       type:'fn'          },
  ];

  for (const key of keys) {
    const rs  = key.rs ?? 1;
    const kx  = x + gap + key.c * (kw + gap);
    const ky  = y + gap + key.r * (kh + gap);
    const kkw = kw;
    const kkh = kh * rs + gap * (rs - 1);

    const active = (key.k === 'VERB' && dskyMode === 'verb') ||
                   (key.k === 'NOUN' && dskyMode === 'noun');

    const bg = active             ? '#1e3020'
             : key.type === 'vn'   ? '#0e1c0e'
             : key.type === 'num'  ? '#121810'
             : key.type === 'sign' ? '#0f1a10'
             :                       '#0d1610';

    ctx.fillStyle   = bg;
    ctx.strokeStyle = active ? '#3a5a38' : '#1e2c1c';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(kx, ky, kkw, kkh, Math.round(Math.min(kkw, kkh) * 0.12));
    ctx.fill();
    ctx.stroke();

    const fontSize = Math.round(Math.min(kkw, kh) * (key.fs ?? 0.38));
    ctx.font         = `${fontSize}px "IBM Plex Mono",monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = active             ? '#c0e8a0'
                     : key.type === 'vn'   ? '#8ab878'
                     : key.type === 'num'  ? '#7aaa60'
                     : key.type === 'sign' ? '#5a8048'
                     :                       '#5a7850';
    ctx.fillText(key.k, kx + kkw / 2, ky + kkh / 2);

    if (key.k) keyRects.push({ key: key.k, x: kx, y: ky, w: kkw, h: kkh });
  }
}
