/**
 * Simulation check — does the live physics agree with the pace model the whole
 * balance report is built on, and does driving skill actually pay in the car?
 * Run with: npm run sim
 */
import { generateTrack } from '../src/game/trackgen.js';
import { resolveStats, STAT_KEYS } from '../src/game/balance.js';
import { estimateLapTime } from '../src/game/pace.js';
import { Vehicle } from '../src/game/vehicle.js';
import { Autopilot } from '../src/game/ai.js';

const lv = (n) => Object.fromEntries(STAT_KEYS.map((k) => [k, n]));

export function runLaps(track, stats, skill, laps = 3, weather = 'clear') {
  const v = new Vehicle(track, stats, { weather });
  const pilot = new Autopilot(track, stats, skill, weather);
  const dt = 1 / 60;
  let time = 0, lineErr = 0, frames = 0;
  while (time < 600 && v.lap <= laps) {
    v.update(dt, pilot.control(v, dt), (time += dt));
    const half = track.samples[v.index].width * 0.5;
    if (Math.abs(v.lateral ?? 0) > half) lineErr++;
    frames++;
  }
  const times = v.lapTimes.map((l) => l.time);
  return {
    lap: times.length ? Math.min(...times) : NaN,
    walls: v.telemetry.wallHits,
    off: v.telemetry.offTrackTime,
    drift: v.telemetry.driftSeconds,
    top: v.telemetry.topSpeed * 3.6,
    line: lineErr / Math.max(1, frames)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = ['t1', 't2', 't3', 't4', 't5', 't6'];
  console.log('=== simulation vs pace model ===\n');
  console.log('track            skill   sim lap   model lap   delta   walls  off-track  drift  top  off%');
  let lowSum = 0, highSum = 0;
  for (const seed of seeds) {
    const t = generateTrack(seed, { weather: 'clear' });
    const stats = resolveStats(lv(3));
    const out = {};
    for (const skill of [0.35, 0.95]) {
      const r = runLaps(t, stats, skill);
      out[skill] = r;
      const model = estimateLapTime(t, stats, 'clear', skill);
      console.log(
        t.name.padEnd(16), skill.toFixed(2),
        String(r.lap.toFixed(1)).padStart(8) + 's',
        String(model.toFixed(1)).padStart(9) + 's',
        String(((r.lap / model - 1) * 100).toFixed(0)).padStart(6) + '%',
        String(r.walls).padStart(6), String(r.off.toFixed(1) + 's').padStart(9),
        String(r.drift.toFixed(1) + 's').padStart(7), String(r.top.toFixed(0)).padStart(4),
        (r.line * 100).toFixed(0).padStart(4) + '%');
    }
    lowSum += out[0.35].lap; highSum += out[0.95].lap;
  }
  const gain = (lowSum - highSum) / lowSum;
  console.log('\nskill gain measured IN THE SIMULATOR:', (gain * 100).toFixed(1) + '%');
  console.log('(the pace model claims 34% — the car has to actually deliver it)');
}
