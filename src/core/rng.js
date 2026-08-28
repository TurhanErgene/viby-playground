/** Deterministic seeded RNG. Same seed -> same map, always. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))];
  next.chance = (p) => next() < p;
  next.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return next;
}

const ADJ = ['Broken', 'Cobalt', 'Hollow', 'Amber', 'Vernal', 'Iron', 'Pale', 'Crimson',
  'Silent', 'Vagrant', 'Salt', 'Grey', 'Long', 'Hidden', 'Wither', 'Bright', 'Old', 'Storm'];
const NOUN = ['Reach', 'Mile', 'Basin', 'Spine', 'Verge', 'Coil', 'Bend', 'Drift', 'Shelf',
  'Loop', 'Gate', 'Run', 'Furrow', 'Crown', 'Ladder', 'Pass', 'Hook', 'Sprawl'];

export function trackName(rng) {
  return `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
}

const DRIVER_FIRST = ['Nara', 'Otto', 'Wren', 'Kess', 'Ilya', 'Dov', 'Suki', 'Marek', 'Ada',
  'Rook', 'Vela', 'Tam', 'Juno', 'Cass', 'Bell', 'Oris', 'Nix', 'Halle'];
const DRIVER_LAST = ['Vance', 'Okoye', 'Idris', 'Sato', 'Brandt', 'Rios', 'Kovac', 'Lund',
  'Ferro', 'Adeyemi', 'Volkov', 'Maren', 'Duval', 'Sorge', 'Nakai', 'Beck'];

export function driverName(rng) {
  return `${rng.pick(DRIVER_FIRST)} ${rng.pick(DRIVER_LAST)}`;
}
