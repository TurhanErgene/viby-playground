/**
 * Plays whole seasons headlessly with the reference driver, at a few skill
 * levels, and reports how they went. Two jobs:
 *   1. an integration test of career -> race -> payout -> next round
 *   2. evidence that the thesis survives a season, not just a single lap
 *   npm run season
 */
import { Career, SEASON_LENGTH } from '../src/game/career.js';
import { Race, formatTime } from '../src/game/race.js';
import { resolveStats, STAT_KEYS, buildValue } from '../src/game/balance.js';
import { Autopilot } from '../src/game/ai.js';
import { buildFit } from '../src/game/pace.js';

// The career persists to localStorage; in node there isn't one.
if (!globalThis.localStorage) {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
}

const DT = 1 / 60;

function raceOnce(career, skill) {
  const e = career.event;
  const race = new Race(e.track, career.levels, e.grid, { laps: e.laps });
  race.playerValue = career.buildValue;
  const pilot = new Autopilot(e.track, resolveStats(career.levels), skill, e.track.weather);
  let guard = 0;
  while (race.state !== 'over' && guard++ < 60 * 900) {
    race.update(DT, pilot.control(race.player, DT));
  }
  if (!race.result) {
    throw new Error(`race did not finish on ${e.track.name} (${e.track.biomeLabel}, ` +
      `seed ${e.track.seed}): player on lap ${race.player.lap}/${race.laps}, ` +
      `${race.player.kmh.toFixed(0)} km/h, ${race.player.telemetry.wallHits} wall hits`);
  }
  return race.result;
}

/** A plain spending policy: buy the cheapest upgrade the map is asking for. */
function spend(career, strategy) {
  const demand = career.event.track.demand;
  for (let i = 0; i < 40; i++) {
    const affordable = STAT_KEYS.filter((k) => career.canUpgrade(k));
    if (!affordable.length) break;
    let pick;
    if (strategy === 'chase') {
      // Buy for the map in front of you — but you only see part of the forecast.
      // Falls back to the cheapest upgrade so this spends the SAME money as
      // 'spread'; otherwise the comparison measures thrift, not allocation.
      const visible = new Set(career.forecast().tags.map((t) => t.key));
      const wanted = affordable.filter((k) => visible.has(k));
      pick = wanted.length
        ? wanted[0]
        : affordable.sort((a, b) => career.levels[a] - career.levels[b])[0];
    } else {
      // Spread evenly: never the best car for a map, never the worst.
      pick = affordable.sort((a, b) => career.levels[a] - career.levels[b])[0];
    }
    // Keep a reserve rather than spending to zero every round.
    if (career.credits < 2500) break;
    career.upgrade(pick);
  }
}

function playSeason(seed, skill, strategy) {
  const career = new Career(seed);
  let fitSum = 0;
  while (!career.finished) {
    spend(career, strategy);
    fitSum += buildFit(career.event.track, career.levels);
    const result = raceOnce(career, skill);
    career.completeEvent(result);
  }
  const wins = career.history.filter((h) => h.position === 1).length;
  const podiums = career.history.filter((h) => h.position <= 3).length;
  return {
    points: career.points, wins, podiums,
    earned: career.history.reduce((a, h) => a + h.credits, 0),
    value: career.buildValue,
    fit: fitSum / SEASON_LENGTH,
    avgPos: career.history.reduce((a, h) => a + h.position, 0) / career.history.length
  };
}

const seeds = ['s1', 's2', 's3'];
console.log('=== full seasons, played by the reference driver ===\n');
console.log('driver          strategy   pts  wins  podiums  avg pos    earned  car value   fit');
const rows = [];
for (const [label, skill] of [['sloppy (0.35)', 0.35], ['decent (0.65)', 0.65], ['sharp (0.90)', 0.90]]) {
  for (const strategy of ['spread', 'chase']) {
    const runs = seeds.map((s) => playSeason(s, skill, strategy));
    const avg = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    rows.push({ label, skill, strategy, points: avg((r) => r.points) });
    console.log(
      label.padEnd(15), strategy.padEnd(10),
      avg((r) => r.points).toFixed(0).padStart(4),
      avg((r) => r.wins).toFixed(1).padStart(5),
      avg((r) => r.podiums).toFixed(1).padStart(8),
      avg((r) => r.avgPos).toFixed(2).padStart(8),
      Math.round(avg((r) => r.earned)).toLocaleString().padStart(9),
      Math.round(avg((r) => r.value)).toLocaleString().padStart(10),
      (avg((r) => r.fit) * 100).toFixed(0).padStart(5) + '%');
  }
}

const bySkill = (s) => rows.filter((r) => r.skill === s).reduce((a, r) => a + r.points, 0) / 2;
const byStrategy = (st) => rows.filter((r) => r.strategy === st).reduce((a, r) => a + r.points, 0) / 3;
console.log('\npoints from driving better (sloppy -> sharp):',
  (bySkill(0.90) - bySkill(0.35)).toFixed(0));
console.log('points from spending smarter (spread -> chase):',
  (byStrategy('chase') - byStrategy('spread')).toFixed(0));
console.log('\nSkill should be the bigger of the two.');
