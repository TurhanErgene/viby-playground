/* Low-poly meshes for Skip Stone. Everything is built once at load and drawn
 * with a translation/rotation/scale matrix — there is no per-frame geometry
 * work except the handful of particles.
 */
window.Scene = (() => {
  'use strict';
  const { Builder, hex, mixc, rng } = window.Engine;

  const C = {
    water:    hex('#2287b4'),
    waterAlt: hex('#2081ad'),
    sand:     hex('#cdb389'),
    grass:    hex('#4f8f52'),
    grassDry: hex('#6a9a4e'),
    rockFace: hex('#7c828b'),
    tree:     [hex('#2f6b45'), hex('#37784c'), hex('#295f3e'), hex('#43855a')],
    trunk:    hex('#4a3527'),
    stone:    hex('#9aa3ac'),
    stoneTop: hex('#c2ccd4'),
    wood:     hex('#6b4a2f'),
    woodDark: hex('#4a3220'),
    gold:     hex('#ffc44a'),
    gem:      hex('#4fd2ff'),
    foam:     hex('#eaf7ff'),
    peak:     hex('#9db2c6'),
    snow:     hex('#dde9f2'),
  };

  // Bank profile: x-samples across the shore and the height at each, so the
  // valley walls stay cheap (5 quads per row) while still reading as terrain.
  const BANK_X = [24, 29, 36, 46, 60, 78];
  const BANK_H = [-1.2, 0.5, 2.4, 5.5, 9.5, 15];
  const CHUNK = 80;          // metres of valley per scenery chunk
  const ROWS = 16;

  // ------------------------------------------------------------------- water
  function water() {
    const b = new Builder();
    const cell = 4;
    const x0 = -96, x1 = 96, z0 = -52, z1 = 236;
    for (let x = x0; x < x1; x += cell) {
      for (let z = z0; z < z1; z += cell) {
        // Subtle scattered shades. A strict checker at this cell size reads as
        // a printed grid rather than water.
        const n = Math.abs(Math.sin(x * 12.34 + z * 7.77) * 43758.5453) % 1;
        const col = mixc(C.water, C.waterAlt, n);
        b.quad([x, 0, z], [x, 0, z + cell], [x + cell, 0, z + cell], [x + cell, 0, z], col, 1);
      }
    }
    return b;
  }

  // ------------------------------------------------------------------ valley
  function valleyChunk(seed) {
    const b = new Builder();
    const r = rng(seed);

    for (const side of [-1, 1]) {
      // Height deviation is forced to zero at both ends of the chunk, so any
      // two chunk variants meet seamlessly wherever they are placed.
      const h = [];
      for (let i = 0; i <= ROWS; i++) {
        const taper = Math.sin((i / ROWS) * Math.PI);
        h.push(BANK_H.map((base, j) =>
          base + (r() - 0.5) * (j < 2 ? 1.4 : 6) * taper));
      }

      for (let i = 0; i < ROWS; i++) {
        const z0 = (i / ROWS) * CHUNK, z1 = ((i + 1) / ROWS) * CHUNK;
        for (let j = 0; j < BANK_X.length - 1; j++) {
          const xa = BANK_X[j] * side, xb = BANK_X[j + 1] * side;
          const t = j / (BANK_X.length - 1);
          let col = j === 0 ? C.sand : mixc(C.grass, C.grassDry, t * 0.8 + r() * 0.2);
          if (j >= 3 && r() < 0.25) col = mixc(col, C.rockFace, 0.55);
          b.quad(
            [xa, h[i][j], z0], [xa, h[i + 1][j], z1],
            [xb, h[i + 1][j + 1], z1], [xb, h[i][j + 1], z0], col, 0);
        }
      }

      // trees, denser on the mid slope
      for (let k = 0; k < 30; k++) {
        const i = Math.floor(r() * ROWS);
        const j = 1 + Math.floor(r() * 3);
        const z = (i / ROWS) * CHUNK + r() * (CHUNK / ROWS);
        const x = (BANK_X[j] + r() * (BANK_X[j + 1] - BANK_X[j])) * side;
        const y = h[i][j] + (h[i][j + 1] - h[i][j]) * r() - 0.3;
        if (y < 0.2) continue;
        tree(b, x, y, z, 1.5 + r() * 2.4, r);
      }

      // boulders along the waterline
      for (let k = 0; k < 7; k++) {
        const i = Math.floor(r() * ROWS);
        const z = (i / ROWS) * CHUNK + r() * 5;
        const x = (BANK_X[0] + r() * 5) * side;
        rock(b, x, h[i][0] + 0.4, z, 0.5 + r() * 1.3, r);
      }
    }
    return b;
  }

  function tree(b, x, y, z, s, r) {
    const col = C.tree[Math.floor(r() * C.tree.length)];
    const tw = 0.16 * s, th = 0.7 * s;
    // trunk
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * 6.2832, a1 = ((i + 1) / 4) * 6.2832;
      const p0 = [x + Math.cos(a0) * tw, y, z + Math.sin(a0) * tw];
      const p1 = [x + Math.cos(a1) * tw, y, z + Math.sin(a1) * tw];
      b.quad(p0, [p0[0], y + th, p0[2]], [p1[0], y + th, p1[2]], p1, C.trunk, 0);
    }
    // two stacked cones
    for (let tier = 0; tier < 2; tier++) {
      const base = y + th + tier * 0.9 * s;
      const rad = (0.95 - tier * 0.3) * s;
      const top = base + (1.9 - tier * 0.35) * s;
      const shade = tier ? mixc(col, [1, 1, 1], 0.12) : col;
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * 6.2832, a1 = ((i + 1) / 6) * 6.2832;
        b.tri(
          [x, top, z],
          [x + Math.cos(a0) * rad, base, z + Math.sin(a0) * rad],
          [x + Math.cos(a1) * rad, base, z + Math.sin(a1) * rad], shade, 0);
      }
    }
  }

  // Irregular low-poly boulder: an octahedron with jittered vertices.
  function rock(b, x, y, z, s, r) {
    const j = () => (r() - 0.5) * 0.5 * s;
    const top = [x + j(), y + s * (0.8 + r() * 0.4), z + j()];
    const bot = [x + j(), y - s * 0.7, z + j()];
    const ring = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.2832 + r() * 0.3;
      ring.push([x + Math.cos(a) * s * (0.8 + r() * 0.4), y + j() * 0.6, z + Math.sin(a) * s * (0.8 + r() * 0.4)]);
    }
    const col = mixc(C.rockFace, [1, 1, 1], r() * 0.25);
    for (let i = 0; i < 5; i++) {
      const a = ring[i], c = ring[(i + 1) % 5];
      b.tri(top, a, c, col, 0);
      b.tri(bot, c, a, mixc(col, [0, 0, 0], 0.2), 0);
    }
  }

  // --------------------------------------------------------------- backdrop
  function mountains() {
    const b = new Builder();
    const r = rng(99);
    const N = 72, R = 620;
    const h = [];
    for (let i = 0; i < N; i++) {
      h.push(46 + r() * 96 + Math.sin(i * 0.63) * 22 + Math.sin(i * 1.9) * 12);
    }
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 6.2832, a1 = ((i + 1) / N) * 6.2832;
      const h0 = h[i], h1 = h[(i + 1) % N];
      const c0 = Math.cos(a0) * R, s0 = Math.sin(a0) * R;
      const c1 = Math.cos(a1) * R, s1 = Math.sin(a1) * R;
      const col = mixc(C.peak, C.snow, Math.min(1, (Math.max(h0, h1) - 60) / 100) * 0.65);
      b.quad([c0, -30, s0], [c0, h0, s0], [c1, h1, s1], [c1, -30, s1], col, 0);
    }
    return b;
  }

  // ------------------------------------------------------------------- jetty
  function jetty() {
    const b = new Builder();
    const W = 1.4, Z0 = -5, Z1 = 0.7, Y = 1.05;
    // deck planks
    for (let z = Z0; z < Z1; z += 0.7) {
      const shade = ((z * 10) | 0) % 2 ? C.wood : mixc(C.wood, C.woodDark, 0.35);
      b.quad([-W, Y, z], [-W, Y, z + 0.62], [W, Y, z + 0.62], [W, Y, z], shade, 0);
    }
    // sides
    b.quad([-W, Y, Z0], [-W, Y - 0.22, Z0], [-W, Y - 0.22, Z1], [-W, Y, Z1], C.woodDark, 0);
    b.quad([W, Y, Z1], [W, Y - 0.22, Z1], [W, Y - 0.22, Z0], [W, Y, Z0], C.woodDark, 0);
    b.quad([-W, Y, Z1], [-W, Y - 0.22, Z1], [W, Y - 0.22, Z1], [W, Y, Z1], C.woodDark, 0);
    // posts
    for (const z of [Z1 - 0.4, Z0 + 2.2]) {
      for (const sx of [-1, 1]) {
        const px = sx * (W - 0.18), t = 0.13;
        for (let i = 0; i < 4; i++) {
          const a0 = (i / 4) * 6.2832, a1 = ((i + 1) / 4) * 6.2832;
          const q0 = [px + Math.cos(a0) * t, Y, z + Math.sin(a0) * t];
          const q1 = [px + Math.cos(a1) * t, Y, z + Math.sin(a1) * t];
          b.quad(q0, [q0[0], -1.4, q0[2]], [q1[0], -1.4, q1[2]], q1, C.woodDark, 0);
        }
      }
    }
    return b;
  }

  // ------------------------------------------------------------------- stone
  function stone() {
    const b = new Builder();
    const N = 9, R = 0.34, T = 0.055;
    const r = rng(7);
    const ring = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.2832;
      const rad = R * (0.86 + r() * 0.28);
      ring.push([Math.cos(a) * rad, 0, Math.sin(a) * rad]);
    }
    for (let i = 0; i < N; i++) {
      const a = ring[i], c = ring[(i + 1) % N];
      b.tri([0, T, 0], [a[0], T * 0.75, a[2]], [c[0], T * 0.75, c[2]], C.stoneTop, 0);
      b.tri([0, -T, 0], [c[0], -T * 0.75, c[2]], [a[0], -T * 0.75, a[2]], C.stone, 0);
      b.quad([a[0], T * 0.75, a[2]], [a[0], -T * 0.75, a[2]],
             [c[0], -T * 0.75, c[2]], [c[0], T * 0.75, c[2]], C.stone, 0);
    }
    return b;
  }

  // ------------------------------------------------------- rings & particles
  function gate(col) {
    const b = new Builder();
    const MAJ = 14, MIN = 4, R = 1.0, t = 0.11;
    for (let i = 0; i < MAJ; i++) {
      const a0 = (i / MAJ) * 6.2832, a1 = ((i + 1) / MAJ) * 6.2832;
      for (let j = 0; j < MIN; j++) {
        const b0 = (j / MIN) * 6.2832, b1 = ((j + 1) / MIN) * 6.2832;
        const P = (A, B) => [
          Math.cos(A) * (R + Math.cos(B) * t),
          Math.sin(A) * (R + Math.cos(B) * t),
          Math.sin(B) * t,
        ];
        b.quad(P(a0, b0), P(a0, b1), P(a1, b1), P(a1, b0),
               mixc(col, [1, 1, 1], j === 0 ? 0.25 : 0), 0);
      }
    }
    return b;
  }

  // flat annulus that lies on the water for expanding ripples
  function ripple(col) {
    const b = new Builder();
    const N = 22;
    const c = col || C.foam;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 6.2832, a1 = ((i + 1) / N) * 6.2832;
      const P = (a, r) => [Math.cos(a) * r, 0, Math.sin(a) * r];
      b.quad(P(a0, 0.82), P(a0, 1), P(a1, 1), P(a1, 0.82), c, 0);
    }
    return b;
  }

  function droplet() {
    const b = new Builder();
    const t = [0, 0.6, 0], bt = [0, -0.6, 0];
    const ring = [[0.5, 0, 0], [0, 0, 0.5], [-0.5, 0, 0], [0, 0, -0.5]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], c = ring[(i + 1) % 4];
      b.tri(t, a, c, C.foam, 0);
      b.tri(bt, c, a, C.foam, 0);
    }
    return b;
  }

  // Forearm and hand for the first-person view. Built at life size with the
  // stone's resting spot at the local origin and +z pointing down the throw,
  // so a plain yaw rotation places it correctly.
  function hand() {
    const b = new Builder();
    const skin = hex('#c98f63'), skinDark = hex('#a9744e'), sleeve = hex('#39506b');

    const box = (x0, x1, y0, y1, z0, z1, col, colTop) => {
      b.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], colTop || col, 0);
      b.quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], mixc(col, [0, 0, 0], 0.25), 0);
      b.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], col, 0);
      b.quad([x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], mixc(col, [0, 0, 0], 0.12), 0);
      b.quad([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], colTop || col, 0);
    };

    box(-0.062, 0.062, -0.058, 0.058, -0.95, -0.30, sleeve);          // forearm
    box(-0.052, 0.052, -0.040, 0.040, -0.30, -0.05, skin, mixc(skin, [1, 1, 1], 0.12));
    box(0.03, 0.075, -0.030, 0.022, -0.16, -0.02, skinDark);          // thumb
    return b;
  }

  return { C, water, hand, valleyChunk, mountains, jetty, stone, gate, ripple, droplet, CHUNK };
})();
