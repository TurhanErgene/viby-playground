/* Skip Stone — low-poly 3D stone skipping.
 * Hold to charge and aim from the thrower's own view, release to throw, then
 * ride the chase camera and tap each time the stone kisses the water.
 */
(() => {
  'use strict';

  const E = window.Engine, S = window.Scene;

  // ---------------------------------------------------------------- constants
  const G = 22;                 // gravity, m/s^2
  const MIN_VY = 1.15;          // below this upward speed the stone sinks
  const MIN_VH = 3.2;           // below this forward speed the stone sinks
  const RING_LEAD = 0.65;       // seconds of warning before the timing ring lands
  const CHARGE_PERIOD = 1.05;   // seconds for the power meter to sweep one way
  const STEER_ACCEL = 17;       // lateral push while dragging, m/s^2

  const UPGRADES = [
    { id: 'flat',  icon: '🪨', name: 'Flat Stone', max: 5, cost: 40,
      blurb: 'A smoother, wider stone. Keeps more speed through every skip.' },
    { id: 'arm',   icon: '💪', name: 'Strong Arm', max: 5, cost: 55,
      blurb: 'Put your shoulder into it. Every throw leaves the hand faster.' },
    { id: 'sense', icon: '👁️', name: "Skipper's Sense", max: 5, cost: 70,
      blurb: 'Time slows at the water. Wider Perfect window, bigger kick.' },
  ];

  const stats = (lv) => ({
    keepH: 0.900 + 0.0130 * lv.flat,
    keepY: 0.500 + 0.0300 * lv.flat,
    throw: 1 + 0.070 * lv.arm,
    window: 0.110 + 0.035 * lv.sense,
    kick: 1.26 + 0.050 * lv.sense,
  });

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const fmt = (m) => `${m.toFixed(m < 100 ? 1 : 0)} m`;
  const el = (id) => document.getElementById(id);

  // --------------------------------------------------------------- save state
  const SAVE_KEY = 'skipstone.save.v2';
  const save = Object.assign(
    { coins: 0, best: 0, lv: { flat: 0, arm: 0, sense: 0 }, throws: 0 },
    (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })()
  );
  const persist = () => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
  };

  // ------------------------------------------------------------------- canvas
  const canvas = el('game');
  const gfx = E.create(canvas);
  if (!gfx) {
    el('titleScreen').innerHTML =
      '<div class="panel"><h2>WebGL unavailable</h2>' +
      '<p class="hint">This game needs WebGL. Try another browser, or turn on ' +
      'hardware acceleration.</p></div>';
    return;
  }
  gfx.cull(false);   // low poly counts; double-sided avoids winding pitfalls

  let W = 0, H = 0;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    gfx.resize(W, H, Math.min(window.devicePixelRatio || 1, 2));
  }
  window.addEventListener('resize', resize);

  // -------------------------------------------------------------------- world
  const MESH = {
    water: gfx.mesh(S.water()),
    chunks: [0, 1, 2, 3].map((i) => gfx.mesh(S.valleyChunk(1000 + i * 77))),
    mountains: gfx.mesh(S.mountains()),
    jetty: gfx.mesh(S.jetty()),
    stone: gfx.mesh(S.stone()),
    hand: gfx.mesh(S.hand()),
    gateGold: gfx.mesh(S.gate(S.C.gold)),
    gateGem: gfx.mesh(S.gate(S.C.gem)),
    ripple: gfx.mesh(S.ripple()),
    target: gfx.mesh(S.ripple(S.C.gold)),
    drop: gfx.mesh(S.droplet()),
  };

  const SKY = {
    top: E.hex('#1c6fb0'), mid: E.hex('#79c2e4'), bot: E.hex('#d8eef2'),
    sun: [0.30, 0.20, 0.06], fog: E.hex('#cbe6ef'),
    light: [0.45, 0.78, 0.35],
  };

  // ---------------------------------------------------------------- run state
  const ST = { TITLE: 'title', AIM: 'aim', FLIGHT: 'flight', SINK: 'sink' };
  let state = ST.TITLE;

  const stone = { x: 0, y: 1.5, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, sinkT: 0 };
  const cam = { x: 0, y: 1.62, z: -0.3, tx: 0, ty: 1, tz: 8, fov: 60, blend: 0 };

  let yaw = 0, pitch = 0.21, power = 0, chargeT = 0, charging = false;
  let time = 0, lastFrame = 0, wind = 0, steer = 0, shake = 0;
  let armedPerfect = false, lastSkipAt = -9, lastImpactVy = 0, lastImpactVh = 0;
  let gates = [], gateCursor = 0;
  const ripples = [], drops = [];
  let landing = null;           // predicted impact point, or null

  const run = { dist: 0, skips: 0, perfects: 0, combo: 0, bestCombo: 0, rings: 0, coins: 0 };

  // ------------------------------------------------------------------- audio
  let ac = null;
  function beep(freq, dur, type = 'sine', vol = 0.06, slide = 0) {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  function initAudio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
  }

  // ------------------------------------------------------------------ screens
  const screens = {
    title: el('titleScreen'), how: el('howScreen'),
    result: el('resultScreen'), shop: el('shopScreen'),
  };
  const hud = el('hud'), aimUi = el('aimUi');

  function show(name) {
    for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
    hud.classList.toggle('hidden', name !== null);
    if (name !== null) aimUi.classList.add('hidden');
  }

  // --------------------------------------------------------------- run control
  function startRun() {
    initAudio();
    Object.assign(run, { dist: 0, skips: 0, perfects: 0, combo: 0, bestCombo: 0, rings: 0, coins: 0 });
    Object.assign(stone, { x: 0, y: 1.45, z: 0.4, vx: 0, vy: 0, vz: 0, spin: 0, sinkT: 0 });
    yaw = 0; pitch = 0.21; power = 0; chargeT = 0; charging = false;
    steer = 0; armedPerfect = false; lastSkipAt = -9;
    wind = rand(-3.2, 3.2);
    gates = []; gateCursor = 26;
    ripples.length = 0; drops.length = 0;
    cam.x = 0; cam.y = 1.62; cam.z = -0.3; cam.blend = 0; cam.fov = 62;
    cam.tx = 0; cam.ty = 1.6; cam.tz = 10;
    state = ST.AIM;
    show(null);
    aimUi.classList.remove('hidden');
    updateHud();
  }

  function launch() {
    const s = stats(save.lv);
    const speed = (16 + power * 20) * s.throw;
    const cp = Math.cos(pitch);
    stone.vx = Math.sin(yaw) * cp * speed;
    stone.vy = Math.sin(pitch) * speed;
    stone.vz = Math.cos(yaw) * cp * speed;
    stone.x = Math.sin(yaw) * 0.6;
    stone.y = 1.42;
    stone.z = 0.4 + Math.cos(yaw) * 0.6;
    charging = false;
    state = ST.FLIGHT;
    aimUi.classList.add('hidden');
    beep(320, 0.12, 'triangle', 0.05, -140);
  }

  function sink() {
    state = ST.SINK;
    stone.sinkT = 0;
    addRipple(stone.x, stone.z, 1.2, 0.9);
    splash(10, 0.7);
    beep(150, 0.3, 'sine', 0.05, -80);
  }

  function finishRun() {
    run.dist = Math.max(0, stone.z);
    const mult = 1 + run.bestCombo * 0.045;
    run.coins = Math.round(
      (run.dist * 0.55 + run.skips * 2 + run.perfects * 4 + run.rings * 3) * mult);
    save.coins += run.coins;
    save.throws++;
    const record = run.dist > save.best;
    if (record) save.best = run.dist;
    persist();

    el('resultTitle').textContent = record ? 'New record!' : pickTitle(run.dist);
    el('resultDist').textContent = fmt(run.dist);
    el('resSkips').textContent = run.skips;
    el('resPerfect').textContent = run.perfects;
    el('resCombo').textContent = run.bestCombo;
    el('resCoins').textContent = run.coins;
    show('result');
  }

  function pickTitle(d) {
    if (d < 25) return 'Plop.';
    if (d < 60) return 'Nice throw';
    if (d < 110) return 'Good arm!';
    if (d < 180) return 'Skipping master';
    return 'Legendary throw';
  }

  // -------------------------------------------------------------------- input
  let ptr = null;

  function onDown(e) {
    if (e.target.closest('button')) return;
    initAudio();
    ptr = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    if (state === ST.AIM) { charging = true; chargeT = 0; }
    else if (state === ST.FLIGHT) tryPerfect();
  }

  function onMove(e) {
    if (!ptr) return;
    ptr.x = e.clientX; ptr.y = e.clientY;
    const dx = ptr.x - ptr.x0, dy = ptr.y - ptr.y0;
    if (state === ST.AIM) {
      yaw = clamp(-dx * 0.0024, -0.5, 0.5);
      pitch = clamp(0.21 - dy * 0.0016, 0.05, 0.62);
    } else if (state === ST.FLIGHT) {
      steer = clamp(-dx / 90, -1, 1);
    }
  }

  function onUp() {
    if (!ptr) return;
    if (state === ST.AIM && charging) launch();
    steer = 0;
    ptr = null;
  }

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === ST.TITLE) {
        if (!screens.title.classList.contains('hidden')) startRun();
        return;
      }
      if (state === ST.AIM) { if (!charging) { charging = true; chargeT = 0; } }
      else if (state === ST.FLIGHT) tryPerfect();
    }
    if (state === ST.AIM) {
      if (e.code === 'ArrowLeft') yaw = clamp(yaw + 0.05, -0.5, 0.5);
      if (e.code === 'ArrowRight') yaw = clamp(yaw - 0.05, -0.5, 0.5);
      if (e.code === 'ArrowUp') pitch = clamp(pitch + 0.03, 0.05, 0.62);
      if (e.code === 'ArrowDown') pitch = clamp(pitch - 0.03, 0.05, 0.62);
    } else if (state === ST.FLIGHT) {
      if (e.code === 'ArrowLeft') steer = 1;
      if (e.code === 'ArrowRight') steer = -1;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && state === ST.AIM && charging) launch();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') steer = 0;
  });

  // Seconds until the stone next reaches the water, or null.
  function timeToWater() {
    if (state !== ST.FLIGHT) return null;
    const a = -0.5 * G, b = stone.vy, c = stone.y;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const r = Math.sqrt(disc);
    const t = Math.max((-b + r) / (2 * a), (-b - r) / (2 * a));
    return t > 0 ? t : null;
  }

  function tryPerfect() {
    const s = stats(save.lv);
    const t = timeToWater();
    if (t !== null && t <= s.window) {
      armedPerfect = true;                 // early: banked until impact
      beep(880, 0.05, 'square', 0.03);
    } else if (time - lastSkipAt <= s.window) {
      applyPerfect();                      // late: applied to the bounce just made
    }
    // A tap nowhere near the water costs nothing. Steering shares the same
    // surface, so punishing stray touches would punish steering.
  }

  function applyPerfect() {
    const s = stats(save.lv);
    lastSkipAt = -9;                       // consumed, so a double tap can't bank two
    stone.vy = Math.min(Math.max(stone.vy, MIN_VY) * s.kick, lastImpactVy * 0.96);
    const vh = Math.hypot(stone.vx, stone.vz);
    const gain = Math.min(1.05, (lastImpactVh * 0.99) / Math.max(vh, 0.001));
    stone.vx *= gain; stone.vz *= gain;
    scorePerfect();
  }

  function scorePerfect() {
    run.perfects++;
    run.combo++;
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    shake = Math.min(shake + 0.5, 1.1);
    splash(14, 1.2);
    flashCombo();
    beep(660 + Math.min(run.combo, 12) * 55, 0.14, 'triangle', 0.055, 240);
  }

  // ------------------------------------------------------------------ physics
  function update(dt) {
    time += dt;
    shake *= Math.pow(0.02, dt);

    if (state === ST.AIM) {
      if (charging) {
        chargeT += dt;
        const ph = (chargeT / CHARGE_PERIOD) % 2;
        power = ph < 1 ? ph : 2 - ph;
      }
      el('powerFill').style.width = `${(charging ? power : 0) * 100}%`;
      el('aimHint').textContent = charging ? 'Release to throw' : 'Hold to charge · drag to aim';
      const arrows = '❯'.repeat(clamp(Math.round(Math.abs(wind) / 1.1), 1, 3));
      el('windTag').textContent = wind >= 0
        ? `WIND ${arrows.split('').reverse().join('').replace(/❯/g, '❮')}`
        : `WIND ${arrows}`;
    }

    if (state === ST.FLIGHT) {
      stone.vx += (wind * 0.35 + steer * STEER_ACCEL) * dt;
      stone.vx -= stone.vx * 0.6 * dt;               // lateral drag
      stone.vy -= G * dt;
      stone.x += stone.vx * dt;
      stone.y += stone.vy * dt;
      stone.z += stone.vz * dt;
      stone.spin += dt * 13;

      if (stone.y <= 0 && stone.vy < 0) doSkip();

      collectGates();
      spawnGates();
      run.dist = stone.z;
      updateHud();
    }

    if (state === ST.SINK) {
      stone.sinkT += dt;
      stone.y -= dt * 1.4;
      if (stone.sinkT > 1.15) { finishRun(); state = ST.TITLE; }
    }

    const tw = timeToWater();
    landing = tw === null ? null
      : { x: stone.x + stone.vx * tw, z: stone.z + stone.vz * tw, t: tw };

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      if (r.age > r.life) ripples.splice(i, 1);
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.vy -= G * 0.6 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.age += dt;
      if (d.y <= 0 || d.age > d.life) drops.splice(i, 1);
    }

    updateCamera(dt);
  }

  function doSkip() {
    const s = stats(save.lv);
    stone.y = 0;
    const up = Math.abs(stone.vy);
    const vh = Math.hypot(stone.vx, stone.vz);
    const deg = Math.atan2(up, Math.max(vh, 0.001)) * 180 / Math.PI;
    const quality = clamp(1 - Math.abs(deg - 14) / 26, 0, 1);

    const keepY = s.keepY + 0.26 * quality;
    const keepH = Math.min(s.keepH + 0.045 * quality, 0.995);

    const perfect = armedPerfect;
    armedPerfect = false;
    lastImpactVy = up;
    lastImpactVh = vh;

    stone.vy = up * keepY;
    stone.vx *= keepH; stone.vz *= keepH;
    run.skips++;
    lastSkipAt = time;

    addRipple(stone.x, stone.z, 0.7, 0.7 + quality * 0.5);
    splash(perfect ? 14 : 6, perfect ? 1.2 : 0.6);

    if (perfect) {
      // A skip never leaves the water faster than it arrived: the Perfect kick
      // buys a slower decay, not a bounce that gains energy every time.
      stone.vy = Math.min(stone.vy * s.kick, up * 0.96);
      const nv = Math.hypot(stone.vx, stone.vz);
      const gain = Math.min(1.05, (vh * 0.99) / Math.max(nv, 0.001));
      stone.vx *= gain; stone.vz *= gain;
      scorePerfect();
    } else {
      run.combo = 0;
      beep(240 + quality * 200, 0.06, 'sine', 0.04);
    }

    if (stone.vy < MIN_VY || Math.hypot(stone.vx, stone.vz) < MIN_VH) sink();
    updateHud();
  }

  function addRipple(x, z, r0, strength) {
    if (ripples.length > 40) ripples.shift();
    ripples.push({ x, z, r: r0, age: 0, life: 1.5, strength });
  }

  function splash(n, power) {
    for (let i = 0; i < n; i++) {
      drops.push({
        x: stone.x, y: 0.05, z: stone.z,
        vx: rand(-2.4, 2.4) * power,
        vy: rand(2, 7) * power,
        vz: rand(-1.5, 3.5) * power,
        age: 0, life: rand(0.35, 0.8),
        s: rand(0.14, 0.3),
      });
    }
  }

  // -------------------------------------------------------------------- gates
  function spawnGates() {
    while (gateCursor < stone.z + 220) {
      gateCursor += rand(28, 52);
      const gem = Math.random() < 0.22;
      gates.push({
        z: gateCursor,
        x: rand(-9, 9),
        y: gem ? rand(2.2, 4.2) : rand(0.9, 2.6),
        gem, got: false, spin: Math.random() * 6.28,
      });
    }
    if (gates.length > 30) gates.splice(0, gates.length - 30);
  }

  function collectGates() {
    for (const g of gates) {
      if (g.got || g.z > stone.z || g.z < stone.z - 10) continue;
      const dx = stone.x - g.x, dy = stone.y - g.y;
      if (dx * dx + dy * dy < 1.5 * 1.5) {
        g.got = true;
        run.rings += g.gem ? 5 : 1;
        addRipple(g.x, g.z, 0.4, 0.5);
        beep(g.gem ? 1180 : 880, 0.09, 'square', 0.035, 300);
      }
    }
  }

  // ------------------------------------------------------------------- camera
  function updateCamera(dt) {
    if (state === ST.AIM) {
      const bob = Math.sin(time * 2.2) * 0.012;
      cam.x = Math.sin(yaw) * 0.1;
      cam.y = 1.62 + bob;
      cam.z = -0.3;
      const look = pitch * 0.35 - 0.07;
      cam.tx = cam.x + Math.sin(yaw) * 12;
      cam.ty = cam.y + Math.sin(look) * 12;
      cam.tz = cam.z + Math.cos(yaw) * 12;
      cam.fov = 62;
      return;
    }

    const head = Math.atan2(stone.vx, stone.vz || 1);
    const ex = stone.x - Math.sin(head) * 6.8;
    const ez = stone.z - Math.cos(head) * 6.8;
    const ey = Math.max(stone.y + 2.1, 1.1);

    // ease out of the first-person view over the first half second
    cam.blend = Math.min(1, cam.blend + dt / 0.55);
    const b = cam.blend * cam.blend * (3 - 2 * cam.blend);
    const k = (1 - Math.pow(0.0009, dt)) * (0.25 + 0.75 * b);

    cam.x = lerp(cam.x, ex, k);
    cam.y = lerp(cam.y, ey, k);
    cam.z = lerp(cam.z, ez, k);
    cam.tx = lerp(cam.tx, stone.x + Math.sin(head) * 5, k);
    cam.ty = lerp(cam.ty, stone.y + 0.7, k);
    cam.tz = lerp(cam.tz, stone.z + Math.cos(head) * 5, k);

    const speed = Math.hypot(stone.vx, stone.vz);
    cam.fov = lerp(cam.fov, 60 + clamp((speed - 18) * 0.45, 0, 13), 1 - Math.pow(0.05, dt));
  }

  // --------------------------------------------------------------------- HUD
  function updateHud() {
    el('hudDist').textContent = fmt(Math.max(0, run.dist));
    el('hudBest').textContent = fmt(save.best);
    el('hudSkips').textContent = run.skips;
    el('hudRings').textContent = run.rings;
  }

  function flashCombo() {
    if (run.combo < 2) return;
    const tag = el('comboTag');
    tag.textContent = `PERFECT ×${run.combo}`;
    tag.classList.remove('show');
    void tag.offsetWidth;
    tag.classList.add('show');
  }

  // ------------------------------------------------------------------ render
  function render() {
    const sx = shake > 0.02 ? (Math.random() - 0.5) * shake * 0.4 : 0;
    const sy = shake > 0.02 ? (Math.random() - 0.5) * shake * 0.3 : 0;
    const eye = [cam.x + sx, cam.y + sy, cam.z];
    const at = [cam.tx, cam.ty + sy, cam.tz];

    gfx.clear(SKY.fog);
    gfx.drawSky(SKY.top, SKY.mid, SKY.bot, [0.72, 0.78], SKY.sun);

    gfx.begin(eye, at, cam.fov * Math.PI / 180, 0.1, 900, {
      light: SKY.light, fog: SKY.fog, fogNear: 90, fogFar: 250, time,
    });

    // the backdrop keeps its own, much longer fog so the peaks stay visible
    gfx.fogRange(190, 980);
    gfx.draw(MESH.mountains, cam.x, 0, cam.z);
    gfx.fogRange(90, 250);

    const snap = (v) => Math.round(v / 4) * 4;
    gfx.draw(MESH.water, snap(cam.x), 0, snap(cam.z), 0, 1, 1, 1, 1, 0.55);

    const first = Math.floor((cam.z - 90) / S.CHUNK);
    for (let i = 0; i < 6; i++) {
      const idx = first + i;
      gfx.draw(MESH.chunks[((idx % 4) + 4) % 4], 0, 0, idx * S.CHUNK);
    }

    if (cam.z < 70) gfx.draw(MESH.jetty, 0, 0, 0);

    for (const g of gates) {
      if (g.got || g.z < cam.z - 8 || g.z > cam.z + 240) continue;
      const pulse = 1.5 + Math.sin(time * 3 + g.spin) * 0.06;
      gfx.draw(g.gem ? MESH.gateGem : MESH.gateGold, g.x, g.y, g.z, 0,
               pulse, pulse, pulse);
    }

    if (state === ST.AIM) {
      const rx = -Math.cos(yaw), rz = Math.sin(yaw);   // screen-right is -x
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const d = 1.15;
      const tanY = Math.tan(cam.fov * Math.PI / 360);
      const right = tanY * gfx.aspect * d * 0.52;
      const down = tanY * d * 0.5;
      const hx = cam.x + rx * right + fx * d;
      const hy = cam.y - down + Math.sin(time * 2.2) * 0.02;
      const hz = cam.z + rz * right + fz * d;
      gfx.draw(MESH.hand, hx, hy, hz, yaw);
      gfx.draw(MESH.stone, hx, hy + 0.018, hz + 0.02, time * 0.7, 0.3, 0.3, 0.3);
    } else {
      gfx.draw(MESH.stone, stone.x, stone.y, stone.z, stone.spin, 1.45, 1.45, 1.45);
    }

    // ---- transparent pass
    gfx.blend(true);

    for (const r of ripples) {
      const t = r.age / r.life;
      const s = r.r + t * 7 * r.strength;
      gfx.draw(MESH.ripple, r.x, 0.04, r.z, 0, s, 1, s, (1 - t) * 0.55 * r.strength);
    }

    // landing marker: where the stone will touch down, and how soon
    if (landing && state === ST.FLIGHT && landing.t < RING_LEAD) {
      const s = stats(save.lv);
      const inWin = landing.t <= s.window;
      const f = landing.t / RING_LEAD;
      const r = 0.9 + f * 3.4;
      gfx.draw(inWin ? MESH.target : MESH.ripple,
               landing.x, 0.06, landing.z, 0, r, 1, r, inWin ? 1 : 0.65);
      gfx.draw(MESH.target, landing.x, 0.05, landing.z, 0, 1.0, 1, 1.0, 0.9);
    }

    // aim preview: the arc the current power and angle would give
    if (state === ST.AIM) {
      const s = stats(save.lv);
      const speed = (16 + power * 20) * s.throw;
      const cp = Math.cos(pitch);
      let px = 0, py = 1.45, pz = 0.4;
      let vx = Math.sin(yaw) * cp * speed, vy = Math.sin(pitch) * speed, vz = Math.cos(yaw) * cp * speed;
      for (let i = 0; i < 110; i++) {
        vy -= G * 0.02;
        px += vx * 0.02; py += vy * 0.02; pz += vz * 0.02;
        if (py <= 0) {
          const pulse = 2.0 + Math.sin(time * 4) * 0.2;
          gfx.draw(MESH.target, px, 0.06, pz, 0, pulse, 1, pulse, 1);
          gfx.draw(MESH.target, px, 0.05, pz, 0, pulse * 1.8, 1, pulse * 1.8, 0.4);
          break;
        }

      }
    }

    for (const d of drops) {
      gfx.draw(MESH.drop, d.x, d.y, d.z, 0, d.s, d.s, d.s, 1 - d.age / d.life);
    }

    gfx.blend(false);
  }

  // ---------------------------------------------------------------- game loop
  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000 || 0, 1 / 30);
    lastFrame = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------------- shop
  const costOf = (u, level) => Math.round(u.cost * Math.pow(1.75, level));

  function renderShop() {
    el('shopCoins').textContent = save.coins;
    const list = el('shopList');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lv = save.lv[u.id];
      const maxed = lv >= u.max;
      const cost = costOf(u, lv);
      const afford = save.coins >= cost;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="ico">${u.icon}</div>
        <div>
          <h3>${u.name}</h3>
          <p>${u.blurb}</p>
          <div class="pips">${Array.from({ length: u.max }, (_, i) =>
            `<span class="pip${i < lv ? ' on' : ''}"></span>`).join('')}</div>
        </div>
        <button class="buy ${maxed ? 'max' : afford ? '' : 'poor'}">${
          maxed ? 'MAX' : `<i class="coin"></i>${cost}`}</button>`;
      const btn = card.querySelector('.buy');
      if (!maxed) {
        btn.addEventListener('click', () => {
          if (save.coins < cost) { beep(180, 0.1, 'square', 0.04); return; }
          save.coins -= cost;
          save.lv[u.id]++;
          persist();
          beep(720, 0.12, 'triangle', 0.05, 300);
          renderShop();
        });
      }
      list.appendChild(card);
    }
  }

  // ----------------------------------------------------------------- ui wiring
  const guard = (node, fn) => node.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  const refreshTitle = () => { el('titleBest').textContent = fmt(save.best); };

  guard(el('playBtn'), startRun);
  guard(el('howBtn'), () => show('how'));
  guard(el('howBackBtn'), () => { show('title'); refreshTitle(); });
  guard(el('againBtn'), startRun);
  guard(el('shopBtn'), () => { renderShop(); show('shop'); });
  guard(el('shopBackBtn'), () => { show('title'); refreshTitle(); });
  document.querySelectorAll('button').forEach((b) =>
    b.addEventListener('pointerdown', (e) => e.stopPropagation()));

  // Debug handle for tuning and automated smoke tests.
  window.__skipstone = {
    stone, run, save, cam, gates, stats, timeToWater, tryPerfect,
    get state() { return state; },
    get power() { return power; },
    setAim(y, p) { yaw = y; pitch = p; },
    hold() { charging = true; chargeT = 0; },
    release() { if (state === ST.AIM && charging) launch(); },
  };

  // --------------------------------------------------------------------- boot
  resize();
  refreshTitle();
  show('title');
  requestAnimationFrame(frame);
})();
