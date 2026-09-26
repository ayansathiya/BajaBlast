/**
 * The update log.
 *
 * The parser is small, but it reads a file a human edits by hand, and the
 * thing it feeds is a screen on a kitchen wall. So the cases that matter are
 * the sloppy ones: a heading typed with a hyphen instead of an em dash, a
 * bullet that wrapped onto a second line, a stray paragraph, an entry with no
 * bullets under it at all.
 *
 * The last section checks the real CHANGELOG.md, because a parser that works
 * on fixtures and not on the actual file is worth nothing.
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const changelog = require(path.join(ROOT, 'app', 'changelog.cjs'));

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

console.log('\nReading an entry');
{
  const entries = changelog.parse(`
# Update log

Some words before the first entry.

## 2026-09-23 — Type with a real keyboard

- The search box is a real input.
- Escape closes what's on top.

## 2026-09-21 — Recipes and Bake Night

- A photo grid.
`);

  check('two entries', entries.length === 2, `${entries.length}`);
  check('the preamble is not one of them', entries.every((e) => e.title !== 'Update log'));
  check('newest first, as written', entries[0].date === '2026-09-23', entries[0].date);
  check('the title comes through', entries[0].title === 'Type with a real keyboard', entries[0].title);
  check('both bullets', entries[0].changes.length === 2, `${entries[0].changes.length}`);
  check('and their text', entries[0].changes[0] === 'The search box is a real input.', entries[0].changes[0]);
}

console.log('\nThe ways a person might type it');
{
  const hyphen = changelog.parse('## 2026-01-02 - A plain hyphen\n\n- Something\n');
  check('a hyphen works as well as an em dash', hyphen.length === 1 && hyphen[0].title === 'A plain hyphen');

  const endash = changelog.parse('## 2026-01-02 – An en dash\n\n- Something\n');
  check('so does an en dash', endash.length === 1, `${endash.length}`);

  const star = changelog.parse('## 2026-01-02 — Stars\n\n* One\n* Two\n');
  check('asterisk bullets count', star[0].changes.length === 2, `${star[0].changes.length}`);

  const wrapped = changelog.parse(
    '## 2026-01-02 — Wrapped\n\n- A bullet long enough that\n  it wrapped onto a second line.\n'
  );
  check('a wrapped bullet is one bullet', wrapped[0].changes.length === 1, `${wrapped[0].changes.length}`);
  check(
    '…rejoined with a space',
    wrapped[0].changes[0] === 'A bullet long enough that it wrapped onto a second line.',
    wrapped[0].changes[0]
  );

  const dateless = changelog.parse('## Earlier\n\n- The calendar itself.\n');
  check('a dateless section is kept', dateless.length === 1 && dateless[0].date === null);
  check('…under its own name', dateless[0].title === 'Earlier', dateless[0].title);

  const empty = changelog.parse('## 2026-01-02 — Nothing under this one\n\n## 2026-01-01 — Real\n\n- Yes\n');
  check('an entry with no bullets is dropped', empty.length === 1, `${empty.length}`);
}

console.log('\nWhat reaches the screen is text, not markup');
{
  const marked = changelog.parse('## 2026-01-02 — Formatting\n\n- A **bold** word and some `code`.\n');
  check('emphasis is stripped', marked[0].changes[0] === 'A bold word and some code.', marked[0].changes[0]);

  // The settings panel renders these as text nodes, never as HTML. This is
  // the reminder of why: the file is editable by anyone with the repo.
  const nasty = changelog.parse('## 2026-01-02 — Tags\n\n- <script>alert(1)</script> stays text.\n');
  check('tags survive as literal characters', nasty[0].changes[0].includes('<script>'), nasty[0].changes[0]);
}

console.log('\nWhen there is nothing to read');
{
  check('empty input is an empty list', changelog.parse('').length === 0);
  check('null is an empty list', changelog.parse(null).length === 0);
  check('prose with no headings is an empty list', changelog.parse('Just some words.\n').length === 0);
}

console.log('\nThe real file');
{
  const file = path.join(ROOT, 'CHANGELOG.md');
  check('CHANGELOG.md exists', fs.existsSync(file));

  const entries = changelog.entries();
  check('it parses into entries', entries.length >= 5, `${entries.length}`);
  check('every entry has a title', entries.every((e) => e.title && e.title.length > 3));
  check('every entry says something', entries.every((e) => e.changes.length > 0));

  const dated = entries.filter((e) => e.date);
  check('the dated ones are newest first', dated.every((e, i) => i === 0 || dated[i - 1].date >= e.date));
  check(
    'every date is a real one',
    dated.every((e) => !Number.isNaN(new Date(`${e.date}T00:00:00`).getTime())),
    dated.map((e) => e.date).join(',')
  );

  // Not "today's build has an entry": the release workflow stamps build.json
  // with the date it runs, so that assertion can never pass on CI and blocks
  // every release. What's worth checking is that nobody has dated an entry
  // into the future, which is the real typo.
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, 'build.json'), 'utf8')).build;
  const stamp = String(build).slice(0, 10);
  check(
    `no entry is dated after this build (${stamp})`,
    dated.every((e) => e.date <= stamp),
    dated.map((e) => e.date).join(',')
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
