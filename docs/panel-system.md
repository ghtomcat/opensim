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
