/**
 * The kitchen: timers, the dinner plan, notes on the wall, and reminders.
 *
 * Timers are the part worth being paranoid about. A timer that loses time
 * across a restart, rings early after a pause, or quietly refuses "+1 minute"
 * once it has gone off is a burnt dinner — so most of this file stands at
 * precise moments and checks the arithmetic.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const kitchen = require(path.join(ROOT, 'app', 'kitchen.cjs'));

// The display's half (reminders, voice parsing, countdown text) is
// TypeScript; bundle it once for node, the way collapse.test does.
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kitchen-')), 'kitchen.cjs');
execFileSync('npx', ['esbuild', 'src/engine/kitchen.ts', '--bundle', '--format=cjs', `--outfile=${OUT}`, '--log-level=warning'], { cwd: ROOT });
const view = require(OUT);

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

const T0 = new Date(2026, 8, 28, 17, 0, 0); // a Monday, 5pm
const at = (sec) => new Date(T0.getTime() + sec * 1000);

console.log('\nStarting a timer');
{
  const r = kitchen.startTimer([], { seconds: 600, label: '  Pasta  ' }, T0);
  check('it starts', !r.error && r.list.length === 1);
  check('it ends ten minutes from now', Date.parse(r.timer.endsAt) === at(600).getTime());
  check('its name is tidied', r.timer.label === 'Pasta', r.timer.label);
  check('no name gets its length', kitchen.startTimer([], { seconds: 90 }, T0).timer.label === '1 min 30 s');
  check('too short is refused', !!kitchen.startTimer([], { seconds: 2 }, T0).error);
  check('nonsense is refused', !!kitchen.startTimer([], { seconds: 'soon' }, T0).error);
  check('twelve hours is the ceiling', kitchen.startTimer([], { seconds: 99999999 }, T0).timer.durationMs === kitchen.MAX_SECONDS * 1000);

  let list = [];
  for (let i = 0; i < kitchen.MAX_TIMERS; i += 1) list = kitchen.startTimer(list, { seconds: 60 }, T0).list;
  check(`a ${kitchen.MAX_TIMERS + 1}th is refused, not silently dropped`, !!kitchen.startTimer(list, { seconds: 60 }, T0).error);
}

console.log('\nPause, resume, add');
{
  let { list, timer } = kitchen.startTimer([], { seconds: 600, label: 'Rice' }, T0);

  // Four minutes in, pause for as long as you like, resume: six minutes left.
  ({ list, timer } = kitchen.actOnTimer(list, timer.id, 'pause', {}, at(240)));
  check('pausing keeps what was left', timer.remainingMs === 360_000 && timer.endsAt === null, JSON.stringify(timer));
  check('and a paused timer never expires', kitchen.normalizeTimers(list, at(86_400)).length === 1);

  ({ list, timer } = kitchen.actOnTimer(list, timer.id, 'resume', {}, at(3000)));
  check('resuming ends six minutes after resuming', Date.parse(timer.endsAt) === at(3360).getTime(), timer.endsAt);

  ({ list, timer } = kitchen.actOnTimer(list, timer.id, 'add', { seconds: 60 }, at(3000)));
  check('+1 minute adds a minute', Date.parse(timer.endsAt) === at(3420).getTime());

  // Rang at 3420; "one more minute" said at 3500 means until 3560.
  ({ list, timer } = kitchen.actOnTimer(list, timer.id, 'add', { seconds: 60 }, at(3500)));
  check('+1 on a ringing timer counts from now', Date.parse(timer.endsAt) === at(3560).getTime(), timer.endsAt);

  const paused = kitchen.actOnTimer(list, timer.id, 'pause', {}, at(4000));
  check('a ringing timer can’t be paused into silence', paused.timer.remainingMs === null);

  const gone = kitchen.actOnTimer(list, timer.id, 'dismiss', {}, at(4000));
  check('dismissing removes it', gone.list.length === 0);
  check('an unknown timer is an error', !!kitchen.actOnTimer(list, 'nope', 'pause', {}, T0).error);
  check('an unknown action is an error', !!kitchen.actOnTimer(list, timer.id, 'explode', {}, T0).error);
}

console.log('\nRinging, and giving up ringing');
{
  const { list } = kitchen.startTimer([], { seconds: 60 }, T0);
  check('it is still there a minute after it rang', kitchen.normalizeTimers(list, at(120)).length === 1);
  check('it clears itself after fifteen minutes of nobody', kitchen.normalizeTimers(list, at(60 + 15 * 60 + 1)).length === 0);
  check('garbage in the store is dropped', kitchen.normalizeTimers([null, 4, { durationMs: 'x' }, {}], T0).length === 0);
}

console.log('\nCountdown text (the display)');
{
  check('9:05', view.formatCountdown(545_000) === '9:05', view.formatCountdown(545_000));
  check('rounds up, so 0:00 only appears at the end', view.formatCountdown(400) === '0:01');
  check('hours', view.formatCountdown(3_723_000) === '1:02:03');
  check('overdue shows how long ago', view.formatCountdown(-130_000) === '+2:10', view.formatCountdown(-130_000));
}

console.log('\n“Baja, set a timer…”');
{
  const p = (s) => view.parseTimerRequest(s);
  check('ten minutes', p('set a timer for 10 minutes')?.seconds === 600);
  check('words, not digits', p('set a timer for five minutes')?.seconds === 300);
  check('hours and minutes', p('set a 1 hour 20 minute timer')?.seconds === 4800);
  check('half an hour', p('timer for half an hour')?.seconds === 1800);
  check('seconds', p('timer 90 seconds')?.seconds === 90);
  check('a name', p('set a timer for 8 minutes for the eggs')?.label === 'eggs', JSON.stringify(p('set a timer for 8 minutes for the eggs')));
  check('“for 10 minutes” is not a name', p('set a timer for 10 minutes')?.label === undefined);
  check('not a timer sentence', p('add eggs to the grocery list') === null);
  check('a timer with no length', p('set a timer') === null);
}

console.log('\nDinner plan');
{
  check('a dinner needs a name', kitchen.normalizeMeal({ title: '   ' }) === null);
  const m = kitchen.normalizeMeal({ title: 'Tacos', url: 'javascript:alert(1)', ingredients: ['Tortillas', ' ', 'Beef'] });
  check('a bad link is dropped, the dinner kept', m.title === 'Tacos' && m.url === null);
  check('blank ingredients are dropped', m.ingredients.length === 2);

  const week = kitchen.mealWeek({ '2026-09-29': { title: 'Tacos' }, 'bogus': { title: 'x' } }, T0);
  check('seven nights from today', week.length === 7 && week[0].date === '2026-09-28' && week[0].isToday);
  check('tomorrow has its dinner', week[1].meal?.title === 'Tacos');
  check('a bad key is ignored', Object.keys(kitchen.normalizeMeals({ bogus: { title: 'x' } })).length === 0);

  const pruned = kitchen.pruneMeals({ '2026-01-01': { title: 'Old' }, '2026-09-20': { title: 'Recent' } }, T0);
  check('old dinners are forgotten', !pruned['2026-01-01'] && !!pruned['2026-09-20']);

  const grocery = [{ label: 'Onions', done: false }, { label: 'milk', done: true }];
  const missing = kitchen.missingFromGrocery(['onions ', 'Milk', 'Garlic', 'garlic'], grocery);
  check('already-listed items are skipped, loosely matched', !missing.includes('onions '), JSON.stringify(missing));
  check('ticked-off items count as needed again', missing.includes('Milk'));
  check('no doubles within the recipe either', missing.filter((x) => /garlic/i.test(x)).length === 1);
}

console.log('\nNotes');
{
  const a = kitchen.addNote([], { text: '  Library books   due  ', from: 'Mom' }, T0);
  check('a note is added and tidied', a.note.text === 'Library books due', a.note.text);
  check('it lasts three days by default', Date.parse(a.note.expiresAt) === T0.getTime() + 3 * 86400000);
  check('and is gone after', kitchen.normalizeNotes(a.list, at(3 * 86400 + 1)).length === 0);
  const keep = kitchen.addNote([], { text: 'WiFi: bajablast', lasts: 'keep' }, T0);
  check('“until cleared” means it', keep.note.expiresAt === null && kitchen.normalizeNotes(keep.list, at(400 * 86400)).length === 1);
  check('an empty note is refused', !!kitchen.addNote([], { text: '   ' }, T0).error);
  check('long notes are cut', kitchen.addNote([], { text: 'x'.repeat(900) }, T0).note.text.length === kitchen.MAX_NOTE_LENGTH);

  let list = [];
  for (let i = 0; i < 20; i += 1) list = kitchen.addNote(list, { text: `n${i}` }, at(i)).list;
  check('the oldest fall off, the newest stay', list.length === kitchen.MAX_NOTES && list[0].text === 'n19');
  check('removing works', kitchen.removeNote(list, list[0].id, at(30)).length === kitchen.MAX_NOTES - 1);
}

console.log('\nReminders');
{
  const people = [
    { id: 'p1', name: 'Jack', color: '#0ff', initials: 'J', enabled: true },
    { id: 'p2', name: 'Emma', color: '#f0f', initials: 'E', enabled: true },
  ];
  const ev = (id, startSec, extra = {}) => ({
    id, title: id, start: at(startSec).toISOString(), end: at(startSec + 3600).toISOString(),
    calendarId: 'h', category: 'other', importance: 1, ...extra,
  });
  // 5pm is rush hour, so a 20-minute drive means leaving 25 minutes early.
  const rsm = ev('RSM', 40 * 60, { personIds: ['p1'], location: { label: 'x', travelMinutes: 20 } });
  let r = view.buildReminders([rsm], null, people, T0);
  check('leave-by, counting the traffic buffer', r[0]?.text === 'Jack: leave for RSM in 15 min', r[0]?.text);
  check('not urgent yet', r[0]?.level === 'soon');
  r = view.buildReminders([rsm], null, people, at(12 * 60));
  check('urgent in the last five minutes', r[0]?.level === 'now', JSON.stringify(r[0]));
  r = view.buildReminders([rsm], null, people, at(16 * 60));
  check('then: time to leave', r[0]?.text === 'Jack: time to leave for RSM', r[0]?.text);

  check('nothing an hour out', view.buildReminders([ev('Piano', 3600)], null, people, T0).length === 0);
  check('starts-in for a local thing', view.buildReminders([ev('Piano', 20 * 60)], null, people, T0)[0]?.text === 'Piano starts in 20 min');
  check('never for all-day things', view.buildReminders([ev('Birthday', 60, { allDay: true })], null, people, T0).length === 0);
  check('never for things already started', view.buildReminders([ev('Dinner', -60)], null, people, T0).length === 0);

  const chores = { totals: { p1: { todayDone: 1, todayTotal: 3 }, p2: { todayDone: 2, todayTotal: 2 } } };
  const evening = new Date(2026, 8, 28, 19, 0, 0);
  const cr = view.buildReminders([], chores, people, evening);
  check('evening chore nudge for whoever isn’t done', cr.length === 1 && cr[0].text === 'Jack: 2 chores left today', JSON.stringify(cr));
  check('no chore nudge in the afternoon', view.buildReminders([], chores, people, T0).length === 0);
}

/* ------------------------------------------------------------------ *
 * Against a real server
 * ------------------------------------------------------------------ */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kitchen-data-'));
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
const json = (method, url, body) =>
  fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

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

  const started = await json('POST', '/api/timers', { seconds: 300, label: 'Eggs' });
  check('a timer starts', started.status === 201, `${started.status}`);
  const t = await started.json();
  const listed = await (await fetch(`${BASE}/api/timers`)).json();
  check('it is listed with the server’s clock', listed.timers.length === 1 && typeof listed.serverNow === 'string');

  const paused = await (await json('POST', `/api/timers/${t.id}/pause`, {})).json();
  check('pause through the route', paused.remainingMs > 0 && paused.endsAt === null);
  const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
  check('timers are on disk, so a restart keeps them', onDisk.timers.length === 1);

  check('a bad timer is a 400', (await json('POST', '/api/timers', { seconds: 1 })).status === 400);
  await fetch(`${BASE}/api/timers/${t.id}`, { method: 'DELETE' });
  check('delete dismisses', (await (await fetch(`${BASE}/api/timers`)).json()).timers.length === 0);

  const d = kitchen.dateKey(new Date());
  const put = await json('PUT', `/api/meals/${d}`, { title: 'Tacos', ingredients: ['Tortillas', 'Onions'] });
  check('plan tonight', put.status === 200);
  await json('POST', '/api/grocery', { label: 'onions' });
  const g1 = await (await json('POST', `/api/meals/${d}/grocery`)).json();
  check('ingredients go to the list, minus what’s on it', g1.added.length === 1 && g1.added[0] === 'Tortillas', JSON.stringify(g1));
  const g2 = await (await json('POST', `/api/meals/${d}/grocery`)).json();
  check('pressing it twice adds nothing twice', g2.added.length === 0);
  const week = await (await fetch(`${BASE}/api/meals`)).json();
  check('the week comes back with tonight in it', week.week[0].meal?.title === 'Tacos');
  check('a nameless dinner is a 400', (await json('PUT', `/api/meals/${d}`, { title: '' })).status === 400);
  await fetch(`${BASE}/api/meals/${d}`, { method: 'DELETE' });
  check('clearing works', (await (await fetch(`${BASE}/api/meals`)).json()).week[0].meal === null);

  const n = await json('POST', '/api/notes', { text: 'Plumber Thursday', from: 'Dad' });
  check('a note posts', n.status === 201);
  const note = await n.json();
  check('and is listed', (await (await fetch(`${BASE}/api/notes`)).json()).length === 1);
  await fetch(`${BASE}/api/notes/${note.id}`, { method: 'DELETE' });
  check('and clears', (await (await fetch(`${BASE}/api/notes`)).json()).length === 0);

  // Backups carry the plan and the notes; a restore brings them back.
  await json('PUT', `/api/meals/${d}`, { title: 'Soup' });
  await json('POST', '/api/notes', { text: 'Keep me' });
  const backup = await (await fetch(`${BASE}/api/export`)).json();
  check('export includes meals and notes', backup.meals?.[d]?.title === 'Soup' && backup.notes?.length === 1);
  await fetch(`${BASE}/api/meals/${d}`, { method: 'DELETE' });
  await json('POST', '/api/import', backup);
  check('import restores them', (await (await fetch(`${BASE}/api/meals`)).json()).week[0].meal?.title === 'Soup');

  stop();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  stop();
  console.error(err);
  process.exit(1);
});
