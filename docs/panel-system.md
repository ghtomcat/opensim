# OpenSim Panel System

## Overview

The cockpit is drawn on `<canvas>` elements. There are three kinds of cockpit display:

| Kind | What | Defined by |
|---|---|---|
| **Data-driven panels** | Glass airliner screens (PFD, ND, ECAM/EICAS) and GA panels (G1000, DR400) | JSON layout specs in `panels/` + styles in `panels/styles/`, drawn by `display/panel_renderer.js` |
| **Hand-drawn panels** | Steam-gauge warbirds and the Velis Electro | One JS module per panel (`display/bf109.js`, `f4u1a.js`, `velis_epsi.js`) |
| **Cockpit zones** | Overhead, pedestal, left/right console, centre panel — slide-in views around the main panel | The aircraft's `views` list + per-zone modules (`display/overhead.js`, …) |

Rockets, hovercraft and robots have their own displays and are not part of the panel
system.

---

## How the main panel is chosen

The render loop in `index.html` (search for `renderYertleQuadruped(canvas)`) picks one
renderer per frame. Vehicle type is checked first, then the aircraft's `panel` field:

```js
if      (isDog)                       renderYertleQuadruped(canvas);
else if (isArm)                       renderRobotArm(canvas);
else if (isHover)                     renderHovercraft(canvas);
else if (isRocket && dragonSepT)      renderDragon(canvas);          // + rocket telemetry
else if (isRocket && id==='saturn-v') renderApollo(canvas);          // / renderLM()
else if (isRocket)                    renderRocket(canvas);
else if (panel === 'dr400')           renderCockpit(canvas);         // data-driven GA
else if (panel === 'g1000')           renderCockpit(canvas);         // data-driven GA
else if (panel === 'bf109')           renderBf109(canvas);           // hand-drawn
else if (panel === 'f4u')             renderF4U1A(canvas);           // hand-drawn
else if (panel === 'velis-epsi')      renderVelisEpsi(canvas);       // hand-drawn
else if (panel === 'airbus' || panel === 'e190') {                   // data-driven glass
  renderPanel(canvas,   0, _currentSpec(0));                         // left screen
  renderPanel(ndCanvas, 1, _currentSpec(1));                         // right screen
  if (displays has screen 1) renderFCU(fcuCanvas);
}
else if (ecam)                        renderECAM(ecamCanvas);
else                                  renderPFD(canvas);             // default glass PFD
```

## Panels in use

| `panel` | Kind | Renderer | Aircraft |
|---|---|---|---|
| `airbus` | data-driven glass | `renderPanel()` — specs `airbus-pfd`, `airbus-nd`, `airbus-ecam` | A220, A340, A350; also B737, B737 MAX 9, B777-300ER (the `ecam_ewd` widget draws a Boeing EICAS when `manufacturer` is `boeing`) |
| `e190` | data-driven glass | `renderPanel()` — specs `e190-pfd`, `e190-nd` (+ `airbus-ecam` page) | E190-E2 |
| `g1000` | data-driven GA | `renderCockpit()` — spec `g1000` (draws via `display/g1000.js`) | C172 |
| `dr400` | data-driven GA | `renderCockpit()` — spec `dr400` | Robin DR400 |
| `bf109` | hand-drawn | `display/bf109.js` | Bf 109 G-4, MiG-15 |
| `f4u` | hand-drawn | `display/f4u1a.js` | F4U-1A Corsair |
| `velis-epsi` | hand-drawn | `display/velis_epsi.js` | Pipistrel Velis Electro |
| *(none)* | default | `display/pfd.js` (`renderPFD`); ECAM mode `display/ecam.js` | AN-225, Avro 504, Tu-95MS, DC-8 |

---

## Data-driven panels

A data-driven panel needs no new code as long as the widgets it uses exist. Three
files work together:

```
aircraft/<id>.json   "panel": "airbus",  "displays": [...]     which style, which specs on which screen
panels/<spec>.json   layout: rows → columns → widget + config  what goes where
panels/styles/<panel>.json   colors, font                      how it looks
```

### Aircraft: `panel` and `displays`

`panel` selects the style file (`panels/styles/<panel>.json`). For glass panels,
`displays` places specs on screens:

```json
"displays": [
  { "id": "pfd", "spec": "e190-pfd", "screen": 0 },
  { "id": "nd",  "spec": "e190-nd",  "screen": 1, "pages": ["e190-nd", "airbus-ecam"] }
]
```

- `screen` — `0` = left canvas (`#pfd`), `1` = right canvas (`#nd`). The FCU is drawn when a screen 1 exists.
- `pages` — specs that screen can cycle through. **Tab** cycles the right screen (on
  the ECAM page it first steps through the sub-pages STATUS → ELEC → HYD, then back to
  the ND); **Shift+Tab** cycles the left screen. In the centre view (**M**), Tab
  switches the lower ECAM between ELEC and HYD. Page indices are meant to reset on the
  `opensim:aircraft-loaded` event, but nothing dispatches it yet, so the selection
  carries over to the next aircraft.

GA panels (`renderCockpit()`) don't use `displays`. They load `panels/<panel>.json`
directly and draw onto the main canvas.

### Spec format

A spec is a grid of rows, each split into columns. Sizes are **fractions** of the
canvas (rows: of the height; columns: of the width), so a spec is resolution-independent.

```json
{
  "id": "airbus-pfd",
  "layout": [
    { "h": 0.09, "cols": [ { "id": "fma", "widget": "fma", "w": 1.0 } ] },
    { "h": 0.76, "cols": [
        { "id": "spd", "widget": "speed_tape", "w": 0.165 },
        { "id": "ai",  "widget": "ai", "w": 0.610,
          "config": { "fpv": true, "ils": true, "bank_arc": true } },
        { "id": "alt", "widget": "alt_tape", "w": 0.155 },
        { "id": "vsi", "widget": "vsi", "w": 0.070 } ] }
  ]
}
```

Each column calls `widget(ctx, box, style, config)` with its pixel box. The `grid`
widget nests a further `layout` inside its box (the G1000 uses this for screen +
standby gauges).

Glass specs also carry `version`, `style`, `physical` (mm), `screen` (px) and `hil`.
None of these is read by the renderer today; the style comes from the aircraft's `panel`.

### Widgets

Registered in `_WIDGETS` in `display/panel_renderer.js`. To add one, write the draw
function and register it there.

| Group | Widgets |
|---|---|
| Glass (from `pfd_instruments.js`) | `fma`, `ai`, `speed_tape`, `alt_tape`, `vsi`, `hdg_tape`, `nd_map`, `ecam_ewd` (ECAM, or EICAS for Boeing), `spacer` |
| GA | `grid`, `analog_asi`, `analog_ai`, `analog_alt`, `rocker_strip`, `bottom_switches`, `g1000_screen`, `garmin_gtn`, `magneto_knob`, `fuel_selector`, `radio_stack`, `aircraft_tag` |

When the panel is squished (the outside view halves its height), `renderPanel()`
enlarges the fonts while the geometry stays. The ECAM schematic is scaled as a whole
instead.

### Styles

`panels/styles/<panel>.json` holds `id`, `colors` (`bg`, `sky`, `ground`, `engaged`,
`selected`, `managed`, `caution`, …) and `font`. Widgets read their colours from
here, not from constants. GA panels without a style file fall back to a default.

### Clickable switches (GA panels)

GA widgets register **hit regions** each frame; `handleCockpitClick()` (wired in
`index.html`) runs the region's action. Switch widgets bind to state by key:

```json
{ "label": "BAT", "state": "masterBat", "color": "red", "guarded": true },
{ "label": "NAV", "state": "lights.nav", "color": "green" }
```

- `state` — a key in `S`; a dot-path (`lights.nav`) toggles a field inside an object.
- `guarded` — the first click lifts the guard, the second throws the switch; switching
  off closes the guard again.
- `fuelPump` and `magnetos` have side effects (pump sound; engine start/stop), wired
  in `_toggleSwitch()`.

---

## Cockpit zones (`views`)

Around the main panel, an aircraft can declare slide-in zones in its JSON:

```json
"views": ["overhead", "left", "center", "right", "pedestal"]
```

| Zone | Key | Module | Content |
|---|---|---|---|
| `overhead` | O | `display/overhead.js` | Electrical, APU, fuel, engine start |
| `pedestal` | D | `display/pedestal.js` | Thrust levers, flaps, speed brake; GA controls from `aircraft.pedestal` (list of tokens) |
| `left` | L | `display/leftconsole.js` | Controls from `aircraft.left` (e.g. Bf 109: throttle, trim, fuel cock) |
| `right` | R | `display/rightconsole.js` | Controls from `aircraft.right` (radio, oxygen, breakers) |
| `center` | M | `display/centerconsole.js` | Airbus centre panel: both ECAM screens, gear lever |

A key does nothing unless the aircraft lists its zone, and the key help hides it too.
(Without a right console, **R** cycles the crew role instead.) The
open zone is `S.cockpitView` (`'forward'` when none). Zones are interactive and write
state through `setState()`.

---

## Hand-drawn panels

For a cockpit that no widget set covers (vintage gauges, unusual layouts), write a
display module.

### 1. Aircraft JSON

```json
{ "id": "my-aircraft", "panel": "my-panel" }
```

### 2. Display module

Create `display/my-panel.js` and export a render function:

```js
import { S } from '../core/state.js';

export function renderMyPanel(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  // draw your panel here, reading flight state from S.*
}
```

Commonly used state:

| Field             | Type    | Description                        |
|-------------------|---------|------------------------------------|
| `S.alt`           | number  | Altitude (ft, true MSL)            |
| `S.spd`           | number  | Airspeed (kt)                      |
| `S.hdg`           | number  | Heading (°)                        |
| `S.vs`            | number  | Vertical speed (ft/min)            |
| `S.pitch`         | number  | Pitch angle (°)                    |
| `S.roll`          | number  | Bank angle (°)                     |
| `S.enginePower`   | number  | Engine power 0–1                   |
| `S.engineState`   | string  | `'off'` \| `'starting'` \| `'running'` … |
| `S.fuelLeft`      | number\|null | Left tank (L); `null` = no fuel system |
| `S.fuelRight`     | number\|null | Right tank (L)               |
| `S.batteryCharge` | number\|null | Battery SOC % (electric only) |
| `S.carbIceLevel`  | number  | Carb ice 0–1 (piston only)         |
| `S.coolantState`  | string  | `'ok'` \| `'leaking'` \| `'failed'` |
| `S.coolantTemp`   | number  | Coolant / CHT (°C)                 |
| `S.gear`          | boolean | Gear down                          |
| `S.flaps`         | number  | Flap index                         |
| `S.aircraft`      | object  | Full aircraft JSON                 |

### 3. Register in index.html

Import the module and add a branch to the render dispatch (see *How the main panel is
chosen*):

```js
import { renderMyPanel } from './display/my-panel.js';
// …
else if (panel === 'my-panel') renderMyPanel(canvas);
```

## Canvas sizing

The panel canvas is sized by the browser. Always use `canvas.width` and `canvas.height` — do not hardcode pixel values. Scale UI elements relative to `W` and `H` so the panel works across screen sizes.

---

## Conventions

- Instrument displays read state and don't write it. Interactive parts (switches,
  levers, knobs in GA panels and cockpit zones) write through `setState()`, never by
  assigning to `S` directly.
- Keep drawing logic inside the render function or private helpers in the same file.
- `requestAnimationFrame` is handled by the main loop; don't start your own loop.
- Name the export `render[PanelName](canvas)`.

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
