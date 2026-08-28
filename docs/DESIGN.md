# Apex Drift — design notes

> Random maps. Upgrades that matter. Luck is a real factor; skill is a bigger one.

This document explains how that sentence is turned into numbers, and how those
numbers are checked rather than asserted.

---

## 1. The three budgets

Everything the game does is arbitrated by three "budgets", each expressed as a
swing in lap time. They live in `src/game/balance.js`:

| Budget | Measured | What it is |
|---|---|---|
| **Skill** | **31%** | Clean lines, late braking, drift-boost chaining, nitro fusion |
| **Stats** | **21%** | A fully maxed car versus a stock one, averaged over random maps |
| **Luck**  | **7%**  | The swing the map roll puts on a build you already committed to |

The ordering is the design: **skill > stats > luck**. A player who reads corners
and chains boosts beats a better-funded one. A bad map roll costs you real time
but never the race outright.

`npm run balance` measures all three across 120 random maps and prints
`thesis (skill > stats > luck): HOLDS` or fails loudly.

Head-to-head, from the same report:

```
great driver, stock car   vs  poor driver, maxed car : 53%
good driver, wrong build  vs  ok driver, right build : 49%
equal drivers, +2 levels of car                      : 100%
```

Read those in order. The first two say skill beats money and beats the map roll,
narrowly — it is a real contest, not a foregone one. The third says that when
skill is equal, the car decides. That is what makes upgrading worth doing.

Over a whole season (`npm run season`, 8 rounds × 3 seeds):

```
points from driving better (sloppy -> sharp):  56
points from spending smarter (spread -> chase): 5
```

## 2. Every map is finishable; only the margin is gated

No surface, jump or corner is impassable in a stock car. What the upgrades buy
is time. This is enforced structurally by splitting each stat's effect in two
(`resolveStats`):

- **Uniform benefits are narrow.** Top speed spans only 176→194 km/h across five
  levels. Money must not buy a lap outright.
- **Terrain-specific leverage is wide.** Tyres barely matter on dry asphalt, but
  on ice their range applies almost in full, because the bonus scales with how
  *scarce* grip is. Suspension does nothing on a clean circuit and is worth ~21%
  of lap time on a sand-heavy one.

So a maxed car is only ~21% better on average, while the *right* car for a given
map can be dramatically better on the sections that map is made of. That is
where the strategy lives.

## 3. Maps are random, and their demands are measured, not authored

`src/game/trackgen.js` generates a seeded closed circuit: a control loop, a
Catmull-Rom spline, resampling at 4m, periodic elevation harmonics, banking from
curvature, surface patches, and jumps placed on straights.

Crucially, **what a map rewards is measured off the finished geometry**, never
declared by hand. `deriveDemand()` reads straight fraction, longest straight,
mean and minimum corner radius, slow/fast corner share, surface mix, jump count,
elevation change and braking events, then scores each of the seven upgrades.

Each feature is divided by a reference constant meaning "a lot of this", and
per-stat calibration (`CALIB`) puts the median random map at ~0.52 for every
stat. Without that step the raw features sit on wildly different scales and a
tag like "fast sweepers" fires on three maps out of four, which tells the player
nothing. After calibration each upgrade is what a map wants between 16% and 46%
of the time. Re-derive with `node scripts/calibrate-demand.mjs` if generation
changes.

The payoff: a trait tag is honest. If the garage says *Broken ground*, the pace
model really does pay for suspension there.

## 4. The gamble: partial information

The strategic decision is created by the **reveal order**, not by hiding dice:

1. The map is rolled. You see the biome, the length, the weather, and **one** of
   its trait tags. The rest show as `+N unknown`.
2. The shop is open. You spend on upgrades with that partial picture.
3. Scouting intel costs ¢1,200 — and buys the *full* demand profile and surface
   breakdown before you commit.

Intel competes directly with the car for the same credits. Hedge broadly and be
adequate everywhere, or buy certainty and commit hard. Weather is the loudest
luck lever because it re-weights which stat is king (rain multiplies the value
of tyres and aero by 1.35).

## 5. Where skill actually lives

Skill carries the largest budget, so the car has to reward it mechanically.

**The drift economy.** Velocity is tracked in the car's own frame. Holding a
turn needs lateral acceleration; the tyres supply what they can and only the
*shortfall* becomes sideways velocity. That shortfall is the drift.

- Slip between ~12° and ~55° charges boost, fastest at ~25°.
- Past 55° you are spinning and the charge bleeds away.
- Straightening releases the charge as an exit boost, in three tiers.
- Releasing **while nitro is burning** fuses them for 1.35× — the fastest thing
  in the game, available to anyone in any car.

Measured (`npm run boost`), over a 400m corner exit from 20 m/s:

```
plain throttle            9.58s
tier 3 drift exit         8.42s   12.2% quicker
nitro only                8.50s   11.3% quicker
tier 3 FUSED with nitro   7.75s   19.1% quicker
```

The `BOOST` constant in `pace.js` is set from that measurement, not guessed.

**Reading the ground.** Surfaces are visibly distinct because knowing that the
apex is sand and lifting early is a skill the game asks for.

**Air.** Jumps need the car levelled before landing. Aero buys the authority to
do it; suspension forgives you when you get it wrong. Neither removes the skill.

## 6. Rivals

Rivals run on the pace model rather than full physics, so their lap times are
exactly what the balance report predicts for their car and their driver. That
keeps the grid honest and tunable, and it means the pre-race prediction and the
race agree. They still hunt a racing line and make mistakes — rarer the better
the driver, which is their share of luck.

Their budgets follow the season, only loosely anchored to the player's spend
(30%). Anchoring harder makes races close but renders upgrading pointless,
because the grid upgrades in lockstep with you.

Rival skill is capped at 0.88, inside the range a human can match.

## 7. Verification

The simulation is checked against the model rather than trusted:

- `npm run balance` — the three budgets, across 120 random maps.
- `npm run sim` — the live physics against the pace model. With a correct
  steering input the car holds **100–110% of the theoretical corner limit**, so
  the model and the car genuinely agree.
- `npm run boost` — what the drift economy is worth, in metres and seconds.
- `npm run season` — eight-round seasons played end to end.
- `npm run smoke` — the real game in a real browser on a pinned seed: menu,
  garage, purchase, race, drive, drift, HUD, console errors.

### Bugs these caught

Worth recording, because each was invisible from the outside:

- **The road was never drawn.** Its triangles were wound so every face pointed
  down, and back-face culling removed the entire racing surface. The edge lines
  still drew, so the track "looked" present.
- **The race clock outran the car.** `Race` advanced by the frame delta while
  `Vehicle` clamped its own, so a slow display silently inflated lap times.
  Physics now runs on a fixed timestep.
- **Lateral forces were double-counted**, generating slide faster than the tyres
  could cancel it, so every car understeered into the barrier at any speed.
- **A car pinned to a barrier had its speed multiplied down every frame** and
  stuck there permanently.
- **`brakes` was tagged as wanted on 63% of maps while being worth 0.3% of lap
  time** — the trait tags were lying to the player.

## 8. Tuning

Start in `src/game/balance.js`; it is the single source of truth. After any
change, run `npm run balance` and `npm run season`. If the thesis line stops
saying `HOLDS`, the change is wrong no matter how good it feels.
