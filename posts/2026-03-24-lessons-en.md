# LinkedIn Post — Tuesday 2026-03-24 (EN)

---

We lost two hours. Completely avoidable.

I'm building OpenSim — an open-source flight simulator that runs entirely in the browser. No dependencies. No build step. One JSON file for the aircraft, one for the mission.

Last week: physical modelling sound for the DB 605 — the supercharged V12 that powered the Messerschmitt Bf 109. Sample-by-sample synthesis, in the browser, in real time. After one night: deep, raw, unmistakable. The sound of a legend.

Then came the auto-compact.

Claude Code has a context limit. When it fills up, it compresses automatically — and nuance gets lost. Parameters we'd spent hours tuning were restored incorrectly. We only noticed when the sound — which had been working — was suddenly broken. One hour of debugging. Then another.

What I learned — and what's now in LESSONS.md in the repo:

**Save checkpoints the moment something works.** Not "after the next step". Right now, exactly when it works. The moment of success is the most dangerous — you want to keep going. Don't. Save first.

**One change at a time.** We changed bodyDecay, noiseCoeff, and output mix simultaneously. When it got worse, we had no idea what had helped and what hadn't. One change. Get feedback. Next change.

**The ear is ground truth.** Not the theory. Not the spectral analysis. Not the oscilloscope. "Brilliant" and "completely broken" are complete specifications. We spent two hours trying to mathematically explain why something should sound good — while the ear had been saying no for a long time.

**If two consecutive attempts make things worse: stop.** Don't try again. Not "just one more time". Roll back to the last known good state, understand the root cause, then continue. "One more try" is how you end up three hours deep with something worse than when you started.

**At 10% context remaining: stop coding, write memory.** At 20% would have been smarter.

These aren't AI lessons. This is software engineering — but AI makes the consequences of impatience visible faster. What used to cost a day now costs an hour. Including the pain when you get it wrong.

In open source there are no secrets. Ship the checkpoint files. Ship the lessons learned. Ship the frustration. The raw development history is more valuable than polished documentation.

LESSONS.md is now in the repo. For everyone building at night with AI who wants to avoid the same mistakes.

github.com/ghtomcat/opensim

#OpenSource #BuildInPublic #ClaudeCode #AudioSynthesis #FlightSim #LessonsLearned

---
*Characters: ~2580*
