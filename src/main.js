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

const scene = new Scene(canvas);
const input = new Input();
const hud = new Hud(hudRoot);
input.bindTouch(touchRoot);

const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

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
  touchRoot.hidden = !isTouch;

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
        : input.sample(STEP);
      state = game.race.update(STEP, controls);
      accumulator -= STEP;
      if (state === 'over') break;
    }

    scene.syncCar('player', game.race.player);
    game.race.rivals.forEach((r, i) => scene.syncCar('rival' + i, r));
    scene.follow(game.race.player, dt);
    hud.update(game.race, dt);

    if (state === 'over') toResult();
  } else {
    // Menus fly over the map you are about to race.
    game.demoTime += dt;
    if (game.demoTrack) scene.orbit(game.demoTrack, game.demoTime);
  }

  scene.render();
  requestAnimationFrame(frame);
}

/** Put a beached car back on the road facing the right way, with no speed. */
function recover(car) {
  const s = car.track.samples[car.index];
  car.x = s.x; car.z = s.z; car.y = s.y;
  car.yaw = Math.atan2(s.tz, s.tx);
  car.vf = Math.min(car.vf, 8); car.vl = 0; car.vy = 0;
  car.airborne = false;
  car.driftCharge = 0;
}

// Exposed for the browser smoke test to inspect scene state.
globalThis.__apex = { game, scene, input };

toMenu();
requestAnimationFrame(frame);
