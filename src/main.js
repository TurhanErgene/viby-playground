import { Scene } from './render/scene.js';
import { Input } from './core/input.js';
import { Hud } from './ui/hud.js';
import { Career } from './game/career.js';
import { resolveStats } from './game/balance.js';
import { Race } from './game/race.js';
import { RIVAL_COLORS, Autopilot } from './game/ai.js';
import * as screens from './ui/screens.js';

const canvas = document.getElementById('stage');
const uiRoot = document.getElementById('ui');
const hudRoot = document.getElementById('hud');
const touchRoot = document.getElementById('touch');

/**
 * A game that fails silently is impossible to report. Anything that stops the
 * page booting gets shown on screen, with the actual message, rather than
 * leaving a black rectangle.
 */
function showFatal(err) {
  const detail = (err && (err.stack || err.message)) || String(err);
  uiRoot.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'screen';
  card.style.maxWidth = '620px';
  card.innerHTML = `
    <h1 style="font-size:24px">Couldn't start</h1>
    <p>The game failed to load in this browser. The details below say why —
       they are worth copying if you report it.</p>
    <pre class="selectable" style="white-space:pre-wrap;word-break:break-word;
      background:rgba(255,255,255,.05);border:1px solid var(--line);
      border-radius:8px;padding:12px;font-size:12px;color:var(--warn);
      max-height:220px;overflow:auto"></pre>
    <p class="hint">Most often this is WebGL being unavailable or blocked —
       hardware acceleration switched off in the browser's settings is the
       usual cause.</p>`;
  card.querySelector('pre').textContent = detail;
  uiRoot.appendChild(card);
}

addEventListener('error', (e) => { if (!booted) showFatal(e.error || e.message); });
let booted = false;

/** Fail with a useful sentence rather than a stack trace from deep in three.js. */
function assertWebGL() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) {
    throw new Error(
      'WebGL is not available. This game needs it to draw anything.\n' +
      'Try enabling hardware acceleration in your browser settings, ' +
      'or open the page in a different browser.');
  }
}

assertWebGL();
const scene = new Scene(canvas);
const input = new Input();
const hud = new Hud(hudRoot);
input.bindTouch(touchRoot);

// A touchscreen laptop reports coarse pointers too, so ask for both signals
// before hiding the keyboard hints and rearranging the HUD for thumbs.
const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
let showPad = isTouch;
document.body.classList.toggle('touch-mode', showPad);

/**
 * An embedded page only receives key events once it has focus, and nothing on
 * screen says so. If a race is running and no key has ever been pressed, say
 * what to do and offer the on-screen controls as a way through.
 */
function setPad(on) {
  showPad = on;
  document.body.classList.toggle('touch-mode', on);
  touchRoot.hidden = !on || game.mode !== 'racing';
}

addEventListener('pointerdown', () => { try { window.focus(); } catch { /* cross-origin */ } });

function keyboardHint() {
  if (hintShown || showPad || input.sawKey) return;
  hintShown = true;
  const el = document.createElement('div');
  el.id = 'kb-hint';
  el.innerHTML = `<span>Click the game once to use the keyboard</span>
    <button id="kb-pad">Use on-screen controls</button>`;
  document.body.appendChild(el);
  el.querySelector('#kb-pad').onclick = () => { setPad(true); el.remove(); };
  const clear = () => { el.remove(); removeEventListener('keydown', clear); };
  addEventListener('keydown', clear);
}
let hintShown = false;

const game = {
  mode: 'menu',      // menu | garage | racing | result | season-end
  career: null,
  race: null,
  demoTrack: null,
  demoTime: 0
};

// --- screen transitions ----------------------------------------------------

function toMenu() {
  game.mode = 'menu';
  game.race = null;
  hud.show(false);
  touchRoot.hidden = true;
  screens.renderMenu(uiRoot, {
    hasSave: !!localStorage.getItem('apex-drift-save-v1'),
    onNew: (seed) => startCareer(new Career(seed ?? Math.floor(Math.random() * 1e9))),
    onContinue: () => { const c = Career.load(); if (c) startCareer(c); else toMenu(); }
  });
  // Something is always moving behind the menu.
  if (!game.demoTrack) game.demoTrack = game.career?.event?.track ?? null;
}

function startCareer(career) {
  game.career = career;
  career.save();
  toGarage();
}

function toGarage() {
  const career = game.career;
  if (career.finished) return toSeasonEnd();
  game.mode = 'garage';
  game.race = null;
  hud.show(false);
  touchRoot.hidden = true;
  scene.loadTrack(career.event.track);
  game.demoTrack = career.event.track;
  game.demoTime = 0;

  screens.renderGarage(uiRoot, career, {
    onUpgrade: (key) => { if (career.upgrade(key)) { career.save(); toGarage(); } },
    onIntel: () => { if (career.buyIntel()) { career.save(); toGarage(); } },
    onRace: startRace,
    onQuit: () => { Career.clear(); game.career = null; toMenu(); }
  });
}

function startRace() {
  accumulator = 0;
  const career = game.career;
  const event = career.event;
  screens.clear(uiRoot);

  const race = new Race(event.track, career.levels, event.grid, {
    laps: event.laps,
    playerName: 'You'
  });
  race.playerValue = career.buildValue;
  game.race = race;
  game.mode = 'racing';
  // A reference driver that can take the wheel — used by the browser test and
  // available as a demo lap.
  game.pilot = new Autopilot(event.track, resolveStats(career.levels), 0.8, event.track.weather);

  scene.loadTrack(event.track);
  scene.addCar('player', 0xe8433a);
  race.rivals.forEach((r, i) => scene.addCar('rival' + i, r.color ?? RIVAL_COLORS[i % RIVAL_COLORS.length]));
  scene.follow(race.player, 1, { snap: true });

  hud.show(true);
  touchRoot.hidden = !showPad;

  // Make the mechanics announce themselves — an invisible mechanic is unused.
  race.player.onEvent = (kind, data) => {
    if (kind === 'drift-release') {
      hud.flash(data.fusion ? `FUSED ×${data.tier}` : `BOOST ×${data.tier}`,
        data.fusion ? '#ff5b47' : '#ffb648');
      scene.bump(0.5 + data.tier * 0.25);
    } else if (kind === 'clean-landing') {
      hud.flash('CLEAN LANDING', '#2fd6a8');
    } else if (kind === 'hard-landing') {
      scene.bump(1.1);
    } else if (kind === 'wall') {
      scene.bump(1.4);
    }
  };
}

function toResult() {
  game.mode = 'result';
  hud.show(false);
  touchRoot.hidden = true;
  const result = game.race.result;
  const event = game.career.event;
  game.career.completeEvent(result);
  screens.renderResult(uiRoot, game.career, result, event, {
    onNext: () => (game.career.finished ? toSeasonEnd() : toGarage())
  });
}

function toSeasonEnd() {
  game.mode = 'season-end';
  hud.show(false);
  screens.renderSeasonEnd(uiRoot, game.career, {
    onRestart: () => { Career.clear(); startCareer(new Career(Math.floor(Math.random() * 1e9))); }
  });
}

// --- loop ------------------------------------------------------------------

let last = performance.now();
let accumulator = 0;

// Physics runs on a fixed step. Advancing it by the frame delta instead lets
// the race clock outrun the car whenever the display drops frames, which
// silently inflates lap times on slower machines.
const STEP = 1 / 120;
const MAX_FRAME = 0.25;

function frame(now) {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  if (game.mode === 'racing' && game.race) {
    if (input.held('reset')) recover(game.race.player);

    accumulator += dt;
    let state = game.race.state;
    let steps = 0;
    while (accumulator >= STEP && steps++ < 40) {
      const controls = game.autoDrive && game.pilot
        ? game.pilot.control(game.race.player, STEP)
        : input.sample(STEP, game.race.player);
      state = game.race.update(STEP, controls);
      accumulator -= STEP;
      if (state === 'over') break;
    }

    scene.syncCar('player', game.race.player);
    game.race.rivals.forEach((r, i) => scene.syncCar('rival' + i, r));
    scene.follow(game.race.player, dt);
    hud.update(game.race, dt);

    if (game.race.time > 1.2) keyboardHint();
    if (state === 'over') toResult();
  } else {
    // Menus fly over the map you are about to race.
    game.demoTime += dt;
    if (game.demoTrack) scene.orbit(game.demoTrack, game.demoTime);
  }

  scene.render();
  requestAnimationFrame(frame);
}

/** Manual recovery. The car also rejoins on its own if it is truly stranded. */
function recover(car) { car.rejoin(); }

// Exposed for the browser smoke test to inspect scene state.
globalThis.__apex = { game, scene, input, setPad };

try {
  toMenu();
  requestAnimationFrame(frame);
  booted = true;
} catch (err) {
  showFatal(err);
  throw err;
}
