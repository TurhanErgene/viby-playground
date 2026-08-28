/**
 * What is the drift-boost economy actually worth? Measures a 400m corner-exit
 * run from 20 m/s under each kind of boost. The BOOST constant in pace.js is
 * derived from these numbers rather than guessed.
 *   npm run boost
 */
import { resolveStats, STAT_KEYS, SKILL } from '../src/game/balance.js';
import { Vehicle } from '../src/game/vehicle.js';

const lv = (n) => Object.fromEntries(STAT_KEYS.map((k) => [k, n]));
const stats = resolveStats(lv(3));
const N = 600, sp = 4, samples = [];
for (let i = 0; i < N; i++) {
  samples.push({ x: i * sp, z: 0, y: 0, s: i * sp, tx: 1, tz: 0, nx: 0, nz: 1,
    curv: 0, grade: 0, width: 24, bank: 0, surface: 'asphalt' });
}
const track = { samples, length: N * sp, spacing: sp, weather: 'clear', metrics: {}, jumps: [] };

function run(mode) {
  const v = new Vehicle(track, stats, { weather: 'clear' });
  v.x = 0; v.z = 0; v.yaw = 0; v.vf = 20; v.vl = 0; v.index = 0;
  if (mode.tier) {
    v.boostForce = SKILL.tierForce[mode.tier];
    v.boostTimer = SKILL.tierDuration[mode.tier];
    v.fusion = !!mode.fusion;
  }
  const dt = 1 / 120;
  let time = 0;
  while (v.x < 400 && time < 60) { v.update(dt, { throttle: 1, steer: 0, nitro: mode.nitro }, time); time += dt; }
  return time;
}

const base = run({});
const pct = (t) => ((1 - t / base) * 100).toFixed(1) + '% quicker';
console.log('400m corner-exit run from 20 m/s (level 3 car):\n');
console.log('  plain throttle           ', base.toFixed(2) + 's');
for (const tier of [1, 2, 3]) console.log(`  + tier ${tier} drift exit       `, run({ tier }).toFixed(2) + 's  ' + pct(run({ tier })));
console.log('  + nitro only             ', run({ nitro: true }).toFixed(2) + 's  ' + pct(run({ nitro: true })));
const fused = run({ tier: 3, nitro: true, fusion: true });
console.log('  + tier 3 FUSED with nitro', fused.toFixed(2) + 's  ' + pct(fused));
