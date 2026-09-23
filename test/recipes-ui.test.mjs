/**
 * The recipe screen, in a real browser at kitchen-panel size.
 *
 * TheMealDB can't be reached from this machine (the egress proxy refuses it),
 * so the API is stubbed at the network layer with responses shaped exactly
 * like the real ones — the awkward shapes included. That's enough to test
 * what this file is actually for: that the screen lays out, that a tap opens
 * a recipe, that picking one puts it on the calendar and in the rail, and
 * that nothing is cut off at 1080p.
 *
 * Run with: node test/recipes-ui.test.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ui-'));
const SHOTS = path.join(ROOT, 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = 'http://127.0.0.1:8787';

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

const CARDS = [
  { id: 'meal:52855', kind: 'food', title: 'Banana Pancakes', image: 'https://img.test/banana.jpg', category: 'Baking' },
  { id: 'meal:52900', kind: 'food', title: 'Chocolate Gateau', image: 'https://img.test/gateau.jpg', category: 'Baking' },
  { id: 'meal:52901', kind: 'food', title: 'Sticky Toffee Pudding', image: 'https://img.test/stp.jpg', category: 'Baking' },
  { id: 'meal:52902', kind: 'food', title: 'Cornish Pasty', image: 'https://img.test/pasty.jpg', category: 'Baking' },
  { id: 'meal:52903', kind: 'food', title: 'Bakewell Tart', image: 'https://img.test/tart.jpg', category: 'Baking' },
  { id: 'meal:52904', kind: 'food', title: 'Madeira Cake', image: 'https://img.test/madeira.jpg', category: 'Baking' },
];

const FULL = {
  id: 'meal:52855',
  kind: 'food',
  title: 'Banana Pancakes',
  image: 'https://img.test/banana.jpg',
  category: 'Dessert',
  area: 'American',
  ingredients: ['1 Banana', '1 Egg', '1 tbsp Milk', 'pinch Cinnamon'],
  steps: ['Mash the banana with a fork.', 'Whisk in the egg and milk.', 'Fry for two minutes a side.'],
  source: 'https://example.test/banana-pancakes',
};

const server = spawn('node', [path.join(ROOT, 'app', 'launch.cjs')], {
  env: { ...process.env, BAJA_BLAST_DATA: DATA },
  stdio: 'ignore',
  detached: true,
});

function stop() {
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    try {
      server.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }
}

async function waitForIt() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** A 1×1 png, so image layout is exercised without touching the network. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

try {
  if (!(await waitForIt())) throw new Error('server never came up');

  // CHROMIUM_PATH lets this run against whatever browser is on the machine,
  // the same escape hatch test/phone-app.test.mjs uses.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  // A 27" 1080p panel, which is what this hangs on.
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Stand in for the recipe APIs, and for the photos they'd serve.
  await page.route('**/api/recipes/sections', (route) =>
    route.fulfill(
      json({
        sections: [
          { key: 'baking', title: 'Baking', subtitle: 'Cakes, breads, cookies, pies' },
          { key: 'mocktails', title: 'Mocktails', subtitle: 'No alcohol' },
          { key: 'cocktails', title: 'Cocktails', subtitle: 'Grown-ups only' },
        ],
        categories: [
          { id: 'Chicken', title: 'Chicken', image: null, description: 'Chicken is a type of domesticated fowl' },
          { id: 'Dessert', title: 'Dessert', image: null, description: 'Dessert is a confection' },
          { id: 'Vegetarian', title: 'Vegetarian', image: null, description: 'Not meat' },
        ],
      })
    )
  );
  await page.route('**/api/recipes/section/**', (route) => route.fulfill(json(CARDS)));
  await page.route('**/api/recipes/search**', (route) => route.fulfill(json(CARDS.slice(0, 2))));
  // The id has a colon in it, which the client percent-encodes, so the URL
  // that actually goes out is /api/recipes/meal%3A52855. Matching on the
  // literal colon here silently never fires.
  await page.route('**/api/recipes/meal*', (route) => route.fulfill(json(FULL)));
  await page.route('https://img.test/**', (route) =>
    // A 1×1 png, so layout is exercised without the network.
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(PIXEL, 'base64'),
    })
  );

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Not networkidle: the live stream (/api/stream) is held open for the life
  // of the page, so the network is never idle and never will be.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kiosk');

  console.log('\nGetting in');
  const chef = page.locator('.touch-recipes');
  check('the recipes button is on the calendar', (await chef.count()) === 1);
  await chef.click();
  await page.waitForSelector('.recipe-card');

  console.log('\nThe grid');
  const cardCount = await page.locator('.recipe-card').count();
  check(`every recipe got a card (${cardCount})`, cardCount === CARDS.length);
  check('baking is the tab it opens on', (await page.locator('.recipe-tab.active').innerText()) === 'BAKING');
  const tabCount = await page.locator('.recipe-tab').count();
  check(`food categories became tabs too (${tabCount})`, tabCount === 6);
  check('the empty bake slot asks to be filled', (await page.locator('.recipe-bake-strip.empty').count()) === 1);

  // Nothing may overflow: there is no scrollbar to grab on a wall panel.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('nothing hangs off the right edge', overflow <= 0, `${overflow}px`);

  await page.screenshot({ path: path.join(SHOTS, 'recipes-grid.png') });

  console.log('\nOne recipe');
  await page.locator('.recipe-card').first().click();
  await page.waitForSelector('.recipe-detail-panel');
  check('the ingredients are listed', (await page.locator('.recipe-ingredients li').count()) === 4);
  check('the method is numbered', (await page.locator('.recipe-steps li').count()) === 3);
  check('the title came through', (await page.locator('.recipe-detail-title').innerText()) === 'Banana Pancakes');
  await page.screenshot({ path: path.join(SHOTS, 'recipes-detail.png') });

  console.log('\nPicking it for bake night');
  const bakeButton = page.locator('.recipe-detail-actions .btn-accent');
  check('the button names the day', (await bakeButton.innerText()).toLowerCase().includes('make this'));
  await bakeButton.click();
  await page.waitForSelector('.recipe-toast');
  check('it confirms the pick', (await page.locator('.recipe-toast').innerText()).includes('Banana Pancakes'));

  const stored = await (await fetch(`${BASE}/api/bake`)).json();
  check('the server has it', stored.next.pick?.title === 'Banana Pancakes', JSON.stringify(stored.next.pick));
  check('with its ingredients copied in', stored.next.pick.ingredients.length === 4);

  console.log('\nBack on the calendar');
  await page.locator('.recipe-detail-actions .btn-secondary', { hasText: 'Back' }).click();
  await page.locator('.recipe-head-actions .btn-secondary', { hasText: 'Close' }).click();
  await page.waitForSelector('.bake-rail', { timeout: 10_000 });
  check('the rail shows what we are making', (await page.locator('.bake-rail-title').innerText()) === 'Banana Pancakes');

  // …and on the calendar itself, on the bake day, in the month grid.
  await page.locator('.view-mode', { hasText: 'month' }).click();
  await page.waitForTimeout(600);
  const onGrid = await page.locator('.month-cell', { hasText: 'Banana Pancakes' }).count();
  check('and the month grid has it on bake day', onGrid >= 1, `${onGrid} cells`);
  await page.screenshot({ path: path.join(SHOTS, 'recipes-calendar.png') });

  console.log('\nTyping, with an actual keyboard');
  await page.locator('.touch-recipes').click();
  await page.waitForSelector('.recipe-searchbar');

  // No fake keyboard in the way, and the cursor is already in the box — so
  // opening Recipes and typing works with nothing clicked first.
  check('no on-screen keyboard', (await page.locator('.tkb').count()) === 0);
  const focused = await page.evaluate(() => document.activeElement?.className || '');
  check('the search box already has the cursor', focused.includes('recipe-search-field'), focused);

  await page.keyboard.type('cake');
  check('typing lands in the field', (await page.locator('.recipe-search-field').inputValue()) === 'cake');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('Enter searches', (await page.locator('.recipe-card').count()) === 2);

  console.log('\nSearching the whole web');
  const googleButton = page.locator('.recipe-searchbar .btn-secondary', { hasText: 'Google' });
  check('there is a Google button', (await googleButton.count()) === 1);
  await googleButton.click();
  await page.waitForSelector('.web-bar');
  const address = await page.locator('.web-address').inputValue();
  check('it opens a Google recipe search', address.startsWith('https://www.google.com/search?q='), address);
  check('…for what was typed', decodeURIComponent(address).includes('cake recipe'), address);
  check('…and can still pin it to Bake Night', (await page.locator('.web-bar .btn-accent').count()) === 1);

  // The address bar is a real input: click, type, Enter.
  await page.locator('.web-address').click();
  await page.keyboard.type('king arthur baking');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const searched = await page.locator('.web-address').inputValue();
  check('words in the address bar become a search', searched.includes('google.com/search'), searched);
  await page.locator('.web-bar .btn-secondary', { hasText: 'calendar' }).click();
  await page.waitForTimeout(200);

  console.log('\nThe browser on its own');
  await page.locator('.recipe-head-actions .btn-secondary', { hasText: 'Browse' }).click();
  await page.waitForSelector('.web-bar');
  const backLabel = (await page.locator('.web-bar .btn-secondary').last().innerText()).toLowerCase();
  check('it has a way back to the calendar', backLabel.includes('calendar'), backLabel);
  check('back is disabled on the first page', await page.locator('.web-btn').first().isDisabled());
  check('and no on-screen keyboard here either', (await page.locator('.tkb').count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, 'browser.png') });

  // Escape gets out, which is what a keyboard user reaches for first.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Escape closes the browser', (await page.locator('.web-bar').count()) === 0);

  console.log('\nAnd on a phone');
  {
    // Same server, same pick — the phone is where someone at the shop looks.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.route('https://img.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PIXEL, 'base64') })
    );
    await phone.goto(`${BASE}/mobile`, { waitUntil: 'domcontentloaded' });
    await phone.locator('.tab', { hasText: 'Bake' }).click();
    await phone.waitForSelector('#bakeNow h3');
    // innerText, not textContent: the phone stylesheet uppercases h3, so this
    // compares what the markup says rather than what the CSS renders.
    const phoneTitle = await phone.locator('#bakeNow h3').textContent();
    check('the phone shows this week\'s bake', phoneTitle === 'Banana Pancakes', phoneTitle);
    check('with its ingredients for the shop', (await phone.locator('#bakeNow li').count()) === 4);
    const weeks = await phone.locator('#bakeWeek option').count();
    check(`and offers the weeks ahead (${weeks})`, weeks >= 4);

    await phone.locator('#bakeNow button', { hasText: 'grocery' }).click();
    await phone.waitForTimeout(600);
    const list = await (await fetch(`${BASE}/api/grocery`)).json();
    check('ingredients go onto the shared grocery list', list.length === 4, `${list.length}`);

    // No horizontal scroll on a phone: the tab strip scrolls, the page doesn't.
    const phoneOverflow = await phone.evaluate(() => document.body.scrollWidth - window.innerWidth);
    check('nothing overflows at 390px', phoneOverflow <= 0, `${phoneOverflow}px`);
    await phone.screenshot({ path: path.join(SHOTS, 'phone-bake.png'), fullPage: true });
    await phone.close();
  }

  console.log('\nOverall');
  check('no JavaScript errors anywhere', errors.length === 0, errors.join(' | '));

  await browser.close();
} catch (err) {
  check('the suite ran', false, String(err));
} finally {
  stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`Screenshots in ${SHOTS}\n`);
process.exit(fail === 0 ? 0 : 1);
