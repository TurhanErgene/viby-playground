/* solve a board with the same seed the page uses, and emit the strokes that win it */
const fs = require('fs');
const src = fs.readFileSync('game.js', 'utf8');
const body = src.slice(src.indexOf('const SHAPE_NONE'),
                       src.indexOf('/* -------------------------------------------------------------- game state */'));
const { generate } = new Function(body + '\nreturn { generate };')();

const DIFFS = {
  easy:   { W: 6,  H: 6,  min: 2, max: 5,  wallRate: .06 },
  medium: { W: 8,  H: 8,  min: 2, max: 7,  wallRate: .07 },
  hard:   { W: 10, H: 10, min: 2, max: 9,  wallRate: .08 },
  expert: { W: 12, H: 12, min: 3, max: 12, wallRate: .09 },
};

const [diff, seedArg, flags = ''] = process.argv.slice(2);
const cfg = Object.assign({}, DIFFS[diff], {
  useWalls: flags.includes('w'), useShapes: flags.includes('s'),
});
const P = generate(cfg, parseInt(seedArg, 10));
const { W, H, N } = P;
const nb = i => { const x = i % W, y = (i / W) | 0, o = [];
  if (y > 0) o.push(i - W); if (y < H - 1) o.push(i + W);
  if (x > 0) o.push(i - 1); if (x < W - 1) o.push(i + 1); return o; };

const clues = [];
for (let i = 0; i < N; i++) if (P.clue[i] >= 0) clues.push([i, P.clue[i], P.shape[i]]);
const own = new Int16Array(N).fill(-1);
if (!solve(0)) { console.error('unsolvable: ' + diff + '/' + seedArg + '/' + flags); process.exit(1); }
const regions = clues.map((_, r) => { const c = []; for (let i = 0; i < N; i++) if (own[i] === r) c.push(i); return c; });
process.stdout.write(JSON.stringify({ W, H, diff, seed: P.seed, flags, regions }));

function shapeOk(cells, shape) {
  if (!shape) return true;
  const xs = cells.map(i => i % W), ys = cells.map(i => (i / W) | 0);
  const bw = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1;
  const bh = Math.max.apply(null, ys) - Math.min.apply(null, ys) + 1;
  return shape === 2 ? (bw === 1 || bh === 1) : bw * bh === cells.length;
}

function solve(r) {
  if (r === clues.length) return own.every(v => v !== -1 || P.wall[v] === undefined);
  const [start, size, shape] = clues[r];
  if (own[start] !== -1) return false;
  const shapes = [], seenSig = new Set();
  grow([start], new Set([start]));
  for (const cells of shapes) {
    if (!shapeOk(cells, shape)) continue;
    for (const i of cells) own[i] = r;
    if (prune() && solve(r + 1)) return true;
    for (const i of cells) own[i] = -1;
  }
  return false;

  function grow(cells, set) {
    const sig = cells.slice().sort((a, b) => a - b).join(',');
    if (seenSig.has(sig)) return;
    seenSig.add(sig);
    if (cells.length === size) { shapes.push(cells.slice()); return; }
    if (shapes.length > 8000) return;
    const cand = [];
    for (const c of cells) for (const n of nb(c))
      if (own[n] === -1 && !set.has(n) && P.clue[n] < 0 && !P.wall[n] && cand.indexOf(n) < 0) cand.push(n);
    for (const n of cand) { set.add(n); cells.push(n); grow(cells, set); cells.pop(); set.delete(n); }
  }
  function prune() {
    const seen = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      if (own[i] !== -1 || P.wall[i] || seen[i]) continue;
      const q = [i]; seen[i] = 1; let hasClue = false;
      for (let k = 0; k < q.length; k++) {
        if (P.clue[q[k]] >= 0) hasClue = true;
        for (const m of nb(q[k])) if (own[m] === -1 && !P.wall[m] && !seen[m]) { seen[m] = 1; q.push(m); }
      }
      if (!hasClue) return false;
    }
    return true;
  }
}
