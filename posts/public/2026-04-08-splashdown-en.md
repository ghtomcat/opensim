# LinkedIn Post — 2026-04-08 (EN)

---

The loop is closed.

Launch, Orbit, Deorbit, Reentry, Splashdown.

You can now run the full Inspiration5 mission end to end in a browser. No installation, no account. Just bring an URL and a keyboard.

---

A few days ago OpenSim could simulate the ascent of a rocket, including stage separation. Then MECO, main engine cutoff of the second stage — SECO — at T+10 minutes. Orbital insertion. Stage 1 coming back to Landing Zone 1 on its own. That was already more than I thought I'd build in a month.

Then I kept going.

The orbital propagator is a Velocity Verlet integrator running in ECEF coordinates — the same mathematical frame the real guidance computers use, the same coordinate system that describes positions on and around a rotating Earth. After SECO, the simulation switches from a physics-based ascent model to Keplerian orbital mechanics. The capsule follows a real orbit. Perigee, apogee, eccentricity, period — all computed, all displayed. The ground track draws itself across a world map as the orbit progresses. The orbital period for Inspiration5 is 96.9 minutes. Over three simulated days, that's 44 orbits.

Then comes the deorbit burn. A 170 metres per second retrograde firing that lowers the perigee into the upper atmosphere. The Keplerian propagator handles the trajectory from there — no additional guidance needed, just physics. Drag builds as the capsule descends through 140 kilometres, 100 kilometres, 80 kilometres. Below 80 kilometres, communications black out. Plasma around the heat shield blocks all signal. Inside the capsule, the crew keeps calling altitudes. On the webcast feed, the hosts go quiet and describe what they can see on the telemetry. Then signal returns at 35 kilometres. Drogues at 5,500 metres. Four mains at 1,800 metres. Splashdown.

The whole sequence — pad to splashdown — runs in about 15 minutes of real time. Or three days of simulated time, depending on how patient you are. There is a time warp function. Press W. Cycle through 1× · 10× · 100× · 1000×. At 1000×, a 72-hour orbit takes four minutes.

---

Five voices tell the story.

John and Lauren are the webcast hosts — the two SpaceX commentators who narrate every launch, hand off to each other through staging and orbit insertion, go quiet at blackout, and come alive again when the capsule punches back through. John calls SECO. Lauren calls the touchdown of Stage 1 at LZ-1. They split the altitude callouts under the mains: Lauren reads the numbers off the telemetry feed, the Pilot Monitoring repeats them from inside the capsule.

CAPCOM is the only voice on the official radio loop to the crew. Abort modes. Go/no-go calls. "Dragon Inspiration, Mission Control. Do you read?"

The Commander answers.

That Commander is me. My name is in the left seat of every Inspiration5 simulation. My Pilot is based on a real person, the person I'll be flying Kitfox with in Montana while we train for this. When the drogue chutes deploy, it's her voice: "Drogues out. Descent nominal." When the main parachutes open: "Four mains. Beautiful." At 50 feet above the Atlantic: "Brace for impact."

And at the end, after the fast boats arrive, after the divers attach the harness, after the hatch opens:

"Dragon Inspiration, thank you for flying SpaceX."

"It was one hell of a ride."

---

I built this alone. Not with a team, not in a company. One person, in the hours I could find, using Claude as a co-pilot — the same discipline as any good crew pairing: I know what I want to build, Claude knows how to build it, and we cross-check each other the whole way.

The whole sim runs in a browser. No WebGL, no framework, no build step. Point-mass physics, AudioWorklets for procedural engine sound, the Web Speech API for five distinct voices, a Keplerian propagator that conserves orbital energy to within 0.01% over 30 minutes. Open source, MIT licensed.

[opensim → ghtomcat.github.io/opensim]

---

Inspiration5 is not a metaphor. It is a real mission I am working toward. A real crew with a real target date of 2030. A real conversation with SpaceX that hasn't happened yet but will.

The simulation exists so that when that conversation happens, I don't walk in with a slide deck.

I walk in with a full simulator and a pre-trained crew.

More about the mission at: inspiration5.ch

---

#OpenSim #SpaceX #Inspiration5 #Spaceflight #BuildingInPublic #CrewDragon #Orbit
