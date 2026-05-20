/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/hydraulics.js
   Hydraulic system for turbofan aircraft (A340-style three-system).

   Systems:
     GREEN  — ENG 1 EDP (auto when N1>56%) + electric pump
     BLUE   — electric pump only
     YELLOW — ENG 4 EDP (auto when N1>56%) + electric pump

   State keys managed here:
     hydGreenPsi / hydBluePsi / hydYellowPsi   0–3000 psi
     hydGreenElecOn / hydBlueElecOn / hydYellowElecOn  (switches)
     hydGreenEdp / hydBlueEdp / hydYellowEdp   derived — EDP running
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const PSI_NOM   = 3000;    // normal system pressure
const RISE_RATE = 600;     // psi/s when source active
const FALL_RATE = 80;      // psi/s when no source (leakage/consumption)

export function resetHydraulics() {
  /* Pre-pressurize if engines already running (airborne start missions) */
  const pressurized = (S.engineState === 'running') ? PSI_NOM : 0;
  setState({
    hydGreenPsi:    pressurized,
    hydBluePsi:     0,           // BLUE needs explicit elec pump — starts off
    hydYellowPsi:   pressurized,
    hydGreenElecOn: false,
    hydBlueElecOn:  false,
    hydYellowElecOn: false,
    hydGreenEdp:    false,
    hydBlueEdp:     false,       // no EDP on BLUE
    hydYellowEdp:   false,
  });
}

export function tickHydraulics(dt) {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan') return;

  const n1 = S.n1 ?? 0;
  const acPowered = S.acBusPowered ?? false;

  /* Engine-driven pumps — run when N1 > 56 % */
  const edpOn = n1 > 56;
  const hydGreenEdp  = edpOn;   // ENG 1 → GREEN
  const hydYellowEdp = edpOn;   // ENG 4 → YELLOW (approximated with shared N1)

  /* Effective pressure source per system */
  const greenSrc  = hydGreenEdp  || ((S.hydGreenElecOn  ?? false) && acPowered);
  const blueSrc   =                  ((S.hydBlueElecOn   ?? false) && acPowered);
  const yellowSrc = hydYellowEdp || ((S.hydYellowElecOn ?? false) && acPowered);

  const _tick = (cur, src) => {
    if (src)  return Math.min(PSI_NOM, cur + RISE_RATE * dt);
    return Math.max(0, cur - FALL_RATE * dt);
  };

  const upd = {
    hydGreenEdp,
    hydYellowEdp,
    hydBlueEdp: false,
  };

  const gNew = _tick(S.hydGreenPsi  ?? 0, greenSrc);
  const bNew = _tick(S.hydBluePsi   ?? 0, blueSrc);
  const yNew = _tick(S.hydYellowPsi ?? 0, yellowSrc);

  if (Math.abs(gNew - (S.hydGreenPsi  ?? 0)) > 0.5) upd.hydGreenPsi  = gNew;
  if (Math.abs(bNew - (S.hydBluePsi   ?? 0)) > 0.5) upd.hydBluePsi   = bNew;
  if (Math.abs(yNew - (S.hydYellowPsi ?? 0)) > 0.5) upd.hydYellowPsi = yNew;

  setState(upd);
}
