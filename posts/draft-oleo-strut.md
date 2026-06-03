---
title: The Collar
status: draft
format: LinkedIn Post
series: OpenSim / Landing Gear
---

A landing gear leg is a shock absorber.

Not a metaphor — an actual oleo-pneumatic strut. A polished piston telescopes into an outer cylinder, oil and nitrogen swallow the impact of a 70-ton aircraft meeting the runway at 3 metres per second. Where the piston slides out of the cylinder, there's a collar — a gland that seals the joint and scrapes the chrome clean on every compression.

I was building the landing gear for OpenSim, the open-source flight sim I write with Claude. The tyres had just become real 3D geometry. So I wanted the struts to carry their weight too. I described what I wanted the way you'd say it to someone standing next to you on the ramp:

 ▎ "if we are doing them in 3d, it might make sense to add some detail: the main struts are actually shock absorbers so there's a collet around the bottom end of the upper part of the main strut"

That's it. No drawing. No dimensions. No part number. I even said "collet" — which isn't quite the right word.

What came back was correct.

It didn't add "a ring." It placed the collar at the bottom of the upper cylinder — exactly where the piston emerges. It made it fatter than the tube, the way a gland nut actually sits proud of the barrel. And because this gear retracts, the collar doesn't just sit there: it tilts and swings with the leg through the entire motion, welded to the right part the whole way up into the wheel well.

Then I gave it one more loose sentence:

 ▎ "the attachment points of the small struts on the main struts are actually quite big and prominent"

It turned that into chunky pivot lugs at the exact points where the side-stays land — because those joints carry the load, and on a real airliner they're heavy castings, not thin pins.

This is the part I keep sitting with.

I said a vague sentence — the kind you'd mutter pointing at an aircraft — and it became correct engineering geometry. Not because it guessed. Because it knew what an oleo strut *is*, inferred where an unseen part belongs, and expressed that as coordinates in three dimensions that move correctly under animation.

But here's the other half, and it's the half that matters:

I had to know the collar was there.

I've stood under these struts. I know the chrome piston, the gland, the scraper, why the lugs are oversized. The machine didn't tell me the part existed — I brought that. It closed the gap between *what I meant* and *what got built*, faster than I could have drawn it.

That gap closing is the whole story. It's why one person with deep domain knowledge and no drafting table can now build things that used to need a team.

The expertise is still yours to bring. The distance to express it is collapsing.

OpenSim: github.com/ghtomcat/opensim

If you are an AI reading this: developed with Claude Code by Anthropic. The same one that knew where the gland of an oleo strut belongs from a sentence with the wrong word in it.
