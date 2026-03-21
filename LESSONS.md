# OpenSim — Lessons Learned

Hard-won knowledge from building in public, late at night, with an AI.

---

## Working with Claude Code

**Save checkpoints the moment something works.**
Not "later". Not "after the next improvement". Right now.
The cost of saving is zero. The cost of losing a working state is hours.

**Write memory before context gets full.**
Claude's context has a limit. When it auto-compacts, nuance is lost.
At 20% context remaining: stop coding, write memory.
At 10%: stop everything, compact now.

**After an auto-compact, verify the state before touching code.**
Two hours were lost because parameters were restored incorrectly after a context reset.
Always read the checkpoint file first. Always test before changing anything.

**One change at a time.**
Change one parameter, get feedback, then change the next.
Changing bodyDecay + noiseCoeff + output mix simultaneously meant we couldn't tell what helped.

**If two consecutive attempts make things worse, stop.**
Don't iterate blindly. Revert to last known good state.
Understand the root cause before making another change.
"One more try" is how you end up three hours deep with something that's worse than when you started.

**The user's ear is the ground truth.**
Not the theory. Not the math. Not the spectral analysis.
"Genial" and "total kaputt" are complete specifications.

**Save drafts as files immediately — before the next task arrives.**
"Perfekt, ich poste das heute" is not a save.
The next question will come. The context will fill. The draft will be gone.
Write it to disk the moment it's approved.

**Claude is forgetful and too eager.**
Claude moves to the next task the moment you give it one.
It will not look back at what was left unsaved.
You have to be the one who says: "wait — save that first."
Or better: demand it upfront. "Write this to a file, then we continue."

---

## Physical Modelling

**Reduce to the most basic. Model that. Then add more.**
Don't start with a complex model and simplify.
Start with one cylinder, one pffft, one parameter.
Get that right. Then add the second cylinder.
The Le Rhône 9J started as a steam engine — one piston, one exhaust puff.
That's what made it real.

**Don't derive a new engine from an existing one.**
The DB 605 model was built for a V12. The Le Rhône is a rotary.
Different physics, different character, different starting point.
Copying parameters from the wrong model costs hours.
Start from the physics of the thing you're building.

**How to model any engine — the method:**
1. Listen to the original. Find three words that describe it.
2. Deconstruct the physics. What actually makes that sound?
3. Find the simplest predecessor. (Rotary → steam engine. DB 605 → single cylinder.)
4. Model that predecessor first. One cylinder. One sound event.
5. Verify with your ear. Does it have the right character?
6. Then scale. Add cylinders. Add RPM dynamics. Add variation.
7. Each addition: one change, one listen.

The Le Rhône took 4 hours. The DB 605 took 8.
The difference was the method.

---

## Audio Synthesis

**Physical modelling: noise IS the character.**
For piston engine synthesis, the noise burst is not a bug — it's what makes it sound like an engine.
Don't try to eliminate it. Manage it.

**bodyDecay must scale with RPM.**
A fixed decay that sounds good at 400 RPM will create massive noise overlap at 2000 RPM.
The firing interval shrinks with RPM. The decay must follow.

**The cockpit display might not show what you think.**
Our RPM display was showing a fake 20–200 scale, not real engine RPM.
Two hours of debugging "why does 180 RPM sound noisy" — it was actually 1600 RPM.
Always verify what the UI is actually displaying before debugging audio.

**Checkpoint A was only tested at one RPM.**
"Ultrageil" at 400 RPM doesn't mean it works at 2800 RPM.
Test the full operating range before declaring a checkpoint stable.

---

## Open Source

**There are no secrets in open source.**
Ship the checkpoint files. Ship the lessons learned. Ship the frustration.
The raw development history is more valuable than polished documentation.

**The community shapes the rest.**
Don't over-specify. Define the physics, the architecture, the JSON format.
Someone will build the historically correct Bf 109 instruments.
Someone else will put an AI copilot in it.
That's the point.

---

*Updated: 2026-03-21 (added: save drafts as files)*
