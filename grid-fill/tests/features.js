/* Daily mode, challenge/lose, and save-resume. Load index.html?debug, eval, await __features(). */
window.__features = async function () {
const R = [], fail = (n, m) => R.push('FAIL  ' + n + ' :: ' + m), pass = n => R.push('ok    ' + n);
const $ = id => document.getElementById(id);
const G = () => window.__gf;
const wait = ms => new Promise(r => setTimeout(r, ms));

const geom = () => {
  const P = G().puzzle, board = $('board'), rect = board.getBoundingClientRect();
  return { P, board, cw: rect.width / P.W, ch: rect.height / P.H, rect };
};
function ev(t, i, buttons) {
  const { P, board, cw, ch, rect } = geom();
  const x = rect.left + ((i % P.W) + .5) * cw, y = rect.top + (((i / P.W) | 0) + .5) * ch;
  (document.elementFromPoint(x, y) || board).dispatchEvent(new PointerEvent(t, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }));
}
const tap = i => { ev('pointerdown', i, 1); ev('pointerup', i, 0); };

/* ---- daily puzzle ------------------------------------------------------ */
$('miDaily').click();
const today = new Date();
const key = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
(location.hash === '#daily/' + key && G().puzzle.mode === 'daily' && G().puzzle.seed === key)
  ? pass('daily puzzle is today\'s seed (' + key + ')')
  : fail('daily', location.hash + ' mode ' + G().puzzle.mode);
($('modeName').textContent === 'Daily') ? pass('header shows the daily label')
  : fail('daily header', $('modeName').textContent);

// the same day must always deal the same board
const first = [...G().puzzle.clue].join(',');
$('miDaily').click();
(first === [...G().puzzle.clue].join(',')) ? pass('daily board is stable within the day')
  : fail('daily stability', 'clues changed');

/* ---- par ---------------------------------------------------------------- */
/* one stroke per region is the floor, but shapes with no path through every tile
   (a T, a plus) need a second stroke, so par sits at or above the region count */
(G().par >= G().puzzle.regionCount && G().par === G().puzzle.par)
  ? pass('par is achievable (' + G().par + ' strokes for ' + G().puzzle.regionCount + ' regions)')
  : fail('par', G().par + ' vs ' + G().puzzle.regionCount + ' regions / P.par ' + G().puzzle.par);

/* ---- save and resume --------------------------------------------------- */
$('btnClear').click();
const free = [...Array(G().puzzle.N).keys()].filter(i => !G().puzzle.wall[i]);
tap(free[0]); tap(free[1]); tap(free[2]);
const held = JSON.parse(localStorage.getItem('gf.save'));
(held && held.moves === 3 && held.owner.filter(v => v !== -1).length === 3)
  ? pass('progress is saved as you play') : fail('save', JSON.stringify(held && held.moves));
(held.key === ['daily', G().puzzle.diff, G().puzzle.seed,
  (G().puzzle.walls ? 'w' : '') + (G().puzzle.shapes ? 's' : '')].join('/'))
  ? pass('save is keyed to the exact board') : fail('save key', held.key);

/* ---- challenge mode ---------------------------------------------------- */
$('optChallenge').checked = true;
$('optChallenge').dispatchEvent(new Event('change', { bubbles: true }));
await wait(30);
const P = G().puzzle;
(P.mode === 'free') ? pass('challenge deals a free board (daily stays no-fail)')
  : fail('challenge', 'still on a ' + P.mode + ' board');
const budget = Math.max(G().par + 4, Math.round(G().par * 1.6));
($('parNote').textContent.trim() === '/ ' + budget)
  ? pass('challenge shows the move budget (' + budget + ')') : fail('budget readout', $('parNote').textContent);

const spare = [...Array(P.N).keys()].filter(i => !P.wall[i]);
for (let k = 0; k < budget && k < spare.length; k++) tap(spare[k]);
(!$('lose').classList.contains('hidden') && G().moves >= budget)
  ? pass('running out of moves ends the run') : fail('lose', 'moves ' + G().moves + ' budget ' + budget);

const lostFirst = !$('lose').classList.contains('hidden');
$('btnUndo').click();
(lostFirst && $('lose').classList.contains('hidden') && G().moves === budget - 1)
  ? pass('undo gives the move back and lifts the loss')
  : fail('undo after loss', 'moves ' + G().moves + ' lostFirst ' + lostFirst);

// put it back the way we found it
$('optChallenge').checked = false;
$('optChallenge').dispatchEvent(new Event('change', { bubbles: true }));
await wait(30);
($('parNote').textContent.indexOf('par') >= 0) ? pass('turning challenge off restores par')
  : fail('par restore', $('parNote').textContent);

return JSON.stringify(R, null, 1);
};
