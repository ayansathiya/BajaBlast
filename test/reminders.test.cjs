/**
 * Reminders (app/reminders.cjs) and reading a photo (app/scan.cjs).
 *
 * The photo half never reaches the internet: fetch is replaced with a stand-
 * in that records what would have been sent to Claude or Groq and answers
 * the way they do, so these check the request we make and what we do with
 * the answer — including the answers a model gets wrong.
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const reminders = require(path.join(ROOT, 'app', 'reminders.cjs'));
const scan = require(path.join(ROOT, 'app', 'scan.cjs'));

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

async function main() {
  console.log('\nReminders');
  const now = new Date('2026-10-20T17:00:00');
  let list = [];
  let r = reminders.add(list, { text: '  Bins   out ', due: '2026-10-20T20:00:00' }, now);
  check('adding one tidies the words', r.reminder.text === 'Bins out');
  list = r.list;
  r = reminders.add(list, { text: 'Call the dentist' }, now);
  list = r.list;
  r = reminders.add(list, { text: 'Permission slip', due: '2026-10-20T08:00:00' }, now);
  list = r.list;
  check('nothing but spaces is refused', !!reminders.add(list, { text: '   ' }).error);
  check('a nonsense time becomes no time', reminders.add([], { text: 'x', due: 'whenever' }).reminder.due === null);

  const order = reminders.sorted(list, now).map((x) => x.text);
  check('dated ones first, soonest first, then the rest', order.join('|') === 'Permission slip|Bins out|Call the dentist', order.join('|'));
  check('what is due now', reminders.due(list, now).map((x) => x.text).join() === 'Permission slip');
  check('when the next one falls due', reminders.nextDue(list, now) === Date.parse('2026-10-20T20:00:00'));

  const slip = list.find((x) => x.text === 'Permission slip');
  r = reminders.update(list, slip.id, { done: true }, now);
  list = r.list;
  check('ticking one off', r.reminder.done && r.reminder.doneAt === now.toISOString());
  check('…and it goes to the end', reminders.sorted(list, now).pop().text === 'Permission slip');
  check('…and is no longer due', reminders.due(list, now).length === 0);
  const later = new Date(now.getTime() + 8 * 86400_000);
  check('ticked-off ones drop away after a week', !reminders.sorted(list, later).some((x) => x.text === 'Permission slip'));
  check('an unknown one can\'t be changed', !!reminders.update(list, 'nope', { done: true }).error);
  check('removing one', reminders.remove(list, slip.id).length === 2);

  console.log('\nReading a photo');
  check('a photo is accepted', !!scan.parseDataUrl('data:image/jpeg;base64,/9j/4AAQ'));
  check('anything else is not', !scan.parseDataUrl('data:text/html;base64,PGh0bWw+') && !scan.parseDataUrl('hello'));

  const cleaned = scan.clean({
    events: [
      { title: 'Science fair', date: '2026-10-23', start: '18:00', end: '19:30', location: 'Gym' },
      { title: 'Bad date', date: '23/10/2026', start: '18:00', end: null, location: null },
      { title: 'Backwards', date: '2026-10-24', start: '18:00', end: '17:00', location: null },
      { title: '', date: '2026-10-24', start: null, end: null, location: null },
    ],
    grocery: ['Milk', 'milk', '  2 lemons ', ''],
    reminders: [{ text: 'Send the slip', date: '2026-10-22', time: '25:00' }, { text: 'Bring $5', date: null, time: '08:00' }],
  });
  check('a good event comes through whole', JSON.stringify(cleaned.events[0]) === JSON.stringify({ title: 'Science fair', date: '2026-10-23', start: '18:00', end: '19:30', location: 'Gym' }));
  check('an event with a date it can\'t read is dropped', !cleaned.events.some((e) => e.title === 'Bad date'));
  check('an end before the start is forgotten, not kept', cleaned.events.find((e) => e.title === 'Backwards').end === null);
  check('an event with no name is dropped', cleaned.events.length === 2);
  check('groceries: no duplicates, no blanks, tidied', cleaned.grocery.join('|') === 'Milk|2 lemons', cleaned.grocery.join('|'));
  check('an impossible time on a reminder is dropped, the date kept', cleaned.reminders[0].date === '2026-10-22' && cleaned.reminders[0].time === null);
  check('a time with no date means nothing', cleaned.reminders[1].time === null);
  check('a model answering nonsense gives empty lists, not a crash', JSON.stringify(scan.clean('nope')) === '{"events":[],"grocery":[],"reminders":[]}');

  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const answer = { events: [{ title: 'Soccer', date: '2026-10-24', start: '09:00', end: '10:30', location: null }], grocery: ['eggs'], reminders: [] };
  const realFetch = global.fetch;
  let sent = null;

  // Claude, when there's an Anthropic key.
  global.fetch = async (url, opts) => {
    sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }) };
  };
  let got = await scan.read(photo, { bajaApiKey: 'sk-ant-test', bajaGroqKey: 'gsk' }, [], now);
  check('with an Anthropic key, Claude reads it', sent.url === 'https://api.anthropic.com/v1/messages' && got.by === 'claude');
  check('…on the current Opus', sent.body.model === 'claude-opus-5-5');
  check('…with the photo as an image', sent.body.messages[0].content[0].type === 'image' && sent.body.messages[0].content[0].source.media_type === 'image/jpeg');
  check('…asked for exactly this shape of answer', sent.body.output_config.format.type === 'json_schema' && JSON.stringify(sent.body.output_config.format.schema) === JSON.stringify(scan.SCHEMA));
  check('…told today\'s date, so "next Friday" means something', /Tuesday 2026-10-20/.test(sent.body.messages[0].content[1].text));
  check('…with the fallback for a declined photo', sent.body.fallbacks === 'default' && sent.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01');
  check('…and the answer comes back cleaned', got.result.events[0].title === 'Soccer' && got.result.grocery[0] === 'eggs');

  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  got = await scan.read(photo, { bajaApiKey: 'sk-ant-test' }, [], now);
  check('a declined photo says so', !!got.error && !got.result);

  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  got = await scan.read(photo, { bajaApiKey: 'sk-ant-bad' }, [], now);
  check('a turned-down key says where to fix it', /Settings → Baja/.test(got.error || ''));

  // Groq, when that's the only key.
  const tried = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    tried.push(body.model);
    if (tried.length === 1) return { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) };
  };
  got = await scan.read(photo, { bajaGroqKey: 'gsk' }, [], now);
  check('with only a Groq key, Groq reads it', got.by === 'groq' && got.result.events.length === 1);
  check('…moving on to the next vision model if one is gone', tried.length === 2 && tried[0] !== tried[1]);

  got = await scan.read(photo, {}, [], now);
  check('no key at all says what to add', /Groq key/.test(got.error || ''));

  global.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
