# Navigation & Browser History

## Aircraft vs. Mission

**Aircraft** is a vehicle definition — geometry, engine type, sound parameters, flight model coefficients. It lives in `aircraft/*.json` and describes what the machine *is*.

**Mission** is a scenario — which aircraft to fly, where, at what time of day, what weather, what initial state (altitude, speed, heading), what the kneeboard says, what failures are armed. It lives in `missions/*.json` and describes what you *do*.

One aircraft can appear in many missions. The A350 flies both the LSZH approach and live ADS-B tracking sessions. The Bf 109 appears in multiple historical scenarios. Selecting a mission always implies an aircraft, but selecting an aircraft tells you nothing about the scenario.

The URL always identifies the **mission**, not the aircraft.

---

## URL Format

```
https://ghtomcat.github.io/opensim/?mission=lszh-approach
```

The `?mission=` query parameter holds the mission ID as defined in the `MISSIONS` array in `index.html`. Example values: `lszh-approach`, `bf109-takeoff`, `live-flight`.

---

## Deep Links

When the page loads with a `?mission=` parameter, the selector is skipped and the mission loads directly — no clicking required.

```
?mission=lszh-approach   → loads A350 LSZH approach immediately
?mission=bf109-takeoff   → loads Bf 109 takeoff scenario immediately
(no param)               → shows the mission selector
```

This is implemented at the bottom of `index.html`:

```js
const _urlMission = new URLSearchParams(location.search).get('mission');
if (_urlMission) {
  const _m = MISSIONS.find(m => m.id === _urlMission);
  if (_m) init(_m.id, _m.aircraft);
  else showSelect();
} else {
  showSelect();
}
```

---

## pushState on Mission Start

Every time `init()` is called, it pushes a history entry:

```js
history.pushState({ missionId, aircraftId }, '', `?mission=${missionId}`);
```

The state object stores both IDs so the forward button can restore the correct mission without re-parsing the URL. The URL is also updated so it is shareable and bookmarkable immediately.

---

## Back Button

Pressing back when inside the sim returns to the mission selector:

- Audio stops (`stopSound()`)
- The briefing overlay is hidden
- The mission selector is shown
- The document title resets to `OpenSim`

The selector state has no `?mission=` param, so `e.state` is `null` — this is how the `popstate` handler distinguishes back from forward.

---

## Forward Button

Pressing forward after going back restores the previous mission:

- Audio from any currently running sim stops
- `init()` is called with the `missionId` and `aircraftId` stored in `e.state`
- The mission loads fresh, including briefing bypass (no briefing on forward navigation)

```js
window.addEventListener('popstate', (e) => {
  stopSound();
  if (e.state?.missionId) {
    // forward — restore mission
    init(e.state.missionId, e.state.aircraftId);
  } else {
    // back — return to selector
    document.getElementById('mission-select').classList.remove('hidden');
    document.title = 'OpenSim';
  }
});
```

---

## User Flow

```
opensim/                     → mission selector (no history state)
  ↓ select mission
opensim/?mission=lszh-approach  → sim running (state: { missionId, aircraftId })
  ↓ press Back
opensim/                     → selector, audio stopped
  ↓ press Forward
opensim/?mission=lszh-approach  → sim restored, audio starts fresh
  ↓ press Back
opensim/                     → selector, silence
```

---

## Live Flight

Live ADS-B sessions use `missionId = 'live-flight'`. The URL becomes `?mission=live-flight`. Deep-linking to this URL loads a blank live flight session (no specific aircraft pre-selected from ADS-B — the radar picker is shown instead).
