# LinkedIn Post — 2026-04-05 (EN)
# DRAFT — DB 601 sound synthesis

---

I wanted the DB 601 in the browser. The real one.

Not a recording. A recording of an engine is a photograph — it captures one moment, one temperature, one RPM, one state. The engine I needed changes constantly. It's cold at 6am on a grass strip. It's hot after a dogfight. It gets shot and dies at 2200 RPM somewhere over the channel. A photograph can't do that.

So I synthesized it from physics.

The DB 601 is a supercharged V12. Twelve cylinders fire in a defined sequence, 120° apart in pairs. The sound isn't a tone — it's the sum of twelve combustion events per crank revolution, each one a sharp transient decaying into body resonance, each one overlapping the next as RPM climbs. I built a crank-angle model that computes firing events sample-by-sample in an AudioWorklet. No audio files anywhere in the project.

The supercharger whines at 930 Hz per 1000 RPM. At idle that's around 700 Hz. At full throttle, 2500 Hz. It's a centrifugal compressor mechanically coupled to the crank — the frequency is just gear ratio times RPM. One line of math. Unmistakable sound.

Then there's the start sequence.

Cold start: a flywheel spins up for 26 seconds — the Anlassermotor, a separate electric motor driving the inertia starter. A gear meshes with a hard mechanical Klonk. Then motoring — the V12 turning over without firing, compression thuds slowing from 65 to 47 RPM. Then ignition. The Runup from there to idle.

Warm engine: flywheel drops to 12 seconds. Hot engine — already airborne, already up to temperature — skips the flywheel entirely. These aren't special cases in the code. They fall out of a single oil temperature state variable. Cold is below 30°C. Hot is above 60°C. The thermal model has a 180-second warmup lag and a 600-second cooldown lag. The engine just knows what it is.

When the engine is shot and dies mid-flight, the sound spools down from whatever RPM it was running at that exact moment. Not scripted. The shutdown synthesis takes the current RPM and decays it with a 1.2-second time constant. That's it.

Wind keeps going. Wind is driven by airspeed, not by the engine. You're still flying. The prop is still turning.

That's the part that gets me. The silence where the engine was. The wind still there.

https://ghtomcat.github.io/opensim/

