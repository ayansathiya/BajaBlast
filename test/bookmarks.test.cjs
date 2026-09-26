/**
 * Bookmarks.
 *
 * The list is shared and it feeds a browser on a wall, which makes the
 * validation the interesting part rather than the storage. Anyone on the
 * house Wi-Fi can POST to this route from the phone page, and whatever they
 * save becomes a link the kiosk will open when somebody taps it. So the
 * scheme check is a real boundary, not a formality: `file:///etc/passwd` and
 * `javascript:` must not survive it.
 *
 * The rest is the ordinary stuff — one entry per address, re-saving moves it
 * up rather than duplicating, and a name is invented when none is given.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const bookmarks = require(path.join(ROOT, 'app', 'bookmarks.cjs'));

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

console.log('\nWhat counts as a web address');
{
  check('a full url passes', bookmarks.safeUrl('https://example.com/x') === 'https://example.com/x');
  check('a bare domain gains https', bookmarks.safeUrl('allrecipes.com') === 'https://allrecipes.com/');
  check('http is allowed too', bookmarks.safeUrl('http://192.168.1.40:8787/') === 'http://192.168.1.40:8787/');
  check('whitespace is trimmed', bookmarks.safeUrl('  example.com  ') === 'https://example.com/');

  // The boundary. Anyone on the Wi-Fi can reach the route that calls this.
  check('javascript: is refused', bookmarks.safeUrl('javascript:alert(1)') === null);
  check('file: is refused', bookmarks.safeUrl('file:///etc/passwd') === null);
  check('data: is refused', bookmarks.safeUrl('data:text/html,<script>x</script>') === null);
  check('empty is refused', bookmarks.safeUrl('   ') === null);
  check('nonsense is refused', bookmarks.safeUrl('http://') === null);
}

console.log('\nNaming one');
{
  check('a given name wins', bookmarks.titleFor('https://example.com', 'Lunch menu') === 'Lunch menu');
  check('otherwise the site names it', bookmarks.titleFor('https://www.bbc.co.uk/food') === 'bbc.co.uk');
  check('a blank name falls back', bookmarks.titleFor('https://example.com', '   ') === 'example.com');
  check('a very long name is cut', bookmarks.titleFor('https://example.com', 'x'.repeat(400)).length === 120);
}

console.log('\nAdding and removing');
{
  let list = [];

  list = bookmarks.add(list, { url: 'example.com', title: 'First' }).list;
  list = bookmarks.add(list, { url: 'https://second.com' }).list;
  check('two bookmarks', list.length === 2, `${list.length}`);
  check('newest first', list[0].url === 'https://second.com/', list[0].url);
  check('the unnamed one names itself', list[0].title === 'second.com', list[0].title);

  // Saving something you already have is how people say "this one matters".
  const again = bookmarks.add(list, { url: 'https://example.com/', title: 'First again' });
  check('re-saving does not duplicate', again.list.length === 2, `${again.list.length}`);
  check('…it moves to the front', again.list[0].url === 'https://example.com/', again.list[0].url);
  check('…with the new name', again.list[0].title === 'First again', again.list[0].title);

  const bad = bookmarks.add(again.list, { url: 'javascript:alert(1)' });
  check('a bad address is rejected, not stored', !!bad.error && !bad.list, JSON.stringify(bad));

  const fewer = bookmarks.remove(again.list, 'https://example.com/');
  check('removing by url works', fewer.length === 1, `${fewer.length}`);
  check('…and removes the right one', fewer[0].url === 'https://second.com/', fewer[0].url);
  check('removing something absent is harmless', bookmarks.remove(fewer, 'nope').length === 1);
}

console.log('\nReading a store written by someone else');
{
  const messy = bookmarks.normalize([
    { url: 'https://good.com' },
    null,
    'not an object',
    { url: 'javascript:alert(1)' },
    { url: 'https://good.com' }, // duplicate
    { nope: true },
  ]);
  check('only the good one survives', messy.length === 1, JSON.stringify(messy));
  check('…and it is complete', !!(messy[0].id && messy[0].title && messy[0].addedAt));
  check('a non-array is an empty list', bookmarks.normalize('nope').length === 0);
  check('undefined is an empty list', bookmarks.normalize(undefined).length === 0);

  const many = bookmarks.normalize(
    Array.from({ length: 200 }, (_, i) => ({ url: `https://site${i}.com` }))
  );
  check(`the list is capped (${many.length})`, many.length === bookmarks.MAX_BOOKMARKS);
}

/* ------------------------------------------------------------------ *
 * Against a real server
 * ------------------------------------------------------------------ */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-marks-'));
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

const BASE = 'http://127.0.0.1:8787';

(async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\nThrough the routes');

  const empty = await (await fetch(`${BASE}/api/bookmarks`)).json();
  check('a new household has none', Array.isArray(empty) && empty.length === 0, JSON.stringify(empty));

  const made = await fetch(`${BASE}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'allrecipes.com/recipes/276/desserts/cakes/', title: 'Cakes' }),
  });
  check('saving one works', made.status === 201, `${made.status}`);

  const list = await (await fetch(`${BASE}/api/bookmarks`)).json();
  check('and it comes back', list.length === 1 && list[0].title === 'Cakes', JSON.stringify(list));
  check('with a scheme added', list[0].url.startsWith('https://'), list[0].url);

  // Written through, not just held in memory: the kiosk restarts on every
  // update, and a bookmark that only lived in RAM would vanish overnight.
  const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
  check('it is on disk', onDisk.bookmarks.length === 1, JSON.stringify(onDisk.bookmarks));

  const refused = await fetch(`${BASE}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'file:///etc/passwd' }),
  });
  check('the route refuses a file: url', refused.status === 400, `${refused.status}`);

  const stillOne = await (await fetch(`${BASE}/api/bookmarks`)).json();
  check('…and stored nothing', stillOne.length === 1, `${stillOne.length}`);

  await fetch(`${BASE}/api/bookmarks/${encodeURIComponent(list[0].id)}`, { method: 'DELETE' });
  const gone = await (await fetch(`${BASE}/api/bookmarks`)).json();
  check('deleting works', gone.length === 0, JSON.stringify(gone));

  stop();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  stop();
  console.error(err);
  process.exit(1);
});
