/**
 * BALANCE — the single source of truth for the game's design thesis.
 *
 *   "Luck is a strong winning factor but skill is a bigger one."
 *
 * Every number that decides how much a map roll, an upgrade, or a driver's
 * hands are worth lives here so the thesis stays measurable instead of vibes.
 *
 * The three budgets, expressed as lap-time swing on a reference lap:
 *
 *   STAT budget   21%  a maxed car vs. a stock car, averaged over random maps
 *   LUCK budget   10%  the swing a map roll puts on a build you already bought
 *   SKILL budget  34%  clean lines + drift-boost chaining + nitro fusion
 *
 * The ordering is the design: SKILL > STAT > LUCK. The worst possible roll in
 * the wrong car is recoverable by driving well, and no amount of money buys
 * you out of driving badly. Every map is completable by every vehicle — the
 * stats gate the *margin*, never the finish.
 *
 * These are not aspirations: `npm run balance` measures all three off the real
 * pace model across 120 random maps and fails loudly when they drift.
 */

export const BUDGET = Object.freeze({
  stat: 0.21,
  luck: 0.10,
  skill: 0.34
});

/** Upgrade tracks. Level 0..5. `curve(l)` returns a 0..1 normalised value. */
const lerp = (a, b, t) => a + (b - a) * t;
const norm = (level) => Math.max(0, Math.min(1, level / 5));

export const STATS = Object.freeze({
  power: {
    label: 'Powerplant',
    blurb: 'Top speed and pull on long straights.',
    icon: '⚡',
    cost: [0, 900, 1500, 2400, 3800, 6000]
  },
  gearbox: {
    label: 'Gearbox',
    blurb: 'Acceleration out of slow corners and off the line.',
    icon: '⚙',
    cost: [0, 800, 1400, 2200, 3500, 5400]
  },
  grip: {
    label: 'Tyres',
    blurb: 'Lateral bite. Decides how fast a corner can be taken.',
    icon: '◎',
    cost: [0, 1000, 1700, 2700, 4200, 6600]
  },
  brakes: {
    label: 'Brakes',
    blurb: 'Stopping force and stability under trail braking.',
    icon: '■',
    cost: [0, 700, 1200, 2000, 3200, 5000]
  },
  suspension: {
    label: 'Suspension',
    blurb: 'Soaks up broken ground, sand ruts and hard landings.',
    icon: '≈',
    cost: [0, 850, 1450, 2300, 3600, 5600]
  },
  aero: {
    label: 'Aero',
    blurb: 'Downforce at speed and control while airborne.',
    icon: '▲',
    cost: [0, 950, 1600, 2500, 4000, 6200]
  },
  nitro: {
    label: 'Nitro',
    blurb: 'Boost tank size, regen and burn strength.',
    icon: '◆',
    cost: [0, 750, 1300, 2100, 3400, 5200]
  }
});

export const STAT_KEYS = Object.keys(STATS);

/** Physical meaning of each stat level. This is what the simulation reads. */
export function resolveStats(levels) {
  const l = (k) => norm(levels?.[k] ?? 0);
  // Normalised levels are kept on the result: terrain code uses them directly
  // so that a stat's leverage lands where the map asks for it, not everywhere.
  const lv = Object.fromEntries(STAT_KEYS.map((k) => [k, l(k)]));
  return {
    lv,
    // --- Uniform benefits: deliberately narrow. Money must not buy a lap. ---
    topSpeed: lerp(49, 53.5, lv.power),              // m/s (176 -> 193 km/h)
    engineForce: lerp(10600, 11600, lv.power),       // N
    launchForce: lerp(1.0, 1.34, lv.gearbox),        // force multiplier under 20 m/s
    responsiveness: lerp(0.84, 1.0, lv.gearbox),     // throttle -> force ramp
    brakeForce: lerp(16.0, 25.0, lv.brakes),         // m/s^2
    trailBrake: lerp(0.25, 0.85, lv.brakes),         // rotation help while braking
    baseGrip: lerp(1.14, 1.20, lv.grip),             // mu on clean asphalt
    slipRecovery: lerp(0.55, 1.15, lv.grip),         // how fast a slide is caught

    // --- Terrain-specific leverage: wide. This is what a map roll gambles on. ---
    tractionFloor: lerp(0.66, 1.36, lv.grip),        // multiplies low-mu surfaces
    absorption: lerp(0.10, 0.95, lv.suspension),     // broken-ground retention
    landing: lerp(0.22, 0.95, lv.suspension),        // hard-landing retention
    rideHeight: lerp(0.30, 0.62, lv.suspension),
    stoppingBite: lerp(0.72, 1.24, lv.brakes),       // braking on loose/slick ground
    downforce: lerp(0.06, 0.38, lv.aero),            // grip gained with speed^2
    dragCoef: lerp(0.0026, 0.0030, lv.aero),         // aero costs a little top end
    airControl: lerp(0.75, 2.40, lv.airControlSrc ?? lv.aero), // rad/s in the air

    // --- Boost ---
    nitroTank: lerp(1.4, 4.0, lv.nitro),             // seconds
    nitroRegen: lerp(0.10, 0.30, lv.nitro),          // seconds per second
    nitroForce: lerp(4200, 7600, lv.nitro)           // N
  };
}

/** Total credits sunk into a build — used for rival matching and grading. */
export function buildValue(levels) {
  let total = 0;
  for (const k of STAT_KEYS) {
    const lv = levels?.[k] ?? 0;
    for (let i = 1; i <= lv; i++) total += STATS[k].cost[i];
  }
  return total;
}

export function upgradeCost(key, level) {
  const c = STATS[key].cost;
  return level >= c.length - 1 ? null : c[level + 1];
}

/**
 * SKILL — the mechanics that carry the biggest budget.
 * Tuned so a driver who chains drifts and fuses nitro laps ~29% quicker
 * than one who only holds throttle, in the same car.
 */
export const SKILL = Object.freeze({
  driftMinSlip: 0.20,      // rad, ~12deg — below this you're just cornering
  driftPeakSlip: 0.44,     // rad, ~25deg — the sweet spot that charges fastest
  driftMaxSlip: 0.95,      // rad, ~55deg — beyond this you are spinning, charge bleeds
  chargePerSecond: 1.05,   // tiers per second at the peak
  maxTier: 3,
  tierForce: [0, 5200, 7400, 9800],   // N of exit boost per tier
  tierDuration: [0, 1.15, 1.8, 2.5],  // seconds
  fusionMultiplier: 1.35,  // drift exit released while nitro burns
  overcookPenalty: 0.55,   // fraction of charge lost per second past maxSlip
  cleanLandingWindow: 0.22 // rad of pitch error that still counts as clean
});

/** Payouts. A bad car driven well must still earn — that is the whole point. */
export const PAYOUT = Object.freeze({
  position: [12000, 8600, 6400, 4800, 3600, 2800, 2200, 1800],
  finishFloor: 1400,
  perDriftSecond: 95,
  perCleanLanding: 320,
  bestLapBonus: 2200,
  flawlessLap: 1500,          // a lap with no wall contact and no off-track
  underdogPerRankBeaten: 850  // beating a rival whose car is worth more than yours
});

export const RACE = Object.freeze({
  laps: 3,
  gridSize: 6,
  countdownSeconds: 3.2
});

/** Weather is the loudest luck lever: it re-weights which stat is king. */
export const WEATHER = Object.freeze({
  clear:  { label: 'Clear',       gripMul: 1.00, dragMul: 1.00, favours: [],                 tint: 0xbfd4ff },
  rain:   { label: 'Rain',        gripMul: 0.82, dragMul: 1.02, favours: ['grip', 'aero'],   tint: 0x6d7d94 },
  heat:   { label: 'Heat Haze',   gripMul: 0.93, dragMul: 0.96, favours: ['suspension'],     tint: 0xffc98a },
  wind:   { label: 'Crosswind',   gripMul: 0.96, dragMul: 1.05, favours: ['aero', 'power'],  tint: 0xa9c6d8 },
  frost:  { label: 'Frost',       gripMul: 0.76, dragMul: 1.00, favours: ['grip', 'brakes'], tint: 0xd8e9f5 }
});
