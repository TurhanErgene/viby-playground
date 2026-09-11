/* Grid Fill - a freehand region-carving puzzle.
   Rules: every tile must end up inside a region; every region holds exactly one
   number and exactly that many tiles. Optional shape clues and voids. */

(() => {
'use strict';

/* ------------------------------------------------------------------ config */

const DIFFS = {
  easy:   { W: 6,  H: 6,  min: 2, max: 5,  wallRate: .06 },
  medium: { W: 8,  H: 8,  min: 2, max: 7,  wallRate: .07 },
  hard:   { W: 10, H: 10, min: 2, max: 9,  wallRate: .08 },
  expert: { W: 12, H: 12, min: 3, max: 12, wallRate: .09 },
};

const PALETTE = [
  '#9fe0c8', '#e9e58f', '#d9a3d8', '#c3bdf2', '#8fd0e8', '#f0b49b',
  '#a9d18f', '#f2a2ab', '#b9c6e8', '#e8c78f', '#87cbb4', '#dcb6f0',
];

const SHAPE_NONE = 0, SHAPE_RECT = 1, SHAPE_LINE = 2;
const SHAPE_GLYPH = { [SHAPE_RECT]: '▭', [SHAPE_LINE]: '━' };

/* region outlines are drawn in svg user units: one tile is U across.
   the two ratios below must stay in step with --pad / --radius in style.css */
const U = 100, U_PAD = U * .065, U_RADIUS = U * .16;

/* --------------------------------------------------------------- utilities */

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const fmtTime = s =>
  String(Math.floor(s / 60)).padStart(2, '0') + ':' +
  String(Math.floor(s % 60)).padStart(2, '0');

/* -------------------------------------------------------------- generation */

/* Carve the grid into random connected blobs, then drop one clue in each.
   Because the clues come from a real partition, every puzzle is solvable. */
function generate(cfg, seed) {
  const rnd = mulberry32(seed >>> 0);
  const { W, H, min, max } = cfg;
  const N = W * H;

  const wall = new Uint8Array(N);
  const nb = i => {
    const x = i % W, y = (i / W) | 0, out = [];
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    return out;
  };

  if (cfg.useWalls) {
    const want = Math.round(N * cfg.wallRate);
    for (let k = 0; k < want; k++) wall[(rnd() * N) | 0] = 1;
    keepLargestOpenArea(wall, N, nb);
  }

  const owner = new Int16Array(N).fill(-1);
  const free = i => owner[i] === -1 && !wall[i];
  const freeCount = i => nb(i).reduce((n, j) => n + (free(j) ? 1 : 0), 0);

  const regions = [];
  for (;;) {
    // seed the next blob at the most hemmed-in free tile, so we leave no orphans
    let seedCell = -1, bestScore = Infinity, ties = 0;
    for (let i = 0; i < N; i++) {
      if (!free(i)) continue;
      const s = freeCount(i);
      if (s < bestScore) { bestScore = s; seedCell = i; ties = 1; }
      else if (s === bestScore && rnd() < 1 / ++ties) seedCell = i;
    }
    if (seedCell < 0) break;

    const id = regions.length;
    const cells = [seedCell];
    owner[seedCell] = id;
    const target = min + ((rnd() * (max - min + 1)) | 0);
    const frontier = new Set(nb(seedCell).filter(free));

    while (cells.length < target && frontier.size) {
      const arr = [...frontier];
      let pick;
      if (rnd() < .65) {                       // prefer dead ends -> tidy blobs
        let best = Infinity, bests = [];
        for (const c of arr) {
          const f = freeCount(c);
          if (f < best) { best = f; bests = [c]; }
          else if (f === best) bests.push(c);
        }
        pick = bests[(rnd() * bests.length) | 0];
      } else {
        pick = arr[(rnd() * arr.length) | 0];
      }
      frontier.delete(pick);
      owner[pick] = id;
      cells.push(pick);
      for (const n of nb(pick)) if (free(n)) frontier.add(n);
    }
    regions.push(cells);
  }

  const clue = new Int16Array(N).fill(-1);
  const shape = new Uint8Array(N);
  for (const cells of regions) {
    const at = cells[(rnd() * cells.length) | 0];
    clue[at] = cells.length;
    if (cfg.useShapes && cells.length >= 3 && rnd() < .4) {
      const xs = cells.map(i => i % W), ys = cells.map(i => (i / W) | 0);
      const bw = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1;
      const bh = Math.max.apply(null, ys) - Math.min.apply(null, ys) + 1;
      if (bw === 1 || bh === 1) shape[at] = SHAPE_LINE;
      else if (bw * bh === cells.length) shape[at] = SHAPE_RECT;
    }
  }

  const par = regions.reduce((sum, cells) => sum + strokesFor(cells, nb), 0);
  return { W, H, N, wall, clue, shape, seed: seed >>> 0, regionCount: regions.length, par };
}

/* How many strokes a good player needs for one region: draw the longest run you
   can, then keep extending from what you already have. Some shapes (a T, a plus)
   have no single path through every tile, so one-stroke-per-region is not always
   reachable - this simulates a real hand, so par is always achievable. */
function strokesFor(cells, nb) {
  const set = new Set(cells), covered = new Set();
  let strokes = 0;
  while (covered.size < cells.length && strokes < cells.length) {
    const starts = covered.size === 0
      ? cells                                   // first stroke can begin anywhere
      : cells.filter(c => !covered.has(c) && nb(c).some(n => covered.has(n)));
    let best = [];
    for (const s of starts) {
      const run = longestRun(s, set, covered, nb);
      if (run.length > best.length) best = run;
    }
    if (!best.length) break;
    for (const c of best) covered.add(c);
    strokes++;
  }
  return Math.max(1, strokes);
}

function longestRun(start, set, covered, nb) {
  let best = [], budget = 20000;                // cap the search; a shorter run
  const path = [], seen = new Set();            // only makes par more generous
  (function walk(c) {
    if (budget-- < 0) return;
    path.push(c); seen.add(c);
    if (path.length > best.length) best = path.slice();
    for (const n of nb(c)) if (set.has(n) && !covered.has(n) && !seen.has(n)) walk(n);
    path.pop(); seen.delete(c);
  })(start);
  return best;
}

/* walls can island off part of the board - wall off everything but the big piece */
function keepLargestOpenArea(wall, N, nb) {
  const seen = new Int8Array(N);
  let best = null;
  for (let i = 0; i < N; i++) {
    if (wall[i] || seen[i]) continue;
    const comp = [i]; seen[i] = 1;
    for (let k = 0; k < comp.length; k++)
      for (const n of nb(comp[k])) if (!wall[n] && !seen[n]) { seen[n] = 1; comp.push(n); }
    if (!best || comp.length > best.length) best = comp;
  }
  if (!best) return;
  const keep = new Int8Array(N);
  for (const i of best) keep[i] = 1;
  for (let i = 0; i < N; i++) if (!keep[i]) wall[i] = 1;
}

/* -------------------------------------------------------------- game state */

const $ = id => document.getElementById(id);
const el = {
  board: $('board'), paint: $('paint'),
  timer: $('timer'), progress: $('progress'), moves: $('moves'),
  parNote: $('parNote'), meterFill: $('meterFill'),
  modeName: $('modeName'), modeSub: $('modeSub'),
  win: $('win'), winRating: $('winRating'), winMoves: $('winMoves'),
  winMeta: $('winMeta'), winNext: $('winNext'), winShare: $('winShare'),
  lose: $('lose'), loseMeta: $('loseMeta'), loseRetry: $('loseRetry'), loseNew: $('loseNew'),
  btnErase: $('btnErase'), btnUndo: $('btnUndo'), btnClear: $('btnClear'),
  btnMenu: $('btnMenu'), btnHelpTop: $('btnHelpTop'),
  sheet: $('sheet'), help: $('help'), helpClose: $('helpClose'),
  miDaily: $('miDaily'), miNew: $('miNew'), miHelp: $('miHelp'), miClose: $('miClose'),
  dailySub: $('dailySub'), dailyBadge: $('dailyBadge'), newSub: $('newSub'),
  segDiff: $('segDiff'),
  optWalls: $('optWalls'), optShapes: $('optShapes'), optChallenge: $('optChallenge'),
  inpSeed: $('inpSeed'), btnSeed: $('btnSeed'), btnShare: $('btnShare'),
  statSolved: $('statSolved'), statStreak: $('statStreak'), statBest: $('statBest'),
};

let P = null;              // puzzle
let owner = null;          // Int16Array: region id per cell, -1 = empty
let colors = new Map();    // region id -> css color
let nextId = 0;
let cellEls = [];
let paintEls = new Map();   // region id -> <path>
let undoStack = [];
let erasing = false;
let won = false, lost = false;
let drag = null;
let moves = 0, par = 0, budget = 0;
let startedAt = 0, elapsedBase = 0, tickId = 0, doneRegions = new Set();

/* browsers refuse this before the first real tap, and some throw rather than warn */
const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) {} };

const nbOf = i => {
  const x = i % P.W, y = (i / P.W) | 0, out = [];
  if (y > 0) out.push(i - P.W);
  if (y < P.H - 1) out.push(i + P.W);
  if (x > 0) out.push(i - 1);
  if (x < P.W - 1) out.push(i + 1);
  return out;
};

/* ------------------------------------------------------------------ puzzle */

/* A board is fully described by { mode, diff, walls, shapes, seed } - that tuple
   is the url hash, the save key, and what a shared link carries. */
function newPuzzle(spec, restore) {
  const cfg = Object.assign({}, DIFFS[spec.diff], { useWalls: spec.walls, useShapes: spec.shapes });
  const seed = Number.isFinite(spec.seed) ? spec.seed : (Math.random() * 1e9) | 0;

  P = generate(cfg, seed);
  P.diff = spec.diff;
  P.mode = spec.mode || 'free';
  P.walls = !!spec.walls;
  P.shapes = !!spec.shapes;

  owner = new Int16Array(P.N).fill(-1);
  colors = new Map();
  nextId = 0;
  undoStack = [];
  won = lost = false;
  doneRegions = new Set();
  moves = 0;
  par = P.par;                                // fewest strokes a hand can do it in
  budget = Math.max(par + 4, Math.round(par * 1.6));
  stopTimer();
  startedAt = 0;
  elapsedBase = 0;

  el.win.classList.add('hidden');
  el.lose.classList.add('hidden');
  el.timer.textContent = '00:00';
  el.inpSeed.value = String(P.seed);

  buildBoard();
  if (restore) applySave(restore);
  writeHash();
  paintChrome();
  render();
}

/* header + par readout for the board now in play */
function paintChrome() {
  const daily = P.mode === 'daily';
  el.modeName.textContent = daily ? 'Daily' : DIFF_NAME[P.diff];
  const bits = [P.W + ' × ' + P.H];
  if (daily) bits.unshift(dateLabel(new Date()));
  if (P.walls) bits.push('voids');
  if (P.shapes) bits.push('shapes');
  el.modeSub.textContent = bits.join(' · ');
  el.parNote.textContent = challenge() ? '/ ' + budget : '· par ' + par;
}

const DIFF_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dateLabel = d => DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
const dateKey = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/* One board per calendar day, same for everyone. The weekday sets the shape of
   it, so the week has a rhythm instead of seven identical mediums. */
function dailySpec(d) {
  const plan = [
    { diff: 'medium', walls: false, shapes: false },   // Sun
    { diff: 'easy',   walls: false, shapes: false },   // Mon - gentle start
    { diff: 'medium', walls: false, shapes: false },
    { diff: 'medium', walls: false, shapes: true  },
    { diff: 'hard',   walls: false, shapes: false },
    { diff: 'hard',   walls: true,  shapes: false },
    { diff: 'expert', walls: true,  shapes: true  },   // Sat - the big one
  ][d.getDay()];
  return Object.assign({ mode: 'daily', seed: dateKey(d) }, plan);
}

function buildBoard() {
  el.board.style.setProperty('--w', P.W);
  el.board.style.setProperty('--h', P.H);
  el.paint.setAttribute('viewBox', '0 0 ' + P.W * U + ' ' + P.H * U);
  el.paint.setAttribute('preserveAspectRatio', 'none');
  el.paint.replaceChildren();
  paintEls = new Map();
  const frag = document.createDocumentFragment();
  cellEls = new Array(P.N);
  for (let i = 0; i < P.N; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    const n = document.createElement('span');
    n.className = 'num';
    d.appendChild(n);
    cellEls[i] = d;
    frag.appendChild(d);
  }
  el.board.replaceChildren(el.paint, frag);
  sizeText();
}

function sizeText() {
  if (!P) return;
  el.board.style.setProperty('--cellpx', (el.board.clientWidth / P.W) + 'px');
}
addEventListener('resize', sizeText);

/* -------------------------------------------------------------- validation */

function regionInfo() {
  const map = new Map();   // id -> { cells, clue, clues, shape, ... }
  for (let i = 0; i < P.N; i++) {
    const id = owner[i];
    if (id === -1) continue;
    let r = map.get(id);
    if (!r) map.set(id, r = { cells: [], clue: null, clues: 0, shape: SHAPE_NONE });
    r.cells.push(i);
    if (P.clue[i] >= 0) { r.clues++; r.clue = P.clue[i]; r.shape = P.shape[i]; }
  }
  for (const r of map.values()) {
    r.size = r.cells.length;
    r.shapeOk = shapeOk(r.cells, r.shape);
    r.done = r.clues === 1 && r.size === r.clue && r.shapeOk;
    r.bad = r.clues > 1 ||
            (r.clue !== null && r.size > r.clue) ||
            (r.clue !== null && r.size === r.clue && !r.shapeOk);
  }
  return map;
}

function shapeOk(cells, shape) {
  if (shape === SHAPE_NONE) return true;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of cells) {
    const x = i % P.W, y = (i / P.W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (shape === SHAPE_LINE) return bw === 1 || bh === 1;
  return bw * bh === cells.length;      // SHAPE_RECT
}

/* ----------------------------------------------------------- region outline */

/* Trace the border of a set of tiles as directed edges, walking each tile's
   sides that face outside the region. Every edge runs with the region on its
   right, so the loops come out consistently wound (holes included). */
function traceLoops(cells) {
  const W = P.W, H = P.H;
  const inR = new Set(cells);
  const has = (x, y) => x >= 0 && y >= 0 && x < W && y < H && inR.has(y * W + x);
  const K = (x, y) => x + ',' + y;
  const from = new Map();
  const add = (ax, ay, bx, by) => {
    const k = K(ax, ay);
    let list = from.get(k);
    if (!list) from.set(k, list = []);
    list.push([bx, by]);
  };

  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    if (!has(x, y - 1)) add(x, y, x + 1, y);
    if (!has(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) add(x, y + 1, x, y);
  }

  const loops = [];
  while (from.size) {
    const firstKey = from.keys().next().value;
    const start = firstKey.split(',').map(Number);
    let cur = start, dir = null;
    const loop = [];
    for (;;) {
      const k = K(cur[0], cur[1]);
      const cands = from.get(k);
      if (!cands || !cands.length) break;
      // where two edges leave the same point the region pinches against itself
      // diagonally; always take the sharpest right turn to keep loops separate
      let pick = 0;
      if (cands.length > 1 && dir) {
        let bestScore = -Infinity;
        cands.forEach((c, idx) => {
          const d = [Math.sign(c[0] - cur[0]), Math.sign(c[1] - cur[1])];
          const cross = dir[0] * d[1] - dir[1] * d[0];
          const dot = dir[0] * d[0] + dir[1] * d[1];
          const score = cross > 0 ? 2 : (cross < 0 ? 0 : (dot > 0 ? 1 : -1));
          if (score > bestScore) { bestScore = score; pick = idx; }
        });
      }
      const nxt = cands.splice(pick, 1)[0];
      if (!cands.length) from.delete(k);
      dir = [Math.sign(nxt[0] - cur[0]), Math.sign(nxt[1] - cur[1])];
      loop.push(cur);
      cur = nxt;
      if (cur[0] === start[0] && cur[1] === start[1]) break;
    }
    if (loop.length >= 4) loops.push(dropStraights(loop));
  }
  return loops;
}

/* keep only the points where the border actually turns */
function dropStraights(loop) {
  const n = loop.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n], c = loop[i], q = loop[(i + 1) % n];
    const ax = c[0] - p[0], ay = c[1] - p[1];
    const bx = q[0] - c[0], by = q[1] - c[1];
    if (ax * by - ay * bx !== 0) out.push(c);
  }
  return out;
}

/* Pull the loop inward by U_PAD so the region sits in the same gap as the
   tiles, then round every turn. Outer corners round outward, inner corners get
   the matching reverse fillet - that is what kills the square nub. */
function loopToPath(loop) {
  const n = loop.length;
  if (n < 4) return '';
  const dirs = [], pts = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n], c = loop[i];
    dirs.push([Math.sign(c[0] - p[0]), Math.sign(c[1] - p[1])]);
  }
  for (let i = 0; i < n; i++) {
    const d1 = dirs[i], d2 = dirs[(i + 1) % n];
    // inward normal of an edge is its direction turned 90 degrees (y grows down)
    const nx = -d1[1] + -d2[1], ny = d1[0] + d2[0];
    pts.push([loop[i][0] * U + U_PAD * nx, loop[i][1] * U + U_PAD * ny]);
  }

  const len = i => {
    const a = pts[i], b = pts[(i + 1) % n];
    return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);   // axis aligned
  };

  let d = '';
  for (let i = 0; i < n; i++) {
    const q = pts[i], d1 = dirs[i], d2 = dirs[(i + 1) % n];
    const r = Math.min(U_RADIUS, len((i - 1 + n) % n) / 2, len(i) / 2);
    const a = [q[0] - d1[0] * r, q[1] - d1[1] * r];
    const b = [q[0] + d2[0] * r, q[1] + d2[1] * r];
    const sweep = d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : 0;
    d += (i ? 'L' : 'M') + f(a[0]) + ' ' + f(a[1]);
    if (r > 0) d += 'A' + f(r) + ' ' + f(r) + ' 0 0 ' + sweep + ' ' + f(b[0]) + ' ' + f(b[1]);
  }
  return d + 'Z';
}

const f = v => Math.round(v * 10) / 10;

function regionPath(cells) {
  return traceLoops(cells).map(loopToPath).join(' ');
}

/* ------------------------------------------------------------------ render */

function render() {
  const info = regionInfo();
  let filled = 0, open = 0;

  for (let i = 0; i < P.N; i++) {
    const d = cellEls[i];
    const id = owner[i];
    const isWall = !!P.wall[i];
    if (!isWall) open++;
    if (id !== -1) filled++;

    const r = id === -1 ? null : info.get(id);
    const cls = ['cell'];
    if (isWall) cls.push('void');
    if (id !== -1) {
      cls.push('filled');
      if (r.bad) cls.push('bad');
      else if (r.done) cls.push('done');
    }
    d.className = cls.join(' ');

    const num = d.firstChild;
    num.textContent = P.clue[i] >= 0 ? String(P.clue[i]) : (isWall ? '✕' : '');
    if (P.clue[i] >= 0 && P.shape[i]) {
      const s = document.createElement('span');
      s.className = 'shape';
      s.textContent = SHAPE_GLYPH[P.shape[i]];
      num.appendChild(s);
    }
  }

  el.progress.textContent = filled + ' / ' + open;
  el.meterFill.style.width = (open ? filled / open * 100 : 0) + '%';
  el.meterFill.classList.toggle('full', filled === open && open > 0);
  el.moves.textContent = moves;
  el.parNote.classList.toggle('over', challenge() ? moves > budget : moves > par);
  paintRegions(info);

  return { filled, open, info };
}

/* one <path> per region, reused across renders so animations survive a redraw */
function paintRegions(info) {
  for (const [id, r] of info) {
    let node = paintEls.get(id);
    if (!node) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      paintEls.set(id, node);
      el.paint.appendChild(node);
    }
    node.setAttribute('d', regionPath(r.cells));
    node.setAttribute('fill', colors.get(id) || PALETTE[0]);
    node.classList.toggle('bad', !!r.bad);
    node.classList.toggle('done', !!r.done);

    if (r.done && !doneRegions.has(id)) {
      doneRegions.add(id);
      node.classList.add('pop');
      setTimeout(() => node.classList.remove('pop'), 260);
      buzz(12);
    } else if (!r.done) {
      doneRegions.delete(id);
    }
  }
  for (const [id, node] of paintEls) {
    if (!info.has(id)) { node.remove(); paintEls.delete(id); }
  }
}

/* ------------------------------------------------------------- board edits */

function snapshot() {
  undoStack.push({ owner: owner.slice(), colors: [...colors], nextId, moves });
  if (undoStack.length > 80) undoStack.shift();
}

function undo() {
  const h = undoStack.pop();
  if (!h) return;
  owner = h.owner;
  colors = new Map(h.colors);
  nextId = h.nextId;
  moves = h.moves;                 // undo gives the move back too
  won = lost = false;
  el.win.classList.add('hidden');
  el.lose.classList.add('hidden');
  render();
  save();
}

function pickColor(neighbourColors) {
  const taken = new Set(neighbourColors);
  const open = PALETTE.filter(c => !taken.has(c));
  const pool = open.length ? open : PALETTE;
  return pool[(Math.random() * pool.length) | 0];
}

function neighbourColorsOf(i) {
  const out = [];
  for (const n of nbOf(i)) if (owner[n] !== -1) out.push(colors.get(owner[n]));
  return out;
}

/* after tiles are taken away a region can fall apart - keep the piece that
   holds a clue (else the biggest) and release the rest */
function repair(id) {
  const cells = [];
  for (let i = 0; i < P.N; i++) if (owner[i] === id) cells.push(i);
  if (!cells.length) { colors.delete(id); doneRegions.delete(id); return; }

  const set = new Set(cells);
  const seen = new Set();
  const comps = [];
  for (const c of cells) {
    if (seen.has(c)) continue;
    const comp = [c]; seen.add(c);
    for (let k = 0; k < comp.length; k++)
      for (const n of nbOf(comp[k]))
        if (set.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); }
    comps.push(comp);
  }
  if (comps.length === 1) return;

  let keep = comps[0];
  for (const c of comps) {
    const hasClue = c.some(i => P.clue[i] >= 0);
    const keepClue = keep.some(i => P.clue[i] >= 0);
    if ((hasClue && !keepClue) || (hasClue === keepClue && c.length > keep.length)) keep = c;
  }
  for (const c of comps) if (c !== keep) for (const i of c) owner[i] = -1;
}

function paintCell(i) {
  if (P.wall[i]) return;
  if (drag.id === null) {                       // first tile of a fresh stroke
    if (owner[i] !== -1) {
      drag.id = owner[i];                       // grabbed a region: keep growing it
    } else {
      drag.id = nextId++;
      colors.set(drag.id, pickColor(neighbourColorsOf(i)));
      owner[i] = drag.id;
      drag.path.push(i);
    }
    return;
  }
  if (owner[i] === drag.id) {                   // dragging back = take it back
    const p = drag.path;
    if (p.length >= 2 && p[p.length - 2] === i) owner[p.pop()] = -1;
    return;
  }
  if (!nbOf(i).some(n => owner[n] === drag.id)) return;   // regions stay connected
  const prev = owner[i];
  owner[i] = drag.id;
  drag.path.push(i);
  if (prev !== -1) repair(prev);
}

function eraseCell(i) {
  const id = owner[i];
  if (id === -1) return;
  owner[i] = -1;
  repair(id);
}

/* ------------------------------------------------------------------- input */

/* A collapsed board (hidden tab, a reflow, css that never arrived) has zero width,
   and dividing by that yields NaN - which slips through every range check, because
   comparisons against NaN are all false. Refuse anything that is not a real tile. */
function cellAt(ev) {
  const r = el.board.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return -1;
  const x = Math.floor((ev.clientX - r.left) / (r.width / P.W));
  const y = Math.floor((ev.clientY - r.top) / (r.height / P.H));
  if (!(x >= 0 && y >= 0 && x < P.W && y < P.H)) return -1;
  return y * P.W + x;
}

/* fast drags skip tiles - walk the gap so the stroke stays unbroken */
function walk(a, b) {
  const out = [];
  if (!isCell(a) || !isCell(b)) return out;
  let x = a % P.W, y = (a / P.W) | 0;
  const tx = b % P.W, ty = (b / P.W) | 0;
  let guard = P.W + P.H + 2;                   // a 4-connected walk can never
  while ((x !== tx || y !== ty) && guard-- > 0) {   // take more steps than this
    if (Math.abs(tx - x) >= Math.abs(ty - y)) x += Math.sign(tx - x);
    else y += Math.sign(ty - y);
    out.push(y * P.W + x);
  }
  return out;
}

const isCell = i => Number.isInteger(i) && i >= 0 && i < P.N;

function onDown(ev) {
  if (won || lost) return;
  const i = cellAt(ev);
  if (i < 0) return;
  ev.preventDefault();
  const mode = (erasing || ev.button === 2 || ev.shiftKey) ? 'erase' : 'paint';
  if (mode === 'paint' && P.wall[i]) return;
  snapshot();
  startTimer();
  drag = { mode, id: null, path: [], last: i };
  if (mode === 'paint') paintCell(i); else eraseCell(i);
  try { el.board.setPointerCapture(ev.pointerId); } catch (_) {}
  render();
}

function onMove(ev) {
  if (!drag) return;
  const i = cellAt(ev);
  if (i < 0 || i === drag.last) return;
  ev.preventDefault();
  for (const c of walk(drag.last, i)) {
    if (drag.mode === 'paint') paintCell(c); else eraseCell(c);
  }
  drag.last = i;
  render();
}

function onUp() {
  if (!drag) return;
  drag = null;
  const changed = !dropNoOpSnapshot();   // a stroke that changed nothing is free
  if (changed) moves++;
  const st = render();
  if (changed) save();
  checkWin(st);
  if (!won) checkLose();
}

/* returns true when the board is unchanged since the snapshot (which is dropped) */
function dropNoOpSnapshot() {
  const h = undoStack[undoStack.length - 1];
  if (!h || h.owner.length !== owner.length) return false;
  for (let i = 0; i < owner.length; i++) if (h.owner[i] !== owner[i]) return false;
  undoStack.pop();
  return true;
}

el.board.addEventListener('pointerdown', onDown);
el.board.addEventListener('pointermove', onMove);
el.board.addEventListener('pointerup', onUp);
el.board.addEventListener('pointercancel', onUp);
el.board.addEventListener('contextmenu', e => e.preventDefault());
el.board.addEventListener('dragstart', e => e.preventDefault());

/* ------------------------------------------------------------- timer / win */

function startTimer() {
  if (startedAt) return;
  startedAt = Date.now();
  const tick = () => el.timer.textContent = fmtTime(elapsed());
  tick();
  tickId = setInterval(tick, 250);
}

function stopTimer() { clearInterval(tickId); tickId = 0; }
const elapsed = () => elapsedBase + (startedAt ? (Date.now() - startedAt) / 1000 : 0);

/* par is one stroke per region - the cleanest solve there is */
function rate(m) {
  if (m <= par) return 'Perfect';
  if (m <= Math.ceil(par * 1.25)) return 'Great';
  if (m <= Math.ceil(par * 1.6)) return 'Good';
  return 'Solved';
}

function checkWin(st) {
  if (won || st.open === 0 || st.filled !== st.open) return;
  for (const r of st.info.values()) if (!r.done) return;
  won = true;
  stopTimer();

  el.winRating.textContent = rate(moves);
  el.winMoves.textContent = moves;
  const over = moves - par;
  el.winMeta.innerHTML =
    (over <= 0 ? 'par ' + par + ' — nothing wasted' : 'par ' + par + ' · ' + over + ' over') +
    '<br>' + fmtTime(elapsed()) + ' · ' + (P.mode === 'daily' ? dateLabel(new Date()) : 'seed ' + P.seed);
  el.win.classList.remove('hidden');
  buzz([18, 60, 18]);

  recordWin();
  clearSave();
}

function checkLose() {
  if (!challenge() || won || lost || moves < budget) return;
  const st = { info: regionInfo() };
  const solved = [...st.info.values()].every(r => r.done);
  if (solved) return;
  lost = true;
  stopTimer();
  el.loseMeta.innerHTML = 'You used all ' + budget + ' moves.<br>Undo still works if you want to keep going.';
  el.lose.classList.remove('hidden');
}

/* ----------------------------------------------------------------- storage */

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

let settings = Object.assign(
  { diff: 'medium', walls: false, shapes: false, challenge: false },
  LS.get('gf.settings', {}));
let stats = Object.assign({ solved: 0, best: null, days: [] }, LS.get('gf.stats', {}));

const challenge = () => settings.challenge && P && P.mode !== 'daily';
const saveKey = () => [P.mode, P.diff, P.seed, (P.walls ? 'w' : '') + (P.shapes ? 's' : '')].join('/');

function save() {
  if (!P || won) return;
  LS.set('gf.save', {
    key: saveKey(), owner: [...owner], colors: [...colors],
    nextId, moves, elapsed: elapsed(),
  });
}
const clearSave = () => LS.del('gf.save');

function applySave(s) {
  owner = Int16Array.from(s.owner);
  colors = new Map(s.colors);
  nextId = s.nextId;
  moves = s.moves || 0;
  elapsedBase = s.elapsed || 0;
  if (elapsedBase) el.timer.textContent = fmtTime(elapsedBase);
}

/* consecutive days ending today or yesterday */
function streak() {
  const days = stats.days.slice().sort((a, b) => b - a);
  if (!days.length) return 0;
  const today = dateKey(new Date());
  const yest = dateKey(new Date(Date.now() - 864e5));
  if (days[0] !== today && days[0] !== yest) return 0;
  let n = 1, cur = new Date(String(days[0]).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'));
  for (let k = 1; k < days.length; k++) {
    cur = new Date(cur.getTime() - 864e5);
    if (days[k] !== dateKey(cur)) break;
    n++;
  }
  return n;
}

function recordWin() {
  stats.solved++;
  const over = moves - par;
  if (stats.best === null || over < stats.best) stats.best = over;
  if (P.mode === 'daily') {
    const k = dateKey(new Date());
    if (!stats.days.includes(k)) stats.days.push(k);
    stats.days = stats.days.slice(-400);
  }
  LS.set('gf.stats', stats);
  paintMenu();
}

/* ---------------------------------------------------------------------- ui */

function specFromSettings(seed) {
  return { mode: 'free', diff: settings.diff, walls: settings.walls, shapes: settings.shapes, seed };
}

function fresh(seed) {
  settings.challenge = el.optChallenge.checked;
  LS.set('gf.settings', settings);
  newPuzzle(specFromSettings(seed));
  paintMenu();
}

function startDaily() {
  newPuzzle(dailySpec(new Date()));
  paintMenu();
}

/* keep the menu showing what is actually true right now */
function paintMenu() {
  [...el.segDiff.children].forEach(b => b.classList.toggle('on', b.dataset.d === settings.diff));
  el.optWalls.checked = settings.walls;
  el.optShapes.checked = settings.shapes;
  el.optChallenge.checked = settings.challenge;

  const d = dailySpec(new Date());
  el.dailySub.textContent = dateLabel(new Date()) + ' · ' + DIFF_NAME[d.diff] +
    (d.walls || d.shapes ? ' +extras' : '');
  const doneToday = stats.days.includes(dateKey(new Date()));
  el.dailyBadge.textContent = doneToday ? 'solved ✓' : '';
  el.newSub.textContent = DIFF_NAME[settings.diff] +
    (settings.walls ? ' · voids' : '') + (settings.shapes ? ' · shapes' : '') +
    (settings.challenge ? ' · challenge' : '');

  el.statSolved.textContent = stats.solved;
  el.statStreak.textContent = streak();
  el.statBest.textContent = stats.best === null ? '—'
    : (stats.best <= 0 ? 'par' : 'par+' + stats.best);
}

const openSheet = n => { n.classList.remove('hidden'); };
const closeSheet = n => { n.classList.add('hidden'); };

el.btnMenu.addEventListener('click', () => { paintMenu(); openSheet(el.sheet); });
el.miClose.addEventListener('click', () => closeSheet(el.sheet));
el.sheet.addEventListener('click', e => { if (e.target === el.sheet) closeSheet(el.sheet); });
el.btnHelpTop.addEventListener('click', () => openSheet(el.help));
el.miHelp.addEventListener('click', () => { closeSheet(el.sheet); openSheet(el.help); });
el.helpClose.addEventListener('click', () => closeSheet(el.help));
el.help.addEventListener('click', e => { if (e.target === el.help) closeSheet(el.help); });

el.miNew.addEventListener('click', () => { closeSheet(el.sheet); fresh(null); });
el.miDaily.addEventListener('click', () => { closeSheet(el.sheet); startDaily(); });
el.winNext.addEventListener('click', () => P.mode === 'daily' ? startDaily() : fresh(null));
el.loseNew.addEventListener('click', () => fresh(null));
el.loseRetry.addEventListener('click', () => {
  newPuzzle({ mode: P.mode, diff: P.diff, walls: P.walls, shapes: P.shapes, seed: P.seed });
});

el.btnUndo.addEventListener('click', undo);
el.btnClear.addEventListener('click', () => {
  snapshot();
  owner.fill(-1);
  colors.clear();
  doneRegions.clear();
  won = lost = false;
  el.win.classList.add('hidden');
  el.lose.classList.add('hidden');
  dropNoOpSnapshot();          // clearing an empty board is not an undo step
  render();
  save();
});

el.btnErase.addEventListener('click', () => {
  erasing = !erasing;
  el.btnErase.classList.toggle('active', erasing);
  el.board.classList.toggle('erasing', erasing);
});

el.segDiff.addEventListener('click', e => {
  const b = e.target.closest('button[data-d]');
  if (!b) return;
  settings.diff = b.dataset.d;
  LS.set('gf.settings', settings);
  closeSheet(el.sheet);
  fresh(null);
});

/* changing a rule deals a new board - including Challenge, which never applies
   to the daily puzzle (a shared board everyone must be able to finish) */
for (const [node, key] of [[el.optWalls, 'walls'], [el.optShapes, 'shapes'], [el.optChallenge, 'challenge']]) {
  node.addEventListener('change', () => {
    settings[key] = node.checked;
    LS.set('gf.settings', settings);
    closeSheet(el.sheet);
    fresh(null);
  });
}

el.btnSeed.addEventListener('click', () => {
  const v = parseInt(el.inpSeed.value, 10);
  closeSheet(el.sheet);
  fresh(Number.isFinite(v) ? v : null);
});

const shareLink = btn => {
  const url = location.origin + location.pathname + location.hash;
  const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link', url));
  else prompt('Copy this link', url);
};
el.btnShare.addEventListener('click', () => shareLink(el.btnShare));
el.winShare.addEventListener('click', () => shareLink(el.winShare));

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') { closeSheet(el.sheet); closeSheet(el.help); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'n' || e.key === 'N') fresh(null);
  else if (e.key === 'e' || e.key === 'E') el.btnErase.click();
  else if (e.key === 'm' || e.key === 'M') el.btnMenu.click();
});

addEventListener('visibilitychange', () => { if (document.hidden) save(); });

/* --------------------------------------------- share / restore via the hash */

function writeHash() {
  const flags = (P.walls ? 'w' : '') + (P.shapes ? 's' : '');
  const h = '#' + (P.mode === 'daily' ? 'daily/' + P.seed : P.diff + '/' + P.seed + (flags ? '/' + flags : ''));
  if (location.hash !== h) location.replace(h);
}

function readHash() {
  const m = location.hash.slice(1).split('/');
  const seed = parseInt(m[1], 10);
  if (m[0] === 'daily') {
    const spec = dailySpec(new Date());
    return Number.isFinite(seed) && seed === spec.seed ? spec : null;   // yesterday's link -> today's board
  }
  if (!DIFFS[m[0]] || !Number.isFinite(seed)) return null;
  return {
    mode: 'free', diff: m[0], seed,
    walls: (m[2] || '').indexOf('w') >= 0,
    shapes: (m[2] || '').indexOf('s') >= 0,
  };
}

/* opt-in test hook: index.html?debug exposes internals to the test suite */
if (location.search.indexOf('debug') >= 0) {
  window.__gf = {
    get puzzle() { return P; },
    get owner() { return owner; },
    get moves() { return moves; },
    get par() { return par; },
    regionInfo, regionPath, traceLoops, render,
    paintEl: id => paintEls.get(id),
  };
}

/* ---------------------------------------------------------------- start up */

const linked = readHash();
const spec = linked || specFromSettings(null);
if (!linked) {
  // no link: pick up where the last session left off, else deal a fresh board
  const held = LS.get('gf.save', null);
  if (held && held.key) {
    const [mode, diff, seed, flags] = held.key.split('/');
    if (DIFFS[diff]) {
      Object.assign(spec, { mode, diff, seed: +seed, walls: flags.includes('w'), shapes: flags.includes('s') });
    }
  }
}
const held = LS.get('gf.save', null);
newPuzzle(spec, held && held.key === [spec.mode || 'free', spec.diff, spec.seed,
  (spec.walls ? 'w' : '') + (spec.shapes ? 's' : '')].join('/') ? held : null);
paintMenu();

})();
