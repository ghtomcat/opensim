# OpenSim Panel System

## Overview

Each aircraft in OpenSim has an instrument panel rendered on a `<canvas>` element. The panel is selected via a `"panel"` field in the aircraft JSON. Adding a new aircraft with a custom panel requires two things: a JSON entry and a display module.

---

## How it works

In `index.html`, the render loop reads `S.aircraft.panel` and dispatches to the correct renderer:

```js
const panel = S.aircraft?.panel ?? 'pfd';

if      (panel === 'g1000')      renderG1000(canvas);
else if (panel === 'bf109')      renderBf109(canvas);
else if (panel === 'f4u')        renderF4U1A(canvas);
else if (panel === 'velis-epsi') renderVelisEpsi(canvas);
else                             renderPFD(canvas);   // default
```

Rockets and hovercrafts bypass this dispatch entirely (handled by `vehicleType` and `type` fields).

---

## Existing panels

| Panel ID      | Display module          | Aircraft          | Notes                        |
|---------------|-------------------------|-------------------|------------------------------|
| `pfd`         | `display/pfd.js`        | Default fallback  | Glass PFD, airline style     |
| `g1000`       | `display/g1000.js`      | Cessna 172S       | Garmin G1000 inspired        |
| `bf109`       | `display/bf109.js`      | Bf 109 G-4        | WWII German, analog gauges   |
| `f4u`         | `display/f4u1a.js`      | F4U-1A Corsair    | WWII US Navy, analog gauges  |
| `velis-epsi`  | `display/velis_epsi.js` | Velis Electro     | Electric, SOC bar, EPSI-inspired |

---

## Adding a new panel

### 1. Aircraft JSON

Add `"panel": "your-panel-id"` to the aircraft JSON:

```json
{
  "id": "my-aircraft",
  "panel": "my-panel",
  ...
}
```

### 2. Display module

Create `display/my-panel.js` and export a single render function:

```js
import { S } from '../core/state.js';

export function renderMyPanel(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // draw your panel here
  // read flight state from S.*
}
```

Key state values available in `S`:

| Field             | Type    | Description                        |
|-------------------|---------|------------------------------------|
| `S.alt`           | number  | Altitude (ft)                      |
| `S.spd`           | number  | Airspeed (kt)                      |
| `S.hdg`           | number  | Heading (°)                        |
| `S.vs`            | number  | Vertical speed (ft/min)            |
| `S.pitch`         | number  | Pitch angle (°)                    |
| `S.bank`          | number  | Bank angle (°)                     |
| `S.enginePower`   | number  | Engine power 0–1                   |
| `S.fuelL`         | number  | Left tank fuel (L)                 |
| `S.fuelR`         | number  | Right tank fuel (L)                |
| `S.batteryCharge` | number\|null | Battery SOC % (electric only) |
| `S.carbIceLevel`  | number  | Carb ice 0–1 (piston only)        |
| `S.coolantState`  | string  | `'ok'` \| `'leaking'` \| `'failed'`|
| `S.gear`          | boolean | Gear down                          |
| `S.flaps`         | number  | Flap index                         |
| `S.aircraft`      | object  | Full aircraft JSON                 |

### 3. Register in index.html

Add the import and dispatch case:

```js
// top of <script type="module">
import { renderMyPanel } from './display/my-panel.js';

// in the render loop dispatch block
else if (panel === 'my-panel') renderMyPanel(canvas);
```

---

## Canvas sizing

The panel canvas is sized by the browser. Always use `canvas.width` and `canvas.height` — do not hardcode pixel values. Scale UI elements relative to `W` and `H` so the panel works across screen sizes.

---

## Conventions

- Read state only — never write to `S` from a display module
- Keep all drawing logic inside the render function or private helpers in the same file
- Use `requestAnimationFrame` is handled by the main loop — do not start your own loop
- Name the export `render[PanelName](canvas)`

---

## Building a real cockpit panel

The Bf 109 and Velis Electro panels show two different approaches. Both follow the same underlying pattern.

### The pattern: sc, layout, shared helpers, instruments

Every panel starts with three things:

```js
const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
const sc = Math.min(W, H) / 700;  // scale factor — 700 is the design reference size
```

`sc` is your scale multiplier. Every pixel value in the panel is multiplied by `sc`. This makes the panel resolution-independent — it looks the same on a laptop and a 4K display.

Then define column positions and instrument radii relative to `W`, `H`, and `sc`:

```js
const cx = W / 2;
const cy = H / 2;
const R  = Math.min(W / 3, H) * 0.38;   // main instrument radius
```

---

### Approach 1: Analog gauges (Bf 109 style)

Build a library of shared helpers at the top of the file, then call them for each instrument.

**Shared helpers:**
- `_base(ctx, x, y, r)` — bezel ring + shaded cream face + glass glint
- `_cap(ctx, x, y, r)` — centre cap over needle pivot
- `_needle(ctx, x, y, r, deg, fwd, bck, sc)` — tapered needle + dark counterweight
- `_ticks(ctx, x, y, r, startDeg, sweep, majCount, minPerMaj, sc)` — tick marks along arc
- `_num(ctx, x, y, r, deg, text, sz, sc)` — numeral at angle on dial face
- `_label(ctx, x, y, r, text, sc)` — instrument name below bezel

**Instrument function pattern:**
```js
function _drawFahrtmesser(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);               // bezel + face
  _ticks(ctx, x, y, r, 220, 280, 8, 5, sc);  // tick marks
  // draw numerals...
  const ang = startDeg + (value / maxValue) * sweep;
  _needle(ctx, x, y, r, ang, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, 'Fahrtmesser', sc);
}
```

**Layout:** place instruments on a grid using column width (`cw`) and row height (`rh`):
```js
const cw = 195 * sc;
const rh = 205 * sc;
_drawFahrtmesser(ctx, cx - cw, cy - rh * 0.85, r, sc);  // top-left
_drawHorizont(   ctx, cx,      cy - rh * 0.85, r, sc);  // top-centre
_drawHoehenmesser(ctx, cx + cw, cy - rh * 0.85, r, sc); // top-right
```

**Atmosphere:** add a vignette and optional effect (frost, dust, tropical haze) at the end of the main render function to set the scene.

---

### Approach 2: Mixed digital + analog (Velis EPSI style)

Use a three-zone layout — left, centre, right — each zone handling a different display type.

```js
const colW = W / 3;
const lx   = colW * 0.5;    // left zone centre
const mx   = W / 2;         // centre zone
const rx   = colW * 2.5;    // right zone centre

_drawNESIS(ctx, lx, cy, R, sc);          // round digital AH
_drawEPSI(ctx, mx, cy, colW*0.88, H*0.88, sc);  // rectangular data panel
_drawBackupASI(ctx, rx, cy - Rs*1.15, Rs, sc);  // small analog gauge
_drawBackupAlt(ctx, rx, cy + Rs*1.15, Rs, sc);  // small analog gauge
```

**Rectangular panel zones** use `_roundRect` + `ctx.clip()` to create a recessed display:
```js
function _drawEPSI(ctx, cx, cy, w, h, sc) {
  const x0 = cx - w/2;
  const y0 = cy - h/2;
  ctx.save();
  _roundRect(ctx, x0, y0, w, h, 10*sc);
  ctx.fillStyle = '#080c10';
  ctx.fill();
  ctx.clip();   // everything below is clipped to this rect

  // draw header, data rows, bars, warning annunciators...

  ctx.restore();
}
```

**Round digital instruments** (NESIS 4 style): use `_bezel()` with a dark face color, then clip to the circle and draw the AH inside, then draw fixed overlays (aircraft symbol, readouts) after restoring:
```js
_bezel(ctx, x, y, r, '#0d1117', '#080c10');  // dark face

ctx.save();
ctx.beginPath(); ctx.arc(x, y, r*0.97, 0, Math.PI*2); ctx.clip();
ctx.translate(x, y);
ctx.rotate(-roll);
// draw sky, ground, horizon, pitch ladder inside clip...
ctx.restore();

// fixed overlays — not affected by rotation
ctx.save();
ctx.translate(x, y);
// draw aircraft symbol, digital readouts...
ctx.restore();
```

---

### Warning annunciators

Both panels use the same pattern for warning lights: render them dim when inactive, colored when active, with an optional glow rect:

```js
const warns = [
  { label: 'BATT LOW', active: soc <= 20, color: P.amber },
  { label: 'MOTOR OFF', active: enginePower < 0.01, color: P.red },
];
warns.forEach((warn, i) => {
  ctx.fillStyle = warn.active ? warn.color : 'rgba(255,255,255,0.12)';
  ctx.fillText(warn.label, wx, wy);
});
```

---

### Scale reference sizes

| Reference | `sc` base | Best for |
|-----------|-----------|----------|
| `700`     | Velis, most panels | Standard instrument panels |
| `860`     | Bf 109 | Panels with more instruments or larger gauges |

Choose a reference size that makes your design comfortable at 1:1 — then `sc` handles all other sizes automatically.

---

## Gotchas

### Leading zeros in headings
JSON does not allow numbers with leading zeros. Headings like 080 or 090 must be written without the leading zero:

```json
// WRONG — SyntaxError
{ "hdg": 080 }

// CORRECT
{ "hdg": 80 }
```

This applies to any numeric field: `hdg`, `alt`, `spd`, `rwyHdg`, etc. The zero looks natural in aviation notation but breaks JSON parsing silently with a confusing "Unexpected number" error.
