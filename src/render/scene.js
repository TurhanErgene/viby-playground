import * as THREE from 'three';
import { buildTrackMesh, buildTerrain, buildJumpMarkers, buildRoadside, buildCar } from './trackmesh.js';
import { WEATHER } from '../game/balance.js';
import { BIOMES } from '../game/trackgen.js';

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.4, 4000);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.trackGroup = null;
    this.cars = new Map();
    this.shake = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loadTrack(track) {
    if (this.trackGroup) {
      this.scene.remove(this.trackGroup);
      this.trackGroup.traverse((o) => { o.geometry?.dispose?.(); });
    }
    this.cars.forEach((c) => this.scene.remove(c));
    this.cars.clear();

    const weather = WEATHER[track.weather] ?? WEATHER.clear;
    const sky = new THREE.Color(BIOMES[track.biome].sky).lerp(new THREE.Color(weather.tint), 0.45);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 260, 1400);

    const group = new THREE.Group();
    group.add(buildTerrain(track));
    group.add(buildTrackMesh(track));
    group.add(buildJumpMarkers(track));
    group.add(buildRoadside(track));
    this.scene.add(group);
    this.trackGroup = group;

    this.scene.remove(...this.scene.children.filter((c) => c.isLight));
    const sun = new THREE.DirectionalLight(0xffffff, weather.gripMul < 0.85 ? 0.75 : 1.15);
    sun.position.set(240, 420, 160);
    this.scene.add(sun);
    // Keep the ground bounce weak: a strong one tints the road with the
    // terrain's own colour and the racing line stops reading against the land.
    this.scene.add(new THREE.HemisphereLight(sky.getHex(), 0x2b2f33, 0.7));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    this.track = track;
  }

  addCar(id, color) {
    const mesh = buildCar(color);
    this.scene.add(mesh);
    this.cars.set(id, mesh);
    return mesh;
  }

  syncCar(id, car) {
    const mesh = this.cars.get(id);
    if (!mesh) return;
    mesh.position.set(car.x, car.y, car.z);
    // Model faces +z; track heading is measured in the x/z plane.
    mesh.rotation.set(car.pitch ?? 0, -(car.yaw ?? 0) + Math.PI / 2, car.roll ?? 0, 'YXZ');
    const spin = (car.speed ?? car.vf ?? 0) * 0.06;
    for (const w of mesh.wheels) w.rotation.x += spin;
  }

  /** Chase camera: pulls back and shakes with speed so pace is felt, not read. */
  follow(car, dt, opts = {}) {
    const speed = Math.abs(car.vf ?? car.speed ?? 0);
    const back = 8.5 + speed * 0.16;
    const height = 3.4 + speed * 0.035;
    const yaw = car.yaw ?? 0;
    // Trail the car's heading, drifting slightly wide when it slides.
    const lag = (car.slip ?? 0) * 0.55 * Math.sign(car.vl ?? 0);
    const target = new THREE.Vector3(
      car.x - Math.cos(yaw + lag) * back,
      car.y + height,
      car.z - Math.sin(yaw + lag) * back
    );
    const ease = opts.snap ? 1 : Math.min(1, dt * 5.5);
    this.camPos.lerp(target, ease);

    const ahead = new THREE.Vector3(
      car.x + Math.cos(yaw) * 14, car.y + 1.6, car.z + Math.sin(yaw) * 14
    );
    this.camLook.lerp(ahead, opts.snap ? 1 : Math.min(1, dt * 7));

    this.shake = Math.max(0, this.shake - dt * 2.4);
    const jitter = this.shake * 0.35 + Math.min(0.22, speed * 0.0022);
    this.camera.position.copy(this.camPos);
    this.camera.position.x += (Math.random() - 0.5) * jitter;
    this.camera.position.y += (Math.random() - 0.5) * jitter;
    this.camera.lookAt(this.camLook);
  }

  /** Orbit for menus and the pre-race flyover. */
  orbit(track, time) {
    const n = track.samples.length;
    const c = track.samples[Math.floor((time * 12) % n)];
    this.camera.position.set(c.x - c.tx * 40, c.y + 26, c.z - c.tz * 40);
    this.camera.lookAt(c.x + c.tx * 30, c.y, c.z + c.tz * 30);
  }

  bump(amount = 1) { this.shake = Math.min(2.2, this.shake + amount); }

  render() { this.renderer.render(this.scene, this.camera); }
}
