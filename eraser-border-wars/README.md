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
   back, taken from the ground right behind your push. The narrow rim gives
   you the land *and* a card.

The bell ends recess after 12 rounds; the largest share wins. Squeezed under
8% of the map and you hand the rest to whoever pushed you there, so endgames
do not turn into a grind.

## Believability

`claimOdds()` turns the shape of your claim into the flip's odds:

```
reach    = claim edges touching your own land / claim perimeter
greed    = claim size / your per-turn cap
belief   = 0.38 + 0.30 * min(reach/0.45, 1)     reach
                - 0.22 * greed                   greed
                - min(14, 3.5 * hill tiles)/100  hills
                - min(18, 6 * river crossings)/100
                - 0.12 if the bite contains a rival capital
                + 0.15 if the Judge card is armed        (clamped 0.15–0.75)

rim      = min(0.22, 0.09 + 0.009 * flips so far)   the eraser wearing down
p(plus)  = belief * (1 - rim)
p(minus) = 1 - rim - p(plus)
```

So a small bite into a pocket you already surround runs near 60%, a wide
shallow bite along a long frontier sits near even, and a deep greedy spear
across the river bottoms out in the teens. The three largest modifiers are
printed under the odds bar on every claim. The CPU scores about a dozen
candidate shapes by expected value, values capitals, and swings harder when
it is behind late.

## The ground

**Hills** are drawn as pencil rises and cost believability to attack into.
**The river** runs along tile edges rather than through them, so it divides
the map without taking ground out of play; reaching across it to take land
costs you. **Capitals** are a flag on a real tile: defended, but taking one
breaks the line and a further 30% of that player's land goes with it, after
which they plant a new flag in whatever is left.

## The eraser wears out

Every throw rounds the corners a little more. The rim starts at 9% and
creeps toward 22%, and the eraser on screen visibly loses its edges as it
goes, so late flips are luckier and stranger than early ones. The rim eats
into both faces, not just the minus.

## Sound

Synthesised at runtime in `sfx` (WebAudio, no assets, nothing to load):
pencil hiss while you paint, the whoosh and slap of the throw, a ting on the
rim, the bell at the end. The `♪` chip in the header mutes it, remembered in
`localStorage`. Browsers need a gesture before audio starts, so the context
is created on the first pointer event.

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
| `RIM0`, `RIM_WEAR`, `RIM_MAX` | 0.09, 0.009, 0.22 | Rim chance when fresh, per flip, and at its most worn |
| `HAND_MAX` | 3 | Cards held at once |
| `HILL_SHARE` | 0.11 | Share of land that is hills |
| `ROUT_SHARE` | 0.08 | Hold less than this and you give up the rest |
| `CAPITAL_ROUT` | 0.30 | Extra land lost with a captured capital |

Believability constants live in `claimOdds()`.

## Code map

| Section | What lives there |
| --- | --- |
| map generation | `makeLand` (metaball landmass, chewed coast), `recenter`, `largestBlob`, `partition` (lockstep growth so shares start even, and its seeds become the capitals), `makeHills`, `makeRiver` |
| claims | `grabNear` (grow a contiguous blob), `addCell` / `strokeStart` / `strokeMove` (painting), `claimOdds` |
| turn flow | `beginTurn`, `cpuTurn`, `nextTurn`, `endGame` |
| collapse | `capitalFalls` (a capital taken breaks the line), `routCheck` (under the threshold, surrender the rest), `biggestNeighbour` |
| sound | `sfx`, a small WebAudio synth with `hiss` and `tone` |
| the flip | `rollFace`, `doFlip`, `toss`, `tumble`, `landed`, `resolve` |
| rendering | `paint` (canvas), `renderHUD`, `renderDock`, `renderOdds`, `renderHand` |

The eraser itself is lifted out as a standalone file in
[`../snippets/eraser-flip.html`](../snippets/eraser-flip.html).

## Notes for a multiplayer version

All game state is one object, `S`: `owner` (an `Int8Array`, one entry per
tile, `-1` sea, otherwise the owning player), plus `turn`, `round`, `hands`,
`claim`, `capitals`, `hills`, `river` and `wear`. A turn is fully described
by `{player, claimCells, armedCard}` and its outcome by the rolled face, so a
server only needs to own `Math.random()` for `rollFace` and broadcast that
triple. The map (land, hills, river, capitals, starting split) is generated
from randomness too, so a seeded PRNG in place of `Math.random` would let a
server send a seed instead of a board. `resolve()`, `capitalFalls()` and
`routCheck()` are the only functions that mutate `owner`.
