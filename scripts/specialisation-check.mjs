/**
 * Does specialising for a map actually pay?
 *
 * The brief this game is built to says winning some maps should depend heavily
 * on specific upgrades. That only holds if a car built for a map beats an
 * evenly-spread car OF THE SAME COST on the maps that want it — and loses on
 * the ones that don't. If hedging wins everywhere, the upgrade gamble is a trap.
 *   npm run spec
 */
import { generateTrack } from '../src/game/trackgen.js';
import { estimateLapTime } from '../src/game/pace.js';
import { resolveStats, STAT_KEYS, buildValue, upgradeCost } from '../src/game/balance.js';
import { buildGrid } from '../src/game/race.js';
import { makeRng, driverName } from '../src/core/rng.js';

const empty = () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));

/** Spread a budget evenly: always raise the lowest track you can afford. */
function balancedBuild(budget) {
  const lv = empty();
  let left = budget;
  for (let i = 0; i < 60; i++) {
    const options = STAT_KEYS
      .filter((k) => { const c = upgradeCost(k, lv[k]); return c != null && c <= left; })
      .sort((a, b) => lv[a] - lv[b]);
    if (!options.length) break;
    left -= upgradeCost(options[0], lv[options[0]]);
    lv[options[0]]++;
  }
  return lv;
}

/** Max the target stat first, then spread whatever is left. */
function specialistBuild(budget, key) {
  const lv = empty();
  let left = budget;
  while (lv[key] < 5) {
    const c = upgradeCost(key, lv[key]);
    if (c == null || c > left) break;
    left -= c; lv[key]++;
  }
  for (let i = 0; i < 60; i++) {
    const options = STAT_KEYS
      .filter((k) => k !== key)
      .filter((k) => { const c = upgradeCost(k, lv[k]); return c != null && c <= left; })
      .sort((a, b) => lv[a] - lv[b]);
    if (!options.length) break;
    left -= upgradeCost(options[0], lv[options[0]]);
    lv[options[0]]++;
  }
  return lv;
}

const BUDGET = 52000;   // roughly a mid-season car
const bal = balancedBuild(BUDGET);
const balStats = resolveStats(bal);

console.log('=== does building for the map pay? ===\n');
console.log(`budget ¢${BUDGET.toLocaleString()} — balanced build costs ` +
  `¢${buildValue(bal).toLocaleString()}: ${JSON.stringify(bal)}\n`);
// Lap-time percentages understate what this means to a player, so the same
// runs are also scored as a finishing position against a real grid.
console.log('specialist   lap time vs balanced          finishing position');
console.log('             wants it     doesn\'t          wants it   doesn\'t');

const N = 300;
const tracks = Array.from({ length: N }, (_, i) => generateTrack('spec' + i));
const grids = tracks.map((t, i) => buildGrid(t, BUDGET, 4, makeRng(i * 7919), driverName));

const place = (t, grid, stats, skill) => {
  const mine = estimateLapTime(t, stats, t.weather, skill);
  return 1 + grid.filter((g) =>
    estimateLapTime(t, resolveStats(g.levels), t.weather, g.skill) < mine).length;
};

let onSum = 0, offSum = 0, onPos = 0, offPos = 0, n = 0;
for (const key of STAT_KEYS) {
  const spec = specialistBuild(BUDGET, key);
  const specStats = resolveStats(spec);
  const on = [], off = [], onP = [], offP = [];
  for (let i = 0; i < N; i++) {
    const t = tracks[i], grid = grids[i];
    const fs = grid.reduce((a, g) => a + g.skill, 0) / grid.length;
    const b = estimateLapTime(t, balStats, t.weather, fs);
    const s = estimateLapTime(t, specStats, t.weather, fs);
    const wants = t.demand[key] >= 0.62;
    (wants ? on : off).push(((b - s) / b) * 100);
    // Position gained over the balanced car on the same map and grid.
    const gain = place(t, grid, balStats, fs) - place(t, grid, specStats, fs);
    (wants ? onP : offP).push(gain);
  }
  const m = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  onSum += m(on); offSum += m(off); onPos += m(onP); offPos += m(offP); n++;
  const sign = (v, u = '%') => (v >= 0 ? '+' : '') + v.toFixed(1) + u;
  console.log(key.padEnd(12),
    sign(m(on)).padStart(7), '    ', sign(m(off)).padStart(6),
    '      ', sign(m(onP), '').padStart(6), '   ', sign(m(offP), '').padStart(6));
}

const on = onSum / n, off = offSum / n;
console.log('\naverage lap time: ' + (on >= 0 ? '+' : '') + on.toFixed(1) +
  '% where the map wants it, ' + (off >= 0 ? '+' : '') + off.toFixed(1) + '% where it does not');
console.log('average places gained over a balanced car: ' +
  (onPos / n >= 0 ? '+' : '') + (onPos / n).toFixed(2) + ' where wanted, ' +
  (offPos / n >= 0 ? '+' : '') + (offPos / n).toFixed(2) + ' elsewhere');
const ok = on > 0 && off < 0;
console.log(ok
  ? '\nSpecialising is a real bet: it wins its maps and loses the rest.'
  : '\nBROKEN: specialising is ' + (on <= 0 ? 'never worth it' : 'free') +
    ' — the gamble is not a gamble.');
process.exit(ok ? 0 : 1);
