/**
 * The wall's browser, in a real Chromium with the wall add-on loaded
 * (packaging/pi/extension). Not part of `npm test`, which has to run
 * anywhere: this one needs Playwright's Chromium.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node app/launch.cjs &          # the calendar on :8787
 *   node test/wall-browser.test.mjs
 *
 * Proves what failed on the wall twice: a website opens in the calendar's
 * own window, has a way home and a keyboard, and comes home on its own.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A path, not a URL: the project folder's name has a space in it.
const EXT = fileURLToPath(new URL('../packaging/pi/extension', import.meta.url));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${!ok && d ? ' — ' + d : ''}`); };

// A pretend website, on another origin: a search box, and a results page.
const site = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url.startsWith('/search')) return res.end(`<h1 id=r>results for ${new URL(req.url, 'http://x').searchParams.get('q')}</h1>`);
  res.end(`<form action=/search><input name=q id=q></form><a id=new href="/search?q=newtab" target=_blank>new</a>`);
});
await new Promise((r) => site.listen(9911, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:9911/';

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wall-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1536, height: 864 },
});
const page = ctx.pages()[0] || (await ctx.newPage());

await page.goto('http://localhost:8787/');
await page.waitForTimeout(800);
check('the calendar knows the way back is there', (await page.evaluate(() => document.documentElement.dataset.bajaWall)) === '1');

await page.goto(SITE);
await page.waitForSelector('#baja-wall', { state: 'attached' });
const wall = page.locator('#baja-wall');
check('a website gets the bar', await wall.locator('.bar').isVisible());
check('with a way home', await wall.locator('button.home').isVisible());

await page.click('#q');
await page.waitForTimeout(300);
check('tapping the search box brings up the keyboard', await wall.locator('.kbd.open').isVisible());
for (const ch of ['p', 'a', 's', 't', 'a']) await wall.locator('button.key', { hasText: new RegExp(`^${ch}$`) }).first().dispatchEvent('pointerdown');
check('the keys type into the site', (await page.inputValue('#q')) === 'pasta', await page.inputValue('#q'));
await wall.locator('button.key', { hasText: /^go$/ }).dispatchEvent('pointerdown');
await page.waitForURL(/search\?q=pasta/, { timeout: 5000 }).catch(() => {});
check('go searches', /search\?q=pasta/.test(page.url()), page.url());
await page.waitForSelector('#baja-wall', { state: 'attached' });

await wall.locator('button[data-a=back]').dispatchEvent('pointerdown');
await page.waitForURL(SITE, { timeout: 5000 }).catch(() => {});
check('back goes back', page.url() === SITE, page.url());

await page.waitForSelector('#new');
await page.click('#new');
await page.waitForURL(/q=newtab/, { timeout: 5000 }).catch(() => {});
check('a link meant for a new window opens here instead', /q=newtab/.test(page.url()) && ctx.pages().length === 1, `${page.url()} pages=${ctx.pages().length}`);

await page.waitForSelector('#baja-wall', { state: 'attached' });
await wall.locator('button.home').dispatchEvent('pointerdown');
await page.waitForURL('http://localhost:8787/', { timeout: 5000 }).catch(() => {});
check('Calendar comes home', page.url() === 'http://localhost:8787/', page.url());

// A timer going off while someone's on a website.
await page.goto(SITE);
await page.waitForSelector('#baja-wall', { state: 'attached' });
await fetch('http://localhost:8787/api/timers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seconds: 5, label: 'Pasta' }) });
await page.waitForURL('http://localhost:8787/', { timeout: 20000 }).catch(() => {});
check('a kitchen timer going off brings the calendar back', page.url() === 'http://localhost:8787/', page.url());

await ctx.close();
site.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
