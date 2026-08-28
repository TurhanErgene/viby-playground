import { surfaceOf } from './surfaces.js';
import { WEATHER } from './balance.js';

export const MASS = 1200;      // kg
export const G = 9.81;

/**
 * Fastest speed a corner of `radius` can be taken at, solving for the fact
 * that downforce grip itself depends on speed:
 *     v^2 = mu(v) * g * R,   mu(v) = mu0 + df * (v/50)^2
 */
export function cornerLimit(radius, mu0, df) {
  const denom = 1 - (df * G * radius) / 2500;
  const v2 = (mu0 * G * radius) / Math.max(0.25, denom);
  return Math.sqrt(Math.max(1, v2));
}

export function effectiveMu(stats, surfaceId, weatherKey, bank = 0) {
  const surf = surfaceOf(surfaceId);
  const w = WEATHER[weatherKey] ?? WEATHER.clear;
  // Tyres pay off hardest exactly where grip is scarce: the worse the surface,
  // the more of the tyre stat's range applies. On clean asphalt it barely shows.
  const scarcity = Math.max(0, 1 - surf.gripMul) + Math.max(0, 1 - w.gripMul);
  const tyre = 1 + (stats.tractionFloor - 1) * Math.min(1.5, scarcity) * 1.6;
  // Suspension recovers what broken ground takes away.
  const roughLoss = surf.rough * Math.pow(1 - stats.absorption, 1.2) * 0.85;
  const bankAid = 1 + Math.abs(bank) * 0.55;
  return Math.max(0.20, stats.baseGrip * surf.gripMul * w.gripMul * tyre * bankAid - roughLoss);
}

/** Target speed at every sample: corner limits, then braking, then traction. */
export function speedProfile(track, stats, weatherKey = 'clear', skill = 1) {
  const s = track.samples, n = s.length, ds = track.spacing;
  const w = WEATHER[weatherKey] ?? WEATHER.clear;
  const v = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const surf = surfaceOf(s[i].surface);
    const radius = Math.abs(s[i].curv) < 1e-5 ? 1e5 : 1 / Math.abs(s[i].curv);
    const mu = effectiveMu(stats, s[i].surface, weatherKey, s[i].bank);
    const corner = cornerLimit(radius, mu, stats.downforce);
    // Deep surfaces cap outright speed even in a straight line.
    // Deep sand and standing water throttle a soft-sprung car hard, and hardly
    // touch a well-sprung one. Every car still gets through.
    const bog = Math.min(0.48, surf.drag * 0.075 * Math.pow(1 - stats.absorption, 1.15));
    const dragCap = stats.topSpeed * (1 - bog);
    v[i] = Math.min(corner, dragCap, stats.topSpeed);
  }

  const brakeA = stats.brakeForce * (0.65 + 0.35 * skill);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n; k >= 0; k--) {
      const i = k % n, j = (i + 1) % n;
      const bSurf = surfaceOf(s[i].surface);
      // Brakes matter most where the ground will not take them.
      const bite = 1 - (1 - bSurf.gripMul) * (2 - stats.stoppingBite) * 0.9;
      const cap = Math.sqrt(v[j] * v[j] + 2 * brakeA * Math.max(0.3, bite) * ds);
      if (v[i] > cap) v[i] = cap;
    }
    for (let k = 0; k <= n; k++) {
      const i = k % n, h = (i - 1 + n) % n;
      const surf = surfaceOf(s[h].surface);
      const speed = v[h];
      const launch = 1 + (stats.launchForce - 1) * Math.max(0, 1 - speed / 20);
      const force = stats.engineForce * launch * stats.responsiveness;
      const drag = stats.dragCoef * w.dragMul * speed * speed * MASS;
      const roll = (surf.drag * 200) * Math.pow(1 - stats.absorption, 1.1) + 180;
      const grade = -s[h].grade * MASS * G;
      const accel = Math.max(0.4, (force - drag - roll + grade) / MASS);
      const cap = Math.sqrt(Math.max(0, v[h] * v[h] + 2 * accel * ds));
      if (v[i] > cap) v[i] = cap;
    }
  }
  return v;
}

/**
 * How close to the theoretical grip limit a driver actually runs. Nobody drives
 * at 100% of it — a real line needs margin for bumps, banking and surface
 * changes. Measured against the simulator (`npm run sim`): with this margin the
 * pace model and a car actually being driven land within a few percent, which
 * is what keeps rivals beatable and the pre-race prediction honest.
 */
export const paceMargin = (skill) => 0.70 + 0.22 * skill;

/**
 * The skill budget has two parts, and both are measured rather than assumed:
 *
 *   how close to the limit you drive  -> paceMargin() above, 0.70 to 0.92
 *   what boost usage adds on top      -> BOOST, below
 *
 * BOOST is set from a measured run (see scripts/boost-value.mjs): a tier-3
 * drift exit fused with nitro covers a 400m corner exit 19% quicker than plain
 * throttle. A lap is not all corner exits, so 13% is the per-lap share a driver
 * who chains them well actually keeps.
 */
const BOOST = 0.13;

/**
 * Lap time for a car+driver. `skill` is 0..1 and carries the largest budget
 * of the three levers — see BUDGET in balance.js.
 */
export function estimateLapTime(track, stats, weatherKey = 'clear', skill = 1) {
  const v = speedProfile(track, stats, weatherKey, skill);
  const reach = paceMargin(skill);
  let t = 0;
  for (let i = 0; i < v.length; i++) t += track.spacing / Math.max(4, v[i] * reach);

  // Nitro: how many boost-seconds are available, capped by how many places on
  // this map can actually use one. A boost tank is worthless with nowhere to spend it.
  // Boost pads and slow-corner exits are where a tank actually converts.
  const exits = Math.max(1.5, track.metrics.frac.boost * 60 +
    track.metrics.slowCorners * 45 + track.metrics.brakingEvents * 0.35);
  const available = stats.nitroTank + stats.nitroRegen * t;
  const usable = Math.min(available, exits * 1.2) * skill;
  t -= usable * 0.24 * (stats.nitroForce / 6000);

  // Drift-boost chaining and nitro fusion are pure driver output.
  return t * (1 - BOOST * skill);
}

/** How well a build answers what this map is asking for. 0..1. */
export function buildFit(track, levels) {
  let num = 0, den = 0;
  for (const [key, weight] of Object.entries(track.demand)) {
    num += weight * ((levels[key] ?? 0) / 5);
    den += weight;
  }
  return den > 0 ? num / den : 0;
}
