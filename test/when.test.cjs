/**
 * Typed times and dates for the event editor (src/engine/when.ts).
 *
 * The wall has an on-screen keyboard and no date picker worth using, so
 * these are what stand between "piano at 4 on fri" and an event at the
 * wrong hour.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-when-')), 'when.cjs');
execFileSync('npx', ['esbuild', 'src/engine/when.ts', '--format=cjs', `--outfile=${OUT}`, '--log-level=warning'], { cwd: ROOT });
const { parseTime, parseDate, showTime } = require(OUT);

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
const same = (name, got, want) => check(`${name}`, got === want, `got ${got}, want ${want}`);

console.log('\nTimes');
same('"3pm"', parseTime('3pm'), '15:00');
same('"3 PM"', parseTime('3 PM'), '15:00');
same('"3:30 p.m."', parseTime('3:30 p.m.'), '15:30');
same('"330p"', parseTime('330p'), '15:30');
same('"930"', parseTime('930'), '09:30');
same('"1545"', parseTime('1545'), '15:45');
same('"15:45"', parseTime('15:45'), '15:45');
same('"12pm" is noon', parseTime('12pm'), '12:00');
same('"12am" is midnight', parseTime('12am'), '00:00');
same('"noon"', parseTime('noon'), '12:00');
same('"9" is nine in the morning', parseTime('9'), '09:00');
same('"4" alone is four in the afternoon, not 4am', parseTime('4'), '16:00');
same('"4am" when someone means it', parseTime('4am'), '04:00');
same('"25:00" is not a time', parseTime('25:00'), null);
same('"3:75" is not a time', parseTime('3:75'), null);
same('"13pm" is not a time', parseTime('13pm'), null);
same('words are not a time', parseTime('soon'), null);
same('shown back as "3:30 PM"', showTime('15:30'), '3:30 PM');
same('midnight shown as "12:00 AM"', showTime('00:00'), '12:00 AM');

console.log('\nDates (today is Tuesday 20 October 2026)');
const now = new Date(2026, 9, 20, 17, 0);
same('"today"', parseDate('today', now), '2026-10-20');
same('"tomorrow"', parseDate('tomorrow', now), '2026-10-21');
same('"fri" is this Friday', parseDate('fri', now), '2026-10-23');
same('"Friday"', parseDate('Friday', now), '2026-10-23');
same('"tue" is next week, not today', parseDate('tue', now), '2026-10-27');
same('"next fri" is the week after', parseDate('next fri', now), '2026-10-30');
same('"oct 25"', parseDate('oct 25', now), '2026-10-25');
same('"October 25th"', parseDate('October 25th', now), '2026-10-25');
same('"25 oct"', parseDate('25 oct', now), '2026-10-25');
same('"jan 5" is next January', parseDate('jan 5', now), '2027-01-05');
same('"oct 1" has passed, so next year', parseDate('oct 1', now), '2027-10-01');
same('"10/25"', parseDate('10/25', now), '2026-10-25');
same('"12/3/27"', parseDate('12/3/27', now), '2027-12-03');
same('"2026-11-02"', parseDate('2026-11-02', now), '2026-11-02');
same('"feb 30" is not a date', parseDate('feb 30', now), null);
same('"13/40" is not a date', parseDate('13/40', now), null);
same('words are not a date', parseDate('someday', now), null);
same('reads back what the editor shows ("Tue, Oct 20, 2026")', parseDate('Tue, Oct 20, 2026', now), '2026-10-20');
const { showDate } = require(OUT);
same('and shows dates that way', showDate('2026-10-23'), 'Fri, Oct 23, 2026');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
