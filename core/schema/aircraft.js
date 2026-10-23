/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/schema/aircraft.js
   Schema for aircraft/<id>.json — aircraft, rockets and robots.
   See core/schema/check.js for the rules.

   Everything the simulation reads is modelled key by key. The 3D model
   blocks that only display/outside*.js reads (nose, wing, geometry,
   doors, livery, rocketGeometry, …) are accepted as `open` for now —
   they get their own schema with the geometry work (issues.md:
   "Aircraft geometry is derived when authored").
   ═══════════════════════════════════════════════════════════════ */

import { str, num, bool, open, oneOf, arrayOf, mapOf, object } from './check.js';
import { com } from './mission.js';
import { ENGINE, ENGINE_TYPE, PANEL, VEHICLE, valuesOf } from '../vocab.js';

const GLASS_JET = [PANEL.AIRBUS, PANEL.E190];   // panels that drive the turbofan A/THR + N1 system

/* ── Engine, thrust, envelope ── */
const engine = object(
  { type: oneOf(...valuesOf(ENGINE_TYPE)), count: num, idleN1: num, thrustReverser: bool,
    startTime: num, stopTime: num,   // s — the start sequence and the run-down (core/engine.js)
    starter: oneOf('electric'),      // what turns the engine over: 'electric' needs BAT on; absent → no condition
    coreIdle: num, spools: num,      // turbofan core: % at idle (default 60); 3 → the core is N3 (core/engine.js)
    egtIdle: num, egtTakeoff: num, egtStart: num, ffMax: num,   // °C at idle / 100 % N1 / the start peak; kg/h at takeoff
    chevrons: bool, nacellePaint: arrayOf(num) },   // last two: 3D model
  { doc: { model: str, description: str }, required: ['count'] },
);
/* The APU — an engine of its own (core/engine.js); startTime is its start-up recording's length */
const apu = object({ startTime: num }, { required: ['startTime'] });
/* The electrical layout (core/electrical.js) — sources and buses; absent → built from the engine count */
const elecSource = object(
  { id: str, type: oneOf('gen', 'ext', 'bat', 'rat'), label: str,
    driver: str,              // gen: 'eng1' … or 'apu'
    backup: bool,             // gen: a backup generator — on its engine's gearbox, no IDG, its own ON/OFF switch
    plug: oneOf('A', 'B'),    // ext
    battery: num, chargedBy: arrayOf(str),     // bat: 1 …; the buses that charge it
    switch: bool,             // bat: false — always connected, no cockpit switch
    deployWhenUnpowered: arrayOf(str),         // rat: deploys in flight when all these buses have lost power
    pos: arrayOf(num) },      // the ELEC page: [x, y] as fractions of the page — overrides the derived place
  { required: ['id', 'type'] },
);
const elecBus = object(
  { id: str, type: oneOf('ac', 'dc'), label: str, role: oneOf('main', 'battery'),
    feeds: arrayOf(str),      // in priority order: sources, or buses (a TR, the static inverter)
    ties: arrayOf(str),       // buses it may borrow from while BUS TIE is AUTO
    tieSwitch: str,           // the bus's own BUS TIE switch (its label) — both sides must be AUTO
    pos: arrayOf(num) },
  { required: ['id', 'type'] },
);
const elecLoad = object({ id: str, type: oneOf('load'), label: str }, { required: ['id', 'type'] });   // a switchable load (GALLEY) — no effect yet
const electrical = object({ batCount: num, extPwrB: bool,          // the default layout's options (no sources / buses given)
                           sources: arrayOf(elecSource), buses: arrayOf(elecBus), loads: arrayOf(elecLoad) },
                         { doc: { sources_doc: arrayOf(str) } });   // where the layout comes from

const envelope = object(
  { cruiseAlt: num, cruiseSpd: num, maxSpd: num, spdProfile: mapOf(num) },
  { doc: { maxAlt: num } },   // the service ceiling — a fact, nothing enforces it
);
const flapSetting = object({ label: str, deg: num, dCL_0: num, dCD_0: num, dCL_max: num });
const thrustProfile = object({ label: str, spdT: num }, { required: ['label', 'spdT'] });

/* ── Rockets ── */
const stage = object({
  name: str, thrustSL: num, thrustVac: num, isp: num, massWet: num, massDry: num,
  engineCount: num, burnDuration: num, velocityGateSECO: bool, orbitTargetSECO: bool,
});
const recovery = object({
  rtls: bool, asds: bool, catch: bool, landingLat: num, landingLon: num, flipDuration: num,
  boostbackEngines: num, boostbackThrottle: num, boostbackDuration: num,
  entryBurnAlt_m: num, entryBurnEngines: num, entryBurnThrottle: num, entryBurnDuration: num,
  landingBurnAlt_m: num, landingBurnEngines: num,
});
const performance = object({
  /* fixed-wing force model */
  mass: num, wingArea: num, wingSpan: num, thrustMax: num, Vr: num,
  CL_0: num, CL_alpha: num, CL_max: num, CD_0: num, inducedK: num,
  gearDrag: num, spoilerDrag: num, coolFlapDrag: num, muRoll: num, muBrake: num,
  /* rockets */
  massWet: num, payload: num, Cd: num, area: num, gLimit: num, qLimit: num, cegCutoffG: num,
  guidanceDuration: num, lesJettisonT: num, stages: arrayOf(stage),
  fpaProfile: arrayOf(arrayOf(num)), recovery,
  rollProgram: object({ startT: num, duration: num, angle: num }),
});

/* ── Systems ── */
const cooling = object(
  { type: oneOf('liquid', 'air'), ambient: num, normal: arrayOf(num), redline: num, critical: num, tMax: num,
    heat: num, vRef: num, coolBase: num, coolMin: num, flapMin: num, tau: num },
  { doc: { source: str },
    planned: { minOp: num, altLimit: mapOf(num) } },   // the cooling model doesn't use these yet
);

/* ── Crew, callouts, cockpit ── */
const altCallout  = object({ alt: num, speech: str });
const gpwsCallout = object({ alt: num, text: str, speech: str, red: bool });
const kneeboardPage = object(
  { type: oneOf('briefing', 'checklist', 'dsky', 'scratch'), title: str, items: arrayOf(str) },
  { required: ['type'] },
);
const checklist = object({
  flaps: arrayOf(object({ alt: num, config: num, pf: str, pm: str })),
  gear: object({ alt: num, pf: str, pm: str }),
});
const VIEW_ZONES = ['overhead', 'left', 'center', 'right', 'pedestal'];

export const aircraft = object(
  {
    id: str, name: str, manufacturer: str, family: str, icaoType: str, registration: str, callsign: str,
    vehicleType: oneOf(...valuesOf(VEHICLE)), manualControl: bool, panel: oneOf(...valuesOf(PANEL)),
    engine, apu, sound: object({ engineType: oneOf(...valuesOf(ENGINE)) }), ignitionTime: num, staging: oneOf('hot'),
    envelope, performance, handling: object({ rollRate: num, pitchRate: num, maxBank: num, maxPitch: num, rudderMaxDeg: num, rudderLimitKt: num }),
    inertia: object({ Izz: num }),                   // kg·m² — overrides core/yaw.js's estimate from mass, span and length
    flaps: arrayOf(flapSetting), thrustProfiles: arrayOf(thrustProfile), approachSpeed: num,
    autobrake: bool, fixedGear: bool, gridFins: bool, landingLegs: bool,
    /* systems */
    tanks: object({ left: num, right: num, unit: oneOf('L') }), fuelBurn: num, hasCarbHeat: bool,
    battery: object({ capacityKwh: num, powerDrawKw: num }), electrical,
    balance: object({ noseGearLoadShare: num }),     // nominal CG (core/airframe.js) until weight and balance
    cooling, coolingSystem: oneOf('liquid', 'air'),
    /* crew and callouts */
    crewLang: str, gpws: arrayOf(gpwsCallout), pmCallouts: arrayOf(altCallout),
    takeoffCallouts: arrayOf(object({ spd: num, speech: str, voice: str })),
    fmaPhases: arrayOf(object({ minAlt: num, vals: arrayOf(str), cols: arrayOf(str) })),
    checklist, kneeboard: arrayOf(kneeboardPage),
    situations: arrayOf(object({ label: str, alt: num, altT: num, spd: num, spdT: num, hdg: num })),
    onboarding: arrayOf(object({ key: str, desc: str })),
    /* cockpit */
    clock: oneOf('analog', 'digital', 'met'), map: bool, com,
    views: arrayOf(oneOf(...VIEW_ZONES)),
    left: arrayOf(str), right: arrayOf(str), pedestal: arrayOf(str),
    displays: arrayOf(object({ id: str, screen: num, spec: str, pages: arrayOf(str) })),
    /* robots */
    joints: arrayOf(object({ name: str, axis: oneOf('X', 'Y', 'Z'), min: num, max: num, home: num })),
    /* 3D model — open until the geometry work (see the header) */
    render: str, chaseCamOrbit: open, nose: open, wing: open, geometry: open, gear: open, doors: open,
    cabinWindows: open, overwingExits: open, windowGaps: open, windowGapSize: open, windowEndX: open,
    windowsToEngineLip: open, flapTracks: open, bellyFairing: open, cheatline: open, dorsalFillet: open,
    vstab: open, winglet: oneOf('none', 'classic', 'blended', 'split'), wingletGeom: open, wingletSplit: open,
    livery: open, propplane: open, rocketGeometry: open,
    rotaryEngine: object(
      { gyroscopicTorque: bool },
      { doc: { note: str }, planned: { leftTurnFaster: bool, castoroilRange: str } },
    ),
  },
  {
    required: ['id', 'name'],
    doc: {
      model: str, era: str, subtype: str,
      specs: open, links: open,       // robot hardware data
      dimensions: open,               // DWG measurement record — read by scripts/rescale-aircraft.py; core/airframe.js reads a few (checked below)
    },
    planned: {
      landSurfaces: arrayOf(str),
      gearRuggedness: num,
      ambient: object({ type: str, freqMin: num, freqMax: num, detune: num, gainMin: num, gainMax: num }),
      crewCallouts: object({ instructor: str, atc: str }),
      externalSensor: object({ type: str, mapping: mapOf(str) }, { doc: { note: str } }),
    },
    check: (a) => {
      const errs = [];
      if (!a.id.length) errs.push('empty "id"');
      if (a.envelope?.maxSpd !== undefined && !(a.envelope.maxSpd > 0)) errs.push('envelope.maxSpd must be > 0');
      const turbofan = a.engine?.type === 'turbofan';
      /* every winged aircraft declares its engines (rockets and robots have their own models) */
      if (a.vehicleType === undefined && !a.engine) errs.push('an aircraft needs an engine block');
      if (a.engine && !(Number.isInteger(a.engine.count) && a.engine.count >= 1)) errs.push('engine.count must be an integer >= 1');
      /* the electrical layout's references: every feed, tie and charging bus names an element, every driver an engine */
      const el = a.electrical;
      if (el?.buses) {
        const ids = new Set([...(el.sources ?? []), ...el.buses].map(x => x.id));
        const busIds = new Set(el.buses.map(b => b.id));
        for (const b of el.buses) {
          for (const f of b.feeds ?? []) if (!ids.has(f)) errs.push(`electrical: bus ${b.id} feeds from unknown "${f}"`);
          for (const t of b.ties ?? [])  if (!busIds.has(t)) errs.push(`electrical: bus ${b.id} ties to unknown bus "${t}"`);
        }
        for (const src of el.sources ?? []) {
          for (const c of [...(src.chargedBy ?? []), ...(src.deployWhenUnpowered ?? [])])
            if (!busIds.has(c)) errs.push(`electrical: ${src.id} names unknown bus "${c}"`);
          const m = /^eng(\d+)$/.exec(src.driver ?? '');
          if (src.type === 'gen' && src.driver !== 'apu' && !(m && +m[1] >= 1 && +m[1] <= (a.engine?.count ?? 0)))
            errs.push(`electrical: ${src.id} driver "${src.driver}" is not an engine of this aircraft`);
        }
      }
      /* the measurements the physics reads (core/airframe.js): positive mm, and a tail that fits together */
      const d = a.dimensions ?? {};
      for (const k of ['length', 'wingSpan', 'fuselageDiameter', 'fanCowlDiameter', 'noseTipToNoseGear', 'noseTipToMainGear', 'engineCenterlineToAircraftCenterline', 'vstabRootChord', 'vstabTipChord',
                       'vstabHeight', 'noseTipToVstabRootLE', 'noseTipToVstabTipLE', 'vstabRudderRootChord', 'vstabRudderTopChord', 'vstabRudderTopHeight'])
        if (d[k] !== undefined && !(typeof d[k] === 'number' && d[k] > 0)) errs.push(`dimensions.${k} must be a positive number (mm)`);
      if (d.noseTipToNoseGear >= d.noseTipToMainGear) errs.push('dimensions: the nose gear must be ahead of the main gear');
      if (d.noseTipToVstabTipLE < d.noseTipToVstabRootLE) errs.push('dimensions: the fin tip leading edge must not be ahead of its root');
      if (d.vstabRudderRootChord >= d.vstabRootChord || d.vstabRudderTopHeight > d.vstabHeight) errs.push('dimensions: the rudder must fit inside the vertical tail');
      const share = a.balance?.noseGearLoadShare;
      if (share !== undefined && !(share > 0 && share < 0.5)) errs.push('balance.noseGearLoadShare must be between 0 and 0.5');
      /* a declared turbofan needs a sane idle */
      if (turbofan && a.engine.idleN1 !== undefined && !(a.engine.idleN1 >= 0 && a.engine.idleN1 <= 100)) errs.push('engine.idleN1 out of range 0…100');
      /* the A/THR detents read thrustProfiles: spdT >= 0 and a positive maximum (the lever denominator) */
      if (a.thrustProfiles) {
        if (!a.thrustProfiles.length) errs.push('thrustProfiles must not be empty');
        if (a.thrustProfiles.some(p => !(p.spdT >= 0))) errs.push('thrustProfiles: every spdT must be >= 0');
        if (a.thrustProfiles.length && !(Math.max(...a.thrustProfiles.map(p => p.spdT)) > 0)) errs.push('thrustProfiles need a positive max spdT');
      }
      /* glass-cockpit jets must declare a turbofan, or N1/N2 stay 0 forever */
      if (GLASS_JET.includes(a.panel)) {
        if (!turbofan) errs.push(`glass jet (panel ${a.panel}) needs engine.type "turbofan"`);
        if (!a.thrustProfiles?.length) errs.push(`glass jet (panel ${a.panel}) needs thrustProfiles for the A/THR detents`);
      }
      return errs;
    },
  },
);
