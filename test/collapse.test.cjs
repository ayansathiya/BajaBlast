/**
 * Repeating events must not flood the lists.
 *
 * A weekly class expanded across a two-month window is eighteen rows. On a
 * month grid that's correct — that's what a calendar is. In a list it makes
 * the list useless for the one thing it's for: finding an event to change.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-collapse-')), 'rec.cjs');
execFileSync('npx', ['esbuild', 'src/engine/recurrence.ts', '--format=cjs', `--outfile=${OUT}`, '--log-level=warning'], { cwd: ROOT });
const r = require(OUT);

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const weekly = (id, title, start, weekday) => ({
  id, title, start, end: start.replace(/T(\d\d)/, (_, h) => `T${String(+h + 1).padStart(2, '0')}`),
  importance: 1, recurrence: { freq: 'weekly', interval: 1, byWeekday: [weekday] },
});

console.log('\nA weekly class is one row, not eighteen');
{
  const events = [
    weekly('piano', 'Piano', '2026-09-23T16:00:00', 3),
    weekly('soccer', 'Soccer', '2026-09-26T10:00:00', 6),
    { id: 'dentist', title: 'Dentist', start: '2026-10-02T09:00:00', end: '2026-10-02T10:00:00', importance: 2 },
  ];
  const expanded = r.expandEvents(events, new Date('2026-09-20'), new Date('2026-11-20'));
  const rows = r.collapseSeries(expanded);

  check(`grid still gets every occurrence (${expanded.length})`, expanded.length > 15, `${expanded.length}`);
  check('list gets one row per series', rows.length === 3, `${rows.length} rows`);
  check('each row is the NEXT occurrence, not the last', rows[0].event.start.startsWith('2026-09-23'), rows[0].event.start);
  check('rows stay in date order', rows.map((x) => x.event.title).join(',') === 'Piano,Soccer,Dentist', rows.map((x) => x.event.title).join(','));
  check('repeats report how many more', rows[0].moreCount > 5, `${rows[0].moreCount}`);
  check('a one-off reports none', rows[2].moreCount === 0, `${rows[2].moreCount}`);
}

console.log('\nAn edited single week does not split into a second series');
{
  // updateOccurrence writes an exception on the master plus an override event
  // carrying the same recurrenceParentId. Keyed on id instead of the parent,
  // that override would appear as its own separate row.
  const master = weekly('piano', 'Piano', '2026-09-23T16:00:00', 3);
  master.exceptions = ['2026-09-30'];
  const override = {
    id: 'piano-override', title: 'Piano (moved)', start: '2026-09-30T18:00:00', end: '2026-09-30T19:00:00',
    importance: 1, recurrenceParentId: 'piano', occurrenceDate: '2026-09-30',
  };
  const expanded = r.expandEvents([master, override], new Date('2026-09-20'), new Date('2026-11-20'));
  const rows = r.collapseSeries(expanded);
  check('still one row, not two', rows.length === 1, `${rows.length} rows: ${rows.map((x) => x.event.title).join(', ')}`);
}

console.log('\nEdge cases');
{
  check('empty in, empty out', r.collapseSeries([]).length === 0);
  const single = [{ id: 'a', title: 'A', start: '2026-10-01T09:00:00', end: '2026-10-01T10:00:00', importance: 1 }];
  check('a lone one-off survives untouched', r.collapseSeries(single).length === 1);
  check('nextPerSeries returns plain events', r.nextPerSeries(single)[0].id === 'a');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
