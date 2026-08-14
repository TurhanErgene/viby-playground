# Skip Stone

A hyper-casual stone-skipping game. Throw a flat rock across a lake, chain
perfectly-timed bounces, and spend your coins on upgrades between throws.

No build step, no dependencies, no assets — every sprite, sound and particle is
drawn or synthesised at runtime. Just open `index.html`.

```
open skipping-rocks/index.html        # macOS
xdg-open skipping-rocks/index.html    # Linux
# or serve it:  python3 -m http.server  →  localhost:8000/skipping-rocks/
```

Tap, click or press **Space** — the whole game is one input.

## The loop

A throw takes about fifteen seconds:

1. **Power** — an oscillating bar. Tap to stop it. Higher means faster.
2. **Angle** — a second bar with a green sweet spot around 14°. Flat throws
   skip; steep throws plop.
3. **Flight** — a ring shrinks onto the stone as it falls toward the water.
   Tap as it lands for a **Perfect** skip: a bigger bounce, and +1 combo.
   Mistime it and the combo resets.

The stone sinks when it runs out of forward speed or bounce, and the run scores
on distance, skips, perfects, best combo and anything you collected.

## Mechanics

- **Perfect-skip timing** — the core skill. The window is generous (110 ms at
  first) and forgiving in both directions: tapping slightly early banks the
  Perfect for the moment of impact, tapping slightly late applies it
  retroactively to the bounce that just happened.
- **Combo** — consecutive Perfects multiply the run's coin payout.
- **Impact angle** — every bounce is scored against an ideal ~14° entry. A good
  angle keeps more speed; a steep one kills the throw.
- **Wind** — randomised per throw, shown bottom-centre, pushing the stone along
  or holding it back.
- **Pickups** — gold coins sit low over the water on the natural skipping line.
  Blue gems are worth 5× but float high, so you have to give up a little
  flatness to reach them.

## Upgrades

Three, five levels each, bought between throws with coins:

| | Upgrade | Effect |
|---|---|---|
| 🪨 | **Flat Stone** | Keeps more speed and bounce through every skip |
| 💪 | **Strong Arm** | +7% launch speed per level |
| 👁️ | **Skipper's Sense** | Wider Perfect window, stronger Perfect kick |

Fully upgraded with clean timing, throws run past 250 m. Costs scale 1.75× per
level, so a full board is a few dozen throws away.

## Notes on the implementation

- `game.js` is a single IIFE: physics in metres and seconds, rendering in a
  world→screen transform, no framework.
- Height is exaggerated ~1.9× on screen (`V_EXAG`). A real skipping throw peaks
  around 1.5 m, which draws as a flat line; the stretch only affects rendering,
  not the physics or the horizontal pacing.
- A Perfect can never send the stone off the water faster than it arrived — the
  kick buys a slower decay, not a runaway bounce. Without that cap a maxed-out
  combo chain skips forever.
- Progress (coins, best distance, upgrade levels) is saved to `localStorage`
  under `skipstone.save.v1`, and fails quietly in private-mode browsers.
- `window.__skipstone` exposes run state for tuning and automated testing.
