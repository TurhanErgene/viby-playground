/* in-browser regression suite; paste into javascript_tool on index.html?debug */
const R = [], fail = (n, m) => R.push('FAIL  ' + n + ' :: ' + m), pass = n => R.push('ok    ' + n);
const G = window.__gf;
const P = G.puzzle, W = P.W, H = P.H;
const board = document.getElementById('board');
const rect = board.getBoundingClientRect(), cw = rect.width / W, ch = rect.height / H;
const pt = i => [rect.left + ((i % W) + .5) * cw, rect.top + (((i / W) | 0) + .5) * ch];
const nb = i => { const x = i % W, y = (i / W) | 0, o = [];
  if (y > 0) o.push(i - W); if (y < H - 1) o.push(i + W);
  if (x > 0) o.push(i - 1); if (x < W - 1) o.push(i + 1); return o; };
function ev(t, i, buttons, button) {
  const [x, y] = pt(i), el = document.elementFromPoint(x, y) || board;
  el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: button || 0, buttons }));
}
const stroke = path => { ev('pointerdown', path[0], 1);
  for (let k = 1; k < path.length; k++) ev('pointermove', path[k], 1);
  ev('pointerup', path[path.length - 1], 0); };
const clear = () => document.getElementById('btnClear').click();
const filledCount = () => [...G.owner].filter(v => v !== -1).length;

/* ---- 1. outline geometry matches the tiles it covers -------------------- */
clear();
let geomChecked = 0;
for (let trial = 0; trial < 40; trial++) {
  clear();
  // grow a few random blobs and check each region's rendered path
  for (let b = 0; b < 4; b++) {
    let start = (Math.random() * W * H) | 0;
    if (P.wall[start] || G.owner[start] !== -1) continue;
    const path = [start];
    const len = 2 + ((Math.random() * 8) | 0);
    while (path.length < len) {
      const cand = nb(path[path.length - 1]).filter(n => !P.wall[n] && !path.includes(n));
      if (!cand.length) break;
      path.push(cand[(Math.random() * cand.length) | 0]);
    }
    stroke(path);
  }
  const info = G.regionInfo();
  for (const [id, r] of info) {
    const d = G.regionPath(r.cells);
    if (/NaN|undefined|Infinity/.test(d)) { fail('path well formed', 'region ' + id + ' -> ' + d.slice(0, 80)); continue; }
    const loops = G.traceLoops(r.cells);
    const subpaths = (d.match(/M/g) || []).length;
    if (subpaths !== loops.length) fail('subpath per loop', id + ': ' + subpaths + ' vs ' + loops.length);
    // the drawn outline must sit exactly one gap inside the tiles it covers
    const node = G.paintEl(id);
    if (!node) { fail('path element exists', 'region ' + id); continue; }
    const box = node.getBBox();
    const xs = r.cells.map(i => i % W), ys = r.cells.map(i => (i / W) | 0);
    const PAD = 6.5, Uu = 100;
    const want = { x: Math.min(...xs) * Uu + PAD, y: Math.min(...ys) * Uu + PAD,
                   w: (Math.max(...xs) - Math.min(...xs) + 1) * Uu - 2 * PAD,
                   h: (Math.max(...ys) - Math.min(...ys) + 1) * Uu - 2 * PAD };
    const off = Math.max(Math.abs(box.x - want.x), Math.abs(box.y - want.y),
                         Math.abs(box.width - want.w), Math.abs(box.height - want.h));
    if (off > 1.5) fail('outline bbox', 'region ' + id + ' off by ' + off.toFixed(2));
    geomChecked++;
  }
}
pass('outline geometry (' + geomChecked + ' regions fuzzed)');

/* ---- 2. regions always stay connected ---------------------------------- */
clear();
for (let t = 0; t < 30; t++) {
  const i = (Math.random() * W * H) | 0;
  if (!P.wall[i]) { ev('pointerdown', i, 1); ev('pointermove', (Math.random() * W * H) | 0, 1); ev('pointerup', i, 0); }
}
let broken = 0;
for (const [id, r] of G.regionInfo()) {
  const set = new Set(r.cells), seen = new Set([r.cells[0]]), q = [r.cells[0]];
  for (let k = 0; k < q.length; k++) for (const n of nb(q[k])) if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
  if (seen.size !== r.cells.length) broken++;
}
broken ? fail('regions connected', broken + ' split regions') : pass('regions connected after random drags');

/* ---- 3. erasing the middle releases the orphan piece -------------------- */
clear();
let row = -1;
for (let y = 0; y < H && row < 0; y++) { let ok = true;
  for (let x = 0; x < 6; x++) if (P.wall[y * W + x]) ok = false;
  if (ok) row = y; }
const line = [0, 1, 2, 3, 4, 5].map(x => row * W + x);
stroke(line);
const before = filledCount();
ev('pointerdown', line[2], 2, 2); ev('pointerup', line[2], 0, 2);   // right-drag erase
const after = filledCount();
(before === 6 && after === 3) ? pass('mid-region erase drops the orphan (6 -> 3)')
                             : fail('mid-region erase', before + ' -> ' + after);

/* ---- 4. retraction inside one stroke ----------------------------------- */
clear();
ev('pointerdown', line[0], 1);
for (let k = 1; k < 5; k++) ev('pointermove', line[k], 1);
const peak = filledCount();
ev('pointermove', line[3], 1); ev('pointermove', line[2], 1); ev('pointerup', line[2], 0);
(peak === 5 && filledCount() === 3) ? pass('drag-back retracts (5 -> 3)')
                                    : fail('retraction', peak + ' -> ' + filledCount());

/* ---- 5. a no-op stroke costs no undo ----------------------------------- */
clear();
stroke(line.slice(0, 3));
ev('pointerdown', line[0], 1); ev('pointerup', line[0], 0);
document.getElementById('btnUndo').click();
filledCount() === 0 ? pass('no-op stroke costs no undo') : fail('no-op undo', filledCount() + ' left');

/* ---- 6. stealing tiles from a neighbour -------------------------------- */
clear();
stroke(line.slice(0, 3));
const victim = G.owner[line[0]];
stroke([line[5], line[4], line[3], line[2]]);
(G.owner[line[2]] !== victim && G.owner[line[2]] === G.owner[line[5]])
  ? pass('painting over a region steals the tile') : fail('steal', 'owner ' + G.owner[line[2]]);

/* ---- 7. region validity tracks the clue -------------------------------- */
clear();
const plain = n => !P.wall[n] && P.clue[n] < 0;          // empty, no number of its own
const two = [...Array(W * H).keys()].find(i => P.clue[i] === 2 && nb(i).some(plain));
if (two === undefined) { pass('validity (no 2-clue on this board, skipped)'); }
else {
  stroke([two, nb(two).find(plain)]);
  const r7 = G.regionInfo().get(G.owner[two]);
  (r7.done && !r7.bad && r7.size === 2 && r7.clues === 1)
    ? pass('clue 2 + 2 tiles = solved region')
    : fail('validity', 'size ' + r7.size + ' clues ' + r7.clues + ' done ' + r7.done);

  // one tile too many must flip it to invalid
  const third = nb(two).concat(nb(nb(two).find(plain))).find(n => plain(n) && G.owner[n] === -1);
  if (third !== undefined) {
    stroke([two, third]);
    const r8 = G.regionInfo().get(G.owner[two]);
    (!r8.done && r8.bad) ? pass('overfilled region is flagged invalid')
                         : fail('overfill', 'size ' + r8.size + ' done ' + r8.done + ' bad ' + r8.bad);
  }
}

/* ---- 8. a collapsed board must not hang the tab ------------------------ */
clear();
{
  // force the board to zero size, then poke it: cellAt used to yield NaN, which
  // slipped past every range check and spun walk() forever
  const board = document.getElementById('board');
  const keep = board.style.cssText;
  board.style.cssText = keep + ';position:absolute;width:0;height:0;overflow:hidden';
  const before = filledCount();
  const fire = (t, buttons) => board.dispatchEvent(new PointerEvent(t, { bubbles: true,
    cancelable: true, clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse',
    isPrimary: true, button: 0, buttons }));
  const t0 = Date.now();
  fire('pointerdown', 1); fire('pointermove', 1); fire('pointerup', 0);
  const ms = Date.now() - t0;
  board.style.cssText = keep;
  (ms < 250 && filledCount() === before)
    ? pass('a zero-size board ignores pointers instead of hanging (' + ms + 'ms)')
    : fail('collapsed board', ms + 'ms, filled ' + before + ' -> ' + filledCount());
}

/* ---- 9. two numbers in one region is invalid --------------------------- */
clear();
const pair = [...Array(W * H).keys()].find(i => P.clue[i] >= 0 && nb(i).some(n => P.clue[n] >= 0 && !P.wall[n]));
if (pair === undefined) { pass('two-clue check (none adjacent on this board, skipped)'); }
else {
  stroke([pair, nb(pair).find(n => P.clue[n] >= 0 && !P.wall[n])]);
  const r9 = G.regionInfo().get(G.owner[pair]);
  (r9.clues === 2 && r9.bad && !r9.done) ? pass('two numbers in one region is invalid')
    : fail('two clues', 'clues ' + r9.clues + ' bad ' + r9.bad);
}
clear();

JSON.stringify(R, null, 1)
