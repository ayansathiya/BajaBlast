/**
 * Does a change on one device actually reach another one immediately?
 *
 * The thing being measured is latency, not correctness — polling was already
 * "correct", it just took up to twenty seconds. So these assert on the clock:
 * a change made over HTTP has to show up on an open stream in well under a
 * second, or the rewrite bought nothing.
 */
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;

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

/** Hold a stream open and collect the events it delivers. */
function openStream() {
  return new Promise((resolve, reject) => {
    const events = [];
    const waiters = [];
    // Events can land before the caller has asked for one — the hello frame
    // usually arrives in the same tick the headers do. Without a cursor,
    // next() would wait for the event *after* the one it wanted and hang.
    let cursor = 0;

    const req = http.get(`${BASE}/api/stream`, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`stream returned ${res.statusCode}`));

      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        // SSE frames are separated by a blank line.
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (frame.startsWith(':')) continue; // heartbeat
          const name = /^event: (.+)$/m.exec(frame);
          const data = /^data: (.+)$/m.exec(frame);
          const parsed = { event: name ? name[1] : 'message', data: data ? JSON.parse(data[1]) : null, at: Date.now() };
          events.push(parsed);
          const waiter = waiters.shift();
          if (waiter) waiter(parsed);
        }
      });

      resolve({
        events,
        contentType: res.headers['content-type'],
        next: (ms = 3000) =>
          new Promise((res2, rej2) => {
            if (cursor < events.length) {
              const e = events[cursor];
              cursor += 1;
              return res2(e);
            }
            const timer = setTimeout(() => rej2(new Error('no event arrived')), ms);
            waiters.push((e) => {
              clearTimeout(timer);
              cursor = events.length;
              res2(e);
            });
            return undefined;
          }),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${BASE}${pathname}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  console.log('\nThe stream opens');
  const stream = await openStream();
  check('served as an event stream', (stream.contentType || '').includes('text/event-stream'), stream.contentType);

  const hello = await stream.next();
  check('says hello on connect', hello.event === 'hello', JSON.stringify(hello));
  check('and names the build', !!hello.data.build, JSON.stringify(hello.data));

  console.log('\nA change on one device reaches another immediately');
  {
    const sentAt = Date.now();
    const added = await post('/api/grocery', { label: 'oat milk' });
    check('the write succeeded', added.status >= 200 && added.status < 300, `${added.status} ${added.body.slice(0, 80)}`);

    const change = await stream.next();
    const latency = change.at - sentAt;
    check('a change event arrived', change.event === 'change', JSON.stringify(change));
    check(`it arrived fast (${latency}ms)`, latency < 1000, `took ${latency}ms`);
    check('and says what changed', Array.isArray(change.data.kinds) && change.data.kinds.length > 0, JSON.stringify(change.data));
  }

  console.log('\nA burst of changes is coalesced, not amplified');
  {
    const before = stream.events.length;
    await Promise.all([
      post('/api/grocery', { label: 'bread' }),
      post('/api/grocery', { label: 'eggs' }),
      post('/api/grocery', { label: 'butter' }),
    ]);
    await new Promise((r) => setTimeout(r, 600));
    const delivered = stream.events.length - before;
    // Three writes inside the coalescing window should not mean three rounds
    // of every client re-reading the whole calendar.
    check(`three quick writes produced ${delivered} event(s), not three`, delivered <= 2, `${delivered} events`);
  }

  console.log('\nRemote-control presses are not coalesced');
  {
    // These are someone's finger on an arrow. Merging two presses into one is
    // exactly the bug that made the old polling remote feel broken.
    const before = stream.events.filter((e) => e.data && e.data.kinds && e.data.kinds.includes('command')).length;
    await post('/api/kiosk/command', { nav: 'next' });
    await post('/api/kiosk/command', { nav: 'next' });
    await post('/api/kiosk/command', { nav: 'next' });
    await new Promise((r) => setTimeout(r, 500));
    const after = stream.events.filter((e) => e.data && e.data.kinds && e.data.kinds.includes('command')).length;
    check(`three presses delivered three commands (got ${after - before})`, after - before === 3, `${after - before}`);
  }

  console.log('\nThe screen schedule');
  {
    const d = require(path.join(__dirname, '..', 'app', 'display.cjs'));
    const at = (h, m = 0) => new Date(2026, 8, 14, h, m);
    const normal = { display: { schedule: { enabled: true, on: '06:00', off: '23:00' } } };

    check('off at 3am', d.shouldBeOn(normal, at(3)) === false);
    check('on at 6am exactly', d.shouldBeOn(normal, at(6)) === true);
    check('on at noon', d.shouldBeOn(normal, at(12)) === true);
    check('on at 10:59pm', d.shouldBeOn(normal, at(22, 59)) === true);
    check('off at 11pm exactly', d.shouldBeOn(normal, at(23)) === false);

    // The window that runs past midnight — a night shift, or just someone who
    // wants it on in the evening and off during the day. Getting this wrong
    // means the screen is dark whenever anyone is actually in the kitchen.
    const overnight = { display: { schedule: { enabled: true, on: '18:00', off: '09:00' } } };
    check('overnight window: on at 8pm', d.shouldBeOn(overnight, at(20)) === true);
    check('overnight window: on at 2am', d.shouldBeOn(overnight, at(2)) === true);
    check('overnight window: off at noon', d.shouldBeOn(overnight, at(12)) === false);

    const disabled = { display: { schedule: { enabled: false, on: '06:00', off: '23:00' } } };
    check('disabled means always on', d.shouldBeOn(disabled, at(3)) === true);

    const zero = { display: { schedule: { enabled: true, on: '08:00', off: '08:00' } } };
    check('a zero-length window means always on, not always off', d.shouldBeOn(zero, at(3)) === true);

    check('a malformed time falls back rather than throwing', d.shouldBeOn({ display: { schedule: { enabled: true, on: 'nonsense', off: '23:00' } } }, at(12)) === true);
  }

  console.log('\nWaking the screen from a phone');
  {
    const woke = await post('/api/display/wake', {});
    check('wake is accepted', woke.status === 200, `${woke.status} ${woke.body.slice(0, 80)}`);
  }

  console.log('\nOpening a real browser window on the Pi');
  {
    const bad = await post('/api/browser/open', { url: 'javascript:alert(1)' });
    check('only web addresses', bad.status === 400);

    const DATA = process.env.BAJA_BLAST_DATA;
    const alive = DATA && path.join(DATA, 'kiosk-alive');
    const request = DATA && path.join(DATA, 'browser-open.json');
    if (alive) fs.rmSync(alive, { force: true });
    const nobody = await post('/api/browser/open', { url: 'https://www.google.com/' });
    check('with no kiosk launcher listening, it says so (and the page falls back)', nobody.status === 200 && JSON.parse(nobody.body).ok === false);

    if (DATA) {
      check('and leaves no request behind', !fs.existsSync(request));
      fs.writeFileSync(alive, '');
      const yes = await post('/api/browser/open', { url: 'https://www.allrecipes.com/' });
      check('with the launcher listening, it asks for the window', yes.status === 200 && JSON.parse(yes.body).ok === true);
      const req = JSON.parse(fs.readFileSync(request, 'utf8'));
      check('for that address', req.url === 'https://www.allrecipes.com/');

      const stale = new Date(Date.now() - 60_000);
      fs.utimesSync(alive, stale, stale);
      fs.rmSync(request, { force: true });
      const gone = await post('/api/browser/open', { url: 'https://www.google.com/' });
      check('a launcher that stopped a minute ago counts as gone', JSON.parse(gone.body).ok === false && !fs.existsSync(request));
    }
  }

  stream.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
