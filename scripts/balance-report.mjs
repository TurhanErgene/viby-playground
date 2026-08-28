/**
 * Balance report — verifies the design thesis holds numerically.
 * Run with: npm run balance
 *
 *   skill budget must exceed the stat budget, and the stat budget must exceed
 *   the luck budget, or the game is about money and dice instead of driving.
 */
import { generateTrack } from '../src/game/trackgen.js';
import { estimateLapTime } from '../src/game/pace.js';
import { resolveStats, STAT_KEYS, buildValue, BUDGET } from '../src/game/balance.js';

const lv = (n) => Object.fromEntries(STAT_KEYS.map((k) => [k, n]));
const N = 120;
const tracks = Array.from({ length: N }, (_, i) => generateTrack('report' + i));
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * p)];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// --- STAT: what money buys, on the map you happen to get -------------------
const statGap = tracks.map((t) => {
  const a = estimateLapTime(t, resolveStats(lv(0)), t.weather, 0.8);
  const b = estimateLapTime(t, resolveStats(lv(5)), t.weather, 0.8);
  return (a - b) / a;
});

// --- SKILL: what hands buy, in the same car --------------------------------
const skillGap = tracks.map((t) => {
  const st = resolveStats(lv(3));
  const bad = estimateLapTime(t, st, t.weather, 0.15);
  const good = estimateLapTime(t, st, t.weather, 0.95);
  return (bad - good) / bad;
});

// --- LUCK: the swing from the map roll, for a build you already committed to.
// A specialist and a generalist of near-identical cost, raced across every map:
// the specialist's advantage swings with the roll. That swing IS the luck budget.
const generalist = lv(2);
const swings = [];
for (const key of STAT_KEYS) {
  const specialist = { ...lv(1), [key]: 5 };
  const adv = tracks.map((t) => {
    const g = estimateLapTime(t, resolveStats(generalist), t.weather, 0.8);
    const s = estimateLapTime(t, resolveStats(specialist), t.weather, 0.8);
    return (g - s) / g;
  });
  swings.push(pct(adv, 0.9) - pct(adv, 0.1));
}
const luckSwing = mean(swings);

// --- The thesis duel -------------------------------------------------------
const duel = (skillA, lvA, skillB, lvB) => {
  let wins = 0;
  for (const t of tracks) {
    const a = estimateLapTime(t, resolveStats(lvA), t.weather, skillA);
    const b = estimateLapTime(t, resolveStats(lvB), t.weather, skillB);
    if (a < b) wins++;
  }
  return Math.round((wins / tracks.length) * 100);
};

const row = (name, measured, target) =>
  `${name.padEnd(16)} ${(measured * 100).toFixed(1).padStart(5)}%   target ${(target * 100).toFixed(0)}%   ` +
  (Math.abs(measured - target) < 0.035 ? 'ok' : 'DRIFTED');

console.log('=== APEX DRIFT — balance report (' + N + ' random maps) ===\n');
console.log(row('stat budget', mean(statGap), BUDGET.stat));
console.log(row('skill budget', mean(skillGap), BUDGET.skill));
console.log(row('luck budget', luckSwing, BUDGET.luck));

const ok = mean(skillGap) > mean(statGap) && mean(statGap) > luckSwing;
console.log('\nthesis (skill > stats > luck):', ok ? 'HOLDS' : 'VIOLATED');

console.log('\n--- head to head (% of maps the first driver wins) ---');
console.log('great driver, stock car   vs  poor driver, maxed car :',
  duel(0.92, lv(0), 0.42, lv(5)) + '%');
console.log('great driver, mid car     vs  poor driver, maxed car :',
  duel(0.92, lv(2), 0.42, lv(5)) + '%');
console.log('good driver, wrong build  vs  ok driver, right build :',
  duel(0.85, lv(1), 0.65, lv(3)) + '%');
console.log('equal drivers, +2 levels of car                      :',
  duel(0.75, lv(4), 0.75, lv(2)) + '%');

console.log('\n--- how often each upgrade is what a map is asking for ---');
for (const k of STAT_KEYS) {
  const n = tracks.filter((t) => t.demand[k] >= 0.62).length;
  console.log('  ' + k.padEnd(11) + String(Math.round((n / N) * 100)).padStart(3) + '% of maps');
}
console.log('\nmaxed build cost:', buildValue(lv(5)).toLocaleString(), 'credits');
process.exit(ok ? 0 : 1);
