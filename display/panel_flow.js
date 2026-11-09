/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/panel_flow.js
   The flowing layout of the analog panel: where each instrument goes, for the view it is drawn in.
   Pure arithmetic — no canvas, no sim state (tests/panel-flow.test.mjs).

   The rules (docs/issues.md, "The analog panels draw a borrowed fighter panel", decided 2026-11-09):
   - the order inside a group is kept, and a group stays together; what belongs together is one item
     (a lamp group: { kind: 'lamps', n: 4 });
   - a group is drawn in its own rows (the photo's row breaks) or re-broken into k balanced rows;
     the groups sit side by side or stacked; the size ratios are kept, the whole is scaled to fit;
   - panel view: the group's own rows always; combined view: the arrangement with the largest
     instruments wins — the own rows if they reach at least PREFER of that;
   - an engine group (`perEngine`) is a fixed grid: one row per quantity, one column per engine;
   - a cap: a large (L) instrument is at most `maxL` px; the panel is centred in the area.
   ═══════════════════════════════════════════════════════════════ */

/** Size classes, mm — relative sizes; the real panels' ratios (sources/*-panel-notes.md) */
export const SIZES = { L: 80, S: 57, XS: 45, T: 25 };

export const PREFER = 0.85;     // combined view: keep the own rows if they reach this share of the best scale

/* Spacing, mm. An instrument's footprint is taller than its dial: the name is drawn below it
   (display/analog_panel.js: _label at 1.28 r), so each item reserves BELOW × its diameter under the dial. */
const GAP = 8, SEP = 26, PAD = 12, LBLCOL = 26, HDR = 10, LAMP_GAP = 4;
const BELOW = 0.22;

/* An item's footprint by its kind (given by the caller — display/analog_panel.js takes it from its registry): a lamp
   has no name under it, a bubble level is wide and flat */
const wOf = e => e.kind === 'lamps' ? e.n * SIZES[e.size] + (e.n - 1) * LAMP_GAP : SIZES[e.size] * (e.kind === 'level' ? 1.3 : 1);
const hOf = e => SIZES[e.size] * (e.kind === 'level' ? 0.5 : 1 + (e.kind === 'lamp' || e.kind === 'lamps' ? 0 : BELOW));

/** k rows of about equal width, in order */
function _splitK(items, k) {
  const total = items.reduce((t, e) => t + wOf(e) + GAP, -GAP), target = total / k, rows = [[]];
  let acc = 0;
  for (const e of items) {
    const w = wOf(e) + GAP;
    if (rows.length < k && rows.at(-1).length && acc + w / 2 > target * rows.length) rows.push([]);
    rows.at(-1).push(e); acc += w;
  }
  return rows;
}

function _boxRows(rows) {
  const ws = rows.map(r => r.reduce((t, e) => t + wOf(e) + GAP, -GAP));
  const hs = rows.map(r => Math.max(...r.map(hOf)));
  return { w: Math.max(...ws), h: hs.reduce((t, h) => t + h + GAP, -GAP), rows, ws, hs };
}

/** The ways one group can be laid out: its own rows, then 1…6 balanced rows (or the fixed grid) */
function _candidates(g, engines) {
  if (g.perEngine) {
    const cell = Math.max(...g.perEngine.map(e => SIZES[e.size]));
    const rowH = cell * (1 + BELOW);
    return [{ grid: true, own: true, cell, rowH, w: LBLCOL + engines * cell + (engines - 1) * GAP,
              h: HDR + g.perEngine.length * (rowH + GAP) - GAP, label: 'grid' }];
  }
  const items = g.rows.flat();
  const out = [{ ..._boxRows(g.rows), own: true, label: 'own rows' }];
  for (let k = 1; k <= Math.min(items.length, 6); k++) out.push({ ..._boxRows(_splitK(items, k)), label: `${k} row${k > 1 ? 's' : ''}` });
  return out;
}

function* _combos(lists, i = 0, acc = []) {
  if (i === lists.length) { yield acc; return; }
  for (const c of lists[i]) yield* _combos(lists, i + 1, [...acc, c]);
}

/**
 * Lay out the groups in an area.
 * @param groups  [{ name, rows: [[item…]…] } | { name, perEngine: [item…] }] — item { id, size, kind?, n? }
 * @param area    { w, h } in px
 * @param opts    { view: 'panel' | 'combined', engines = 1, maxL = Infinity (px) }
 * @returns { scale (px per mm), arrangement: 'side' | 'stack', groups: [{ name, label, x, y, w, h }],
 *            items: [{ id, x, y, d, group, engine? }] — x, y the dial's centre in px, d its diameter;
 *            labels: [{ text, x, y, id? }] — the engine numbers and quantity names of a grid (id: the quantity's instrument) }
 */
export function flowLayout(groups, area, { view = 'panel', engines = 1, maxL = Infinity } = {}) {
  const lists = groups.map(g => _candidates(g, engines));
  let best = null, bestOwn = null;
  for (const cs of _combos(lists)) {
    for (const arr of (cs.length > 1 ? ['side', 'stack'] : ['side'])) {
      const W = arr === 'side' ? cs.reduce((t, c) => t + c.w + SEP, -SEP) : Math.max(...cs.map(c => c.w));
      const H = arr === 'side' ? Math.max(...cs.map(c => c.h)) : cs.reduce((t, c) => t + c.h + SEP, -SEP);
      const scale = Math.min(area.w / (W + 2 * PAD), area.h / (H + 2 * PAD));
      const cand = { cs, arr, W, H, scale };
      if (!best || scale > best.scale) best = cand;
      if (cs.every(c => c.own) && (!bestOwn || scale > bestOwn.scale)) bestOwn = cand;
    }
  }
  const pick = (view === 'panel' || bestOwn.scale >= PREFER * best.scale) ? bestOwn : best;
  const scale = Math.min(pick.scale, maxL / SIZES.L);
  return _place(groups, pick, scale, area, engines);
}

function _place(groups, pick, s, area, engines) {
  const ox = (area.w - pick.W * s) / 2, oy = (area.h - pick.H * s) / 2;
  const items = [], labels = [], boxes = [];
  let x = 0, y = 0;
  pick.cs.forEach((c, gi) => {
    const g = groups[gi];
    const gx = pick.arr === 'side' ? x : (pick.W - c.w) / 2;
    const gy = pick.arr === 'side' ? (pick.H - c.h) / 2 : y;
    boxes.push({ name: g.name, label: c.label, x: ox + gx * s, y: oy + gy * s, w: c.w * s, h: c.h * s });
    if (c.grid) {
      for (let k = 0; k < engines; k++)
        labels.push({ text: String(k + 1), x: ox + (gx + LBLCOL + k * (c.cell + GAP) + c.cell / 2) * s, y: oy + (gy + HDR / 2) * s });
      g.perEngine.forEach((e, r) => {
        const cy = gy + HDR + r * (c.rowH + GAP) + SIZES[e.size] / 2;
        labels.push({ text: e.id.toUpperCase(), id: e.id, x: ox + (gx + LBLCOL / 2) * s, y: oy + cy * s });
        for (let k = 0; k < engines; k++)
          items.push({ id: e.id, item: e, group: g.name, engine: k, d: SIZES[e.size] * s,
                       x: ox + (gx + LBLCOL + k * (c.cell + GAP) + c.cell / 2) * s, y: oy + cy * s });
      });
    } else {
      let ry = gy;
      c.rows.forEach((row, r) => {
        let rx = gx + (c.w - c.ws[r]) / 2;
        const rowD = Math.max(...row.map(e => SIZES[e.size]));
        for (const e of row) {
          const d = SIZES[e.size], cy = ry + rowD / 2;          // one centre line per row, the largest dial's
          if (e.kind === 'lamps') {
            for (let q = 0; q < e.n; q++)
              items.push({ id: e.id, item: e, group: g.name, lamp: q, d: d * s, x: ox + (rx + q * (d + LAMP_GAP) + d / 2) * s, y: oy + cy * s });
          } else {
            items.push({ id: e.id, item: e, group: g.name, d: d * s, x: ox + (rx + wOf(e) / 2) * s, y: oy + cy * s });   // centred in its footprint
          }
          rx += wOf(e) + GAP;
        }
        ry += c.hs[r] + GAP;
      });
    }
    x += c.w + SEP; y += c.h + SEP;
  });
  return { scale: s, arrangement: pick.arr, groups: boxes, items, labels };
}
