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
   you the land *and* a card. A short end changes the bet instead of settling
   it: `×2` doubles the bite, `÷2` halves it, and the eraser goes straight
   back up to settle the new one against freshly recalculated odds.

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
                + min(12, 4 * tiles next to a rival capital)/100
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
costs you. **Fords** are two marked crossings where the river costs nothing,
and in the rain they are the only way over at all, which makes them the one
piece of ground both players want. **Capitals** are a flag on a real tile:
the ground immediately around it is loose, because the crowd is all inside
the walls, so the outskirts come away easily and the flag tile itself is the
hard part. Taking it breaks the line and a further 30% of that player's land
goes with it, after which they plant a new flag in whatever is left. The soft
ring makes a capital a magnet: easy to approach, expensive to finish.

## Playing together

Any seat can be a person or the CPU: **New map** lists the players and each
one toggles between the two, so two people share one phone, or three people
and one CPU, up to four seats. With more than one person playing, nobody is
"you" any more and every message uses colour names.

Between turns a handover screen covers the board with whose turn it is, the
standings and the round, and the hand is emptied from the DOM until that
player taps Ready, so nobody reads anyone else's cards over their shoulder.

For play across two devices, a turn is fully described by
`{player, claimCells, armedCard}` plus the face the eraser landed on, and the
whole map comes out of `Math.random()` at setup. A server that owns the seed
and the flip result and relays that triple is the entire protocol; nothing
else in the game needs to change.

## The seasons

Recess runs through a year. The twelve rounds pass through spring, summer,
autumn and winter, and each round draws a condition from its season's table
and announces itself over the map:

| Condition | Season | Effect |
| --- | --- | --- |
| Rain | spring | The river cannot be crossed except at a ford |
| Dry | summer | River crossings cost nothing |
| Wind | autumn | The rim comes up twice as often |
| Fog | winter | The odds are hidden until the eraser lands (for the CPU too) |
| Clear | any | Nothing |

Rain works by removing river edges from the adjacency graph in `linked()`,
so it changes what you are allowed to claim rather than adding another
number to the odds.

## Pencil ghosts

Every tile remembers who held it last and how often it has changed hands
(`ghost` and `churn`, written only through `setOwner`). Old owners show as
faint rub-strokes in their colour under the current fill, so by the last
rounds the map shows where the fighting was.

## The eraser wears out

Every throw rounds the corners a little more. The rim starts at 9% and creeps
toward 22%, the short ends from 2% to 8%, and the eraser on screen visibly
loses its edges as it goes, so late flips are luckier and stranger than early
ones. Both rare faces eat into the plus and the minus alike rather than only
the minus.

The rounded corners would otherwise let you see straight through the box, so
the eraser has a solid core: a second six-face block scaled just inside the
shell, square-cornered and the colour of bare rubber. It only shows where the
outer faces have worn away, which is exactly what a chewed eraser looks
like.

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

## Framing

The grid is 20x32, but the canvas is sized to the country rather than the
whole sheet: `setView()` takes the land's bounding box plus one tile of sea
and `fit()` scales that to the board, so there is no dead paper down the
sides and the tiles come out as large as the screen allows (22 to 25px on a
390px-wide phone instead of 18). `makeLand()` draws two dozen candidate
countries and keeps the one whose proportions give the biggest tiles on this
particular screen.

## Tuning

The knobs are all constants at the top of the script:

| Constant | Default | Does |
| --- | --- | --- |
| `COLS`, `ROWS` | 20, 32 | Map grid |
| `ROUNDS` | 12 | Rounds before the bell |
| `CLAIM_SHARE`, `CLAIM_CEIL` | 0.20, 30 | Per-turn claim cap, as a share of what you hold |
| `RIM0`, `RIM_WEAR`, `RIM_MAX` | 0.09, 0.009, 0.22 | Rim chance when fresh, per flip, and at its most worn |
| `HAND_MAX` | 3 | Cards held at once |
| `HILL_SHARE` | 0.11 | Share of land that is hills |
| `FORDS` | 2 | Free crossings on the river |
| `SEASONS`, `WEATHER` | - | The year's conditions and what each does |
| `ROUT_SHARE` | 0.08 | Hold less than this and you give up the rest |
| `CAPITAL_ROUT` | 0.30 | Extra land lost with a captured capital |

Believability constants live in `claimOdds()`.

## Code map

| Section | What lives there |
| --- | --- |
| map generation | `makeLand` (metaball landmass, chewed coast), `recenter`, `largestBlob`, `partition` (lockstep growth so shares start even, and its seeds become the capitals), `makeHills`, `makeRiver`, `makeFords` |
| claims | `grabNear` (grow a contiguous blob), `addCell` / `strokeStart` / `strokeMove` (painting), `claimOdds` |
| turn flow | `beginTurn`, `cpuTurn`, `nextTurn`, `endGame`, `rollWeather` |
| collapse | `capitalFalls` (a capital taken breaks the line), `routCheck` (under the threshold, surrender the rest), `biggestNeighbour` |
| sound | `sfx`, a small WebAudio synth with `hiss` and `tone` |
| history | `setOwner` is the only way a tile changes hands, and it records the ghost |
| the flip | `rollFace`, `doFlip`, `toss`, `tumble`, `landed`, `resolve` |
| rendering | `paint` (canvas), `setView` / `fit` (framing), `renderHUD`, `renderDock`, `renderOdds`, `renderHand` |

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
