/**
 * Checks the ways the game can fail on someone else's machine:
 * a browser with no WebGL, and an embedded page that never receives the
 * keyboard. Both must end in something the player can read and act on
 * rather than a black rectangle.
 *   npm run fallbacks
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server:{port:5192,host:'127.0.0.1'}, logLevel:'error' });
await server.listen();
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
let bad = 0;
const ok = (c,m) => { console.log((c?'  ok  ':'FAIL: ')+m); if(!c) bad++; };

// 1. WebGL unavailable -> a readable card, not a black screen.
{
  const p = await b.newPage({ viewport:{width:1100,height:700} });
  await p.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) {
      if (String(t).startsWith('webgl')) return null;
      return real.call(this, t, ...a);
    };
  });
  await p.goto('http://127.0.0.1:5192/', { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(1200);
  const txt = await p.locator('#ui').innerText().catch(() => '');
  ok(/Couldn't start/i.test(txt), 'WebGL failure shows a readable card');
  ok(/WebGL is not available/i.test(txt), 'card names the actual cause');
  await p.screenshot({ path: 'docs/shot-fatal.png' });
  await p.close();
}

// 2. Racing with no key ever pressed -> hint + working on-screen fallback.
{
  const p = await b.newPage({ viewport:{width:1100,height:700} });
  await p.goto('http://127.0.0.1:5192/', { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('#seed').fill('fallback');
  await p.locator('#btn-new').click(); await p.waitForTimeout(500);
  ok(await p.locator('#touch').isHidden(), 'no thumb controls on a desktop pointer');
  await p.locator('#btn-race').click();
  await p.waitForTimeout(6000);
  ok(await p.locator('#kb-hint').count() > 0, 'keyboard hint appears when no key is ever pressed');
  await p.screenshot({ path: 'docs/shot-kbhint.png' });

  await p.locator('#kb-pad').click();
  await p.waitForTimeout(400);
  ok(await p.locator('#touch').isVisible(), 'on-screen controls can be turned on with the mouse');

  // Drive with the mouse alone.
  const go = p.locator('[data-touch="throttle"]');
  await go.dispatchEvent('pointerdown');
  await p.waitForTimeout(3500);
  const kmh = await p.evaluate(() => globalThis.__apex.game.race.player.kmh);
  await go.dispatchEvent('pointerup');
  ok(kmh > 40, `car drives from the on-screen controls (${kmh.toFixed(0)} km/h)`);
  await p.close();
}

// 3. The hint must NOT appear once a key has been used.
{
  const p = await b.newPage({ viewport:{width:1100,height:700} });
  await p.goto('http://127.0.0.1:5192/', { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('#btn-new').click(); await p.waitForTimeout(500);
  await p.locator('#btn-race').click();
  await p.waitForTimeout(1000);
  await p.keyboard.press('KeyW');
  await p.waitForTimeout(5000);
  ok(await p.locator('#kb-hint').count() === 0, 'hint stays away for a working keyboard');
  await p.close();
}

await b.close(); await server.close();
console.log(bad ? '\nFALLBACK CHECKS FAILED' : '\nfallbacks work');
process.exit(bad ? 1 : 0);
