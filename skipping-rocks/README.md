# Skip Stone

A low-poly 3D stone-skipping game. Stand at the end of a jetty, charge a throw
from your own point of view, then ride the chase camera down the valley tapping
the stone across the water.

No build step, no dependencies, no assets. The 3D is a small hand-written WebGL
renderer — a library from a CDN was not an option, and flat-shaded low-poly is
the one style a compact renderer does really well.

```
open skipping-rocks/index.html        # macOS
xdg-open skipping-rocks/index.html    # Linux
# or serve it:  python3 -m http.server  →  localhost:8000/skipping-rocks/
```

Touch or mouse; the keyboard works too (space to charge and release, arrows to
aim and steer).

## The loop

1. **Hold** anywhere to charge. The power bar sweeps up and back, so releasing
   at the top takes timing.
2. **Drag while holding** to aim — sideways to turn, up and down for the angle.
   A gold ring on the water shows exactly where the stone will land.
3. **Release** to throw. The camera falls in behind the stone.
4. **Tap** as it touches down for a **Perfect** skip — a bigger bounce and +1
   combo. The landing ring turns gold inside the timing window.
5. **Drag left and right** in flight to steer through the rings.

The stone sinks when it runs out of forward speed or bounce, and the run scores
on distance, skips, perfects, best combo and rings collected.

## Mechanics

- **Perfect-skip timing** — the core skill. The window is generous (110 ms at
  first) and forgiving both ways: tapping slightly early banks the Perfect for
  the moment of impact, tapping slightly late applies it to the bounce that just
  happened. A tap nowhere near the water costs nothing, because steering shares
  the same screen.
- **Combo** — consecutive Perfects multiply the run's coin payout.
- **Impact angle** — every bounce is scored against an ideal ~14° entry. Flat
  throws keep their speed; steep ones die.
- **Steering** — a gentle lateral push, enough to line up rings without turning
  the stone into an aircraft.
- **Wind** — randomised per throw and shown while aiming, pushing the stone
  across the valley.
- **Rings** — gold rings are worth 1, blue gems 5. Gems float higher, so you
  trade a little flatness to reach them.

## Upgrades

Three, five levels each, bought between throws with coins:

| | Upgrade | Effect |
|---|---|---|
| 🪨 | **Flat Stone** | Keeps more speed and bounce through every skip |
| 💪 | **Strong Arm** | +7% launch speed per level |
| 👁️ | **Skipper's Sense** | Wider Perfect window, stronger Perfect kick |

Clean timing and no upgrades runs a bit past 200 m; fully upgraded it clears
500 m. Costs scale 1.75× per level.

## How the rendering works

`engine.js` is the whole 3D stack in one file: 4×4 matrices, a triangle-soup
mesh builder, two shader programs and a forward renderer.

- **Flat shading** comes from recovering the face normal in the fragment shader
  with screen-space derivatives (`OES_standard_derivatives`). That gives true
  faceting even on the water, whose vertices are displaced on the GPU and so
  have no usable per-vertex normal. Devices without the extension fall back to
  the baked normals every mesh already carries.
- **Normals are faced toward the viewer** in both paths. Backface culling is off
  — at these polygon counts it buys nothing and it makes winding mistakes across
  a dozen mesh builders impossible.
- **A weak view-aligned fill light** sits on top of the sun. Without it the
  stone's leading face turns away from the sun and goes nearly black from the
  chase camera, which is exactly where the player is looking.
- **The world scrolls, the meshes don't.** The water grid follows the camera,
  snapped to its cell size, with the wave computed from world coordinates so the
  surface never swims. The valley is four scenery chunks drawn repeatedly; each
  chunk's terrain deviation is tapered to zero at both ends, so any variant meets
  any other seamlessly.
- **Fog is per-draw.** The scene fades out by 250 m, which hides the edge of the
  water grid; the mountain ring uses a much longer range so the peaks stay
  visible as distant haze rather than fog-coloured nothing.
- **The sky** is a full-screen gradient with the sun painted into it, drawn with
  depth writes off before anything else.

## Notes

- Physics is in metres and seconds: +z is downrange, +y is up. Note that looking
  down +z with +y up means **screen-right is −x** — aiming, steering and the
  first-person hand all have to account for it.
- The first-person hand is positioned by view angle rather than in metres, so it
  sits in the same screen corner on a narrow phone and a wide desktop. In metres
  it drifted to the middle of a wide view and off the edge of a narrow one.
- A Perfect can never send the stone off the water faster than it arrived — the
  kick buys a slower decay, not a bounce that gains energy every skip.
- Water waves are visual only; the physics plane stays flat at y = 0, so the
  amplitude is kept small enough that the stone never looks like it missed.
- Progress saves to `localStorage` under `skipstone.save.v2`, failing quietly in
  private-mode browsers.
- `window.__skipstone` exposes run state for tuning and automated testing.
