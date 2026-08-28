import { generateTrack } from './trackgen.js';
import { makeRng, hashSeed, driverName } from '../core/rng.js';
import { STAT_KEYS, STATS, buildValue, upgradeCost, WEATHER, RACE } from './balance.js';
import { buildFit } from './pace.js';
import { buildGrid } from './race.js';

const SAVE_KEY = 'apex-drift-save-v1';
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export const SEASON_LENGTH = 8;
export const INTEL_COST = 1200;
export const START_CREDITS = 9000;

/**
 * A season of random maps.
 *
 * The strategic gamble lives in the reveal order: you see the biome, the
 * weather and a partial forecast BEFORE the shop closes, and the full demand
 * profile only after. Scouting intel buys certainty, and certainty costs the
 * credits you would otherwise have spent on the car. That is the whole
 * upgrade decision — hedge broadly, or read the forecast and commit.
 */
export class Career {
  constructor(seed = Date.now()) {
    this.seed = String(seed);
    this.round = 0;
    this.credits = START_CREDITS;
    this.points = 0;
    this.levels = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
    this.history = [];
    this.intelBought = false;
    this.rollEvent();
  }

  get buildValue() { return buildValue(this.levels); }
  get finished() { return this.round >= SEASON_LENGTH; }

  /** Deterministic per season+round, so a season can be replayed or shared. */
  rollEvent() {
    if (this.finished) { this.event = null; return; }
    const eventSeed = `${this.seed}:${this.round}`;
    const track = generateTrack(eventSeed);
    const rng = makeRng(hashSeed(eventSeed) ^ 0x9e37);
    const grid = buildGrid(track, this.buildValue, this.round + 1, rng, driverName);
    this.intelBought = false;
    this.event = {
      round: this.round + 1,
      track,
      grid,
      laps: RACE.laps,
      // Only some of what the map wants is public before the shop closes.
      revealed: track.tags.slice(0, 1).map((t) => t.key)
    };
    return this.event;
  }

  /** What the player is allowed to see right now. */
  forecast() {
    const e = this.event;
    if (!e) return null;
    const full = this.intelBought;
    return {
      full,
      biome: e.track.biomeLabel,
      weather: WEATHER[e.track.weather],
      weatherKey: e.track.weather,
      length: e.track.length,
      difficulty: e.track.difficulty,
      jumps: e.track.jumps.length,
      tags: full ? e.track.tags : e.track.tags.filter((t) => e.revealed.includes(t.key)),
      hiddenCount: full ? 0 : e.track.tags.length - e.revealed.length,
      demand: full ? e.track.demand : null,
      surfaces: full ? e.track.metrics.frac : null
    };
  }

  buyIntel() {
    if (this.intelBought || this.credits < INTEL_COST) return false;
    this.credits -= INTEL_COST;
    this.intelBought = true;
    return true;
  }

  canUpgrade(key) {
    const cost = upgradeCost(key, this.levels[key]);
    return cost != null && cost <= this.credits;
  }

  upgrade(key) {
    const cost = upgradeCost(key, this.levels[key]);
    if (cost == null || cost > this.credits) return false;
    this.credits -= cost;
    this.levels[key]++;
    return true;
  }

  /** How well the current car answers this map. Only honest once intel is in. */
  fit() {
    return this.event ? buildFit(this.event.track, this.levels) : 0;
  }

  completeEvent(result) {
    const pts = POINTS[result.position - 1] ?? 0;
    this.points += pts;
    this.credits += result.credits;
    this.history.push({
      round: this.event.round,
      track: this.event.track.name,
      biome: this.event.track.biomeLabel,
      weather: this.event.track.weather,
      position: result.position,
      points: pts,
      credits: result.credits,
      bestLap: result.bestLap,
      tags: this.event.track.tags.map((t) => t.key)
    });
    this.round++;
    this.rollEvent();
    this.save();
    return pts;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        seed: this.seed, round: this.round, credits: this.credits,
        points: this.points, levels: this.levels, history: this.history
      }));
    } catch { /* private browsing, or storage disabled — the season still plays */ }
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const c = new Career(data.seed);
      c.round = data.round ?? 0;
      c.credits = data.credits ?? START_CREDITS;
      c.points = data.points ?? 0;
      c.levels = { ...c.levels, ...(data.levels ?? {}) };
      c.history = data.history ?? [];
      c.rollEvent();
      return c;
    } catch {
      return null;
    }
  }

  static clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}

/** Human-readable grade for a build, shown in the garage. */
export function buildGrade(levels) {
  const total = STAT_KEYS.reduce((a, k) => a + levels[k], 0);
  const max = STAT_KEYS.length * 5;
  const r = total / max;
  if (r >= 0.85) return 'Works';
  if (r >= 0.65) return 'Factory';
  if (r >= 0.45) return 'Privateer';
  if (r >= 0.25) return 'Club';
  return 'Showroom';
}

export { STATS, STAT_KEYS, upgradeCost };
