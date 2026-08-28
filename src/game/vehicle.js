import { locate, surfaceHeight } from './trackgen.js';
import { surfaceOf } from './surfaces.js';
import { effectiveMu, MASS, G } from './pace.js';
import { SKILL, WEATHER } from './balance.js';

const WHEELBASE = 2.7;
const MAX_STEER = 0.58;      // rad of lock at a crawl (~33 degrees)
const SHOULDER = 6.5;        // metres of drivable run-off before the barrier

/**
 * Steering authority falls off sharply with speed. Without this a car can ask
 * for 24 degrees of lock at 90km/h, which saturates the grip limit on a third
 * of an input and makes the thing dart off the road at the slightest correction.
 * Both the player's car and the AI's controller must agree on this curve.
 */
export const steerLimit = (speed) => MAX_STEER / (1 + Math.abs(speed) * 0.11);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The player's car. Velocity is tracked in the car's own frame, so rotating the
 * heading naturally turns the car and any sideways velocity the tyres cannot
 * kill becomes a slide. That slide is the whole skill system: held in the right
 * window it charges a boost, overcooked it costs you the corner.
 */
export class Vehicle {
  constructor(track, stats, opts = {}) {
    this.track = track;
    this.stats = stats;
    this.weather = opts.weather ?? track.weather ?? 'clear';
    this.isPlayer = opts.isPlayer ?? false;
    this.name = opts.name ?? 'Driver';
    this.color = opts.color ?? 0xd8412f;
    this.reset(opts.gridIndex ?? 0);
  }

  reset(gridIndex = 0) {
    const t = this.track;
    const startIdx = (t.samples.length - 10 - gridIndex * 3) % t.samples.length;
    const s = t.samples[startIdx];
    const lane = ((gridIndex % 2) * 2 - 1) * (s.width * 0.22);
    this.x = s.x + s.nx * lane;
    this.z = s.z + s.nz * lane;
    this.y = s.y;
    this.yaw = Math.atan2(s.tz, s.tx);
    this.vf = 0; this.vl = 0; this.vy = 0;
    this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.airborne = false; this.airTime = 0;
    this.index = startIdx;
    this.lap = 0;
    this.progress = 0;          // continuous distance travelled along the loop
    this.lastGroundY = s.y;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.boostTimer = 0;
    this.boostForce = 0;
    this.fusion = false;
    this.nitro = this.stats.nitroTank;
    this.slip = 0;
    this.sliding = false;
    this.finished = false;
    this.finishTime = null;
    this.lapTimes = [];
    this.lapStart = 0;
    this.telemetry = { driftSeconds: 0, cleanLandings: 0, sloppyLandings: 0, wallHits: 0, offTrackTime: 0, topSpeed: 0 };
    this.lapClean = true;
  }

  get speed() { return Math.hypot(this.vf, this.vl); }
  get kmh() { return this.speed * 3.6; }

  update(dt, ctrl, raceTime) {
    dt = Math.min(dt, 1 / 30);
    const t = this.track;
    const loc = locate(t, this.x, this.z, this.index);
    const prevIndex = this.index;
    this.index = loc.index;
    this.lateral = loc.lateral;

    const half = loc.sample.width * 0.5;
    const over = Math.abs(loc.lateral) - half;
    const onShoulder = over > 0;
    const surfaceId = onShoulder ? 'gravel' : loc.sample.surface;
    const surf = surfaceOf(surfaceId);
    this.surfaceId = surfaceId;

    // --- lap + progress ------------------------------------------------
    const n = t.samples.length;
    let delta = loc.index - prevIndex;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    this.progress += delta * t.spacing;
    if (prevIndex > n - 12 && loc.index < 12 && delta > 0) {
      // The grid sits behind the line, so the first crossing STARTS lap 1
      // rather than completing one.
      if (this.lap >= 1) {
        this.lapTimes.push({ time: raceTime - this.lapStart, clean: this.lapClean });
      }
      this.lapStart = raceTime;
      this.lapClean = true;
      this.lap++;
    }

    // --- vertical: ramps, flight, landings -------------------------------
    const groundY = surfaceHeight(t, loc.index, clamp(loc.lateral, -half, half));
    const climbRate = (groundY - this.lastGroundY) / Math.max(dt, 1e-4);
    this.lastGroundY = groundY;

    if (!this.airborne) {
      // The ground fell away faster than the car can follow -> flight.
      if (climbRate < -22 && this.speed > 13) {
        this.airborne = true;
        this.vy = Math.max(0, this.lastClimb ?? 0) * 0.5;
        this.airTime = 0;
      } else {
        this.y = groundY;
        this.vy = 0;
      }
      this.lastClimb = climbRate;
    }

    if (this.airborne) {
      this.vy -= G * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      // Aero buys authority to level the car out before it lands.
      const target = clamp(-(ctrl.pitch ?? 0), -1, 1) * 0.5;
      this.pitch += clamp(target - this.pitch, -1, 1) * this.stats.airControl * dt;
      if (this.y <= groundY) {
        this.y = groundY;
        this.airborne = false;
        const gradeAngle = Math.atan(loc.sample.grade);
        const error = Math.abs(this.pitch - gradeAngle);
        if (error <= SKILL.cleanLandingWindow) {
          this.telemetry.cleanLandings++;
          this.onEvent?.('clean-landing');
        } else if (this.airTime > 0.25) {
          // A soft-sprung car loses far more here than a well-sprung one.
          const loss = (1 - this.stats.landing) * Math.min(0.55, error * 0.5);
          this.vf *= 1 - loss;
          this.telemetry.sloppyLandings++;
          this.lapClean = false;
          this.onEvent?.('hard-landing');
        }
        this.pitch = 0;
      }
    }

    // --- longitudinal ----------------------------------------------------
    const w = WEATHER[this.weather] ?? WEATHER.clear;
    const speed = this.speed;
    const throttle = clamp(ctrl.throttle ?? 0, 0, 1);
    const brake = clamp(ctrl.brake ?? 0, 0, 1);

    let force = 0;
    if (!this.airborne) {
      const launch = 1 + (this.stats.launchForce - 1) * Math.max(0, 1 - Math.abs(this.vf) / 20);
      force += throttle * this.stats.engineForce * launch * this.stats.responsiveness;
      force -= brake * this.stats.brakeForce * MASS *
        clamp(1 - (1 - surf.gripMul) * (2 - this.stats.stoppingBite) * 0.9, 0.3, 1.2);
    }
    force -= this.stats.dragCoef * w.dragMul * this.vf * Math.abs(this.vf) * MASS;
    const roll = (surf.drag * 200) * Math.pow(1 - this.stats.absorption, 1.1) + 180;
    force -= Math.sign(this.vf) * roll;
    force -= Math.sin(Math.atan(loc.sample.grade)) * MASS * G;

    // --- boost: drift exits and nitro ------------------------------------
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      force += this.boostForce * (this.fusion ? SKILL.fusionMultiplier : 1);
      if (this.boostTimer <= 0) this.fusion = false;
    }
    const wantsNitro = !!ctrl.nitro && this.nitro > 0;
    if (wantsNitro) {
      this.nitro = Math.max(0, this.nitro - dt);
      force += this.stats.nitroForce;
      this.burning = true;
    } else {
      this.burning = false;
      this.nitro = Math.min(this.stats.nitroTank, this.nitro + this.stats.nitroRegen * dt);
    }

    this.vf += (force / MASS) * dt;
    if (this.vf < -6) this.vf = -6;

    // Top speed is an explicit ceiling, exactly as the pace model treats it —
    // drag alone shapes how quickly you get there. Boost is allowed to breach
    // it, which is why a well-timed drift exit feels like a reward.
    const boosting = this.boostTimer > 0 || this.burning;
    const cap = this.stats.topSpeed * (boosting ? 1.14 : 1) *
      (1 - Math.min(0.48, surf.drag * 0.075 * Math.pow(1 - this.stats.absorption, 1.15)));
    if (this.vf > cap) this.vf += (cap - this.vf) * Math.min(1, dt * 3.5);

    // --- lateral: grip, slide, and the drift window ----------------------
    const mu = effectiveMu(this.stats, surfaceId, this.weather, loc.sample.bank);
    const muG = mu * G;

    if (!this.airborne) {
      const steerMax = steerLimit(this.vf);
      const steer = clamp(ctrl.steer ?? 0, -1, 1) * steerMax;
      const handbrake = ctrl.handbrake ? 1 : 0;

      let desiredYaw = (this.vf * Math.tan(steer)) / WHEELBASE;
      // Trail braking rotates the car; good brakes make that controllable.
      desiredYaw *= 1 + brake * this.stats.trailBrake * 0.55;
      desiredYaw *= 1 + handbrake * 0.85;

      const yawCap = muG / Math.max(6, Math.abs(this.vf)) * (1 + handbrake * 0.9);
      this.yawRate = clamp(desiredYaw, -yawCap * 1.35, yawCap * 1.35);
      this.yaw += this.yawRate * dt;

      // Holding a turn needs lateral acceleration. The tyres supply what they
      // can; only the SHORTFALL becomes sideways velocity, and that shortfall
      // is the drift. Yanking the handbrake cuts the supply on purpose.
      const aReq = this.vf * this.yawRate;
      const supply = muG * (1 - handbrake * 0.55);
      const aTyre = Math.sign(aReq) * Math.min(Math.abs(aReq), supply);
      this.vl -= (aReq - aTyre) * dt;

      // Whatever grip is left over scrubs off a slide already in progress.
      const spare = Math.max(0, supply - Math.abs(aTyre));
      const recover = (spare * this.stats.slipRecovery + 1.5) * (1 - handbrake * 0.7);
      this.vl -= Math.sign(this.vl) * Math.min(Math.abs(this.vl), recover * dt);

      // Frame rotation also feeds a little sideways velocity back into forward.
      this.vf += this.vl * this.yawRate * dt;
      this.roll = clamp(-this.vl * 0.02 + loc.sample.bank * 0.6, -0.4, 0.4);
    } else {
      this.yaw += this.yawRate * dt * 0.35;
      this.vl *= 1 - 0.6 * dt;
    }

    this.slip = Math.abs(Math.atan2(this.vl, Math.max(2, Math.abs(this.vf))));
    this.sliding = this.slip > SKILL.driftMinSlip && speed > 12;
    this.updateDrift(dt, wantsNitro);

    // --- integrate world position ---------------------------------------
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    this.x += (this.vf * cos - this.vl * sin) * dt;
    this.z += (this.vf * sin + this.vl * cos) * dt;

    // --- run-off and barriers --------------------------------------------
    if (!onShoulder) this.touchingWall = false;
    if (onShoulder) {
      this.telemetry.offTrackTime += dt;
      this.lapClean = false;
      if (over > SHOULDER) {
        // Hard barrier: you never lose the car entirely, you lose the lap time.
        const push = over - SHOULDER;
        const dir = Math.sign(loc.lateral);
        this.x -= loc.sample.nx * dir * push;
        this.z -= loc.sample.nz * dir * push;
        this.vl *= -0.25;
        if (!this.touchingWall) {
          // The impact costs real speed — but only once. Scraping along the
          // barrier just scrubs, otherwise a car pinned to a wall stops dead
          // and can never rejoin.
          this.vf *= 0.72;
          this.driftCharge *= 0.4;
          this.telemetry.wallHits++;
          this.onEvent?.('wall');
        } else {
          this.vf *= 1 - 0.55 * dt;
        }
        this.touchingWall = true;
      } else {
        this.touchingWall = false;
      }
    }

    this.telemetry.topSpeed = Math.max(this.telemetry.topSpeed, this.speed);
    return this;
  }

  /**
   * The drift-boost economy. Charge builds fastest at the peak slip angle,
   * bleeds if you spin it past the limit, and pays out when you straighten.
   * Releasing while nitro burns fuses the two for a bigger exit — the highest
   * skill expression in the game, and free to anyone who learns it.
   */
  updateDrift(dt, burningNitro) {
    if (this.airborne) return;
    if (this.slip > SKILL.driftMaxSlip) {
      this.driftCharge = Math.max(0, this.driftCharge - SKILL.overcookPenalty * dt);
      this.overcooking = true;
      return;
    }
    this.overcooking = false;

    if (this.sliding) {
      // Quality peaks at driftPeakSlip and falls off either side.
      const d = (this.slip - SKILL.driftPeakSlip) / SKILL.driftPeakSlip;
      const quality = Math.exp(-d * d * 2.2);
      this.driftCharge = Math.min(SKILL.maxTier,
        this.driftCharge + SKILL.chargePerSecond * quality * dt);
      this.telemetry.driftSeconds += dt * quality;
    } else if (this.driftCharge >= 1) {
      this.releaseDrift(burningNitro);
    } else {
      this.driftCharge = Math.max(0, this.driftCharge - dt * 0.35);
    }
    this.driftTier = Math.floor(this.driftCharge);
  }

  releaseDrift(burningNitro) {
    const tier = Math.min(SKILL.maxTier, Math.floor(this.driftCharge));
    if (tier < 1) return;
    this.boostForce = SKILL.tierForce[tier];
    this.boostTimer = SKILL.tierDuration[tier];
    this.fusion = !!burningNitro;
    // Overflow charge tops the nitro tank back up: chaining drifts feeds boost.
    this.nitro = Math.min(this.stats.nitroTank, this.nitro + tier * 0.22);
    this.driftCharge = 0;
    this.driftTier = 0;
    this.onEvent?.('drift-release', { tier, fusion: this.fusion });
  }
}
