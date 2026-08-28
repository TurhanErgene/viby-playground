import { makeRng, trackName } from '../core/rng.js';
import { SURFACES } from './surfaces.js';
import { WEATHER } from './balance.js';

/**
 * Biomes bias the *shape* of a generated track. They never dictate the
 * demand tags — those get measured off the finished geometry in deriveDemand(),
 * so two "Canyon" maps can want genuinely different cars.
 */
export const BIOMES = {
  speedway: {
    label: 'Speedway', sky: 0x86a9d8, ground: 0x6b7a52, weight: 1.0,
    points: [7, 9], radius: [340, 420], radiusVar: 0.16, corner: 0.35,
    width: [20, 26], bankGain: 5.5, elevation: 7, jumps: [0, 1],
    mix: { asphalt: 0.90, gravel: 0.06, boost: 0.04 }
  },
  canyon: {
    label: 'Canyon', sky: 0xd8a978, ground: 0x8a5a3c, weight: 1.0,
    points: [12, 16], radius: [230, 290], radiusVar: 0.34, corner: 0.85,
    width: [14, 18], bankGain: 3.0, elevation: 26, jumps: [0, 1],
    mix: { asphalt: 0.80, gravel: 0.16, boost: 0.04 }
  },
  dunes: {
    label: 'Dunes', sky: 0xe8c98d, ground: 0xc9a86a, weight: 1.0,
    points: [9, 13], radius: [280, 350], radiusVar: 0.28, corner: 0.55,
    width: [17, 22], bankGain: 2.0, elevation: 34, jumps: [1, 3],
    mix: { asphalt: 0.58, sand: 0.30, gravel: 0.10, boost: 0.02 }
  },
  glacier: {
    label: 'Glacier', sky: 0xcfe4f2, ground: 0xd6e6ee, weight: 1.0,
    points: [9, 13], radius: [290, 360], radiusVar: 0.22, corner: 0.5,
    width: [18, 23], bankGain: 3.5, elevation: 16, jumps: [0, 1],
    mix: { asphalt: 0.62, ice: 0.26, water: 0.08, boost: 0.04 }
  },
  skyway: {
    label: 'Skyway', sky: 0x7f8fd0, ground: 0x3d4358, weight: 0.85,
    points: [10, 14], radius: [270, 340], radiusVar: 0.24, corner: 0.6,
    width: [13, 17], bankGain: 6.5, elevation: 44, jumps: [2, 4],
    mix: { asphalt: 0.92, boost: 0.08 }
  },
  circuit: {
    label: 'Circuit', sky: 0x9fb4c9, ground: 0x4f5a4a, weight: 1.0,
    points: [14, 18], radius: [220, 280], radiusVar: 0.30, corner: 0.95,
    width: [15, 19], bankGain: 4.0, elevation: 12, jumps: [0, 1],
    mix: { asphalt: 0.82, gravel: 0.08, water: 0.04, boost: 0.06 }
  }
};

const SPACING = 4; // metres between samples
const TAU = Math.PI * 2;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function splineLoop(ctrl, per = 24) {
  const n = ctrl.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      out.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  return out;
}

function resample(dense, spacing) {
  const n = dense.length;
  const seg = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = dense[i], b = dense[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    seg.push(d); total += d;
  }
  const count = Math.max(64, Math.round(total / spacing));
  const step = total / count;
  const out = [];
  let i = 0, acc = 0, travelled = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (acc + seg[i] < target && i < n - 1) { acc += seg[i]; i++; }
    const t = seg[i] > 1e-6 ? (target - acc) / seg[i] : 0;
    const a = dense[i], b = dense[(i + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: target });
    travelled = target;
  }
  return { pts: out, length: total, spacing: step };
}

/** Menger curvature, signed by turn direction. */
function curvature(prev, cur, next) {
  const ax = cur.x - prev.x, az = cur.z - prev.z;
  const bx = next.x - cur.x, bz = next.z - cur.z;
  const cross = ax * bz - az * bx;
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  const lc = Math.hypot(next.x - prev.x, next.z - prev.z);
  const denom = la * lb * lc;
  if (denom < 1e-6) return 0;
  return (2 * cross) / denom; // 1/radius, signed
}

function smoothRing(arr, passes = 2) {
  let a = arr.slice();
  const n = a.length;
  for (let p = 0; p < passes; p++) {
    const b = new Array(n);
    for (let i = 0; i < n; i++) {
      b[i] = (a[(i - 1 + n) % n] + 2 * a[i] + a[(i + 1) % n]) / 4;
    }
    a = b;
  }
  return a;
}

function pickWeighted(rng, table) {
  const keys = Object.keys(table);
  let total = 0;
  for (const k of keys) total += table[k].weight ?? 1;
  let r = rng() * total;
  for (const k of keys) {
    r -= table[k].weight ?? 1;
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

function assignSurfaces(rng, samples, biome) {
  const n = samples.length;
  for (const s of samples) s.surface = 'asphalt';
  const entries = Object.entries(biome.mix).filter(([id]) => id !== 'asphalt');
  for (const [id, frac] of entries) {
    let budget = Math.round(n * frac);
    let guard = 0;
    while (budget > 0 && guard++ < 200) {
      const isStrip = id === 'boost';
      const len = isStrip ? rng.int(4, 9) : rng.int(10, Math.max(12, Math.round(n * 0.10)));
      const start = rng.int(0, n - 1);
      for (let k = 0; k < len && budget > 0; k++) {
        const i = (start + k) % n;
        if (samples[i].surface === 'asphalt') { samples[i].surface = id; budget--; }
      }
    }
  }
}

function addJumps(rng, samples, biome, length) {
  const n = samples.length;
  const count = rng.int(biome.jumps[0], biome.jumps[1]);
  const jumps = [];
  const straightIdx = samples
    .map((s, i) => ({ i, k: Math.abs(s.curv) }))
    .filter((o) => o.k < 0.004)
    .map((o) => o.i);
  if (!straightIdx.length) return jumps;
  for (let j = 0; j < count; j++) {
    const lip = straightIdx[rng.int(0, straightIdx.length - 1)];
    if (jumps.some((o) => Math.abs(o.lip - lip) < n * 0.12)) continue;
    const rampLen = rng.int(7, 12);         // samples of approach ramp
    const height = rng.range(2.6, 5.4);
    for (let k = 0; k <= rampLen; k++) {
      const i = (lip - rampLen + k + n) % n;
      const t = k / rampLen;
      samples[i].y += height * (t * t * (3 - 2 * t));
      samples[i].ramp = true;
    }
    samples[lip].jumpLip = true;
    samples[lip].jumpHeight = height;
    jumps.push({ lip, height, rampLen });
  }
  return jumps;
}

/**
 * Read the finished geometry and work out which upgrades this map actually
 * rewards. Nothing here is authored per-biome — it is all measured.
 *
 * Each feature is divided by a REF constant meaning "a lot of this", calibrated
 * against the distribution the generator actually produces (see scripts/geo).
 * That keeps demand scores comparable between stats and honest to the player:
 * a tag only appears when the pace model really pays for that upgrade.
 */
/**
 * Per-stat calibration so that the median random map scores ~0.52 for every
 * upgrade. Without it the raw features are on wildly different scales and a
 * tag like "fast sweepers" would fire on three maps out of four, which tells
 * the player nothing. Re-derive with scripts/calibrate-demand.mjs if the
 * generator's shape changes.
 */
const CALIB = {
  power: 0.615, gearbox: 0.724, grip: 0.852, brakes: 0.642,
  suspension: 2.266, aero: 0.653, nitro: 0.715
};

const REF = {
  straightFrac: 0.55, longestStraight: 450, slowCorner: 0.10, meanCorner: 150,
  slick: 0.30, rough: 0.40, jumps: 2, elevGain: 260, braking: 8, boost: 0.06,
  fastCorner: 0.30
};

function deriveDemand(samples, length, weather) {
  const n = samples.length;
  const radii = samples.map((s) => (Math.abs(s.curv) < 1e-5 ? 1e5 : 1 / Math.abs(s.curv)));
  const straight = radii.filter((r) => r > 300).length / n;

  let best = 0, run = 0;
  for (let i = 0; i < n * 2; i++) {
    if (radii[i % n] > 260) { run += SPACING; best = Math.max(best, run); } else run = 0;
  }
  const longestStraight = Math.min(best, length);

  const cornerRadii = radii.filter((r) => r < 300);
  const meanCorner = cornerRadii.length
    ? cornerRadii.reduce((a, b) => a + b, 0) / cornerRadii.length : 300;
  const minRadius = cornerRadii.length ? Math.min(...cornerRadii) : 300;
  const slowCorners = radii.filter((r) => r < 70).length / n;
  const fastCorners = radii.filter((r) => r >= 90 && r < 260).length / n;

  const frac = {};
  for (const id of Object.keys(SURFACES)) frac[id] = 0;
  for (const s of samples) frac[s.surface]++;
  for (const id of Object.keys(frac)) frac[id] /= n;

  const jumps = samples.filter((s) => s.jumpLip).length;
  let elevGain = 0;
  for (let i = 0; i < n; i++) elevGain += Math.abs(samples[(i + 1) % n].y - samples[i].y);

  let brakingEvents = 0;
  for (let i = 0; i < n; i++) {
    if (radii[i] < 90 && radii[(i - 12 + n) % n] > 240) brakingEvents++;
  }

  const rough = frac.sand * 1.0 + frac.gravel * 0.55;
  const slick = frac.ice * 1.0 + frac.water * 0.6;
  const cap = (x) => Math.min(1.35, x);

  // weight * normalised-feature, then divided by the total weight per stat.
  const mix = {
    power: [[0.55, straight / REF.straightFrac], [0.45, longestStraight / REF.longestStraight]],
    gearbox: [[0.65, slowCorners / REF.slowCorner], [0.35, brakingEvents / REF.braking]],
    grip: [[0.55, (REF.meanCorner / Math.max(30, meanCorner))], [0.45, slick / REF.slick]],
    // Brakes are graded conservatively: on paper they buy little lap time,
    // their real payoff is rotation and not overshooting — see docs/DESIGN.md.
    brakes: [[0.40, brakingEvents / REF.braking], [0.40, slick / REF.slick],
             [0.20, 45 / Math.max(20, minRadius)]],
    suspension: [[0.60, rough / REF.rough], [0.25, jumps / REF.jumps],
                 [0.15, elevGain / REF.elevGain]],
    aero: [[0.45, fastCorners / REF.fastCorner], [0.30, jumps / REF.jumps],
           [0.25, longestStraight / REF.longestStraight]],
    nitro: [[0.55, frac.boost / REF.boost], [0.30, slowCorners / REF.slowCorner],
            [0.15, brakingEvents / REF.braking]]
  };

  const raw = {};
  for (const [key, terms] of Object.entries(mix)) {
    let num = 0, den = 0;
    for (const [w, v] of terms) { num += w * cap(v); den += w; }
    raw[key] = (num / den) * CALIB[key];
  }

  for (const k of (WEATHER[weather]?.favours ?? [])) raw[k] *= 1.35;

  const demand = {};
  for (const k of Object.keys(raw)) demand[k] = Math.max(0, Math.min(1, raw[k]));

  return {
    demand,
    metrics: { straight, longestStraight, meanCorner, minRadius, slowCorners, fastCorners, frac, jumps, elevGain, brakingEvents }
  };
}

const TAG_LABEL = {
  power: 'Long straights',
  gearbox: 'Slow-corner exits',
  grip: 'Grip-limited',
  brakes: 'Heavy braking',
  suspension: 'Broken ground',
  aero: 'Fast sweepers & air',
  nitro: 'Boost-hungry'
};

export function generateTrack(seedInput, opts = {}) {
  const seed = typeof seedInput === 'number' ? seedInput : String(seedInput ?? Date.now());
  const rng = makeRng(seed);
  const biomeKey = opts.biome ?? pickWeighted(rng, BIOMES);
  const biome = BIOMES[biomeKey];
  const weather = opts.weather ?? rng.pick(['clear', 'clear', 'clear', 'rain', 'heat', 'wind', 'frost']);

  // 1. Control loop.
  const nPts = rng.int(biome.points[0], biome.points[1]);
  const baseR = rng.range(biome.radius[0], biome.radius[1]);
  const ctrl = [];
  for (let i = 0; i < nPts; i++) {
    const a = (i / nPts) * TAU + rng.range(-0.12, 0.12) * biome.corner;
    const r = baseR * (1 + rng.range(-biome.radiusVar, biome.radiusVar));
    ctrl.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }

  // 2. Dense spline -> even samples.
  const dense = splineLoop(ctrl, 26);
  const { pts, length } = resample(dense, SPACING);
  const n = pts.length;
  const samples = pts.map((p) => ({ ...p, y: 0 }));

  // 3. Elevation as periodic harmonics so the loop closes seamlessly.
  const harmonics = [];
  for (let k = 1; k <= 4; k++) {
    harmonics.push({ k, amp: (biome.elevation / k) * rng.range(0.45, 1.0), phase: rng() * TAU });
  }
  for (const s of samples) {
    let y = 0;
    for (const h of harmonics) y += h.amp * Math.sin((s.s / length) * TAU * h.k + h.phase);
    s.y = y;
  }

  // 4. Tangents / normals / curvature.
  const recompute = () => {
    for (let i = 0; i < n; i++) {
      const prev = samples[(i - 1 + n) % n], cur = samples[i], next = samples[(i + 1) % n];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      cur.tx = tx / tl; cur.tz = tz / tl;
      cur.nx = -cur.tz; cur.nz = cur.tx;            // left-hand normal
      cur.curv = curvature(prev, cur, next);
      cur.grade = (next.y - prev.y) / (2 * SPACING);
    }
    const sm = smoothRing(samples.map((s) => s.curv), 2);
    for (let i = 0; i < n; i++) samples[i].curv = sm[i];
  };
  recompute();

  // 5. Width + banking follow the shape.
  const widthNoisePhase = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const tight = Math.min(1, Math.abs(s.curv) * 90);
    const base = biome.width[0] + (biome.width[1] - biome.width[0]) *
      (0.5 + 0.5 * Math.sin((s.s / length) * TAU * 3 + widthNoisePhase));
    s.width = base * (1 - 0.22 * tight);
    s.bank = Math.max(-0.30, Math.min(0.30, s.curv * biome.bankGain * 12));
  }

  // 6. Surfaces, then jumps (jumps need curvature, so they come last).
  assignSurfaces(rng, samples, biome);
  // The grid and the run to the first corner are always clean tarmac, so a
  // race never opens on a random patch of sand or a boost strip.
  for (let k = -14; k <= 10; k++) samples[(k + n) % n].surface = 'asphalt';
  const jumps = addJumps(rng, samples, biome, length);
  recompute();

  const { demand, metrics } = deriveDemand(samples, length, weather);

  const tags = Object.entries(demand)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v >= 0.62)
    .slice(0, 3)
    .map(([key, weight]) => ({ key, weight, label: TAG_LABEL[key] }));

  const difficulty = Math.min(1,
    (1 - metrics.straight) * 0.4 +
    (metrics.frac.ice + metrics.frac.sand + metrics.frac.water) * 0.7 +
    Math.min(1, metrics.jumps / 4) * 0.2 +
    (WEATHER[weather].gripMul < 0.9 ? 0.15 : 0));

  return {
    seed, name: opts.name ?? trackName(rng), biome: biomeKey, biomeLabel: biome.label,
    sky: biome.sky, ground: biome.ground, weather,
    samples, length, spacing: SPACING, jumps, demand, metrics, tags, difficulty,
    laps: opts.laps
  };
}

/** Nearest-sample lookup with a progress hint — O(1) in the common case. */
export function locate(track, x, z, hint = 0) {
  const s = track.samples, n = s.length;
  let bestI = hint, bestD = Infinity;
  const span = 42;
  for (let k = -span; k <= span; k++) {
    const i = (hint + k + n * 2) % n;
    const d = (s[i].x - x) ** 2 + (s[i].z - z) ** 2;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  // Fall back to a full scan if we clearly lost the car (respawn, big air).
  if (Math.sqrt(bestD) > span * track.spacing * 0.8) {
    for (let i = 0; i < n; i++) {
      const d = (s[i].x - x) ** 2 + (s[i].z - z) ** 2;
      if (d < bestD) { bestD = d; bestI = i; }
    }
  }
  const cur = s[bestI];
  const lateral = (x - cur.x) * cur.nx + (z - cur.z) * cur.nz;
  const along = (x - cur.x) * cur.tx + (z - cur.z) * cur.tz;
  return { index: bestI, sample: cur, lateral, along, dist: Math.sqrt(bestD) };
}

/** Surface height (with banking) at a point near sample `i`. */
export function surfaceHeight(track, i, lateral) {
  const s = track.samples[i];
  return s.y + Math.sin(s.bank) * lateral;
}
