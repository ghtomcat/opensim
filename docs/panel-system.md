# OpenSim Panel System

## Overview

The cockpit is drawn on `<canvas>` elements. There are three kinds of cockpit display:

| Kind | What | Defined by |
|---|---|---|
| **Data-driven panels** | Glass airliner screens (PFD, ND, ECAM/EICAS) and GA panels (G1000, DR400) | JSON layout specs in `panels/` + styles in `panels/styles/`, drawn by `display/panel_renderer.js` |
| **Hand-drawn panels** | The analog panels and the Velis Electro | `display/analog_panel.js` — one analog panel in a style per aircraft (luftwaffe, soviet, usn: look, labels, units); `display/velis_epsi.js` |
| **Cockpit zones** | Overhead, pedestal, left/right console, centre panel — slide-in views around the main panel | The aircraft's `views` list + per-zone modules (`display/overhead.js`, …) |

Rockets and robots have their own displays and are not part of the panel
system.

---

## How the main panel is chosen

The render loop in `index.html` (search for `renderYertleQuadruped(canvas)`) picks one
renderer per frame. Vehicle type is checked first, then the aircraft's `panel` field:

```js
if      (isDog)                       renderYertleQuadruped(canvas);
else if (isArm)                       renderRobotArm(canvas);
else if (isRocket && dragonSepT)      renderDragon(canvas);          // + rocket telemetry
else if (isRocket && id==='saturn-v') renderApollo(canvas);          // / renderLM()
else if (isRocket)                    renderRocket(canvas);
else if (panel === 'dr400')           renderCockpit(canvas);         // data-driven GA
else if (panel === 'g1000')           renderCockpit(canvas);         // data-driven GA
else if (panel === 'analog')          renderAnalogPanel(canvas, ac.panelStyle);   // round gauges: the look by style, the instruments from analogPanel
else if (panel === 'velis-epsi')      renderVelisEpsi(canvas);       // hand-drawn
else if (panel === 'airbus' || panel === 'e190') {                   // data-driven glass
  renderPanel(canvas,   0, _currentSpec(0));                         // left screen
  renderPanel(ndCanvas, 1, _currentSpec(1));                         // right screen
  if (displays has screen 1) renderFCU(fcuCanvas);
}
```

There is no fallback: every aircraft has a `panel` (rockets and robots pick their display by
`vehicleType`), and `panel: "analog"` needs a `panelStyle` and an `analogPanel` (its instruments) — `tests/data-schema.test.mjs` fails otherwise.

## Panels in use

| `panel` | Kind | Renderer | Aircraft |
|---|---|---|---|
| `airbus` | data-driven glass | `renderPanel()` — specs `airbus-pfd`, `airbus-nd`, `airbus-ecam` | A220, A340, A350; also B737, B737 MAX 9, B777-300ER (the `ecam_ewd` widget draws a Boeing EICAS when `manufacturer` is `boeing`) |
| `e190` | data-driven glass | `renderPanel()` — specs `e190-pfd`, `e190-nd` (+ `airbus-ecam` page) | E190-E2 |
| `g1000` | data-driven GA | `renderCockpit()` — spec `g1000` (draws via `display/g1000.js`) | C172 |
| `dr400` | data-driven GA | `renderCockpit()` — spec `dr400` | Robin DR400 |
| `analog` | hand-drawn | `display/analog_panel.js`: the look from `panelStyle`, the instruments from `analogPanel`, placed by `display/panel_flow.js` | Bf 109 (`luftwaffe`), MiG-15bis (`soviet-1956`), F4U-1A, DC-8 (`usn`), Tu-95 (`soviet-1956`), An-225 (`soviet`), Avro 504 (`wood`) — today's set on all until each gets its sourced one |
| `velis-epsi` | hand-drawn | `display/velis_epsi.js` | Pipistrel Velis Electro |

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
| GA | `grid`, `analog_asi`, `analog_ai`, `analog_alt`, `rocker_strip`, `bottom_switches`, `g1000_screen`, `garmin_gtn`, `magneto_knob`, `fuel_selector`, `aircraft_tag` |

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

**Round gauges need no module of their own:** an aircraft with analog instruments uses
`panel: "analog"` and lists its instruments as data (docs/creating-aircraft.md, *Analog panel*); a new
instrument or look goes into the analog registry (*Analog instruments* below). Write a
display module only for a cockpit that neither the widgets nor the analog panel cover — like
the Velis EPSI.

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

The analog panel and the Velis Electro panel show two different approaches. Both follow the same underlying pattern.

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

### Approach 1: Analog instruments (`display/analog_panel.js`)

One module draws the round gauges of every analog aircraft; the design is in
docs/architecture.md §5.2. Positions are not written by hand — the flowing layout
(`display/panel_flow.js`) places the aircraft's groups for the view. What you add is an
instrument, or a look of one.

**An instrument is a registry entry** (`INSTRUMENTS`), its id listed in `core/vocab.js` `INSTRUMENT`:

```js
mach: { value: 'Mach from S.spd and S.alt (core/airdata.js)',   // what it shows — for the docs and the tests
        read: () => machOf(S.spd ?? 0, S.alt ?? 0),             // the value from the sim — read(i, entry): i the engine, entry the panel entry
        simple: undefined,                                      // a stand-in? name what replaces it (core/engine-gauges.js STAND_INS)
        kind: undefined,                                        // 'lamp', 'lamps', 'level', 'glass' — the layout's footprint
        draw: _both(_drawMach) },                               // a draw function per unit system ('metric', 'imperial'; _both for either)
```

**A draw function only draws the value it is given** — `(ctx, x, y, r, sc, value, scale, variant)`;
it never reads `S` (except the aircraft's data) or the sound code: `tests/analog-registry.test.mjs`
checks every `_draw…` function, including the comment above the next one. Values the sim does
not model yet are stand-ins in `core/engine-gauges.js`, each marked with what replaces it.

**A new look of an existing instrument** — the same value, another face — is a `variant`: add
it to the entry's `variants`, branch in its `draw`, and list it in the schema's `variant`
(`core/schema/aircraft.js`). The data picks it per aircraft.

**Shared helpers** for the faces: `_base` (bezel and face, in the style's colours), `_needle`,
`_cap`, `_ticks`, `_num`, `_label` (the name below), `_sublabel`, `_scale` (the markings from an
entry's `scale`), `_drawGauge` (a whole scale-driven gauge), `_drawLamp` / `_drawPlateLamp`; and for
faces whose figures scale with the dial: `_rt`, `_rnum`, `_rtick`, `_hand`.

**Try it first in the lab:** `docs/mockups/analog-instrument-kinds.html` (local) draws each kind
large, driven by sliders, for comparing with the source's picture before it goes into the panel.

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
