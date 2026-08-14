/* Skip Stone — a hyper-casual stone-skipping game.
 * Two taps to throw (power, angle), one tap per bounce for Perfect skips.
 * No build step, no assets: everything is drawn and synthesised at runtime.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- constants
  const G = 22;                 // gravity, m/s^2
  const MIN_VY = 1.15;          // below this upward speed the stone sinks
  const MIN_VX = 3.2;           // below this forward speed the stone sinks
  const RING_LEAD = 0.55;       // seconds of warning before the timing ring lands
  const BUOY_SPACING = 25;      // metres between distance markers

  const UPGRADES = [
    {
      id: 'flat', icon: '🪨', name: 'Flat Stone', max: 5, cost: 40,
      blurb: 'A smoother, wider stone. Keeps more speed through every skip.',
    },
    {
      id: 'arm', icon: '💪', name: 'Strong Arm', max: 5, cost: 55,
      blurb: 'Put your shoulder into it. Every throw leaves the hand faster.',
    },
    {
      id: 'sense', icon: '👁️', name: "Skipper's Sense", max: 5, cost: 70,
      blurb: 'Time slows at the water. Wider Perfect window, bigger kick.',
    },
  ];

  // Tuning derived from upgrade levels.
  const stats = (lv) => ({
    keepX: 0.900 + 0.0130 * lv.flat,   // forward speed kept per skip
    keepY: 0.500 + 0.0300 * lv.flat,   // bounce height kept per skip
    throw: 1 + 0.070 * lv.arm,         // launch speed multiplier
    window: 0.110 + 0.035 * lv.sense,  // Perfect timing window, seconds
    kick: 1.26 + 0.050 * lv.sense,     // Perfect bounce multiplier
  });

  // ------------------------------------------------------------------- canvas
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // Height is exaggerated: a real skipping throw only peaks about 1.5 m, which
  // reads as a flat line on screen. VSCALE stretches the arc without touching
  // the physics or the horizontal pacing.
  const V_EXAG = 1.9;
  let W = 0, H = 0, SCALE = 8, VSCALE = 15, waterY = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Frame the throw: roughly 32 m of water across the screen.
    const portrait = H > W;
    SCALE = clamp(Math.min(W / 32, H / 30), 7, 24);
    VSCALE = SCALE * V_EXAG;
    waterY = H * (portrait ? 0.43 : 0.56);
  }
  window.addEventListener('resize', resize);

  // --------------------------------------------------------------- save state
  const SAVE_KEY = 'skipstone.save.v1';
  const save = Object.assign(
    { coins: 0, best: 0, lv: { flat: 0, arm: 0, sense: 0 }, throws: 0 },
    load()
  );
  function load() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
    catch { return {}; }
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
  }

  // ---------------------------------------------------------------- run state
  const STATE = { TITLE: 'title', POWER: 'power', ANGLE: 'angle', FLIGHT: 'flight', SINK: 'sink' };
  let state = STATE.TITLE;

  const cam = { x: -6, y: 0 };
  const rock = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, alive: false, sinkT: 0 };

  let meter = 0, meterDir = 1, power = 0, angle = 0;
  let wind = 0, time = 0, lastFrame = 0, shake = 0;
  let armedPerfect = false, lastSkipAt = -9, tapLockUntil = 0;
  let lastImpactUp = 0, lastImpactVx = 0;

  const run = {
    dist: 0, skips: 0, perfects: 0, combo: 0, bestCombo: 0, pickups: 0, coins: 0,
  };

  const trail = [];
  const ripples = [];
  const bits = [];      // splash particles
  const pops = [];      // floating score text
  let coins = [];       // collectibles over the water
  let coinCursor = 0;   // world x up to which coins have been generated

  // ----------------------------------------------------------------- dom refs
  const el = (id) => document.getElementById(id);
  const screens = {
    title: el('titleScreen'), how: el('howScreen'),
    result: el('resultScreen'), shop: el('shopScreen'),
  };
  const hud = el('hud');

  function show(name) {
    for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
    hud.classList.toggle('hidden', name !== null);
    if (name === null) for (const k in screens) screens[k].classList.add('hidden');
  }

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
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; }
  }

  // ------------------------------------------------------------------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const sx = (wx) => (wx - cam.x) * SCALE;
  const sy = (wy) => waterY + cam.y - wy * VSCALE;
  const fmt = (m) => `${m.toFixed(m < 100 ? 1 : 0)} m`;

  // --------------------------------------------------------------- run control
  function startRun() {
    initAudio();
    Object.assign(run, { dist: 0, skips: 0, perfects: 0, combo: 0, bestCombo: 0, pickups: 0, coins: 0 });
    Object.assign(rock, { x: 0, y: 1.6, vx: 0, vy: 0, rot: 0, alive: false, sinkT: 0 });
    cam.x = -9.5; cam.y = 0;
    trail.length = 0; ripples.length = 0; bits.length = 0; pops.length = 0;
    coins = []; coinCursor = 12;
    wind = rand(-3.4, 3.4);
    armedPerfect = false; lastSkipAt = -9;
    meter = 0; meterDir = 1;
    state = STATE.POWER;
    show(null);
    hud.classList.remove('hidden');
    updateHud();
  }

  function launch() {
    const s = stats(save.lv);
    const speed = (16 + power * 20) * s.throw;
    const deg = lerp(3, 38, angle);
    const rad = deg * Math.PI / 180;
    rock.vx = Math.cos(rad) * speed;
    rock.vy = Math.sin(rad) * speed;
    rock.alive = true;
    state = STATE.FLIGHT;
    beep(320, 0.12, 'triangle', 0.05, -140);
  }

  function sink() {
    state = STATE.SINK;
    rock.alive = false;
    rock.sinkT = 0;
    addRipple(rock.x, 1.1, 0.9);
    splash(rock.x, 10, 0.7);
    beep(150, 0.3, 'sine', 0.05, -80);
  }

  function finishRun() {
    run.dist = Math.max(0, rock.x);
    const mult = 1 + run.bestCombo * 0.045;
    run.coins = Math.round(
      (run.dist * 0.55 + run.skips * 2 + run.perfects * 4 + run.pickups * 3) * mult
    );
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
    hud.classList.add('hidden');
  }

  function pickTitle(d) {
    if (d < 25) return 'Plop.';
    if (d < 60) return 'Nice throw';
    if (d < 110) return 'Good arm!';
    if (d < 180) return 'Skipping master';
    return 'Legendary throw';
  }

  // ------------------------------------------------------------------- input
  function tap() {
    if (performance.now() < tapLockUntil) return;
    initAudio();
    if (ac && ac.state === 'suspended') ac.resume();

    if (state === STATE.POWER) {
      power = meter;
      meter = 0; meterDir = 1;
      state = STATE.ANGLE;
      beep(520, 0.07, 'square', 0.04);
    } else if (state === STATE.ANGLE) {
      angle = meter;
      launch();
    } else if (state === STATE.FLIGHT) {
      const s = stats(save.lv);
      const tImpact = timeToWater();
      if (tImpact !== null && tImpact <= s.window) {
        armedPerfect = true;                       // early tap: banked for impact
        beep(880, 0.05, 'square', 0.03);
      } else if (time - lastSkipAt <= s.window) {
        applyPerfect();                            // late tap: retroactive boost
      } else {
        run.combo = 0;                             // mistimed: combo drops
      }
    }
  }

  // Seconds until the stone next crosses the water line, or null if it never will.
  function timeToWater() {
    if (!rock.alive) return null;
    const a = -0.5 * G, b = rock.vy, c = rock.y;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const r = Math.sqrt(disc);
    const t1 = (-b + r) / (2 * a), t2 = (-b - r) / (2 * a);
    const t = Math.max(t1, t2);
    return t > 0 ? t : null;
  }

  function applyPerfect() {
    const s = stats(save.lv);
    lastSkipAt = -9;   // consume, so a double tap can't bank two perfects
    rock.vy = Math.min(Math.max(rock.vy, MIN_VY) * s.kick, lastImpactUp * 0.96);
    rock.vx = Math.min(rock.vx * 1.05, lastImpactVx * 0.99);
    run.perfects++;
    run.combo++;
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    shake = Math.min(shake + 5, 12);
    splash(rock.x, 14, 1.25);
    flashCombo();
    beep(660 + run.combo * 55, 0.14, 'triangle', 0.055, 240);
  }

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;   // let UI buttons handle themselves
    tap();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (state === STATE.TITLE) startRun(); else tap();
    }
  });

  // ------------------------------------------------------------------ physics
  function update(dt) {
    time += dt;
    shake *= Math.pow(0.0025, dt);

    if (state === STATE.POWER || state === STATE.ANGLE) {
      const speed = state === STATE.POWER ? 1.45 : 1.85;
      meter += meterDir * speed * dt;
      if (meter >= 1) { meter = 1; meterDir = -1; }
      if (meter <= 0) { meter = 0; meterDir = 1; }
      cam.x = lerp(cam.x, -9.5, 1 - Math.pow(0.001, dt));
    }

    if (state === STATE.FLIGHT) {
      rock.vx += wind * 0.35 * dt;
      rock.vy -= G * dt;
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.rot += rock.vx * 0.05 * dt * 12;

      if (rock.y <= 0 && rock.vy < 0) doSkip();

      trail.push({ x: rock.x, y: rock.y, t: time });
      while (trail.length && time - trail[0].t > 0.42) trail.shift();

      collectCoins();
      spawnCoins();
      run.dist = rock.x;
      updateHud();
    }

    if (state === STATE.SINK) {
      rock.sinkT += dt;
      if (rock.sinkT > 0.95) { finishRun(); state = STATE.TITLE; }
    }

    // camera
    if (state === STATE.FLIGHT || state === STATE.SINK) {
      const target = rock.x - 0.3 * (W / SCALE);
      cam.x = lerp(cam.x, Math.max(target, -9.5), 1 - Math.pow(0.0008, dt));
      const raw = waterY - rock.y * VSCALE;
      const want = raw < H * 0.24 ? clamp(H * 0.24 - raw, 0, H * 0.22) : 0;
      cam.y = lerp(cam.y, want, 1 - Math.pow(0.004, dt));
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      if (r.age > r.life) ripples.splice(i, 1);
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.vy -= G * 0.55 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.age += dt;
      if (b.age > b.life || b.y < -0.4) bits.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].age += dt;
      pops[i].y += dt * 2.4;
      if (pops[i].age > 1) pops.splice(i, 1);
    }
  }

  function doSkip() {
    const s = stats(save.lv);
    rock.y = 0;
    const up = Math.abs(rock.vy);
    const deg = Math.atan2(up, Math.max(rock.vx, 0.001)) * 180 / Math.PI;
    const quality = clamp(1 - Math.abs(deg - 14) / 26, 0, 1);

    const keepY = s.keepY + 0.26 * quality;
    const keepX = Math.min(s.keepX + 0.045 * quality, 0.995);

    const perfect = armedPerfect;
    armedPerfect = false;
    lastImpactUp = up;
    lastImpactVx = rock.vx;

    rock.vy = up * keepY;
    rock.vx *= keepX;
    run.skips++;
    lastSkipAt = time;

    addRipple(rock.x, 0.55, 0.7 + quality * 0.5);
    splash(rock.x, perfect ? 14 : 6, perfect ? 1.2 : 0.6);

    if (perfect) {
      // A skip never leaves the water faster than it arrived — the Perfect kick
      // buys you a slower decay, not a runaway bounce.
      rock.vy = Math.min(rock.vy * s.kick, up * 0.96);
      rock.vx = Math.min(rock.vx * 1.05, lastImpactVx * 0.99);
      run.perfects++;
      run.combo++;
      run.bestCombo = Math.max(run.bestCombo, run.combo);
      shake = Math.min(shake + 5, 12);
      flashCombo();
      beep(660 + Math.min(run.combo, 12) * 55, 0.14, 'triangle', 0.055, 240);
    } else {
      run.combo = 0;
      beep(240 + quality * 200, 0.06, 'sine', 0.04);
    }

    if (rock.vy < MIN_VY || rock.vx < MIN_VX) sink();
    updateHud();
  }

  // ------------------------------------------------------------- collectibles
  function spawnCoins() {
    const ahead = cam.x + W / SCALE + 40;
    while (coinCursor < ahead) {
      coinCursor += rand(14, 26);
      const gem = Math.random() < 0.14;
      coins.push({
        x: coinCursor,
        y: gem ? rand(2.6, 5.2) : rand(0.7, 3.0),
        gem,
        got: false,
        bob: Math.random() * 6.28,
      });
    }
    if (coins.length > 60) coins.splice(0, coins.length - 60);
  }

  function collectCoins() {
    for (const c of coins) {
      if (c.got) continue;
      const dx = c.x - rock.x, dy = c.y - rock.y;
      if (dx * dx + dy * dy < 3.2) {
        c.got = true;
        run.pickups += c.gem ? 5 : 1;
        pops.push({ x: c.x, y: c.y, age: 0, text: c.gem ? '+5' : '+1', gem: c.gem });
        beep(c.gem ? 1180 : 880, 0.09, 'square', 0.035, 300);
      }
    }
  }

  function addRipple(x, r0, strength) {
    ripples.push({ x, r: r0, age: 0, life: 1.4, strength });
  }

  function splash(x, n, power) {
    for (let i = 0; i < n; i++) {
      bits.push({
        x, y: 0.05,
        vx: rand(-2.5, 5) * power,
        vy: rand(2, 8) * power,
        age: 0, life: rand(0.35, 0.8),
        r: rand(1.2, 3),
      });
    }
  }

  function flashCombo() {
    if (run.combo < 2) return;
    const tag = el('comboTag');
    tag.textContent = `PERFECT ×${run.combo}`;
    tag.classList.remove('show');
    void tag.offsetWidth;
    tag.classList.add('show');
  }

  function updateHud() {
    el('hudDist').textContent = fmt(Math.max(0, run.dist));
    el('hudBest').textContent = fmt(save.best);
    el('hudSkips').textContent = run.skips;
    el('hudCoins').textContent = run.pickups;
  }

  // ------------------------------------------------------------------ drawing
  function draw() {
    ctx.save();
    if (shake > 0.2) ctx.translate(rand(-shake, shake) * 0.4, rand(-shake, shake) * 0.4);

    drawSky();
    drawHills();
    drawWater();
    drawBuoys();
    drawRipples();
    drawShore();
    drawCoins();
    drawTrail();
    drawBits();
    if (rock.alive || state === STATE.SINK) drawRock();
    drawPops();
    drawMeters();
    drawTimingRing();
    drawWind();

    ctx.restore();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, waterY + cam.y);
    g.addColorStop(0, '#2a7fb8');
    g.addColorStop(0.55, '#7fc6e2');
    g.addColorStop(1, '#dff0f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, waterY + cam.y + 1);

    // sun
    const sunX = W * 0.78, sunY = (waterY + cam.y) * 0.28;
    const gs = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, W * 0.3);
    gs.addColorStop(0, 'rgba(255,246,200,.95)');
    gs.addColorStop(0.12, 'rgba(255,236,170,.5)');
    gs.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = gs;
    ctx.fillRect(0, 0, W, waterY + cam.y);

    // clouds (slow parallax)
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 620 - cam.x * SCALE * 0.06) % (W + 460)) - 230;
      const cy = (waterY + cam.y) * (0.12 + 0.07 * ((i * 37) % 5) / 5) + 10;
      cloud(cx, cy, 34 + (i % 3) * 12);
    }
  }

  function cloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.arc(x + r * 0.85, y + r * 0.12, r * 0.72, 0, 6.2832);
    ctx.arc(x - r * 0.8, y + r * 0.18, r * 0.6, 0, 6.2832);
    ctx.arc(x + r * 0.1, y - r * 0.45, r * 0.6, 0, 6.2832);
    ctx.fill();
  }

  function drawHills() {
    const horizon = waterY + cam.y;
    layerHills(horizon, 0.07, 'rgba(120,168,180,.55)', 78, 340);
    layerHills(horizon, 0.16, 'rgba(74,132,126,.75)', 54, 250);
    layerHills(horizon, 0.30, '#33705f', 34, 170);
  }

  function layerHills(horizon, par, color, amp, wl) {
    const off = -cam.x * SCALE * par;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, horizon + 2);
    for (let x = -10; x <= W + 10; x += 12) {
      const u = (x - off) / wl;
      const y = horizon - amp * (0.55 + 0.45 * Math.sin(u * 1.7) * Math.cos(u * 0.6 + 1.2));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 10, horizon + 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawWater() {
    const top = waterY + cam.y;
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, '#3ea3c9');
    g.addColorStop(0.35, '#1d7fb0');
    g.addColorStop(1, '#0a3357');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, H - top);

    // moving highlight bands — the sense of speed comes from these
    const depth = H - top;
    for (let i = 0; i < 26; i++) {
      const f = i / 26;
      const y = top + Math.pow(f, 1.7) * depth;
      const par = 0.12 + f * 1.5;
      const off = (-cam.x * SCALE * par + Math.sin(time * (0.6 + f) + i) * 18) % 220;
      ctx.fillStyle = `rgba(255,255,255,${0.06 + f * 0.05})`;
      for (let x = -220 + (off % 220); x < W + 220; x += 220) {
        ctx.fillRect(x, y, 60 + f * 90, 1.5 + f * 2.5);
      }
    }

    // sun glitter near the surface
    ctx.fillStyle = 'rgba(255,240,190,.20)';
    for (let i = 0; i < 40; i++) {
      const s = Math.sin(i * 12.9898) * 43758.5453;
      const fx = ((s - Math.floor(s)) * W * 1.4 - cam.x * SCALE * 0.3) % W;
      const x = fx < 0 ? fx + W : fx;
      const y = top + 4 + ((i * 7) % 60) * (Math.abs(Math.sin(time * 0.7 + i)) * 0.9 + 0.3);
      ctx.fillRect(x, y, 10 + (i % 4) * 6, 1.4);
    }

    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, top - 1, W, 1.6);
  }

  function drawShore() {
    // dock + thrower, drawn in world units so they stay life-sized at any zoom
    if (sx(1) < -80) return;
    const u = SCALE, deck = sy(1.1), px = sx(-1.2);

    ctx.fillStyle = '#5a3b25';
    ctx.fillRect(sx(-9), deck, u * 8.2, u * 0.32);
    ctx.fillStyle = '#3e2717';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(sx(-8.4 + i * 2.1), deck + u * 0.3, u * 0.24, u * 1.15);
    }

    // silhouette of the thrower
    const aiming = state === STATE.POWER || state === STATE.ANGLE;
    const bob = aiming ? Math.sin(time * 5) * u * 0.05 : 0;
    const feet = deck + bob;
    ctx.fillStyle = '#1c3444';
    ctx.beginPath();
    ctx.arc(px, feet - u * 1.62, u * 0.23, 0, 6.2832);              // head
    ctx.fill();
    ctx.fillRect(px - u * 0.2, feet - u * 1.4, u * 0.4, u * 0.72);  // torso
    ctx.fillRect(px - u * 0.18, feet - u * 0.7, u * 0.14, u * 0.7); // legs
    ctx.fillRect(px + u * 0.04, feet - u * 0.7, u * 0.14, u * 0.7);
    ctx.save();                                                     // throwing arm
    ctx.translate(px + u * 0.14, feet - u * 1.28);
    ctx.rotate(state === STATE.ANGLE ? -0.95 : -0.25);
    ctx.fillRect(0, -u * 0.07, u * 0.6, u * 0.14);
    ctx.restore();
  }

  function drawBuoys() {
    const from = Math.floor(cam.x / BUOY_SPACING) * BUOY_SPACING;
    const to = cam.x + W / SCALE + BUOY_SPACING;
    for (let m = Math.max(BUOY_SPACING, from); m <= to; m += BUOY_SPACING) {
      const x = sx(m), y = sy(0) + Math.sin(time * 1.6 + m) * 2;
      ctx.fillStyle = m % 100 === 0 ? '#ff7043' : 'rgba(255,255,255,.55)';
      ctx.beginPath();
      ctx.moveTo(x, y - 13); ctx.lineTo(x + 5, y); ctx.lineTo(x - 5, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(6,37,60,.35)';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${m}`, x, y + 14);
    }

    // personal best marker
    if (save.best > 5) {
      const x = sx(save.best);
      if (x > -30 && x < W + 30) {
        const y = sy(0);
        ctx.strokeStyle = 'rgba(255,200,74,.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = '#ffc84a';
        ctx.beginPath();
        ctx.moveTo(x, y - 34); ctx.lineTo(x + 20, y - 28); ctx.lineTo(x, y - 22);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(6,37,60,.6)';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BEST', x + 3, y - 8);
      }
    }
  }

  function drawRipples() {
    ctx.lineWidth = 2;
    for (const r of ripples) {
      const t = r.age / r.life;
      const rad = (r.r + t * 6 * r.strength) * SCALE;
      ctx.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.55 * r.strength})`;
      ctx.beginPath();
      ctx.ellipse(sx(r.x), sy(0), rad, rad * 0.28, 0, 0, 6.2832);
      ctx.stroke();
    }
  }

  function drawCoins() {
    for (const c of coins) {
      if (c.got) continue;
      const x = sx(c.x);
      if (x < -40 || x > W + 40) continue;
      const y = sy(c.y) + Math.sin(time * 2.4 + c.bob) * 4;
      const rad = clamp(SCALE * 0.7, 10, 15);
      const w = Math.abs(Math.cos(time * 3 + c.bob)) * rad + rad * 0.28;
      ctx.save();
      ctx.translate(x, y);
      const g = ctx.createLinearGradient(-w, -10, w, 10);
      if (c.gem) { g.addColorStop(0, '#bff4ff'); g.addColorStop(1, '#2ea6d6'); }
      else { g.addColorStop(0, '#fff0b8'); g.addColorStop(1, '#e39a12'); }
      ctx.fillStyle = g;
      ctx.beginPath();
      if (c.gem) {
        ctx.moveTo(0, -rad); ctx.lineTo(w, 0); ctx.lineTo(0, rad); ctx.lineTo(-w, 0);
        ctx.closePath();
      } else {
        ctx.ellipse(0, 0, w, rad, 0, 0, 6.2832);
      }
      ctx.fill();
      ctx.strokeStyle = c.gem ? 'rgba(255,255,255,.85)' : 'rgba(180,110,10,.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!c.gem && w > rad * 0.45) {          // inner ring, only when face-on
        ctx.strokeStyle = 'rgba(180,110,10,.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.55, rad * 0.55, 0, 0, 6.2832);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath();
      ctx.ellipse(-w * 0.35, -rad * 0.4, w * 0.22, rad * 0.16, -0.5, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const f = i / trail.length;
      ctx.strokeStyle = `rgba(255,255,255,${f * 0.35})`;
      ctx.lineWidth = f * 4;
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
  }

  function drawRock() {
    const x = sx(rock.x);
    let y = sy(rock.y);
    let alpha = 1, scale = 1;
    if (state === STATE.SINK) {
      const t = clamp(rock.sinkT / 0.95, 0, 1);
      y += t * 34;
      alpha = 1 - t;
      scale = 1 - t * 0.4;
    }
    // shadow on the water
    const h = clamp(rock.y, 0, 12);
    const sw = clamp(SCALE * 0.55, 7, 14) * (1 - h / 18);
    ctx.fillStyle = `rgba(4,40,66,${0.2 * (1 - h / 16) * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, sy(0) + 2, sw * scale, sw * 0.32 * scale, 0, 0, 6.2832);
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rock.rot);
    ctx.scale(scale, scale);
    const flat = 1 + save.lv.flat * 0.06;
    const rr = clamp(SCALE * 0.62, 8, 16);
    ctx.fillStyle = '#4f5a61';
    ctx.beginPath();
    ctx.ellipse(0, 0, rr * flat, rr * 0.56, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = '#7d8a92';
    ctx.beginPath();
    ctx.ellipse(-rr * 0.16, -rr * 0.16, rr * 0.62 * flat, rr * 0.3, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function drawBits() {
    for (const b of bits) {
      const t = b.age / b.life;
      ctx.fillStyle = `rgba(235,250,255,${(1 - t) * 0.9})`;
      ctx.beginPath();
      ctx.arc(sx(b.x), sy(b.y), b.r * (1 - t * 0.4), 0, 6.2832);
      ctx.fill();
    }
  }

  function drawPops() {
    ctx.textAlign = 'center';
    ctx.font = '800 18px system-ui, sans-serif';
    for (const p of pops) {
      ctx.fillStyle = p.gem
        ? `rgba(150,230,255,${1 - p.age})`
        : `rgba(255,200,74,${1 - p.age})`;
      ctx.fillText(p.text, sx(p.x), sy(p.y));
    }
  }

  function drawMeters() {
    if (state !== STATE.POWER && state !== STATE.ANGLE) return;
    const isPower = state === STATE.POWER;
    const bw = Math.min(W * 0.72, 320), bh = 22;
    const bx = (W - bw) / 2, by = H - 118;

    ctx.fillStyle = 'rgba(4,28,46,.55)';
    roundRect(bx - 6, by - 30, bw + 12, bh + 44, 14);
    ctx.fill();

    ctx.fillStyle = '#dff0f8';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isPower ? 'POWER — tap to set' : 'ANGLE — flat skips best', W / 2, by - 12);

    // track
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    if (isPower) { g.addColorStop(0, '#3a6f8c'); g.addColorStop(1, '#ffc84a'); }
    else {
      g.addColorStop(0, '#3a6f8c');
      g.addColorStop(0.32, '#45d69c');   // sweet spot for the skip angle
      g.addColorStop(0.55, '#3a6f8c');
      g.addColorStop(1, '#c0553f');
    }
    ctx.fillStyle = g;
    roundRect(bx, by, bw, bh, 11);
    ctx.fill();

    if (!isPower) {
      const sweetX = bx + bw * 0.32;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sweetX, by - 4); ctx.lineTo(sweetX, by + bh + 4); ctx.stroke();
      ctx.setLineDash([]);
    }

    // marker
    const mx = bx + meter * bw;
    ctx.fillStyle = '#fff';
    roundRect(mx - 3.5, by - 7, 7, bh + 14, 4);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTimingRing() {
    if (state !== STATE.FLIGHT) return;
    const t = timeToWater();
    if (t === null || t > RING_LEAD) return;
    const s = stats(save.lv);
    const f = t / RING_LEAD;
    const x = sx(rock.x), y = sy(rock.y);
    const inWindow = t <= s.window;
    const target = clamp(SCALE * 1.15, 14, 26);

    ctx.lineWidth = inWindow ? 4 : 2.5;
    ctx.strokeStyle = inWindow ? 'rgba(255,200,74,.95)' : `rgba(255,255,255,${0.25 + (1 - f) * 0.45})`;
    ctx.beginPath();
    ctx.arc(x, y, target + f * target * 2.6, 0, 6.2832);
    ctx.stroke();

    // fixed target ring — land the shrinking ring on this
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    ctx.arc(x, y, target, 0, 6.2832);
    ctx.stroke();

    if (armedPerfect) {
      ctx.fillStyle = 'rgba(255,200,74,.35)';
      ctx.beginPath(); ctx.arc(x, y, target, 0, 6.2832); ctx.fill();
    }
  }

  function drawWind() {
    if (state === STATE.TITLE) return;
    const cx = W / 2, y = H - 42;
    const dir = wind >= 0 ? 1 : -1;
    const strength = Math.abs(wind) / 3.4;
    ctx.fillStyle = 'rgba(4,28,46,.45)';
    roundRect(cx - 48, y - 15, 102, 26, 13);
    ctx.fill();
    ctx.fillStyle = 'rgba(223,240,248,.85)';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('WIND', cx - 2, y + 2);
    ctx.strokeStyle = wind >= 0 ? '#45d69c' : '#ff9678';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    // Chevrons sit in fixed slots so the pill stays balanced whichever way
    // the wind is blowing.
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = strength > i * 0.33 ? 1 : 0.2;
      const mid = cx + 12 + i * 13;
      ctx.beginPath();
      ctx.moveTo(mid - 4 * dir, y - 8);
      ctx.lineTo(mid + 4 * dir, y - 3);
      ctx.lineTo(mid - 4 * dir, y + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- game loop
  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000 || 0, 1 / 30);
    lastFrame = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------------- shop
  function costOf(u, level) {
    return Math.round(u.cost * Math.pow(1.75, level));
  }

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
          <div class="pips">${
            Array.from({ length: u.max }, (_, i) =>
              `<span class="pip${i < lv ? ' on' : ''}"></span>`).join('')
          }</div>
        </div>
        <button class="buy ${maxed ? 'max' : afford ? '' : 'poor'}">${
          maxed ? 'MAX' : `<i class="coin"></i>${cost}`
        }</button>`;

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

  // ---------------------------------------------------------------- ui wiring
  function guard(node, fn) {
    node.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  }
  guard(el('playBtn'), startRun);
  guard(el('howBtn'), () => show('how'));
  guard(el('howBackBtn'), () => { show('title'); refreshTitle(); });
  guard(el('againBtn'), startRun);
  guard(el('shopBtn'), () => { renderShop(); show('shop'); });
  guard(el('shopBackBtn'), () => { show('title'); refreshTitle(); });

  // Buttons live above the canvas; stop their taps from also firing a throw.
  document.querySelectorAll('button').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      tapLockUntil = performance.now() + 220;
    });
  });

  function refreshTitle() {
    el('titleBest').textContent = fmt(save.best);
  }

  // Small debug handle, handy for tuning and automated smoke tests.
  window.__skipstone = {
    rock, run, save, tap, timeToWater, stats,
    get state() { return state; },
    get meter() { return meter; },
  };

  // ------------------------------------------------------------------- boot
  resize();
  refreshTitle();
  show('title');
  hud.classList.add('hidden');
  requestAnimationFrame(frame);
})();
