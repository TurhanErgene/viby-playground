// pull the pure generator out of game.js and hammer it
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const start = src.indexOf('const SHAPE_NONE');
const end = src.indexOf('/* -------------------------------------------------------------- game state */');
const body = src.slice(start, end);
const make = new Function(body + '\nreturn { generate };');
const { generate } = make();

const DIFFS = {
  easy:   { W: 6,  H: 6,  min: 2, max: 5,  wallRate: .06 },
  medium: { W: 8,  H: 8,  min: 2, max: 7,  wallRate: .07 },
  hard:   { W: 10, H: 10, min: 2, max: 9,  wallRate: .08 },
  expert: { W: 12, H: 12, min: 3, max: 12, wallRate: .09 },
};

let checked = 0, sizes = [], singles = 0, regionsTotal = 0, shapes = 0;
for (const key of Object.keys(DIFFS)) {
  for (const walls of [false, true]) {
    for (const shapesOn of [false, true]) {
      for (let s = 0; s < 60; s++) {
        const cfg = Object.assign({}, DIFFS[key], { useWalls: walls, useShapes: shapesOn });
        const P = generate(cfg, s * 7919 + 13);
        verify(P, key, walls, shapesOn, s);
        checked++;
      }
    }
  }
}
console.log('puzzles verified:', checked);
console.log('regions:', regionsTotal, ' size-1 regions:', singles,
            ' (' + (100 * singles / regionsTotal).toFixed(1) + '%)',
            ' shape clues:', shapes);
console.log('mean region size:', (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2));

function verify(P, key, walls, shapesOn, s) {
  const { W, H, N } = P;
  const tag = `${key} walls=${walls} shapes=${shapesOn} seed#${s}`;
  const nb = i => {
    const x = i % W, y = (i / W) | 0, o = [];
    if (y > 0) o.push(i - W);
    if (y < H - 1) o.push(i + W);
    if (x > 0) o.push(i - 1);
    if (x < W - 1) o.push(i + 1);
    return o;
  };
  // rebuild the intended solution by flood-filling from each clue is not possible;
  // instead check the clue set is consistent: sum(clues) === open cells
  let open = 0;
  const clueCells = [];
  for (let i = 0; i < N; i++) {
    if (!P.wall[i]) open++;
    if (P.clue[i] >= 0) clueCells.push(i);
    if (P.wall[i] && P.clue[i] >= 0) fail(tag, 'clue sitting on a void at ' + i);
  }
  const sum = clueCells.reduce((a, i) => a + P.clue[i], 0);
  if (sum !== open) fail(tag, `clue sum ${sum} != open cells ${open}`);
  if (open === 0) fail(tag, 'no open cells');

  // open area must be one connected piece, else the puzzle can't be finished
  const seen = new Int8Array(N);
  let startI = -1;
  for (let i = 0; i < N; i++) if (!P.wall[i]) { startI = i; break; }
  const q = [startI]; seen[startI] = 1; let count = 1;
  for (let k = 0; k < q.length; k++)
    for (const n of nb(q[k])) if (!P.wall[n] && !seen[n]) { seen[n] = 1; count++; q.push(n); }
  if (count !== open) fail(tag, `open area is split (${count} of ${open})`);

  for (const i of clueCells) {
    sizes.push(P.clue[i]);
    regionsTotal++;
    if (P.clue[i] === 1) singles++;
    if (P.shape[i]) {
      shapes++;
      if (!shapesOn) fail(tag, 'shape clue with shapes disabled');
    }
  }
}

function fail(tag, msg) {
  console.error('FAIL', tag, '-', msg);
  process.exit(1);
}
