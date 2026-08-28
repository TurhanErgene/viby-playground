import { Vehicle } from './vehicle.js';
import { Rival } from './ai.js';
import { resolveStats, PAYOUT, RACE, STATS, STAT_KEYS } from './balance.js';
import { estimateLapTime } from './pace.js';

const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export { fmt as formatTime };

export class Race {
  constructor(track, playerLevels, rivalSpecs, opts = {}) {
    this.track = track;
    this.laps = opts.laps ?? RACE.laps;
    this.weather = track.weather;
    this.playerLevels = playerLevels;
    this.events = [];

    const playerStats = resolveStats(playerLevels);
    this.player = new Vehicle(track, playerStats, {
      isPlayer: true, name: opts.playerName ?? 'You',
      color: 0xe8433a, gridIndex: opts.gridIndex ?? rivalSpecs.length,
      weather: track.weather
    });
    this.player.onEvent = (kind, data) => this.events.push({ kind, data, t: this.time });

    this.rivals = rivalSpecs.map((spec, i) => new Rival(track, resolveStats(spec.levels), {
      ...spec, gridIndex: i, weather: track.weather
    }));
    this.entries = [this.player, ...this.rivals];

    this.time = -RACE.countdownSeconds;
    this.state = 'countdown';
    this.finishOrder = [];
  }

  get racing() { return this.state === 'racing'; }

  update(dt, controls) {
    const wasCountdown = this.state === 'countdown';
    this.time += dt;
    if (wasCountdown && this.time >= 0) this.state = 'racing';

    const live = this.state === 'racing' || this.state === 'finished';
    // Before the lights the player can rev but not move.
    const playerCtrl = live ? controls : { ...controls, throttle: 0, brake: 1 };
    if (!this.player.finished) {
      this.player.update(dt, playerCtrl, Math.max(0, this.time));
      if (this.player.lap > this.laps) this.finish(this.player);
    }
    for (const r of this.rivals) {
      if (r.finished) continue;
      r.update(dt, Math.max(0, this.time), live);
      if (r.lap > this.laps) this.finish(r);
    }

    if (this.player.finished && this.state !== 'over') {
      this.state = 'over';
      this.result = this.buildResult();
    }
    return this.state;
  }

  finish(entry) {
    if (entry.finished) return;
    entry.finished = true;
    entry.finishTime = this.time;
    this.finishOrder.push(entry);
  }

  /** Live order: finished cars first, then by distance covered. */
  standings() {
    const dist = (e) => e.lap * this.track.length + (e.progress % this.track.length);
    return [...this.entries].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return dist(b) - dist(a);
    });
  }

  playerPosition() {
    return this.standings().findIndex((e) => e.isPlayer) + 1;
  }

  bestLap(entry) {
    const times = (entry.lapTimes ?? []).map((l) => l.time);
    return times.length ? Math.min(...times) : null;
  }

  /**
   * Payouts. Position matters, but so does how you drove — a slow car driven
   * well still banks credits, which is what keeps a bad map roll from ending
   * a season.
   */
  buildResult() {
    const order = this.standings();
    const position = order.findIndex((e) => e.isPlayer) + 1;
    const t = this.player.telemetry;

    const lines = [];
    const add = (label, amount) => { if (amount > 0) lines.push({ label, amount: Math.round(amount) }); };

    add(`Finished P${position}`, PAYOUT.position[position - 1] ?? PAYOUT.finishFloor);
    add(`Drifting (${t.driftSeconds.toFixed(1)}s)`, t.driftSeconds * PAYOUT.perDriftSecond);
    add(`Clean landings (${t.cleanLandings})`, t.cleanLandings * PAYOUT.perCleanLanding);

    const flawless = (this.player.lapTimes ?? []).filter((l) => l.clean).length;
    add(`Flawless laps (${flawless})`, flawless * PAYOUT.flawlessLap);

    const myBest = this.bestLap(this.player);
    const fieldBest = Math.min(...this.rivals.map((r) => this.bestLap(r) ?? Infinity));
    if (myBest != null && myBest < fieldBest) add('Fastest lap of the race', PAYOUT.bestLapBonus);

    // Beating a richer car is the underdog bonus — this is the thesis paying out.
    const myValue = this.playerValue ?? 0;
    const beaten = order.slice(position).filter((e) => !e.isPlayer && e.buildValue > myValue).length;
    add(`Beat ${beaten} better-funded car${beaten === 1 ? '' : 's'}`, beaten * PAYOUT.underdogPerRankBeaten);

    const credits = lines.reduce((a, l) => a + l.amount, 0);
    return {
      position, credits, lines, order,
      bestLap: myBest,
      telemetry: t,
      totalTime: this.player.finishTime
    };
  }
}

/**
 * Builds a grid that is competitive without being rigged. Rival cars are
 * pegged near the player's own spend so the race is decided by the map roll
 * and by driving, not by a rubber-banded stat wall.
 */
export function buildGrid(track, playerValue, round, rng, nameFor) {
  const specs = [];
  const count = RACE.gridSize - 1;
  // The field develops over the season on its own budget. It is only loosely
  // anchored to the player's spend: enough that races stay close, not so much
  // that upgrading buys you nothing because the grid upgrades with you.
  const fieldBase = 6000 + round * 5200;
  for (let i = 0; i < count; i++) {
    const spread = 0.55 + (i / Math.max(1, count - 1)) * 0.95;
    const budget = Math.max(0, fieldBase * spread * rng.range(0.85, 1.15) + playerValue * 0.3);
    const levels = spendBudget(budget, rng, track);
    specs.push({
      name: nameFor(rng),
      levels,
      buildValue: budget,
      // Rival skill sits in a band a human can actually match or beat.
      skill: Math.min(0.88, 0.42 + round * 0.035 + rng.range(-0.09, 0.09))
    });
  }
  return specs;
}

/** Spends a rival's budget, biased toward what this map rewards. */
function spendBudget(budget, rng, track) {
  const levels = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  let remaining = budget;
  let guard = 0;
  while (remaining > 0 && guard++ < 60) {
    // Weight the pick toward this map's demands, but never perfectly.
    const key = weightedPick(rng, track.demand);
    const cost = COSTS[key][levels[key] + 1];
    if (cost == null || cost > remaining) {
      const affordable = STAT_KEYS.filter((k) => {
        const c = COSTS[k][levels[k] + 1];
        return c != null && c <= remaining;
      });
      if (!affordable.length) break;
      const alt = rng.pick(affordable);
      remaining -= COSTS[alt][levels[alt] + 1];
      levels[alt]++;
      continue;
    }
    remaining -= cost;
    levels[key]++;
  }
  return levels;
}

function weightedPick(rng, demand) {
  // A flat floor keeps rivals from all building the identical car.
  let total = 0;
  for (const k of STAT_KEYS) total += (demand[k] ?? 0) + 0.35;
  let r = rng() * total;
  for (const k of STAT_KEYS) {
    r -= (demand[k] ?? 0) + 0.35;
    if (r <= 0) return k;
  }
  return STAT_KEYS[0];
}

const COSTS = Object.fromEntries(STAT_KEYS.map((k) => [k, STATS[k].cost]));
