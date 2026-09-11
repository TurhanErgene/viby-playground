# Eraser Border Wars

The schoolyard game: a hand-drawn country split between players, and a
two-tone eraser flipped as a coin to settle every border argument.

Open `index.html` in a browser. No build, no dependencies, touch-first —
one file, ~1100 lines, plain ES5-style JS in one IIFE.

## The turn

1. **Paint a bite.** Touch a rival tile that borders you and drag across as
   many as you want. One tap is a one-tile claim. Tiles you may start on are
   marked with a dot.
2. **Read the odds.** The bar under the map splits into take / rim / pay, and
   moves as you paint — see *Believability* below.
3. **Arm a card** (optional) from the hand at the bottom.
4. **Flip.** Red `+` takes the land, blue `-` hands the same number of tiles
   back — taken from the ground right behind your push. The narrow rim gives
   you the land *and* a card.

The bell ends recess after 12 rounds; the largest share wins. Losing every
tile knocks you out earlier.

## Believability

`claimOdds()` turns the shape of your claim into the flip's odds:

```
reach = claim edges touching your own land / claim perimeter
greed = claim size / your per-turn cap
p(plus) = 0.38 + 0.30 * min(reach / 0.45, 1) - 0.22 * greed   (clamped 0.22–0.72)
p(rim)  = 0.10
```

So a small bite into a pocket you already surround runs near 65%, a wide
shallow bite along a long frontier sits near even, and a deep spear into
their middle bottoms out near 22%. The CPU scores about a dozen candidate
shapes by expected value and swings harder when it is behind late.

## Cards

The rim deals one of four, held (max 3) and armed before any flip. A card
only leaves your hand when it actually fires.

| Card | Effect |
| --- | --- |
| Double | A plus (or rim) pays twice |
| Shield | A minus costs nothing |
| Re-flip | A minus buys one more throw |
| Judge | +15% on the plus side for this flip |

## Tuning

The knobs are all constants at the top of the script:

| Constant | Default | Does |
| --- | --- | --- |
| `COLS`, `ROWS` | 18, 29 | Map grid |
| `ROUNDS` | 12 | Rounds before the bell |
| `CLAIM_SHARE`, `CLAIM_CEIL` | 0.20, 30 | Per-turn claim cap, as a share of what you hold |
| `RIM` | 0.10 | Chance of landing on the narrow edge |
| `HAND_MAX` | 3 | Cards held at once |

Believability constants live in `claimOdds()`.

## Code map

| Section | What lives there |
| --- | --- |
| map generation | `makeLand` (metaball landmass, chewed coast), `recenter`, `largestBlob`, `partition` (lockstep growth so shares start even) |
| claims | `grabNear` (grow a contiguous blob), `addCell` / `strokeStart` / `strokeMove` (painting), `claimOdds` |
| turn flow | `beginTurn`, `cpuTurn`, `nextTurn`, `endGame` |
| the flip | `rollFace`, `doFlip`, `toss`, `tumble`, `landed`, `resolve` |
| rendering | `paint` (canvas), `renderHUD`, `renderDock`, `renderOdds`, `renderHand` |

The eraser itself is lifted out as a standalone file in
[`../snippets/eraser-flip.html`](../snippets/eraser-flip.html).

## Notes for a multiplayer version

All game state is one object, `S` — `owner` (an `Int8Array`, one entry per
tile: `-1` sea, otherwise the owning player), plus `turn`, `round`, `hands`,
`claim`. A turn is fully described by `{player, claimCells, armedCard}`, and
the outcome by the rolled face, so a server only needs to own `Math.random()`
for `rollFace` and broadcast that triple. `resolve()` is the only function
that mutates `owner`.
