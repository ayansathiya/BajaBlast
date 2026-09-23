/**
 * Bake Night.
 *
 * Three things are worth testing here and one of them is easy to forget:
 *
 *   1. The date maths, including the two weeks a year when the clocks change
 *      and "add seven days" is not "add 168 hours".
 *   2. That the week rolls over on its own. Nothing schedules that — it falls
 *      out of keying picks by date — so it's worth proving rather than
 *      assuming.
 *   3. That the server's copy of the maths (app/bake.cjs) and the browser's
 *      copy (src/engine/bake.ts) agree. They're deliberately duplicated so
 *      neither side has to import the other's module system, and duplicated
 *      logic drifts unless something checks.
 *
 * The route tests at the end run against a real server on a temp data dir.
 */
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const bake = require(path.join(ROOT, 'app', 'bake.cjs'));

// The front-end copy, compiled so this file can require it.
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bake-')), 'bake.cjs');
execFileSync('npx', ['esbuild', 'src/engine/bake.ts', '--format=cjs', `--outfile=${OUT}`, '--log-level=warning'], {
  cwd: ROOT,
});
const web = require(OUT);

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

/* ------------------------------------------------------------------ */
console.log('\nWhich day is bake day');
{
  // 2026-09-21 is a Monday.
  const monday = new Date(2026, 8, 21, 9, 0, 0);
  check('Saturday from Monday is five days out', bake.dateKey(bake.nextBakeDate(6, monday)) === '2026-09-26');
  check('Monday from Monday is today', bake.dateKey(bake.nextBakeDate(1, monday)) === '2026-09-21');
  check('Sunday from Monday is six days out', bake.dateKey(bake.nextBakeDate(0, monday)) === '2026-09-27');

  // The whole day counts, not the moment. Someone looking at the kiosk at
  // 11pm on bake day should still see what was made, not next week's blank.
  const lateOnBakeDay = new Date(2026, 8, 26, 23, 30, 0);
  check('still today at 11:30pm on bake day', bake.dateKey(bake.nextBakeDate(6, lateOnBakeDay)) === '2026-09-26');

  const justAfter = new Date(2026, 8, 27, 0, 5, 0);
  check('rolls to next week just after midnight', bake.dateKey(bake.nextBakeDate(6, justAfter)) === '2026-10-03');

  check('a nonsense weekday falls back to Saturday', bake.normalizeWeekday('x') === 6);
  check('0 is a real weekday, not falsy-nothing', bake.normalizeWeekday(0) === 0);
}

console.log('\nThe clocks changing does not move bake day');
{
  // US DST ends on 2026-11-01. Adding 7×24h across that boundary lands an
  // hour early, which in a local-midnight calculation is the previous day.
  const before = new Date(2026, 9, 24, 12, 0, 0); // Sat 24 Oct
  const dates = bake.bakeDatesBetween(6, before, new Date(2026, 10, 30));
  const keys = dates.map(bake.dateKey);
  check('every date is still a Saturday', dates.every((d) => d.getDay() === 6), keys.join(','));
  check('the week after the change is right', keys.includes('2026-11-07'), keys.join(','));
  check('no week is skipped or doubled', new Set(keys).size === keys.length, keys.join(','));
}

console.log('\nA month grid gets four or five bake days');
{
  const from = new Date(2026, 8, 1);
  const to = new Date(2026, 9, 1);
  const dates = bake.bakeDatesBetween(6, from, to);
  check('September 2026 has four Saturdays in range', dates.length === 4, `${dates.length}`);
  check('a reversed range returns nothing rather than spinning', bake.bakeDatesBetween(6, to, from).length === 0);
}

/* ------------------------------------------------------------------ */
console.log('\nThe server and the browser agree on the maths');
{
  let mismatches = 0;
  const detail = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    for (let day = 0; day < 400; day += 1) {
      const when = new Date(2026, 0, 1 + day, 13, 0, 0);
      const a = bake.dateKey(bake.nextBakeDate(weekday, when));
      const b = web.dateKey(web.nextBakeDate(weekday, when));
      if (a !== b) {
        mismatches += 1;
        if (detail.length < 3) detail.push(`${when.toDateString()} wd=${weekday}: ${a} vs ${b}`);
      }
    }
  }
  check('2800 dates, no disagreement', mismatches === 0, detail.join(' | '));
}

/* ------------------------------------------------------------------ */
console.log('\nA pick is cleaned before it is stored');
{
  const now = new Date('2026-09-21T12:00:00Z');

  check('nothing to show is rejected', bake.normalizePick({}, now) === null);
  check('a whitespace title is rejected', bake.normalizePick({ title: '   ' }, now) === null);
  check(
    'a javascript: url is rejected',
    bake.normalizePick({ title: 'x', url: 'javascript:alert(1)' }, now) === null
  );

  const web1 = bake.normalizePick({ url: 'https://example.com/banana-bread' }, now);
  check('a bare url becomes a web pick', web1.kind === 'web', web1 && web1.kind);
  check('…titled with the url when the page had no name', web1.title === 'https://example.com/banana-bread');

  const api = bake.normalizePick(
    {
      id: 'meal:52855',
      title: 'Banana Pancakes',
      image: 'https://img.example/banana.jpg',
      ingredients: ['1 cup flour', '2 bananas'],
      steps: ['Mash the bananas', 'Cook'],
    },
    now
  );
  check('an api recipe keeps its id', api.id === 'meal:52855');
  check('…and its ingredients, copied for bake day', api.ingredients.length === 2);
  check('…and is not a web pick', api.kind === 'food', api.kind);
  check('…and is stamped', api.pickedAt === now.toISOString());

  const junkImage = bake.normalizePick({ title: 'x', image: 'data:image/png;base64,AAAA' }, now);
  check('a non-http image is dropped', junkImage.image === null);

  const huge = bake.normalizePick({ title: 'x', ingredients: new Array(500).fill('flour') }, now);
  check('a runaway ingredient list is capped', huge.ingredients.length === 40, `${huge.ingredients.length}`);
}

console.log('\nOld picks are forgotten, recent ones are not');
{
  const now = new Date(2026, 8, 21);
  const stored = {
    picks: {
      '2025-01-04': { title: 'Ancient' },
      '2026-09-05': { title: 'Recent' },
      '2026-09-26': { title: 'Upcoming' },
      'not-a-date': { title: 'Junk' },
    },
  };
  const pruned = bake.prunePicks(bake.normalizeBake(stored), now);
  check('the junk key never survives normalising', !('not-a-date' in pruned.picks));
  check('last year is dropped', !('2025-01-04' in pruned.picks));
  check('this month is kept', '2026-09-05' in pruned.picks);
  check('next week is kept', '2026-09-26' in pruned.picks);
}

console.log('\nThe week rolls over on its own');
{
  const picks = { picks: { '2026-09-26': { title: 'Banana Bread' } } };

  const duringThatWeek = bake.summary(picks, 6, new Date(2026, 8, 23));
  check('mid-week, next is that Saturday', duringThatWeek.next.date === '2026-09-26');
  check('…and it knows what we are making', duringThatWeek.next.pick.title === 'Banana Bread');

  const onTheDay = bake.summary(picks, 6, new Date(2026, 8, 26, 8, 0));
  check('on the day itself it is still showing', onTheDay.next.pick.title === 'Banana Bread');
  check('…and says so', onTheDay.next.isToday === true);

  // Nothing ran. No timer, no cron, no reset button.
  const theNextMonday = bake.summary(picks, 6, new Date(2026, 8, 28));
  check('the following week has moved on', theNextMonday.next.date === '2026-10-03');
  check('…to an empty slot, with no reset needed', theNextMonday.next.pick === null);
  check('last week is still in the history', bake.normalizeBake(picks).picks['2026-09-26'].title === 'Banana Bread');

  check('it offers several weeks ahead', theNextMonday.upcoming.length === 4, `${theNextMonday.upcoming.length}`);
  check(
    'each one a week apart',
    theNextMonday.upcoming.map((w) => w.date).join(',') === '2026-10-03,2026-10-10,2026-10-17,2026-10-24',
    theNextMonday.upcoming.map((w) => w.date).join(',')
  );
}

console.log('\nThe calendar draws it');
{
  const state = {
    enabled: true,
    label: 'Bake Night',
    weekday: 6,
    dayName: 'Saturday',
    time: '16:00',
    durationMinutes: 90,
    next: null,
    upcoming: [],
    picks: { '2026-09-26': { title: 'Banana Bread', ingredients: ['2 bananas', 'flour', 'sugar', 'butter'], steps: [] } },
  };

  const today = new Date(2026, 8, 21); // Monday, before that week's bake day
  const events = web.bakeEvents(state, new Date(2026, 8, 20), new Date(2026, 9, 18), today);
  check('one event per week', events.length === 4, `${events.length}`);
  check('the picked week is named after the recipe', events[0].title === 'Bake Night: Banana Bread', events[0].title);
  check('an empty week invites someone to choose', events[1].title.includes('pick a recipe'), events[1].title);
  check('it lands at the configured time', new Date(events[0].start).getHours() === 16);
  check('and runs for the configured length', new Date(events[0].end) - new Date(events[0].start) === 90 * 60000);
  check('only the first few ingredients get shown', (events[0].description.match(/·/g) || []).length === 2, events[0].description);
  check('disabled draws nothing', web.bakeEvents({ ...state, enabled: false }, new Date(2026, 8, 20), new Date(2026, 9, 18), today).length === 0);
  check('no state draws nothing', web.bakeEvents(null, new Date(2026, 8, 20), new Date(2026, 9, 18), today).length === 0);

  // Scrolling back a month shouldn't be a wall of "pick a recipe" for weeks
  // that have already gone.
  const looking = new Date(2026, 9, 12);
  const past = web.bakeEvents(state, new Date(2026, 8, 1), new Date(2026, 9, 1), looking);
  check('past weeks with nothing picked are left blank', past.length === 1, `${past.length}: ${past.map((e) => e.title).join(', ')}`);
  check('…but a past week we did bake is remembered', past[0].title === 'Bake Night: Banana Bread', past[0].title);

  // "Make this this Saturday" is what you get without the second helper.
  const sat = new Date(2026, 8, 21);
  check('the label reads as a sentence', web.bakeWhenPhrase('2026-09-26', 'Saturday', sat) === 'on Saturday', web.bakeWhenPhrase('2026-09-26', 'Saturday', sat));
  check('…and stands alone elsewhere', web.bakeWhen('2026-09-26', 'Saturday', sat) === 'this Saturday');
  check('today is still just today', web.bakeWhenPhrase('2026-09-21', 'Monday', sat) === 'today');
  check('tomorrow too', web.bakeWhenPhrase('2026-09-22', 'Tuesday', sat) === 'tomorrow');
  check('further out gets a date', web.bakeWhen('2026-10-10', 'Saturday', sat).includes('Oct'), web.bakeWhen('2026-10-10', 'Saturday', sat));

  check('a bake event is recognisable', web.isBakeEvent(events[0]) === true);
  check('an ordinary event is not', web.isBakeEvent({ id: 'abc', calendarId: 'local' }) === false);
  check('and carries its date', web.bakeEventDate(events[0]) === '2026-09-26', web.bakeEventDate(events[0]));
}

/* ------------------------------------------------------------------ */
console.log('\nAn address bar that is also a search box');
{
  const SEARCH = path.join(path.dirname(OUT), 'websearch.cjs');
  execFileSync('npx', ['esbuild', 'src/engine/websearch.ts', '--format=cjs', `--outfile=${SEARCH}`, '--log-level=warning'], { cwd: ROOT });
  const w = require(SEARCH);

  check('a full url is left alone', w.normalizeUrl('https://example.com/x') === 'https://example.com/x');
  check('a bare domain gets a scheme', w.normalizeUrl('allrecipes.com') === 'https://allrecipes.com');
  check('…including a deep one', w.normalizeUrl('bbc.co.uk/food/recipes') === 'https://bbc.co.uk/food/recipes');
  check('the kiosk itself still works', w.normalizeUrl('localhost:8787') === 'http://localhost:8787');
  check('and so does an IP', w.normalizeUrl('192.168.1.40:8787') === 'http://192.168.1.40:8787');

  const words = w.normalizeUrl('king arthur banana bread');
  check('words become a Google search', words.startsWith('https://www.google.com/search?q='), words);
  check('…properly escaped', words.includes('king+arthur') || words.includes('king%20arthur'), words);

  // An address bar inside a kiosk is not a way to run something or read the
  // disk. These go to Google rather than being loaded.
  check('javascript: is not a url here', w.normalizeUrl('javascript:alert(1)').includes('google.com/search'));
  check('file: is not either', w.normalizeUrl('file:///etc/passwd').includes('google.com/search'));
  check('a sentence with dots is still a search', w.normalizeUrl('what a mess. really').includes('google.com/search'));

  const recipe = w.googleRecipeSearch('chocolate cake');
  check('the recipe search says recipe', decodeURIComponent(recipe).includes('chocolate cake recipe'), recipe);
  const already = decodeURIComponent(w.googleRecipeSearch('banana bread recipe'));
  check('…but never twice', !already.includes('recipe recipe'), already);
  check('…case-insensitively', !decodeURIComponent(w.googleRecipeSearch('Best Recipes')).includes('Recipes recipe'));
}

/* ------------------------------------------------------------------ *
 * Against a real server.
 * ------------------------------------------------------------------ */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bake-srv-'));
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
      /* already gone */
    }
  }
}

const BASE = 'http://127.0.0.1:8787';

async function waitForIt() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  console.log('\nAgainst a running server');
  if (!(await waitForIt())) {
    check('server started', false, 'it never answered /health');
  } else {
    const before = await (await fetch(`${BASE}/api/bake`)).json();
    check('a fresh household has a bake day', typeof before.next?.date === 'string', JSON.stringify(before.next));
    check('…with nothing picked', before.next.pick === null);
    check('…and knows what to call it', before.label === 'Bake Night', before.label);

    const saved = await fetch(`${BASE}/api/bake/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe: { id: 'meal:52855', title: 'Banana Pancakes', ingredients: ['2 bananas'], steps: ['Mash'] },
      }),
    });
    const savedBody = await saved.json();
    check('a pick is accepted', saved.status === 200, `${saved.status}`);
    check('…for the next bake day, by default', savedBody.date === before.next.date, savedBody.date);

    const after = await (await fetch(`${BASE}/api/bake`)).json();
    check('and it comes back', after.next.pick?.title === 'Banana Pancakes', JSON.stringify(after.next.pick));
    check('with its ingredients, for bake day offline', after.next.pick.ingredients.length === 1);
    check('the whole picks map is sent for the calendar', !!after.picks[before.next.date]);

    // Written through, not just held in memory: the wall display is restarted
    // by every update, and a pick that only lived in RAM would vanish.
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    check('and it is on disk', onDisk.bake.picks[before.next.date].title === 'Banana Pancakes');

    const ahead = after.upcoming[2].date;
    await fetch(`${BASE}/api/bake/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: ahead, recipe: { title: 'Focaccia', url: 'https://example.com/focaccia' } }),
    });
    const planned = await (await fetch(`${BASE}/api/bake`)).json();
    check('you can plan weeks ahead', planned.picks[ahead]?.title === 'Focaccia');
    check('…and this week is untouched', planned.next.pick.title === 'Banana Pancakes');
    check('a page from the browser is stored as a web pick', planned.picks[ahead].kind === 'web');

    const bad = await fetch(`${BASE}/api/bake/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe: {} }),
    });
    check('an empty pick is refused', bad.status === 400, `${bad.status}`);

    await fetch(`${BASE}/api/bake/pick?date=${ahead}`, { method: 'DELETE' });
    const cleared = await (await fetch(`${BASE}/api/bake`)).json();
    check('a pick can be taken back', !cleared.picks[ahead]);
    check('…without touching the others', cleared.next.pick.title === 'Banana Pancakes');

    // This machine's egress blocks TheMealDB, which is exactly the offline
    // case the kitchen will hit on a bad Wi-Fi day: the built-in sections
    // must still be listed rather than the screen erroring out.
    const sections = await fetch(`${BASE}/api/recipes/sections`);
    const list = await sections.json();
    check('the sections list never 500s', sections.status === 200, `${sections.status}`);
    check('the built-in sections are always there', list.sections.length >= 2, JSON.stringify(list.sections));
    check('baking is one of them', list.sections.some((s) => s.key === 'baking'));

    // Turning cocktails off has to hold at the API, not just in the UI.
    const settings = await (await fetch(`${BASE}/api/settings`)).json();
    settings.recipes.showCocktails = false;
    await fetch(`${BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const hidden = await (await fetch(`${BASE}/api/recipes/sections`)).json();
    check('cocktails disappear from the tabs', !hidden.sections.some((s) => s.key === 'cocktails'));
    const blockedSection = await fetch(`${BASE}/api/recipes/section/cocktails`);
    check('…and the route refuses too', blockedSection.status === 403, `${blockedSection.status}`);
  }

  stop();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  stop();
  console.error(err);
  process.exit(1);
});
