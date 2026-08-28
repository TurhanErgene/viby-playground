import { generateTrack } from '../src/game/trackgen.js';
import { STAT_KEYS } from '../src/game/balance.js';
const N = 500;
const by = Object.fromEntries(STAT_KEYS.map(k => [k, []]));
for (let i = 0; i < N; i++) {
  const t = generateTrack('c' + i);
  for (const k of STAT_KEYS) by[k].push(t.demand[k]);
}
console.log('stat        p25   p50   p75   p90   -> scale for median 0.52');
const out = {};
for (const k of STAT_KEYS) {
  const a = by[k].sort((x, y) => x - y);
  const q = (p) => a[Math.floor(N * p)];
  const scale = 0.52 / Math.max(0.05, q(0.5));
  out[k] = +scale.toFixed(3);
  console.log(k.padEnd(11), q(.25).toFixed(2), ' ', q(.5).toFixed(2), ' ', q(.75).toFixed(2), ' ', q(.9).toFixed(2), '  ->', scale.toFixed(3));
}
console.log('\nCALIB =', JSON.stringify(out));
