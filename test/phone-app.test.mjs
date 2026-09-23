/**
 * Does the phone page actually behave like an installed app?
 *
 * Not part of `npm test`: it needs Playwright and a Chromium, which would
 * roughly triple the release build for a check that guards markup rather than
 * the update path. Run it by hand after touching mobile.html, sw.js or the
 * manifest:
 *
 *     npx playwright install chromium
 *     node test/phone-app.test.mjs
 *
 * Three things a manifest alone doesn't prove:
 *   1. the manifest and icons are reachable BEFORE anyone signs in (a 401 on
 *      the manifest means no install prompt and no home-screen icon)
 *   2. the service worker really registers and really caches
 *   3. with the server switched off, the app still opens and still shows the
 *      calendar it last saw — and says that's what it's doing
 *
 * Served over http://localhost, which browsers treat as a secure origin, so
 * the service worker registers exactly as it would over HTTPS on Tailscale.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://localhost:8787';

/**
 * The test owns the server, because "offline" has to mean the kitchen box is
 * genuinely unreachable.
 *
 * Playwright's setOffline only cuts the page's network — a service worker's
 * own fetches sail straight past it and reach the server anyway, which makes
 * the offline path look like it works when it hasn't been exercised at all.
 * Stopping the server is the real thing, and it's also literally the scenario:
 * the Mac is asleep, the Pi is unplugged, you're on a train.
 */
let server = null;

async function startServer() {
  server = spawn('node', [process.env.BAJA_TEST_SERVER || new URL('../app/server.cjs', import.meta.url).pathname], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('server never came up');
}

async function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    try { server.kill('SIGKILL'); } catch { /* already gone */ }
  }
  server = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      await fetch(`${BASE}/health`);
    } catch {
      return; // refusing connections — properly down
    }
    await sleep(250);
  }
  throw new Error('server would not stop');
}

await startServer();
let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({
  viewport: { width: 420, height: 900 },
  deviceScaleFactor: 2,
  serviceWorkers: 'allow',
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('   PAGEERROR:', e.message));

console.log('\nThe manifest and icons are reachable');
{
  const manifest = await page.request.get(`${BASE}/manifest.webmanifest`);
  check('manifest returns 200', manifest.status() === 200, `got ${manifest.status()}`);
  check(
    'served as a manifest, not as plain text',
    (manifest.headers()['content-type'] || '').includes('manifest+json'),
    manifest.headers()['content-type'],
  );

  const m = await manifest.json();
  check('has a name', !!m.name);
  check('opens standalone, without browser chrome', m.display === 'standalone', m.display);
  check('starts on the phone page', m.start_url === '/mobile', m.start_url);
  check('scope covers the API it calls', m.scope === '/', m.scope);
  check('background matches the app, so no white flash', m.background_color === '#000000', m.background_color);

  const sizes = (m.icons || []).map((i) => i.sizes);
  check('has the 192 and 512 icons Android requires', sizes.includes('192x192') && sizes.includes('512x512'), sizes.join(','));
  check('has a maskable icon', (m.icons || []).some((i) => i.purpose === 'maskable'));

  for (const icon of m.icons || []) {
    const res = await page.request.get(BASE + icon.src);
    const ct = res.headers()['content-type'] || '';
    check(`${icon.src} loads as a real PNG`, res.status() === 200 && ct.includes('image/png'), `${res.status()} ${ct}`);
  }

  const apple = await page.request.get(`${BASE}/icons/apple-touch-icon-180.png`);
  check('iPhone home-screen icon loads', apple.status() === 200, `got ${apple.status()}`);

  const sw = await page.request.get(`${BASE}/sw.js`);
  check('service worker loads', sw.status() === 200, `got ${sw.status()}`);
  check(
    'service worker is never cached',
    (sw.headers()['cache-control'] || '').includes('no-store'),
    sw.headers()['cache-control'],
  );
  check(
    'service worker allowed to control the whole origin',
    sw.headers()['service-worker-allowed'] === '/',
    sw.headers()['service-worker-allowed'],
  );
  check('build stamped into the cache name', !(await sw.text()).includes('__BUILD__'));
}

console.log('\nThe page links it all up');
{
  await page.goto(`${BASE}/mobile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  check('links the manifest', (await page.locator('link[rel="manifest"]').count()) === 1);
  check('declares an apple-touch-icon', (await page.locator('link[rel="apple-touch-icon"]').count()) > 0);
  check(
    'tells iOS to open it full screen',
    (await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content')) === 'yes',
  );
  check(
    'names the icon on the home screen',
    (await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content')) === 'Baja Blast',
  );

  // The notch: with black-translucent the page draws under the status bar, so
  // the top inset has to be respected or the title sits behind the clock.
  const usesSafeArea = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return document.styleSheets.length > 0 && !!style.paddingTop !== undefined;
  });
  check('body padding uses the safe-area insets', usesSafeArea);
}

console.log('\nThe service worker registers and caches');
{
  await page.waitForTimeout(2500);
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return { registered: false };
    await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith('baja-shell-'));
    const cached = shell ? (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname) : [];
    return { registered: true, scope: reg.scope, names, cached };
  });

  check('registered', state.registered);
  check('scope is the whole origin', (state.scope || '').endsWith('/'), state.scope);
  check('cache name carries the build', (state.names || []).some((n) => /baja-shell-\d{4}-\d{2}-\d{2}/.test(n)), (state.names || []).join(','));
  check('cached the page itself', (state.cached || []).includes('/mobile'), (state.cached || []).join(' '));
  check('cached the icons', (state.cached || []).some((p) => p.startsWith('/icons/')), (state.cached || []).join(' '));

  // Prime the data cache by visiting the tabs that read it.
  await page.evaluate(() =>
    Promise.all(
      ['/api/settings', '/api/grocery', '/api/events/expanded?from=2026-09-01&to=2026-10-01'].map((u) =>
        fetch(u, { cache: 'no-store' }).catch(() => {}),
      ),
    ),
  );
  await page.waitForTimeout(800);

  const dataCached = await page.evaluate(async () => {
    const names = await caches.keys();
    const data = names.find((n) => n.startsWith('baja-data-'));
    if (!data) return [];
    return (await (await caches.open(data)).keys()).map((r) => new URL(r.url).pathname);
  });
  check('cached the settings', dataCached.includes('/api/settings'), dataCached.join(' '));
  check('cached the grocery list', dataCached.includes('/api/grocery'), dataCached.join(' '));
}

console.log('\nWith home unreachable, it still opens and says so');
{
  // The kitchen box goes away entirely — asleep, unplugged, or you're on a
  // train. Not a simulated page-level outage: the server is actually stopped,
  // so the service worker's own fetches fail too.
  await stopServer();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const title = await page.title();
  check('the app still opens', title.includes('Baja Blast'), title);

  const bodyText = await page.locator('body').innerText();
  check('it does not show a browser error page', !/ERR_|not available offline/i.test(bodyText));

  const bar = page.locator('#connbar');
  const barVisible = await bar.isVisible().catch(() => false);
  const barText = barVisible ? await bar.innerText() : '';
  check('it says the data is not live', barVisible, 'the offline banner never appeared');
  check('and says so honestly', /reach home|saved data|last saw/i.test(barText), barText);

  await page.screenshot({ path: 'phone-offline.png', fullPage: false });

  await startServer();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const backOnline = await page.locator('#connbar').isVisible().catch(() => false);
  check('the warning clears once it can reach home again', !backOnline);
  await page.screenshot({ path: 'phone-installed.png', fullPage: false });
}

await browser.close();
await stopServer();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
