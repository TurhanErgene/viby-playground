import * as THREE from 'three';
import { SURFACES } from '../game/surfaces.js';

/**
 * Builds the track ribbon as a single geometry with per-vertex colour, so the
 * surface a corner is made of is readable at a glance while driving. Reading
 * the ground is a skill the game asks for, so it must be visible.
 */
export function buildTrackMesh(track) {
  const group = new THREE.Group();
  const s = track.samples, n = s.length;
  const SHOULDER = 6.5;

  const positions = [], colors = [], indices = [];
  const shoulderCol = new THREE.Color(0x3d3a32);
  const tmp = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const c = s[i];
    const half = c.width * 0.5;
    const bankLift = Math.sin(c.bank);
    const surf = SURFACES[c.surface] ?? SURFACES.asphalt;
    const shade = 0.9 + 0.1 * Math.sin(i * 0.7);

    // `band` names the strip between this lane and the previous one.
    const lanes = [
      [-half - SHOULDER, 'shoulder'],
      [-half, 'shoulder'],
      [-half * 0.5, 'road'],
      [0, 'road'],
      [half * 0.5, 'road'],
      [half, 'road'],
      [half + SHOULDER, 'shoulder']
    ];

    for (let k = 0; k < lanes.length; k++) {
      const [off, band] = lanes[k];
      const outer = k === 0 || k === lanes.length - 1;
      positions.push(c.x + c.nx * off, c.y + bankLift * off - (outer ? 0.45 : 0), c.z + c.nz * off);
      tmp.copy(band === 'shoulder' ? shoulderCol : new THREE.Color(surf.color));
      colors.push(tmp.r * shade, tmp.g * shade, tmp.b * shade);
    }
  }

  const lanesPerRow = 7;
  for (let i = 0; i < n; i++) {
    const a = i * lanesPerRow, b = ((i + 1) % n) * lanesPerRow;
    for (let k = 0; k < lanesPerRow - 1; k++) {
      // Counter-clockwise seen from above, so the road's faces point up. The
      // other winding makes every face point at the ground, and back-face
      // culling then renders the entire road invisible.
      indices.push(a + k, a + k + 1, b + k);
      indices.push(a + k + 1, b + k + 1, b + k);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
  road.receiveShadow = true;
  group.add(road);

  group.add(buildKerbs(track));
  group.add(buildStartLine(track));
  return group;
}

/**
 * Kerbs as their own un-indexed quads. Colouring them inside the road ribbon
 * makes each block bleed into the next, because vertex colours interpolate
 * along the strip — separate quads keep the red/white blocks crisp.
 */
function buildKerbs(track) {
  const s = track.samples, n = s.length;
  const WIDTH = 1.4;
  const positions = [], colors = [];
  const red = new THREE.Color(0xcf3b2d), white = new THREE.Color(0xeef0f2);

  for (let i = 0; i < n; i++) {
    const c = s[i], d = s[(i + 1) % n];
    // Kerbs only matter where a corner is: a straight does not need them.
    if (Math.abs(c.curv) < 0.0035) continue;
    const col = Math.floor(i / 2) % 2 ? red : white;

    for (const side of [-1, 1]) {
      const inner = side * c.width * 0.5, outer = side * (c.width * 0.5 + WIDTH);
      const innerD = side * d.width * 0.5, outerD = side * (d.width * 0.5 + WIDTH);
      const pt = (sample, off) => [
        sample.x + sample.nx * off,
        sample.y + Math.sin(sample.bank) * off + 0.07,
        sample.z + sample.nz * off
      ];
      const p1 = pt(c, inner), p2 = pt(c, outer), p3 = pt(d, outerD), p4 = pt(d, innerD);
      // Wind each side so the quad faces up.
      const quad = side < 0 ? [p1, p2, p3, p1, p3, p4] : [p1, p3, p2, p1, p4, p3];
      for (const v of quad) {
        positions.push(v[0], v[1], v[2]);
        colors.push(col.r, col.g, col.b);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide
  }));
}

function buildStartLine(track) {
  const c = track.samples[0];
  const half = c.width * 0.5;
  const geo = new THREE.PlaneGeometry(c.width, 3);
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#1a1a1a';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -Math.atan2(c.tz, c.tx);
  mesh.position.set(c.x, c.y + 0.06, c.z);
  return mesh;
}

/**
 * Terrain as a heightfield over the track's bounding box. An earlier version
 * extruded a skirt sideways from the track, which tore itself apart wherever
 * the loop doubled back on itself. A grid that samples the nearest bit of road
 * for its height follows the elevation properly and never self-intersects.
 */
export function buildTerrain(track) {
  const s = track.samples;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of s) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  }
  const pad = 320;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

  const RES = 190;
  const dx = (maxX - minX) / RES, dz = (maxZ - minZ) / RES;

  // Every 2nd sample is plenty to find "how high is the road near here".
  const probes = s.filter((_, i) => i % 2 === 0);

  const positions = [], colors = [], indices = [];
  // Held clearly darker than any road surface, so the racing line always
  // reads against the land even on a sand map where the two share a hue.
  const base = new THREE.Color(track.ground).multiplyScalar(0.62);
  const rock = new THREE.Color(track.ground).multiplyScalar(0.34);
  const tmp = new THREE.Color();

  for (let iz = 0; iz <= RES; iz++) {
    for (let ix = 0; ix <= RES; ix++) {
      const x = minX + ix * dx, z = minZ + iz * dz;

      let bestD = Infinity, bestY = 0, bestHalf = 8;
      for (const c of probes) {
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestD) { bestD = d; bestY = c.y; bestHalf = c.width * 0.5; }
      }
      const dist = Math.sqrt(bestD);

      // Flat corridor around the racing surface, then let the land roll away.
      // Without this the hills poke straight up through the road, because a
      // grid cell is wider than the track is.
      const corridor = bestHalf + 22;
      const wild = Math.min(1, Math.max(0, dist - corridor) / 130);

      // A terrain cell spans several metres, so a shallow corridor lets the
      // interpolated surface cross back over the road on any gradient. The
      // road sits on a shallow embankment instead, which is what a real
      // circuit looks like anyway.
      const drop = Math.min(30, Math.max(0, dist - corridor) * 0.07) * wild;
      const lumps = wild *
        (Math.sin(x * 0.0075) * Math.cos(z * 0.0091) * 15 +
         Math.sin(x * 0.021 + z * 0.017) * 5);
      positions.push(x, bestY - 3.2 - drop + lumps, z);

      const steep = Math.min(1, Math.abs(lumps) / 14);
      tmp.copy(base).lerp(rock, steep * 0.75)
        .multiplyScalar(0.82 + 0.18 * Math.sin(ix * 0.9) * Math.cos(iz * 0.7));
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }

  const stride = RES + 1;
  for (let iz = 0; iz < RES; iz++) {
    for (let ix = 0; ix < RES; ix++) {
      const a = iz * stride + ix;
      indices.push(a, a + stride, a + 1);
      indices.push(a + 1, a + stride, a + stride + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/** Marker gates on jump lips — the player needs warning that air is coming. */
export function buildJumpMarkers(track) {
  const g = new THREE.Group();
  for (const jump of track.jumps) {
    const c = track.samples[jump.lip];
    const half = c.width * 0.5;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 3.2, 0.5),
        new THREE.MeshLambertMaterial({ color: 0xffd257 })
      );
      post.position.set(c.x + c.nx * side * half, c.y + 1.6, c.z + c.nz * side * half);
      g.add(post);
    }
  }
  return g;
}

/**
 * Marker posts down both sides. Without something passing the camera at a
 * fixed spacing there is nothing to read speed against, and 190km/h feels
 * identical to 90. Instanced so the cost is one draw call.
 */
export function buildRoadside(track) {
  const s = track.samples, n = s.length;
  const every = Math.max(4, Math.round(26 / track.spacing));
  const count = Math.floor(n / every) * 2;
  const geo = new THREE.BoxGeometry(0.34, 2.0, 0.34);
  const mat = new THREE.MeshLambertMaterial({ color: 0xe9edf2 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();

  let idx = 0;
  for (let i = 0; i < n; i += every) {
    const c = s[i];
    for (const side of [-1, 1]) {
      if (idx >= count) break;
      const off = side * (c.width * 0.5 + 8.4);
      m.makeTranslation(
        c.x + c.nx * off,
        c.y + Math.sin(c.bank) * off + 0.6,
        c.z + c.nz * off
      );
      mesh.setMatrixAt(idx++, m);
    }
  }
  mesh.count = idx;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** A simple readable car: wedge body, cabin, four wheels. */
export function buildCar(color) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.62, 4.3),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 0.62;
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.55, 1.9),
    new THREE.MeshLambertMaterial({ color: 0x16181d })
  );
  cabin.position.set(0, 1.12, -0.25);
  car.add(cabin);

  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 0.12, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x22242b })
  );
  wing.position.set(0, 1.15, 2.0);
  car.add(wing);

  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x121316 });
  car.wheels = [];
  for (const [x, z] of [[-0.95, -1.4], [0.95, -1.4], [-0.95, 1.5], [0.95, 1.5]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.44, z);
    car.add(wheel);
    car.wheels.push(wheel);
  }
  return car;
}
