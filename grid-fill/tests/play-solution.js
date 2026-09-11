/* Replays a solved board through real pointer events and checks the game wins.
   Load index.html?debug#<diff>/<seed>[/flags], eval this, then await __play(). */
window.__play = async function (opts) {
const oneStroke = !!(opts && opts.oneStroke);
const G = window.__gf, P = G.puzzle, W = P.W, H = P.H;
const file = P.mode === 'daily' ? 'sol-daily' : 'sol-' + P.diff;
const sol = await fetch('tests/' + file + '.json?x=' + Date.now()).then(r => r.json());
if (sol.seed !== P.seed) throw new Error('solution is for seed ' + sol.seed + ', board is ' + P.seed);

const board = document.getElementById('board');
const rect = board.getBoundingClientRect(), cw = rect.width / W, ch = rect.height / H;
const pt = i => [rect.left + ((i % W) + .5) * cw, rect.top + (((i / W) | 0) + .5) * ch];
const nb = i => { const x = i % W, y = (i / W) | 0, o = [];
  if (y > 0) o.push(i - W); if (y < H - 1) o.push(i + W);
  if (x > 0) o.push(i - 1); if (x < W - 1) o.push(i + 1); return o; };
function ev(t, i, buttons) {
  const [x, y] = pt(i), el = document.elementFromPoint(x, y) || board;
  el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }));
}

/* play a region the way par assumes: longest run first, then extend from what
   is already drawn - the same strategy strokesFor() scores */
function longestRun(start, set, covered) {
  let best = [], budget = 20000;
  const path = [], seen = new Set();
  (function walk(c) {
    if (budget-- < 0) return;
    path.push(c); seen.add(c);
    if (path.length > best.length) best = path.slice();
    for (const n of nb(c)) if (set.has(n) && !covered.has(n) && !seen.has(n)) walk(n);
    path.pop(); seen.delete(c);
  })(start);
  return best;
}

function drawAtPar(cells) {
  const set = new Set(cells), covered = new Set();
  let strokes = 0;
  while (covered.size < cells.length && strokes <= cells.length) {
    const starts = covered.size === 0 ? cells
      : cells.filter(c => !covered.has(c) && nb(c).some(n => covered.has(n)));
    let best = [];
    for (const st of starts) {
      const run = longestRun(st, set, covered);
      if (run.length > best.length) best = run;
    }
    if (!best.length) break;
    if (covered.size === 0) {
      ev('pointerdown', best[0], 1);
    } else {
      ev('pointerdown', nb(best[0]).find(n => covered.has(n)), 1);   // grab the drawn part
      ev('pointermove', best[0], 1);
    }
    for (let k = 1; k < best.length; k++) ev('pointermove', best[k], 1);
    ev('pointerup', best[best.length - 1], 0);
    for (const c of best) covered.add(c);
    strokes++;
  }
  return strokes;
}

document.getElementById('btnClear').click();
let fallbacks = 0;
for (const cells of sol.regions) {
  if (oneStroke) { drawAtPar(cells); continue; }
  const set = new Set(cells), seen = new Set([cells[0]]), order = [cells[0]];
  for (let k = 0; k < order.length; k++)                 // breadth first, so every
    for (const n of nb(order[k]))                        // new tile touches the region
      if (set.has(n) && !seen.has(n)) { seen.add(n); order.push(n); }
  if (order.length !== cells.length) throw new Error('region in the solution is not connected');
  ev('pointerdown', order[0], 1); ev('pointerup', order[0], 0);
  const painted = new Set([order[0]]);
  for (let k = 1; k < order.length; k++) {
    const c = order[k], from = nb(c).find(n => painted.has(n));
    ev('pointerdown', from, 1); ev('pointermove', c, 1); ev('pointerup', c, 0);
    painted.add(c);
  }
}

const info = G.regionInfo();
return JSON.stringify({
  board: P.diff + '/' + P.seed,
  progress: document.getElementById('progress').textContent,
  regions: info.size,
  allDone: [...info.values()].every(r => r.done),
  invalid: [...info.values()].filter(r => r.bad).length,
  won: !document.getElementById('win').classList.contains('hidden'),
  rating: document.getElementById('winRating').textContent,
  moves: G.moves, par: G.par,
  paths: document.querySelectorAll('#paint path').length,
  sealed: document.querySelectorAll('#paint path.done').length,
  fallbacks,
})
};
