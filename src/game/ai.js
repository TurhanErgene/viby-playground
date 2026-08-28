import { speedProfile, paceMargin } from './pace.js';
import { SKILL } from './balance.js';
import { steerLimit } from './vehicle.js';

const SKILL_WINDOW = SKILL.driftPeakSlip * 0.85;
const WHEELBASE = 2.7;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * A control policy that drives a real Vehicle. Used for the attract-mode demo
 * and, more importantly, as the harness that checks the live simulation agrees
 * with the pace model the whole balance report is built on.
 *
 * `skill` (0..1) scales exactly the things a human gets better at: how close to
 * the limit they carry speed, how tidy the line is, and whether they use the
 * drift-boost and nitro at all.
 */
export class Autopilot {
  constructor(track, stats, skill = 0.85, weather = 'clear') {
    this.track = track;
    this.skill = skill;
    this.stats = stats;
    this.brakeDecel = stats.brakeForce;
    this.profile = speedProfile(track, stats, weather, skill);
    this.noisePhase = Math.random() * TAU;
  }

  control(car, dt = 1 / 60) {
    const t = this.track, n = t.samples.length;
    const i = car.index;
    const here = t.samples[i];
    const speed = Math.max(0, car.vf);
    const half = here.width * 0.5;

    // --- steering: pure pursuit ------------------------------------------
    // Aim at a point on the racing line some distance ahead and solve for the
    // curvature that reaches it. One term covers both heading and cross-track
    // error, and unlike a reactive controller it does not lag the corner.
    const Ld = clamp(7 + speed * (0.55 + 0.25 * this.skill), 10, 48);
    const step = Math.max(1, Math.round(Ld / t.spacing));
    const aim = t.samples[(i + step) % n];
    const apex = t.samples[(i + Math.round(step * 1.5)) % n];
    const lineOffset = -Math.sign(apex.curv) * (aim.width * 0.5) * 0.32 * this.skill;
    const tx = aim.x + aim.nx * lineOffset;
    const tz = aim.z + aim.nz * lineOffset;

    const alpha = angleDiff(Math.atan2(tz - car.z, tx - car.x), car.yaw);
    const reach = Math.max(4, Math.hypot(tx - car.x, tz - car.z));
    let curvature = (2 * Math.sin(alpha)) / reach;

    // Weaker drivers wander and react late.
    this.noisePhase += dt * 1.7;
    curvature += Math.sin(this.noisePhase) * (1 - this.skill) * 0.004;

    const steer = clamp(Math.atan(WHEELBASE * curvature) / steerLimit(car.vf), -1, 1);

    // --- speed: braking points -------------------------------------------
    // Scan ahead and take the most demanding corner, allowing for how much
    // speed the brakes can shed before reaching it. Comparing against a single
    // point ahead always brakes too late. And never target the theoretical
    // grip limit — a real line needs margin for bumps, banking and surface
    // changes, so even the best pilot leaves some on the table.
    const push = paceMargin(this.skill);
    const decel = this.brakeDecel * (0.75 + 0.25 * this.skill);
    let target = this.profile[i];
    const horizon = Math.round(clamp((speed * speed) / (2 * decel) / t.spacing, 4, 90));
    for (let k = 1; k <= horizon; k++) {
      const allowed = Math.sqrt(this.profile[(i + k) % n] ** 2 + 2 * decel * k * t.spacing);
      if (allowed < target) target = allowed;
    }
    target *= push;

    let throttle = 0, brake = 0;
    if (speed < target * 0.98) throttle = 1;
    else if (speed > target * 1.08) brake = clamp((speed - target) / 10, 0.2, 1);
    else throttle = 0.5;

    // Running wide? Back out rather than plough into the barrier.
    if (Math.abs(car.lateral ?? 0) > half * 0.95) {
      throttle *= 0.5;
      brake = Math.max(brake, 0.2);
    }

    // The reference pilot drives clean and never provokes a slide. Drifting for
    // boost is a player mechanic: a controller that yanks the handbrake only
    // throws itself at the outside barrier, and it would make this a worse
    // baseline for checking the physics.
    const radius = Math.abs(apex.curv) < 1e-5 ? 1e5 : 1 / Math.abs(apex.curv);
    const nitro = this.skill > 0.35 && speed > 12 && car.nitro > 0.3 &&
      (radius > 150 || car.driftCharge >= 1);

    return {
      throttle, brake, steer, nitro, handbrake: false,
      pitch: car.airborne ? -car.pitch * 2.5 : 0
    };
  }
}

const RIVAL_COLORS = [0x3f7fd8, 0x37b46a, 0xd8a83f, 0xa855c7, 0xe0603f, 0x2fb8c0, 0xc94f7c];

/**
 * Rivals run on the pace model rather than full physics: their lap time is
 * exactly what the balance report predicts for their car and their skill, so
 * the grid stays honest and tunable. They still hunt a racing line, make
 * mistakes, and lose time in the same places a real car would.
 */
export class Rival {
  constructor(track, stats, opts = {}) {
    this.track = track;
    this.stats = stats;
    this.name = opts.name ?? 'Rival';
    this.skill = opts.skill ?? 0.7;
    this.color = opts.color ?? RIVAL_COLORS[(opts.gridIndex ?? 0) % RIVAL_COLORS.length];
    this.gridIndex = opts.gridIndex ?? 0;
    this.buildValue = opts.buildValue ?? 0;
    this.levels = opts.levels ?? null;
    this.profile = speedProfile(track, stats, opts.weather ?? track.weather, this.skill);
    this.margin = paceMargin(this.skill);
    this.isPlayer = false;
    this.reset(this.gridIndex);
  }

  reset(gridIndex = 0) {
    const t = this.track;
    const startIdx = (t.samples.length - 10 - gridIndex * 3) % t.samples.length;
    this.index = startIdx;
    this.progress = 0;
    this.speed = 0;
    this.lap = 0;
    this.lane = ((gridIndex % 2) * 2 - 1) * 0.22;
    this.laneTarget = this.lane;
    this.finished = false;
    this.finishTime = null;
    this.lapTimes = [];
    this.lapStart = 0;
    this.mistakeTimer = 0;
    this.mistakeCooldown = 6 + Math.random() * 10;
    this.startIdx = startIdx;
    this.syncTransform();
  }

  syncTransform() {
    const s = this.track.samples[this.index];
    const off = this.lane * s.width * 0.5;
    this.x = s.x + s.nx * off;
    this.z = s.z + s.nz * off;
    this.y = s.y + Math.sin(s.bank) * off;
    this.yaw = Math.atan2(s.tz, s.tx);
    this.roll = s.bank * 0.6;
    this.sample = s;
  }

  update(dt, raceTime, racing = true) {
    if (this.finished || !racing) { this.syncTransform(); return; }
    const t = this.track, n = t.samples.length;

    // Mistakes are the rival's share of luck: rarer the better the driver.
    this.mistakeCooldown -= dt;
    if (this.mistakeCooldown <= 0) {
      this.mistakeCooldown = 8 + Math.random() * 14;
      if (Math.random() > this.skill) this.mistakeTimer = 0.5 + Math.random() * 1.4;
    }
    const flubbing = this.mistakeTimer > 0;
    if (flubbing) this.mistakeTimer -= dt;

    // Rivals run the same margin a real car needs, so their lap times land
    // where the pace model says and the grid stays beatable.
    const target = this.profile[this.index] * this.margin * (flubbing ? 0.62 : 1);
    // Approach the target speed rather than snapping to it.
    const rate = this.speed < target ? 9 * (0.6 + 0.4 * this.skill) : 16;
    this.speed += clamp(target - this.speed, -rate * dt, rate * dt);

    const advance = this.speed * dt;
    this.progress += advance;
    const stepped = Math.floor(this.progress / t.spacing);
    const newIndex = (this.startIdx + stepped) % n;
    if (newIndex < this.index && this.index > n - 20) {
      this.lapTimes.push({ time: raceTime - this.lapStart, clean: true });
      this.lapStart = raceTime;
      this.lap++;
    }
    this.index = newIndex;

    // Drift toward the apex line, with a little wander for weaker drivers.
    const s = t.samples[this.index];
    this.laneTarget = -Math.sign(s.curv) * 0.45 * this.skill +
      Math.sin(raceTime * 0.7 + this.gridIndex) * (1 - this.skill) * 0.25;
    this.lane += clamp(this.laneTarget - this.lane, -1.4 * dt, 1.4 * dt);
    this.syncTransform();
  }

  get kmh() { return this.speed * 3.6; }
}

export { RIVAL_COLORS };
