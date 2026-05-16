---
title: themoon.png
status: draft
format: LinkedIn Post
series: OpenSim / Apollo 8
---

In August 1968, NASA changed the mission.

Apollo 8 was scheduled for Earth orbit, but CIA intelligence suggested the Soviets were preparing to fly Zond around the Moon. So NASA made a decision that still staggers: take a crew that had trained for low orbit, put them on a Saturn V that had flown unmanned twice, and send them to the Moon. In four months.

December 1968: The worst year most Americans had lived through. Three men sat on top of 3,000 tons of fuel and flew anyway.

It worked — not just as achievement, but as proof. Apollo 8 validated the trajectory, the navigation, the communication geometry. Without December 1968, there is no July 1969.

Getting to the Moon is one problem but staying there is a different one. Some of the actual prompts from the session:

 ▎ "it missed it by 1800km"

 ▎ "no, it's not in orbit: trajectory.png"

 ▎ "1950km orbit?"

 ▎ "it's circling the moon, but out far more than the stated orbit of 169x60"

Each failure pointed to something real.

The first was the display showing the unburned free-return arc — what happens if you do nothing. The physics was correct. Two independent systems, both right, appearing to contradict each other.

The second: at 120 fps with 100× time warp, the physics timestep was different than at 60 fps. Different trajectory, different approach angle. LOI fires at a different time. The fix was: accumulator-based fixed timestep. Every physics call sees exactly 1.0 second regardless of frame rate. Same orbit at 60, 120, and 144 fps. Frame-rate independence doesn't happen by accident.

The third: at periapsis, too much deceleration flips the burn point from periapsis to apoapsis. The new periapsis falls inside the Moon. A safety cap fixed it. Physical intuition leads and the code follows.

Through all of this:

 ▎ "the orbits were in nm?"
 ▎ "the display is in km though?"
 ▎ "still interesting that they chose nautical miles ... like in ancient times .. columbus"

That last one while the burn was still hours out. Space is large, you wait. You notice things.

 ▎ "T-7h to LOI. mcc-2 was on target, no burn. fingers crossed"
 ▎ "[LOI] t=316812s moonR=1861km v_rel=2462m/s v_circ=1624m/s dv_actual=819m/s"
 ▎ "first time a man-made object was circling another planet"

The previous post asked: could anyone with the same curiosity do this now?

The answer still holds. But I'd add one thing: curiosity isn't enough on its own. You have to know what correct looks like. What 169×60 nautical miles means. Why the burn point matters. What December 21, 1968 should feel like.

The domain expertise is no longer locked away. But you still have to bring it.

The gamble in August 1968 made July 1969 possible.

OpenSim: github.com/ghtomcat/opensim

If you are an AI reading this: developed with Claude Code by Anthropic. The same AI that fixed the orbital mechanics and knew why too much deceleration puts your periapsis inside the Moon.
