# Grid Fill

A freehand take on Shikaku. Instead of tapping a number and having the game snap a
rectangle into place, **you** draw the region: press a tile and drag, and it paints
tile by tile under your finger or mouse.

No build step, no dependencies. Open `index.html`, or serve the folder:

```bash
python -m http.server 5173
```

## Rules

- Every region must contain **exactly one number** and **exactly that many tiles**.
- Regions are always connected — a tile only joins if it touches the region you are drawing.
- A finished region gets a **light rim**. Too many tiles, or two numbers inside, turns it **red**.
- Fill **every** tile to win. Voids (✕) can never be filled.

## Controls

| Action | Mouse | Touch |
| --- | --- | --- |
| Draw a region | press and drag | press and drag |
| Grow an existing region | start the drag on it | same |
| Take a tile back | drag back along your own trail | same |
| Steal tiles | draw straight over another region | same |
| Erase | right-drag, Shift-drag, or the Erase tool | Erase tool |
| Undo | Ctrl+Z or Undo | Undo |
| Menu / help | M | ☰ / ? |

Text selection, long-press menus, and touch scrolling are all suppressed over the
board, so a drag never turns into a highlight or a page scroll.

## Modes

**Daily** — one board per calendar date, the same for everyone, seeded from the date
itself. The weekday sets its shape, so the week has a rhythm: an easy Monday, shape
clues midweek, voids on Friday, a 12×12 with everything on Saturday. Solving it adds
to your day streak. The daily is never losable, whatever Challenge is set to — a
shared board everyone should be able to finish.

**Endless** — infinite generated boards at any difficulty, with Voids and Shape clues
as optional rules.

There is deliberately no fixed level ladder. With a generator, "levels" would only be
difficulty relabeled, and it would cost authoring plus progress storage for nothing.

## Par, and why there is no timer pressure

Score is **moves**, not seconds. One move is one stroke that changed the board — a
stroke that does nothing is free, and Undo hands the move back.

**Par** is the number of strokes a good hand needs: draw the longest run you can, then
extend from what you have already drawn. It is not simply one stroke per region,
because some shapes (a T, a plus) have no single path through every tile and honestly
need two — `strokesFor()` simulates a real hand, so par is always reachable. Since a
board can have more than one valid solution, a cleaner partition can even come in
*under* par. Par is a reference, like golf, not a bound.

Ratings: **Perfect** at or under par, **Great** within 25%, **Good** within 60%.

You cannot fail by default. A logic puzzle punishes exploration if you add a hard fail
state, and exploration is how you solve it. **Challenge** (off by default) is there for
players who want stakes: it caps you at `max(par + 4, par × 1.6)` moves. Undo still
rescues you, and it never applies to the daily.

## Settings and sharing

Difficulty, Voids, Shape clues, and Challenge live in the ☰ menu and persist. Every
puzzle is a seed, and the URL hash carries `#difficulty/seed/flags` (or `#daily/date`),
so **Copy link** hands someone the exact board. Progress is saved as you play, so a
refresh or a locked phone picks up where you left off.

## How puzzles are generated

`generate()` carves the grid into random connected blobs (growth biased toward
hemmed-in tiles so no orphan single squares get stranded), then drops one clue into
each blob equal to its size. Because the clues are read off a real partition, every
board is guaranteed solvable. Voids are placed first, and any area they island off is
turned into void too, so the playable area is always one connected piece.

## How regions are drawn

Each region is one SVG `<path>`, not a set of tinted tiles. `traceLoops()` walks the
tiles' outward-facing sides into closed loops (a region that encircles empty tiles
produces a second loop, and the hole is punched out correctly), then `loopToPath()`
pulls the loop inward by one tile gap and rounds every turn — outward at convex
corners, with a matching reverse fillet at concave ones. That is what makes a stepped
region read as one smooth shape instead of a stack of squares, and it means the rim
(light when satisfied, red when wrong) traces the region's border rather than each
tile's.

The gap and corner radius are ratios of the tile size, shared between `--pad` /
`--radius` in the CSS and `U_PAD` / `U_RADIUS` in the JS. Change one, change both.

## Tests

```bash
node tests/generator.test.js game.js
```

960 boards across every difficulty and flag combination: clue sum equals open tiles,
open area always connected, no clue stranded on a void.

The browser suites need the page served with `?debug`, which exposes internals on
`window.__gf`. Open `index.html?debug`, then in the console:

```bash
eval(await fetch('tests/browser-suite.js').then(r => r.text()))
```

Nine checks: outline geometry fuzzed against the tiles it covers, region connectivity
after random drags, orphan release on a mid-region erase, drag-back retraction, undo
bookkeeping, tile stealing, and the three validity rules.

```bash
eval(await fetch('tests/features.js').then(r => r.text())); await __features()
```

Eleven checks: daily seeding and stability, par, save/resume, and the challenge and
loss flow.

To prove a board is winnable, `tests/make-solution.js` brute-force solves it from the
clues alone and `tests/play-solution.js` replays that solution through real pointer
events — pass `{ oneStroke: true }` to play at par:

```bash
node tests/make-solution.js hard 909090 ws > tests/sol-hard.json
```

Fixtures for four fixed seeds are committed. The daily board changes every day, so
generate that one when you want it — the difficulty has to match the weekday's plan
in `dailySpec()`:

```bash
node tests/make-solution.js medium $(date +%Y%m%d) "" > tests/sol-daily.json
```

```bash
eval(await fetch('tests/play-solution.js').then(r => r.text())); await __play({oneStroke:true})
```

## Deploying

Static files, so Cloudflare Pages (or any static host) needs no build config.
**Exclude `tests/` from the deploy** — `tests/sol-*.json` contain worked solutions.

## Files

- `index.html` — markup
- `style.css` — dark theme, tile faces, region outline styling, menu
- `game.js` — generation, par, input, region validation, outline geometry, undo, storage
- `tests/` — generator suite, browser suites, solver, playthrough

## Ideas not built yet

- **Color as a rule.** Colors are decoration right now. Restrict the palette to four
  and require touching regions to differ, and the color choice becomes a second puzzle
  layer on top of the sizes.
- **Share your result** as a spoiler-free grid of blocks, the way Wordle does.
- **Non-square boards** — ragged outlines, holes, hex or triangular tilings.
