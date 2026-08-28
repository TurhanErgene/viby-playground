/**
 * Browser smoke test: boots the built game, plays through menu -> garage ->
 * race, drives for a few seconds and asserts the car actually moved and the
 * HUD is live. Catches the whole class of "it builds but the page is blank".
 *   npm run smoke
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const shots = process.argv.includes('--shots');
const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = 'http://127.0.0.1:5199/';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const fail = (msg) => { console.error('FAIL: ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('  ok  ' + msg);

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// --- menu ---
if (!(await page.locator('#btn-new').count())) fail('menu did not render');
else ok('menu renders');
if (shots) await page.screenshot({ path: 'docs/shot-menu.png' });

// --- garage ---
// Pin the season seed: a random map every run makes a failure impossible to
// reproduce, and this test exists to be trusted.
await page.locator('#seed').fill(process.env.SMOKE_SEED || 'smoke-1');
await page.locator('#btn-new').click();
await page.waitForTimeout(600);
const trackName = await page.locator('.screen h1').first().textContent();
if (!(await page.locator('#btn-race').count())) fail('garage did not render');
else ok(`garage renders (map: ${trackName?.trim()})`);

const upgrades = await page.locator('[data-up]').count();
if (upgrades !== 7) fail(`expected 7 upgrade tracks, saw ${upgrades}`);
else ok('7 upgrade tracks offered');

// Buy something so the shop is exercised.
const buyable = page.locator('[data-up]:not([disabled])').first();
if (await buyable.count()) {
  await buyable.click();
  await page.waitForTimeout(300);
  ok('an upgrade can be purchased');
}
if (shots) await page.screenshot({ path: 'docs/shot-garage.png' });

// --- race ---
await page.locator('#btn-race').click();
await page.waitForTimeout(300);
if (await page.locator('#hud').isHidden()) fail('HUD did not appear');
else ok('race started, HUD visible');

// Wait out the countdown, then drive.
await page.waitForTimeout(3600);
if (shots) await page.screenshot({ path: 'docs/shot-grid.png' });
// Hand the wheel to the reference driver: a blind straight-line input just
// leaves the road on the first corner and tells us nothing.
await page.evaluate(() => { globalThis.__apex.game.autoDrive = true; });
await page.waitForTimeout(9000);
const driven = await page.evaluate(() => {
  const { race } = globalThis.__apex.game;
  const c = race.player;
  return {
    kmh: c.kmh, progress: c.progress, raceTime: race.time,
    walls: c.telemetry.wallHits, off: c.telemetry.offTrackTime
  };
});
// Software rendering here runs well below 60fps, so judge the car by simulated
// race time rather than by how long the test sat waiting.
const avg = driven.progress / Math.max(0.1, driven.raceTime);
if (!(driven.kmh > 80)) fail(`car did not get up to speed (${driven.kmh.toFixed(0)} km/h)`);
else ok(`car reaches racing speed (${driven.kmh.toFixed(0)} km/h)`);
if (!(avg > 10)) fail(`car averaged only ${avg.toFixed(1)} m/s along the track`);
else ok(`car covers ground (${driven.progress.toFixed(0)}m, avg ${avg.toFixed(1)} m/s)`);
const offShare = driven.off / Math.max(0.1, driven.raceTime);
if (offShare > 0.25) fail(`reference driver spent ${(offShare * 100).toFixed(0)}% of the lap off track`);
else ok(`stays on the racing surface (${(offShare * 100).toFixed(0)}% off track)`);

if (shots) await page.screenshot({ path: 'docs/shot-race.png' });
await page.evaluate(() => { globalThis.__apex.game.autoDrive = false; });

// Turn and yank the handbrake to exercise the drift system. Throttle stays on:
// drift charge needs speed, and a coasting car would fail this for the wrong
// reason. Sample the bar repeatedly — charge builds while sliding, then empties.
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(700);
await page.keyboard.down('ArrowLeft');
await page.keyboard.down('Space');
let peak = 0;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(80);
  const w = parseFloat(await page.locator('#hud-drift').evaluate((e) => e.style.width)) || 0;
  peak = Math.max(peak, w);
}
await page.keyboard.up('Space');
await page.keyboard.up('ArrowLeft');
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(900);
if (!(peak > 3)) fail(`handbrake did not build drift charge (peak ${peak.toFixed(1)}%)`);
else ok(`drift charge builds while sliding (peak ${peak.toFixed(0)}%)`);

const lap = await page.locator('#hud-lap').textContent();
const pos = await page.locator('#hud-pos').textContent();
ok(`HUD live (${pos?.trim()}, ${lap?.trim()})`);

if (errors.length) {
  fail('console errors:\n    ' + errors.slice(0, 8).join('\n    '));
} else {
  ok('no console errors');
}

await browser.close();
await server.close();
console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nsmoke test passed');
