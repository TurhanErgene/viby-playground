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

  // Each throw picks the next light of day. Colours are grouped so every layer
  // of the scene — sky, hills, water, foam, glitter — shifts together.
  const PALETTES = [
    { // clear morning
      sky: ['#2f81b8', '#7cc5e3', '#e2f2f2'],
      cloud: 'rgba(255,255,255,.88)', cloudShade: 'rgba(203,226,239,.9)',
      sun: '255,247,205', sunGlow: '255,238,175', sunX: 0.78, sunY: 0.24,
      surf: '#54b4d6', mid: '#1a7cad', deep: '#062b47',
      hills: ['rgba(150,192,199,.5)', 'rgba(94,152,142,.75)', '#33705f'],
      trees: '#2b6252', hillRef: 'rgba(52,104,96,.35)',
      foam: '236,250,255', glitter: '255,246,206', dark: '#1c3444',
      horizon: '208,236,240', pad: ['#3c7a5b', '#265f47'], reed: '#3c8a5e',
    },
    { // golden hour
      sky: ['#2b5f96', '#e79f63', '#ffd9a8'],
      cloud: 'rgba(255,226,196,.9)', cloudShade: 'rgba(212,148,128,.85)',
      sun: '255,236,180', sunGlow: '255,190,120', sunX: 0.72, sunY: 0.5,
      surf: '#6aa6bd', mid: '#256e91', deep: '#07243c',
      hills: ['rgba(178,168,170,.5)', 'rgba(104,120,120,.72)', '#2c5a52'],
      trees: '#23483f', hillRef: 'rgba(44,90,82,.35)',
      foam: '255,242,224', glitter: '255,214,150', dark: '#1e3038',
      horizon: '255,190,130', pad: ['#3f6d55', '#28503f'], reed: '#356b4e',
    },
    { // dusk
      sky: ['#16255a', '#5d4a86', '#e0896b'],
      cloud: 'rgba(198,172,202,.78)', cloudShade: 'rgba(118,94,138,.8)',
      sun: '255,186,130', sunGlow: '236,140,110', sunX: 0.68, sunY: 0.6,
      surf: '#43789c', mid: '#1a3f64', deep: '#050f22',
      hills: ['rgba(122,122,162,.45)', 'rgba(64,72,104,.75)', '#232f4a'],
      trees: '#1a2338', hillRef: 'rgba(35,47,74,.4)',
      foam: '226,232,255', glitter: '255,196,150', dark: '#141c30',
      horizon: '224,137,107', pad: ['#2c5560', '#1b3540'], reed: '#24455a',
    },
  ];

  // Deterministic noise, so scattered detail stays put between frames.
  const hash = (i) => { const v = Math.sin(i * 12.9898) * 43758.5453; return v - Math.floor(v); };

  const CLOUDS = Array.from({ length: 9 }, (_, i) => ({
    u: hash(i) * 2600,
    y: 0.06 + hash(i + 40) * 0.34,
    r: 26 + hash(i + 80) * 34,
    par: 0.04 + hash(i + 120) * 0.05,
  }));

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
  const bits = [];      // splash droplets
  const pops = [];      // floating score text
  const foams = [];     // lingering white water where the stone struck
  let coins = [];       // collectibles over the water
  let pads = [];        // decorative lily pads
  let coinCursor = 0;   // world x up to which coins have been generated
  let padCursors = [];
  let squash = 0;       // stone deformation right after an impact
  let pal = PALETTES[0];

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
    foams.length = 0;
    coins = []; coinCursor = 12;
    pads = []; padCursors = [4, 4, 4, 4];
    squash = 0;
    pal = PALETTES[save.throws % PALETTES.length];
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
    squash *= Math.pow(0.00002, dt);

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
      spawnPads();
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
      if (b.y <= 0 && b.vy < 0) {
        if (ripples.length < 44) addRipple(b.x, 0.06, 0.22);
        bits.splice(i, 1);
      } else if (b.age > b.life) {
        bits.splice(i, 1);
      }
    }
    for (let i = foams.length - 1; i >= 0; i--) {
      foams[i].age += dt;
      if (foams[i].age > foams[i].life) foams.splice(i, 1);
    }
    for (const pd of pads) pd.wob *= Math.pow(0.02, dt);
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
    squash = 1;
    foams.push({ x: rock.x, age: 0, life: perfect ? 1.5 : 1.0, r: perfect ? 1.5 : 0.9 });
    for (const pd of pads) {
      if (pd.d < 0.3 && Math.abs(pd.x - rock.x) < 4) pd.wob = Math.min(pd.wob + 1, 1.6);
    }

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

  const PAD_BANDS = [0.12, 0.34, 0.58, 0.82];

  function spawnPads() {
    for (let b = 0; b < PAD_BANDS.length; b++) {
      const d = PAD_BANDS[b];
      const m = 1 + d * 1.5;
      const ahead = cam.x + (W / SCALE) / m + 12;   // world span this band covers
      const gap = b === 0 ? rand(22, 52) : rand(11, 30);
      while (padCursors[b] < ahead) {
        padCursors[b] += gap / m;
        pads.push({
          x: padCursors[b],
          d: d + rand(-0.05, 0.05),
          r: rand(0.42, 0.85),
          drift: rand(0, 6.28),
          flower: Math.random() < 0.18,
          wob: 0,
        });
      }
    }
    // drop pads that have scrolled off behind the camera
    for (let i = pads.length - 1; i >= 0; i--) {
      if ((pads[i].x - cam.x) * SCALE * (1 + pads[i].d * 1.5) < -90) pads.splice(i, 1);
    }
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

  // Screen-space height of the water surface. The amplitude is deliberately
  // tiny — the physics plane is flat at y = 0, and a big visible swell would
  // disagree with where the stone actually lands.
  function surfaceAt(px) {
    const wx = cam.x + px / SCALE;
    return waterY + cam.y
      + Math.sin(wx * 0.55 + time * 1.6) * 2.0
      + Math.sin(wx * 1.30 - time * 2.3) * 1.1
      + Math.sin(wx * 0.21 + time * 0.7) * 1.6;
  }

  function tracedSurface(step) {
    ctx.beginPath();
    ctx.moveTo(-20, surfaceAt(-20));
    for (let x = -20 + step; x <= W + 20; x += step) ctx.lineTo(x, surfaceAt(x));
  }

  function draw() {
    const p = pal;
    ctx.save();
    if (shake > 0.2) ctx.translate(rand(-shake, shake) * 0.4, rand(-shake, shake) * 0.4);

    drawSky(p);
    drawHills(p);
    drawWater(p);
    drawFoam(p);
    drawRipples(p);
    drawPads(p);
    drawBuoys(p);
    drawShore(p);
    drawCoins();
    drawTrail(p);
    drawBits(p);
    if (rock.alive || state === STATE.SINK) drawRock(p);
    drawPops();
    drawMeters();
    drawTimingRing();
    drawWind();
    drawVignette();

    ctx.restore();
  }

  // ---------------------------------------------------------------------- sky
  function drawSky(p) {
    const horizon = waterY + cam.y;
    const g = ctx.createLinearGradient(0, -30, 0, horizon);
    g.addColorStop(0, p.sky[0]);
    g.addColorStop(0.58, p.sky[1]);
    g.addColorStop(1, p.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 2);

    const sunX = W * p.sunX, sunY = horizon * p.sunY;
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, W * 0.45);
    glow.addColorStop(0, `rgba(${p.sunGlow},.6)`);
    glow.addColorStop(0.3, `rgba(${p.sunGlow},.16)`);
    glow.addColorStop(1, `rgba(${p.sunGlow},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, horizon + 2);

    ctx.fillStyle = `rgba(${p.sun},.96)`;
    ctx.beginPath();
    ctx.arc(sunX, sunY, clamp(W * 0.036, 15, 32), 0, 6.2832);
    ctx.fill();

    for (const c of CLOUDS) {
      const span = W + 900;
      let x = (c.u - cam.x * SCALE * c.par) % span;
      if (x < 0) x += span;
      cloud(x - 450, horizon * c.y + 12, c.r, p);
    }
  }

  // Two-tone: a lit crown with a flatter shaded base, so clouds have a bottom.
  function cloud(x, y, r, p) {
    ctx.fillStyle = p.cloudShade;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.34, r * 1.5, r * 0.4, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = p.cloud;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, 0, 6.2832);
    ctx.arc(x + r * 0.82, y + r * 0.2, r * 0.58, 0, 6.2832);
    ctx.arc(x - r * 0.8, y + r * 0.24, r * 0.5, 0, 6.2832);
    ctx.arc(x + r * 0.16, y - r * 0.4, r * 0.52, 0, 6.2832);
    ctx.fill();
  }

  // -------------------------------------------------------------------- hills
  function drawHills(p) {
    const horizon = waterY + cam.y;
    ridge(horizon, 0.07, p.hills[0], 86, 380, false, p);
    ridge(horizon, 0.16, p.hills[1], 58, 260, false, p);
    ridge(horizon, 0.30, p.hills[2], 36, 175, true, p);
  }

  function ridge(horizon, par, color, amp, wl, treed, p) {
    const off = -cam.x * SCALE * par;
    const top = (x) => {
      const u = (x - off) / wl;
      return horizon - amp * (0.55 + 0.45 * Math.sin(u * 1.7) * Math.cos(u * 0.6 + 1.2));
    };
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, horizon + 2);
    for (let x = -10; x <= W + 10; x += 12) ctx.lineTo(x, top(x));
    ctx.lineTo(W + 10, horizon + 2);
    ctx.closePath();
    ctx.fill();

    if (!treed) return;
    // A conifer line along the near ridge, thinning as it recedes.
    ctx.fillStyle = p.trees;
    for (let x = -10; x <= W + 10; x += 9) {
      const n = Math.round(x / 9);
      const jitter = (hash(n * 1.7) - 0.5) * 7;
      const h = 6 + hash(n + 7) * 15;
      const halfW = 2.8 + hash(n * 2.9) * 2.4;
      const cx = x + jitter;
      const y = top(cx) + 2;
      ctx.beginPath();
      ctx.moveTo(cx, y - h);
      ctx.lineTo(cx + halfW, y + 2);
      ctx.lineTo(cx - halfW, y + 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------- water
  function drawWater(p) {
    const base = waterY + cam.y;

    tracedSurface(9);
    ctx.lineTo(W + 20, H + 10);
    ctx.lineTo(-20, H + 10);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, base, 0, H);
    g.addColorStop(0, p.surf);
    g.addColorStop(0.3, p.mid);
    g.addColorStop(1, p.deep);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();                       // keep every effect below inside the lake

    // the far bank, smeared across the first few metres of water
    ctx.fillStyle = p.hillRef;
    ctx.fillRect(0, base - 3, W, 22);

    // the sky's own colour carried into the water, so the horizon reads as one
    // scene rather than two flat bands meeting at a line
    const hz = ctx.createLinearGradient(0, base - 3, 0, base + 70);
    hz.addColorStop(0, `rgba(${p.horizon},.5)`);
    hz.addColorStop(0.45, `rgba(${p.horizon},.16)`);
    hz.addColorStop(1, `rgba(${p.horizon},0)`);
    ctx.fillStyle = hz;
    ctx.fillRect(0, base - 3, W, 74);

    // the sun's path on the water, widening as it comes toward the viewer
    const sunX = W * p.sunX;
    sunColumn(p, base, sunX);

    drawSwell(p, base);
    drawGlitter(p, base, sunX);
    ctx.restore();

    // lit crest along the surface itself
    ctx.strokeStyle = `rgba(${p.foam},.5)`;
    ctx.lineWidth = 1.8;
    tracedSurface(9);
    ctx.stroke();
  }

  // The sun's path on the water. Drawn as horizontal bands, each with its own
  // left-to-right falloff, so the column feathers into the lake instead of
  // ending on the hard diagonal a single filled trapezoid would give.
  let sunBands = null, sunBandsKey = '';

  function sunColumn(p, base, sunX) {
    const depth = H - base;
    const bands = 18;
    const key = `${W}x${Math.round(depth)}|${p.glitter}`;
    if (sunBandsKey !== key) {           // rebuild only on resize or palette swap
      sunBands = [];
      for (let i = 0; i < bands; i++) {
        const f = i / bands;
        const halfW = W * (0.045 + f * 0.28);
        const a = (0.30 - f * 0.26) * (1 - f * 0.25);
        const g = ctx.createLinearGradient(sunX - halfW, 0, sunX + halfW, 0);
        g.addColorStop(0, `rgba(${p.glitter},0)`);
        g.addColorStop(0.5, `rgba(${p.glitter},${a})`);
        g.addColorStop(1, `rgba(${p.glitter},0)`);
        sunBands.push({ g, halfW });
      }
      sunBandsKey = key;
    }
    for (let i = 0; i < bands; i++) {
      const y = base + (i / bands) * depth, y2 = base + ((i + 1) / bands) * depth;
      const { g, halfW } = sunBands[i];
      ctx.fillStyle = g;
      ctx.fillRect(sunX - halfW, y, halfW * 2, y2 - y + 1);
    }
  }

  // Rows of swell receding to the horizon. Each row is a dashed sine, so it
  // breaks into scattered crests instead of reading as a stripe.
  function drawSwell(p, base) {
    const depth = H - base;
    const rows = W > 900 ? 20 : 26;
    const step = clamp(W / 42, 12, 22);
    ctx.lineCap = 'round';
    for (let i = 0; i < rows; i++) {
      const f = (i + 0.5) / rows;
      const y = base + Math.pow(f, 1.75) * depth;
      const amp = 0.8 + f * f * 7;
      const wl = 90 + f * 260;
      const drift = -cam.x * SCALE * (0.15 + f * 1.6) + time * (10 + f * 46);

      // an uneven dash rhythm — a single repeating pair reads as tick marks
      const j = hash(i * 3.3), k = hash(i * 7.7);
      const unit = 14 + f * 46;
      ctx.setLineDash([
        unit * (0.6 + j), 30 + f * 92,
        unit * (0.3 + k * 0.7), 22 + f * 70 * (0.6 + j),
      ]);
      ctx.lineDashOffset = -drift * 0.6;
      ctx.lineWidth = 1 + f * 2.4;

      ctx.strokeStyle = `rgba(3,26,46,${0.06 + f * 0.08})`;
      wave(y + 1.6 + f * 1.6, amp, wl, drift, step);
      ctx.strokeStyle = `rgba(${p.foam},${0.10 + f * 0.13})`;
      wave(y, amp, wl, drift, step);
    }
    ctx.setLineDash([]);
  }

  function wave(y, amp, wl, phase, step) {
    ctx.beginPath();
    for (let x = -40; x <= W + 40; x += step) {
      const yy = y + Math.sin((x + phase) / wl * 6.2832) * amp;
      if (x === -40) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // Specular sparkle scattered down the sun's column.
  function drawGlitter(p, base, sunX) {
    const depth = H - base;
    for (let i = 0; i < 54; i++) {
      const h = hash(i * 3.7);
      const f = ((i * 7) % 27) / 27;
      const y = base + Math.pow(f, 1.7) * depth * 0.8 + Math.sin(time * 0.8 + i) * 2;
      const x = sunX + (h * 2 - 1) * W * (0.05 + f * 0.26);
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * (1.4 + h * 1.6) + i * 2.1));
      ctx.globalAlpha = twinkle * (1 - f * 0.55) * 0.7;
      ctx.fillStyle = `rgba(${p.glitter},1)`;
      ctx.fillRect(x, y, 6 + f * 26, 1.1 + f * 1.8);
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.32,
                                       W / 2, H * 0.5, Math.max(W, H) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(2,14,26,.34)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ water surface
  function drawFoam(p) {
    for (const f of foams) {
      const t = f.age / f.life;
      const x = sx(f.x);
      if (x < -60 || x > W + 60) continue;
      const r = f.r * SCALE * (1 + t * 1.6);
      ctx.fillStyle = `rgba(${p.foam},${(1 - t) * 0.32})`;
      ctx.beginPath();
      ctx.ellipse(x, surfaceAt(x), r, r * 0.3, 0, 0, 6.2832);
      ctx.fill();
    }
  }

  function drawRipples(p) {
    for (const r of ripples) {
      const t = r.age / r.life;
      const x = sx(r.x);
      if (x < -80 || x > W + 80) continue;
      const y = surfaceAt(x);
      const rad = (r.r + t * 7 * r.strength) * SCALE;
      ctx.lineWidth = 0.6 + 2.2 * (1 - t);
      ctx.strokeStyle = `rgba(${p.foam},${(1 - t) * 0.6 * r.strength})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * 0.27, 0, 0, 6.2832);
      ctx.stroke();
      if (t < 0.55) {
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = `rgba(${p.foam},${(0.55 - t) * 0.7 * r.strength})`;
        ctx.beginPath();
        ctx.ellipse(x, y, rad * 0.52, rad * 0.14, 0, 0, 6.2832);
        ctx.stroke();
      }
    }
  }

  // Lily pads sit at varying depths and scroll at their own rate — the strongest
  // cue that the water is a receding plane rather than a flat backdrop.
  function drawPads(p) {
    for (const pd of pads) {
      const d = pd.d;
      const m = 1 + d * 1.5;
      const x = (pd.x - cam.x) * SCALE * m;
      if (x < -70 || x > W + 70) continue;
      const y = surfaceAt(x) + Math.pow(d, 1.6) * (H - waterY - cam.y) * 0.62
              + Math.sin(time * 1.5 + pd.drift) * (1 + pd.wob * 4);
      const r = SCALE * pd.r * m;

      ctx.fillStyle = 'rgba(3,26,46,.22)';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.1, y + r * 0.2, r, r * 0.34, 0, 0, 6.2832);
      ctx.fill();

      ctx.fillStyle = d > 0.55 ? p.pad[1] : p.pad[0];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.36, 0, 0.42, 6.2832 - 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.25, y - r * 0.1, r * 0.4, r * 0.13, 0, 0, 6.2832);
      ctx.fill();

      if (pd.flower) {
        ctx.fillStyle = 'rgba(255,224,238,.95)';
        for (let k = 0; k < 5; k++) {
          const a = k * 1.256 + 0.3;
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * 0.22, y - r * 0.12 + Math.sin(a) * r * 0.08,
                      r * 0.19, r * 0.09, a, 0, 6.2832);
          ctx.fill();
        }
        ctx.fillStyle = '#ffd451';
        ctx.beginPath();
        ctx.arc(x, y - r * 0.12, r * 0.09, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------------ markers
  function drawBuoys(p) {
    const from = Math.floor(cam.x / BUOY_SPACING) * BUOY_SPACING;
    const to = cam.x + W / SCALE + BUOY_SPACING;
    ctx.textAlign = 'center';
    for (let m = Math.max(BUOY_SPACING, from); m <= to; m += BUOY_SPACING) {
      const x = sx(m);
      const y = surfaceAt(x) + Math.sin(time * 1.6 + m) * 2;
      const hundred = m % 100 === 0;

      ctx.fillStyle = 'rgba(3,26,46,.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 9, 3, 0, 0, 6.2832);
      ctx.fill();

      ctx.fillStyle = hundred ? '#ff7043' : '#f2f7f9';
      ctx.beginPath();
      ctx.moveTo(x, y - 15); ctx.lineTo(x + 5.5, y); ctx.lineTo(x - 5.5, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath();
      ctx.moveTo(x, y - 15); ctx.lineTo(x + 5.5, y); ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = `rgba(${p.foam},.6)`;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText(`${m}`, x, y + 15);
    }

    if (save.best > 5) {
      const x = sx(save.best);
      if (x > -40 && x < W + 40) {
        const y = surfaceAt(x);
        ctx.strokeStyle = 'rgba(255,200,74,.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y - 36); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = '#ffc84a';
        ctx.beginPath();
        ctx.moveTo(x, y - 36); ctx.lineTo(x + 21, y - 30); ctx.lineTo(x, y - 24);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,74,.85)';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BEST', x + 4, y - 10);
        ctx.textAlign = 'center';
      }
    }
  }

  // ------------------------------------------------------------------- shore
  function drawShore(p) {
    if (sx(1) < -110) return;
    const u = SCALE, px = sx(-1.2);
    const deck = sy(1.1);

    // reeds in the shallows, in front of and behind the pier
    for (let i = 0; i < 26; i++) {
      const wx = -15 + hash(i * 2.3) * 13;
      const x = sx(wx);
      if (x < -30 || x > W + 30) continue;
      const base = surfaceAt(x) + hash(i * 9.1) * 10;
      const h = (12 + hash(i * 4.7) * 26) * (u / 13);
      const sway = Math.sin(time * 1.4 + i) * 3;
      ctx.strokeStyle = i % 3 === 0 ? p.trees : p.reed;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + sway * 0.5, base - h * 0.6, x + sway, base - h);
      ctx.stroke();
    }

    ctx.fillStyle = '#5a3b25';
    ctx.fillRect(sx(-9), deck, u * 8.2, u * 0.32);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(sx(-9), deck, u * 8.2, u * 0.1);
    ctx.fillStyle = '#3e2717';
    for (let i = 0; i < 4; i++) {
      const postX = sx(-8.4 + i * 2.1);
      ctx.fillRect(postX, deck + u * 0.3, u * 0.24, surfaceAt(postX) - deck - u * 0.3 + u * 0.5);
    }

    const aiming = state === STATE.POWER || state === STATE.ANGLE;
    const bob = aiming ? Math.sin(time * 5) * u * 0.05 : 0;
    const feet = deck + bob;
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.arc(px, feet - u * 1.62, u * 0.23, 0, 6.2832);
    ctx.fill();
    ctx.fillRect(px - u * 0.2, feet - u * 1.4, u * 0.4, u * 0.72);
    ctx.fillRect(px - u * 0.18, feet - u * 0.7, u * 0.14, u * 0.7);
    ctx.fillRect(px + u * 0.04, feet - u * 0.7, u * 0.14, u * 0.7);
    ctx.save();
    ctx.translate(px + u * 0.14, feet - u * 1.28);
    ctx.rotate(state === STATE.ANGLE ? -0.95 : -0.25);
    ctx.fillRect(0, -u * 0.07, u * 0.6, u * 0.14);
    ctx.restore();
  }

  // -------------------------------------------------------------------- coins
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
      const g = ctx.createLinearGradient(-w, -rad, w, rad);
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
      if (!c.gem && w > rad * 0.45) {
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

  // ------------------------------------------------------------- stone & wake
  function drawTrail(p) {
    if (trail.length < 2) return;
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const f = i / trail.length;
      ctx.strokeStyle = `rgba(${p.foam},${f * 0.32})`;
      ctx.lineWidth = f * 3.5;
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
  }

  function drawBits(p) {
    for (const b of bits) {
      const t = b.age / b.life;
      const x = sx(b.x), y = sy(b.y);
      const sp = Math.hypot(b.vx, b.vy);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-b.vy, b.vx));
      ctx.fillStyle = `rgba(${p.foam},${(1 - t) * 0.92})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r * (1 - t * 0.35) * (1 + sp * 0.06), b.r * (1 - t * 0.35), 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawRock(p) {
    const x = sx(rock.x);
    let y = sy(rock.y);
    let alpha = 1, shrink = 1;
    if (state === STATE.SINK) {
      const t = clamp(rock.sinkT / 0.95, 0, 1);
      y += t * 34;
      alpha = 1 - t;
      shrink = 1 - t * 0.4;
    }
    const h = clamp(rock.y, 0, 12);
    const rr = clamp(SCALE * 0.62, 8, 16);
    const flat = 1 + save.lv.flat * 0.06;

    // cast shadow
    const sw = clamp(SCALE * 0.55, 7, 14) * (1 - h / 18);
    ctx.fillStyle = `rgba(4,40,66,${0.2 * (1 - h / 16) * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, surfaceAt(x) + 2, sw * shrink, sw * 0.32 * shrink, 0, 0, 6.2832);
    ctx.fill();

    // mirrored in the surface, fading out as the stone climbs
    if (h < 5 && state !== STATE.SINK) {
      const surf = surfaceAt(x);
      ctx.save();
      ctx.globalAlpha = (1 - h / 5) * 0.3;
      ctx.translate(x + Math.sin(time * 3) * 1.5, surf + (surf - y));
      ctx.rotate(-rock.rot);
      ctx.fillStyle = '#3f4a52';
      ctx.beginPath();
      ctx.ellipse(0, 0, rr * flat, rr * 0.4, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rock.rot);
    ctx.scale(shrink * (1 + squash * 0.3), shrink * (1 - squash * 0.28));
    const g = ctx.createLinearGradient(0, -rr * 0.6, 0, rr * 0.6);
    g.addColorStop(0, '#8d99a1');
    g.addColorStop(0.55, '#5b666e');
    g.addColorStop(1, '#3c464d');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rr * flat, rr * 0.56, 0, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,28,34,.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.beginPath();
    ctx.ellipse(-rr * 0.2, -rr * 0.18, rr * 0.46 * flat, rr * 0.17, -0.15, 0, 6.2832);
    ctx.fill();
    ctx.restore();
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

  // ----------------------------------------------------------------------- ui
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

    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    if (isPower) { g.addColorStop(0, '#3a6f8c'); g.addColorStop(1, '#ffc84a'); }
    else {
      g.addColorStop(0, '#3a6f8c');
      g.addColorStop(0.32, '#45d69c');
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
