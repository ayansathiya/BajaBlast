// A small local server so a phone on the same WiFi can add grocery items
// and events without touching the kiosk's keyboard/mouse at all. It is the
// single source of truth: the kiosk itself now reads/writes through this
// same server (see HttpCalendarProvider / HttpGroceryProvider) instead of
// keeping its own private in-memory copy.
//
// LAN-only, no auth. Anyone on your home WiFi can reach /mobile. That's a
// fine trade-off for a kitchen grocery list; it is NOT something to expose
// to the public internet.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { getWeather, getNews, getStocks } = require('./livedata.cjs');
const { DEFAULT_SETTINGS, withDefaults } = require('./defaults.cjs');
const music = require('./music.cjs');
const { expandEvents } = require('./recurrence.cjs');
const display = require('./display.cjs');
const recipes = require('./recipes.cjs');
const bake = require('./bake.cjs');
const changelog = require('./changelog.cjs');

const PORT = 8787;

// Bumped on every release. This is the answer to "am I actually running the
// new version?" — it's printed to the terminal at startup next to the folder
// it's running from, shown on the phone page under the title, and shown in
// Settings → System on the kiosk. If those three don't say the same thing as
// the release you unzipped, you're running an older copy from another folder.
const BUILD = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build.json'), 'utf8')).build;
  } catch {
    return 'unknown';
  }
})();

// Where the household lives, and which copy of the app code is running. Both
// are answered in paths.cjs, so the bootstrap, this server and the updater
// can't end up disagreeing about them.
const { dataDir } = require('./paths.cjs');
const updater = require('./updater.cjs');

const DIR = dataDir();

// Which copy of the app is running — set by launch.cjs, which picked it. The
// built display lives inside it, so serving dist/ has to follow the payload
// rather than assume the folder this file happens to sit in.
let PAYLOAD_ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(DIR, 'store.json');
const PHOTOS_DIR = path.join(DIR, 'photos');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const PHOTO_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

const BACKUP_DIR = path.join(DIR, 'backups');
const PREV_FILE = path.join(DIR, 'store.prev.json');
const MAX_BACKUPS = 30;

function emptyStore() {
  return { events: [], grocery: [], settings: null, photos: [], spotify: null, auth: null, completions: [], bake: { picks: {} } };
}

function normalizeStore(data) {
  if (!data || typeof data !== 'object') return emptyStore();
  return { ...emptyStore(), ...data };
}

/**
 * Load the store, falling back through the backups.
 *
 * A half-written JSON file is the realistic failure here: the Mac loses power
 * mid-write and the household's whole calendar reads back as a parse error.
 * `saveStore` writes atomically to make that nearly impossible, but "nearly"
 * isn't a plan — so a store that won't parse falls back to the newest backup
 * that does, rather than silently starting empty and looking like everything
 * was deleted.
 */
function loadStore() {
  // Order matters: the live file, then the previous good save (written on
  // every change, so at most one edit behind), then the hourly backups.
  const candidates = [DATA_FILE, PREV_FILE];
  try {
    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .map((f) => path.join(BACKUP_DIR, f));
    candidates.push(...backups);
  } catch {
    // No backups directory yet — first run.
  }

  for (const file of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (file !== DATA_FILE) {
        console.warn(`[baja-blast] ${DATA_FILE} was unreadable; recovered from ${path.basename(file)}`);
      }
      return normalizeStore(data);
    } catch {
      // Try the next candidate.
    }
  }
  return emptyStore();
}

let lastBackupAt = 0;

/**
 * Write the store atomically: full contents to a temp file, flush it to the
 * platter, then rename over the real file. Rename is atomic, so a reader (or
 * a power cut) sees either the whole old file or the whole new one — never a
 * truncated one. Plain writeFileSync can leave a partial file behind.
 */
// When the household last changed anything. Read by the update scheduler:
// restarting the app mid-sentence while someone is typing an event title is
// the one way an automatic update can feel like a bug rather than a feature.
let lastWriteAt = 0;

function saveStore(store) {
  lastWriteAt = Date.now();
  // Everything that changes the household funnels through here, so this is the
  // one place that has to announce it. One call, and the wall screen and every
  // phone in the house know within a few milliseconds.
  queueBroadcast('store');
  fs.mkdirSync(DIR, { recursive: true });
  const json = JSON.stringify(store, null, 2);
  const tmp = `${DATA_FILE}.tmp`;

  // Keep the version we're about to replace. Combined with the atomic rename
  // below, the worst case stops being "an hour of edits" and becomes "the one
  // edit in flight".
  try {
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, PREV_FILE);
  } catch {
    // Not fatal — the write below is still atomic on its own.
  }

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DATA_FILE);

  // A rolling backup at most once an hour: enough to undo an accidental
  // "delete all the people" without writing a copy on every grocery tap.
  if (Date.now() - lastBackupAt > 60 * 60 * 1000) {
    lastBackupAt = Date.now();
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(BACKUP_DIR, `store-${stamp}.json`), json);
      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
        .sort();
      for (const old of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
        fs.unlinkSync(path.join(BACKUP_DIR, old));
      }
    } catch (err) {
      console.warn('[baja-blast] backup failed (not fatal):', err.message);
    }
  }
}

let store = loadStore();

// Kiosk remote state. Intentionally in memory, not on disk: a command is only
// meaningful for the few seconds after someone presses the button, and a
// stale one replayed after a restart would yank the display around for no
// reason.
let kioskCommand = { seq: 0, wake: false, view: null, nav: null, at: null };

// A short log rather than a single slot. Two arrow presses inside one kiosk
// poll used to collapse into one step — you'd tap next twice and move one
// week. The kiosk replays everything newer than it has already applied.
let kioskLog = [];

function pushCommand(command) {
  kioskCommand = command;
  kioskLog = [...kioskLog, command].slice(-25);
  // Not coalesced and not delayed: this is someone's finger on an arrow, and
  // the whole point is that the wall moves while they're still looking at it.
  broadcast({ kinds: ['command'], command, at: new Date().toISOString() });
}

// What the kiosk says it's currently showing. Without this the phone's arrows
// are pressed blind — you'd be stepping a calendar you can't see. The kiosk
// posts here whenever its view or date changes.
let kioskStatus = { view: 'day', rangeLabel: null, idle: false, at: null };

/* ------------------------------------------------------------------ *
 * Live updates
 * ------------------------------------------------------------------ *
 *
 * This replaces eleven separate polling timers. Polling meant a change made on
 * a phone took up to twenty seconds to reach the wall, every client asked for
 * the whole calendar on a loop whether or not anything had changed, and the
 * kiosk's remote had to be checked every 1.2 seconds just so an arrow press
 * felt responsive.
 *
 * Server-sent events rather than websockets: this traffic only ever goes one
 * way, and the browser's EventSource reconnects by itself — which on a kitchen
 * display that has to survive the Wi-Fi dropping out at 3am is the feature
 * that matters more than any of the protocol differences.
 */
const liveClients = new Set();
let broadcastTimer = null;
let pendingKinds = new Set();

/**
 * Coalesce. Saving one event can touch the store two or three times in a few
 * milliseconds, and three identical "something changed" messages means three
 * rounds of every client re-fetching the same calendar.
 */
function queueBroadcast(kind) {
  pendingKinds.add(kind);
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    const kinds = [...pendingKinds];
    pendingKinds = new Set();
    broadcastTimer = null;
    broadcast({ kinds, at: new Date().toISOString() });
  }, 60);
  if (broadcastTimer.unref) broadcastTimer.unref();
}

function broadcast(payload) {
  const frame = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of liveClients) {
    try {
      res.write(frame);
    } catch {
      liveClients.delete(res);
    }
  }
}

/** Wake the kitchen display. Called when a phone changes something worth looking at. */
function nudgeKiosk(view) {
  // A phone adding an event at 11:30pm should light the screen up, not push a
  // command at a panel that's asleep.
  if (typeof wakeDisplay === 'function') wakeDisplay();
  pushCommand({
    seq: kioskCommand.seq + 1,
    wake: true,
    view: view || null,
    nav: null,
    at: new Date().toISOString(),
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Safari on iOS will happily serve a cached grocery list from ten minutes
    // ago otherwise, which reads as "the app isn't updating."
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function localLanUrl() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Skip Tailscale's own interface (100.64.0.0/10, the carrier-grade NAT
      // range it uses). It's a real non-internal IPv4 and it would otherwise
      // win this loop and hand out an address that only works numerically,
      // instead of the LAN one people expect to see at home.
      if (net.family === 'IPv4' && !net.internal && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(net.address)) {
        return `http://${net.address}:${PORT}/mobile`;
      }
    }
  }
  return `http://localhost:${PORT}/mobile`;
}

/**
 * The address that works from outside the house, if there is one.
 *
 * Written by setup/remote-setup.sh into the data folder — not derived here by
 * shelling out to the Tailscale CLI on every request, which would mean
 * finding a binary that lives in three different places depending on the
 * machine and paying for a subprocess on a route the kiosk polls.
 *
 * Re-read rather than cached at startup, so running the setup script doesn't
 * need the kiosk restarted to notice.
 */
function remoteUrl() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'remote.json'), 'utf8'));
    if (raw && typeof raw.url === 'string' && /^https:\/\/[\w.-]+$/.test(raw.url)) {
      return `${raw.url}/mobile`;
    }
  } catch {
    /* not set up — that's the normal state until someone runs the script */
  }
  return null;
}

/**
 * What to put on screen and in the QR code.
 *
 * Prefers the away-capable address once it exists, because it's strictly
 * better: it works at home too, it's HTTPS (which is what lets the phone
 * install it as a real app), and it doesn't change when the router hands out
 * a new lease.
 */
function phoneUrl() {
  return remoteUrl() || localLanUrl();
}

// ---------------------------------------------------------------------------
// One shared household sign-in.
//
// Deliberately one passcode for the whole family, not an account per person:
// there is nothing here that needs to know *which* of you added milk, and a
// per-person login on a kitchen wall is friction with no payoff.
//
// Be clear-eyed about what this is. It's a lock on the phone page so a guest
// on your Wi-Fi (or a kid who found the URL) can't rewrite the calendar. It
// is NOT security in the real sense: the traffic is plain HTTP on your LAN,
// so anyone already on the network and inclined to snoop can read it. It does
// not make this safe to expose to the internet. Don't port-forward it.
//
// The kiosk itself is exempt — requests from the machine's own loopback
// address skip the check, because a passcode prompt on the kitchen display
// would be absurd.
// ---------------------------------------------------------------------------

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(String(passcode), salt, 32).toString('hex');
}

function setPasscode(passcode) {
  if (!passcode) {
    store.auth = null;
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    store.auth = { salt, hash: hashPasscode(passcode, salt), tokens: [] };
  }
  saveStore(store);
}

function checkPasscode(passcode) {
  if (!store.auth) return true;
  const attempt = Buffer.from(hashPasscode(passcode, store.auth.salt), 'hex');
  const known = Buffer.from(store.auth.hash, 'hex');
  // Constant-time compare — cheap, and avoids leaking a prefix match through timing.
  return attempt.length === known.length && crypto.timingSafeEqual(attempt, known);
}

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  store.auth.tokens = [...(store.auth.tokens || []), { token, createdAt: Date.now() }]
    // Keep the list from growing without bound; 90 days of household devices.
    .filter((t) => Date.now() - t.createdAt < 90 * 24 * 3600 * 1000)
    .slice(-25);
  saveStore(store);
  return token;
}

/** Today where the household lives. toISOString() would roll over at 8pm here. */
function localDateString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the week containing `dateStr`, as YYYY-MM-DD. */
function startOfWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return localDateString(d);
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const match = /(?:^|;\s*)bb_session=([^;]+)/.exec(raw);
  return match ? match[1] : null;
}

function isAuthorized(req) {
  if (!store.auth) return true; // No passcode set — open, as before.
  if (isLoopback(req)) return true; // The kiosk on this machine.
  const token = cookieToken(req);
  return !!token && (store.auth.tokens || []).some((t) => t.token === token);
}

// Routes reachable without signing in: the page shell itself (it renders its
// own lock screen), the health/version probes, and the auth endpoints.
const OPEN_PATHS = new Set([
  '/',
  '/mobile',
  '/health',
  '/api/version',
  '/api/auth/status',
  '/api/auth/login',
  // The browser asks for these while the lock screen is still up, before
  // anyone could possibly have signed in. A 401 on the manifest means no
  // install prompt and no home-screen icon. They give nothing away: a name,
  // three colours, and the caching rules.
  '/manifest.webmanifest',
  '/sw.js',
]);

function isOpenPath(pathname) {
  // The display shell and its assets are open; every API route behind them is
  // not. Someone on the Wi-Fi who loads it without signing in gets an empty
  // frame, which is the right amount of nothing.
  return (
    OPEN_PATHS.has(pathname) ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/assets/') ||
    pathname === '/index.html'
  );
}

// The phone page is a plain HTML file next to this one rather than a template
// literal, so its own JavaScript doesn't have to fight backslash-escaping
// rules (and so it can be edited like normal HTML). Re-read on every request:
// it is one small file, and it means editing it never needs a restart.
const MOBILE_PAGE_FILE = path.join(__dirname, 'mobile.html');

function mobilePage() {
  return fs.readFileSync(MOBILE_PAGE_FILE, 'utf8').replace(/__BUILD__/g, BUILD);
}

// Set by startServer() when the launcher hands them over. Direct runs (dev,
// tests) leave them null and the update scheduler stays off, which is right:
// nothing to relaunch.
let relaunchApp = null;
let notifyKiosk = () => {};

/*
  How soon a push reaches the kitchen.

  This used to be half-hourly, which is a long time to stand in front of a
  screen waiting for a fix you just made. It's forty-five seconds now, and
  that's affordable because the updater asks conditionally: GitHub answers an
  unchanged release with 304 Not Modified, and 304s don't count against the
  rate limit. So the common case — nothing has changed — is free, however
  often we ask.

  End to end, a push now reaches the wall in about three minutes: a minute or
  two for GitHub to build and publish, forty-five seconds at worst before the
  screen notices, and a few seconds to download 400KB and restart.
*/
const UPDATE_CHECK_MS = 45 * 1000;
const UPDATE_FIRST_CHECK_MS = 45 * 1000; // let Wi-Fi come up after a cold boot
// A run of failures means something is wrong — no network, GitHub down, rate
// limited despite the conditional requests. Backing off turns a fast poll
// into a slow one rather than into a stream of failing requests.
const UPDATE_BACKOFF_MAX_MS = 15 * 60 * 1000;
const QUIET_BEFORE_RESTART_MS = 25 * 1000; // no edits for this long
const MAX_RESTART_WAIT_MS = 5 * 60 * 1000; // …but don't wait forever

/**
 * Restart into the newly installed build, once nobody is mid-edit.
 *
 * "Apply immediately" is the setting, and it's the right default for a
 * screen that spends most of its life showing a clock — but immediately has
 * to mean "as soon as the kitchen isn't using it", not "in the middle of
 * someone's sentence". Anyone typing is writing to the store every few
 * seconds, so a quiet store is a good enough proxy for an idle household.
 */
function restartWhenQuiet(startedAt = Date.now()) {
  const quiet = Date.now() - lastWriteAt > QUIET_BEFORE_RESTART_MS;
  const waitedLongEnough = Date.now() - startedAt > MAX_RESTART_WAIT_MS;

  if (!quiet && !waitedLongEnough) {
    setTimeout(() => restartWhenQuiet(startedAt), 10_000);
    return;
  }

  notifyKiosk({ kind: 'updating', text: 'Updating Baja Blast…' });
  console.log('[baja-blast] Restarting into the new build.');
  setTimeout(() => relaunchApp && relaunchApp(), 1_500);
}

let updateFailures = 0;

async function runUpdateCycle() {
  try {
    const result = await updater.check();

    // Successive failures double the wait, up to a quarter of an hour. One
    // success puts it straight back to the fast cadence.
    if (!result.ok) {
      updateFailures += 1;
      return;
    }
    updateFailures = 0;

    if (!result.available) return;

    console.log(`[baja-blast] Update available: rev ${result.latest.rev} (${result.latest.build}).`);
    const installed = await updater.install();
    if (!installed.ok) {
      console.error(`[baja-blast] Update failed: ${installed.error}`);
      return;
    }
    console.log(`[baja-blast] Installed rev ${installed.rev}. Waiting for a quiet moment to restart.`);
    restartWhenQuiet();
  } catch (err) {
    updateFailures += 1;
    console.error('[baja-blast] Update cycle error:', err.message);
  }
}

/** The wait before the next check: fast normally, slower while failing. */
function nextUpdateDelay() {
  if (updateFailures === 0) return UPDATE_CHECK_MS;
  return Math.min(UPDATE_CHECK_MS * 2 ** updateFailures, UPDATE_BACKOFF_MAX_MS);
}

/* ------------------------------------------------------------------ *
 * The overnight screen schedule
 * ------------------------------------------------------------------ */

// Set when someone touches the screen (or wakes it from a phone) outside its
// scheduled hours. Cleared at the next scheduled boundary, so an override
// lasts the evening rather than forever.
let displayOverrideUntil = 0;

async function applyDisplaySchedule() {
  const settings = withDefaults(store.settings);
  const scheduled = display.shouldBeOn(settings, new Date());
  const overridden = Date.now() < displayOverrideUntil;
  const wanted = scheduled || overridden;

  // Once the schedule says "on" again, the override has served its purpose.
  if (scheduled) displayOverrideUntil = 0;

  if (display.status().on === wanted) return;
  const result = await display.setDisplay(wanted);
  if (result.ok) {
    console.log(`[baja-blast] Screen ${wanted ? 'on' : 'off'} (${result.method}).`);
  } else if (!wanted) {
    // Only worth complaining about when we wanted it off and failed: failing
    // to turn a screen ON that is already on is not a problem anyone has.
    console.warn(`[baja-blast] Couldn't sleep the screen: ${result.error}`);
  }
  queueBroadcast('display');
}

/** Bring the screen back now, whatever the schedule says. */
function wakeDisplay(minutes = 90) {
  const settings = withDefaults(store.settings);
  if (settings.display.schedule && settings.display.schedule.wakeOnTouch === false) return false;
  displayOverrideUntil = Date.now() + minutes * 60 * 1000;
  applyDisplaySchedule();
  return true;
}

function scheduleDisplay() {
  // Once a minute is plenty for something whose resolution is HH:MM, and it
  // costs nothing: when nothing needs to change, applyDisplaySchedule()
  // compares two booleans and returns.
  applyDisplaySchedule();
  const t = setInterval(applyDisplaySchedule, 60_000);
  if (t.unref) t.unref();
}

function scheduleUpdates() {
  if (!relaunchApp) return; // started directly, not by systemd — nothing to restart

  // setTimeout that re-arms itself, not setInterval: the gap has to be able
  // to grow while things are failing, and setInterval's is fixed for life.
  async function tick() {
    await runUpdateCycle();
    const timer = setTimeout(tick, nextUpdateDelay());
    timer.unref();
  }

  const first = setTimeout(tick, UPDATE_FIRST_CHECK_MS);
  first.unref();
}

function startServer(options = {}) {
  if (typeof options.relaunch === 'function') relaunchApp = options.relaunch;
  if (typeof options.notify === 'function') notifyKiosk = options.notify;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      return send(res, 204, {});
    }

    // ----- household sign-in ------------------------------------------------

    if (url.pathname === '/api/auth/status' && req.method === 'GET') {
      return send(res, 200, {
        required: !!store.auth,
        signedIn: isAuthorized(req),
        onKiosk: isLoopback(req),
      });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (!store.auth) return send(res, 200, { ok: true, note: 'no-passcode-set' });
      if (!checkPasscode(body.passcode || '')) {
        return send(res, 401, { error: 'wrong-passcode' });
      }
      const token = issueToken();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        // 90 days: long enough that the family signs in once per phone.
        'Set-Cookie': `bb_session=${token}; Path=/; Max-Age=${90 * 24 * 3600}; SameSite=Lax`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = cookieToken(req);
      if (store.auth && token) {
        store.auth.tokens = (store.auth.tokens || []).filter((t) => t.token !== token);
        saveStore(store);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'bb_session=; Path=/; Max-Age=0; SameSite=Lax',
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    // Setting or clearing the passcode is a kiosk-only action on purpose: it's
    // the one control that shouldn't be reachable from a phone that merely
    // knows the current passcode.
    if (url.pathname === '/api/auth/passcode' && req.method === 'POST') {
      if (!isLoopback(req)) return send(res, 403, { error: 'kiosk-only' });
      const body = await readBody(req);
      setPasscode(body.passcode || '');
      return send(res, 200, { ok: true, required: !!store.auth });
    }

    if (!isOpenPath(url.pathname) && !isAuthorized(req)) {
      return send(res, 401, { error: 'sign-in-required' });
    }

    /* ------------ the bits that make it an installable app ------------ */

    // The manifest, the service worker and the icons all have to be reachable
    // before anyone has signed in — the browser fetches them while the lock
    // screen is still showing, and a 401 on the manifest means no install
    // prompt and no app icon. They contain nothing private: three colours and
    // a name.
    if (url.pathname === '/manifest.webmanifest' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      return res.end(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest')));
    }

    if (url.pathname === '/sw.js' && req.method === 'GET') {
      // Served from the root on purpose: a service worker's scope can't be
      // wider than its own path, and this one has to cover /api and /photos,
      // not just /mobile.
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        // Never cached. This file is what decides how everything else is
        // cached, so a stale copy of it is the one mistake with no way out.
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Service-Worker-Allowed': '/',
      });
      return res.end(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8').replace(/__BUILD__/g, BUILD));
    }

    if (url.pathname.startsWith('/icons/') && req.method === 'GET') {
      const name = path.basename(url.pathname);
      const file = path.join(__dirname, 'icons', name);
      if (!/^[\w.-]+\.png$/.test(name) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
      return res.end(fs.readFileSync(file));
    }

    /**
     * The live connection. Held open; the server writes down it whenever
     * something changes.
     *
     * The heartbeat is not optional. Home routers and mobile networks drop
     * connections they decide are idle, usually somewhere between 30 and 60
     * seconds, and a silently dead stream looks exactly like a quiet house.
     * A comment line every 20 seconds keeps it alive and costs almost nothing.
     */
    /* ---------------- the screen ---------------- */

    if (url.pathname === '/api/display' && req.method === 'GET') {
      const settings = withDefaults(store.settings);
      return send(res, 200, {
        ...display.status(),
        scheduledOn: display.shouldBeOn(settings, new Date()),
        overrideUntil: displayOverrideUntil ? new Date(displayOverrideUntil).toISOString() : null,
        schedule: settings.display.schedule,
      });
    }

    // Touching the screen calls this. Also what the phone's "wake" button
    // reaches, so one path handles both and they can't disagree.
    if (url.pathname === '/api/display/wake' && req.method === 'POST') {
      const woke = wakeDisplay();
      return send(res, 200, { ok: true, woke, ...display.status() });
    }

    if (url.pathname === '/api/display/sleep' && req.method === 'POST') {
      displayOverrideUntil = 0;
      const result = await display.setDisplay(false);
      queueBroadcast('display');
      return send(res, result.ok ? 200 : 500, result);
    }

    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        // Proxies buffer streaming responses by default, which turns
        // "instant" into "whenever the buffer fills". Harmless here, and
        // essential the day this sits behind one.
        'X-Accel-Buffering': 'no',
      });

      // Reconnect after a second, and say hello so the client knows the
      // connection is genuinely established rather than merely opened.
      res.write('retry: 1000\n');
      res.write(`event: hello\ndata: ${JSON.stringify({ build: BUILD, at: new Date().toISOString() })}\n\n`);

      liveClients.add(res);

      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(heartbeat);
          liveClients.delete(res);
        }
      }, 20_000);

      const drop = () => {
        clearInterval(heartbeat);
        liveClients.delete(res);
      };
      req.on('close', drop);
      req.on('error', drop);
      return undefined;
    }

    if (url.pathname === '/mobile' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      });
      return res.end(mobilePage());
    }

    // The wall display. Chromium on the Pi opens "/" and gets this; it used to
    // be loaded off the filesystem, which is why the built page
    // uses relative asset paths — they work either way.
    if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
      const index = path.join(PAYLOAD_ROOT, 'dist', 'index.html');
      if (!fs.existsSync(index)) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('The display has not been built yet. Run: npm run build');
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      return res.end(fs.readFileSync(index));
    }

    // Its JS and CSS. Vite fingerprints these filenames, so they can be
    // cached hard — a new build produces new names rather than new contents at
    // the same name.
    if (url.pathname.startsWith('/assets/') && req.method === 'GET') {
      const name = path.basename(url.pathname);
      const file = path.join(PAYLOAD_ROOT, 'dist', 'assets', name);
      if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      const ext = path.extname(name);
      const type =
        { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }[ext] ||
        'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(fs.readFileSync(file));
    }

    if (url.pathname === '/api/grocery' && req.method === 'GET') {
      return send(res, 200, store.grocery);
    }

    if (url.pathname === '/api/grocery' && req.method === 'POST') {
      const body = await readBody(req);
      const item = { id: crypto.randomUUID(), label: body.label, addedBy: body.addedBy, done: false, createdAt: new Date().toISOString() };
      store.grocery.push(item);
      saveStore(store);
      return send(res, 201, item);
    }

    const groceryToggle = url.pathname.match(/^\/api\/grocery\/([^/]+)\/toggle$/);
    if (groceryToggle && req.method === 'POST') {
      const item = store.grocery.find((g) => g.id === groceryToggle[1]);
      if (!item) return send(res, 404, { error: 'not found' });
      item.done = !item.done;
      saveStore(store);
      return send(res, 200, item);
    }

    const groceryDelete = url.pathname.match(/^\/api\/grocery\/([^/]+)$/);
    if (groceryDelete && req.method === 'DELETE') {
      store.grocery = store.grocery.filter((g) => g.id !== groceryDelete[1]);
      saveStore(store);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      return send(res, 200, store.events);
    }

    // Repeats turned into individual occurrences, for the phone (which has no
    // build step and so can't run the renderer's copy of the expander).
    if (url.pathname === '/api/events/expanded' && req.method === 'GET') {
      const from = url.searchParams.get('from')
        ? new Date(url.searchParams.get('from'))
        : new Date(Date.now() - 24 * 3600 * 1000);
      const to = url.searchParams.get('to')
        ? new Date(url.searchParams.get('to'))
        : new Date(Date.now() + 90 * 24 * 3600 * 1000);
      return send(res, 200, expandEvents(store.events, from, to));
    }

    if (url.pathname === '/api/events' && req.method === 'POST') {
      const body = await readBody(req);
      const event = { id: crypto.randomUUID(), ...body };
      store.events.push(event);
      saveStore(store);
      // Added from a phone? Wake the display so whoever added it can see it
      // land, instead of walking over to a screensaver. Events added on the
      // kiosk itself (loopback) already have someone looking at the screen.
      if (!isLoopback(req)) nudgeKiosk();
      return send(res, 201, event);
    }

    // ----- editing one occurrence of a repeat --------------------------------
    //
    // A weekly class is stored as ONE event with a rule on it, not 120 rows.
    // So "just this Tuesday" can't be a plain edit — it becomes two writes:
    // the master learns to skip that date, and a standalone override event
    // takes its place. "All of them" is the simple case: patch the master.

    if (url.pathname === '/api/events/occurrence' && req.method === 'PATCH') {
      const body = await readBody(req);
      const master = store.events.find((e) => e.id === body.masterId);
      if (!master) return send(res, 404, { error: 'no-such-event' });
      if (!body.occurrenceDate) return send(res, 400, { error: 'no-occurrence-date' });

      master.exceptions = [...new Set([...(master.exceptions || []), body.occurrenceDate])];

      // A null patch means "delete just this one" — skip it and add nothing.
      let override = null;
      if (body.patch) {
        override = {
          ...master,
          ...body.patch,
          id: crypto.randomUUID(),
          recurrence: undefined,
          exceptions: undefined,
          recurrenceParentId: master.id,
          occurrenceDate: body.occurrenceDate,
        };
        store.events.push(override);
      }

      saveStore(store);
      if (!isLoopback(req)) nudgeKiosk();
      return send(res, 200, { ok: true, override });
    }

    const eventItem = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (eventItem && req.method === 'PATCH') {
      const body = await readBody(req);
      const idx = store.events.findIndex((e) => e.id === eventItem[1]);
      if (idx === -1) return send(res, 404, { error: 'not found' });
      store.events[idx] = { ...store.events[idx], ...body };
      saveStore(store);
      return send(res, 200, store.events[idx]);
    }
    if (eventItem && req.method === 'DELETE') {
      const id = eventItem[1];
      // Deleting a repeating master takes its overrides with it — otherwise
      // the one moved lesson survives the series it belonged to.
      store.events = store.events.filter((e) => e.id !== id && e.recurrenceParentId !== id);
      saveStore(store);
      return send(res, 200, { ok: true });
    }

    // Always merged over defaults, so a store.json written before a feature
    // existed still gets that feature's new keys instead of `undefined`.
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return send(res, 200, withDefaults(store.settings || DEFAULT_SETTINGS));
    }

    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      const body = await readBody(req);
      store.settings = withDefaults(body);
      saveStore(store);
      return send(res, 200, store.settings);
    }

    // Baja voice assistant proxy — keeps any API key on this local server
    // instead of shipping it to every device that opens /mobile. The kiosk
    // sends { question, context }; this forwards to Claude if an Anthropic
    // key is set, otherwise tries a free local model via Ollama
    // (http://localhost:11434) before giving up with a helpful message.
    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody(req);
      const apiKey = store.settings?.bajaApiKey;
      const systemPrompt =
        "You are Baja, a calm, concise voice assistant embedded in a kitchen calendar kiosk. " +
        "Answer in 1-3 short spoken sentences — this gets read aloud, not displayed as text. " +
        "Use the household context you're given (today's schedule, grocery list, weather) when relevant. " +
        "If asked something with no connection to the household, just answer normally and briefly.";

      if (apiKey) {
        try {
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 300,
              system: systemPrompt,
              messages: [
                { role: 'user', content: `Household context:\n${body.context || '(none)'}\n\nQuestion: ${body.question}` },
              ],
            }),
          });
          const data = await upstream.json();
          const text = data?.content?.find((b) => b.type === 'text')?.text;
          if (text) return send(res, 200, { answer: text, source: 'anthropic' });
          // fall through to Ollama if Anthropic returned something unusable
        } catch {
          // fall through to Ollama attempt below
        }
      }

      // Free path: try a local Ollama install. No key, no cost, no cloud —
      // but only works if Ollama is installed and the model is pulled
      // (`ollama pull llama3.2`, or whatever model name is set in Baja
      // settings). If Ollama isn't running, this fails fast and we return
      // a helpful message rather than hanging.
      try {
        const model = store.settings?.bajaLocalModel || 'llama3.2';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const upstream = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Household context:\n${body.context || '(none)'}\n\nQuestion: ${body.question}` },
            ],
          }),
        });
        clearTimeout(timeout);
        if (!upstream.ok) throw new Error('ollama-error');
        const data = await upstream.json();
        const text = data?.message?.content;
        if (text) return send(res, 200, { answer: text, source: 'ollama' });
        throw new Error('ollama-empty');
      } catch {
        return send(res, 400, { error: 'no-assistant' });
      }
    }

    if (url.pathname === '/api/photos' && req.method === 'GET') {
      return send(res, 200, store.photos);
    }

    // Body is { dataUrl: "data:image/jpeg;base64,...", caption? }. Phone
    // camera/photo-library uploads come in as data URLs from a FileReader.
    if (url.pathname === '/api/photos' && req.method === 'POST') {
      const body = await readBody(req);
      const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.dataUrl || '');
      if (!match) return send(res, 400, { error: 'invalid-image' });
      const [, mime, base64] = match;
      const ext = PHOTO_MIME_EXT[mime] || 'jpg';
      const id = crypto.randomUUID();
      const filename = `${id}.${ext}`;
      fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(base64, 'base64'));
      const photo = { id, url: `/photos/${filename}`, caption: body.caption, uploadedAt: new Date().toISOString() };
      store.photos.push(photo);
      saveStore(store);
      return send(res, 201, photo);
    }

    const photoDelete = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (photoDelete && req.method === 'DELETE') {
      const photo = store.photos.find((p) => p.id === photoDelete[1]);
      if (photo) {
        const filename = photo.url.split('/').pop();
        try { fs.unlinkSync(path.join(PHOTOS_DIR, filename)); } catch {}
      }
      store.photos = store.photos.filter((p) => p.id !== photoDelete[1]);
      saveStore(store);
      return send(res, 200, { ok: true });
    }

    // Static serving for uploaded photos.
    const photoFile = url.pathname.match(/^\/photos\/([^/]+)$/);
    if (photoFile && req.method === 'GET') {
      const filePath = path.join(PHOTOS_DIR, photoFile[1]);
      if (!filePath.startsWith(PHOTOS_DIR) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const ext = path.extname(filePath).slice(1);
      const mime = Object.entries(PHOTO_MIME_EXT).find(([, e]) => e === ext)?.[0] || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=31536000' });
      return fs.createReadStream(filePath).pipe(res);
    }

    // ----- live feeds -------------------------------------------------------
    // These are real network calls made from Node (the renderer can't make
    // them itself — browsers block cross-origin requests to these hosts).
    // Everything is cached upstream in livedata.cjs and served stale rather
    // than blank when the network hiccups.

    if (url.pathname === '/api/weather' && req.method === 'GET') {
      const settings = withDefaults(store.settings || DEFAULT_SETTINGS);
      const { lat, lon } = settings.homeLocation;
      const { value, fetchedAt } = await getWeather(lat, lon);
      if (!value) return send(res, 200, { unavailable: true });
      // Full snapshot for the kiosk; the phone reads the same object and
      // just uses the top-level convenience fields.
      const rainHour = value.hourly.find((h) => h.precipChance >= 0.4);
      return send(res, 200, {
        ...value,
        tempF: value.now.tempF,
        condition: value.now.condition,
        rainSoon: !!rainHour,
        rainAt: rainHour ? rainHour.time : null,
        place: settings.homeLocation.label,
        updatedAt: new Date(fetchedAt).toISOString(),
      });
    }

    if (url.pathname === '/api/news' && req.method === 'GET') {
      const { value, fetchedAt } = await getNews();
      return send(res, 200, { items: value || [], updatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null });
    }

    if (url.pathname === '/api/stocks' && req.method === 'GET') {
      const settings = withDefaults(store.settings || DEFAULT_SETTINGS);
      const tickers = (settings.feeds?.tickers || []).filter(Boolean).slice(0, 8);
      if (tickers.length === 0) return send(res, 200, { items: [], updatedAt: null });
      const { value, fetchedAt } = await getStocks(tickers);
      // Preserve the household's chosen order rather than whatever order the
      // upstream requests happened to resolve in.
      const byOrder = (value || [])
        .slice()
        .sort((a, b) => tickers.indexOf(a.symbol) - tickers.indexOf(b.symbol));
      return send(res, 200, { items: byOrder, updatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null });
    }

    // ----- music: Sonos on the LAN, and Spotify Connect ---------------------
    // See app/music.cjs for why this is the shape it is (short version:
    // no app can stream audio over Bluetooth; Spotify Connect reaches a Sonos
    // over Wi-Fi, which is better anyway).

    function currentSettings() {
      return withDefaults(store.settings || DEFAULT_SETTINGS);
    }

    function saveSpotifyTokens(tokens) {
      store.spotify = { ...(store.spotify || {}), ...tokens };
      saveStore(store);
    }

    async function spotifyCall(path, options) {
      const s = currentSettings();
      return music.spotifyApi(s.music.spotifyClientId, store.spotify, saveSpotifyTokens, path, options);
    }

    if (url.pathname === '/api/music/state' && req.method === 'GET') {
      const s = currentSettings();
      const speakers = await music.getSonosPlayers();
      let nowPlaying = null;
      let error = null;

      // Prefer whatever is actually making noise: ask Spotify first (it knows
      // about playback happening on the Sonos itself), fall back to the
      // speaker's own transport state.
      if (store.spotify?.accessToken) {
        try {
          nowPlaying = music.normalizeSpotifyPlayback(await spotifyCall('/me/player'));
        } catch (e) {
          error = e.message;
        }
      }
      if ((!nowPlaying || !nowPlaying.title) && s.music.speakerIp) {
        try {
          nowPlaying = await music.sonosNowPlaying(s.music.speakerIp);
        } catch (e) {
          error = error || e.message;
        }
      }

      return send(res, 200, {
        speakers,
        selected: s.music.speakerIp || null,
        nowPlaying,
        spotify: {
          clientIdSet: !!s.music.spotifyClientId,
          connected: !!store.spotify?.accessToken,
        },
        error,
      });
    }

    if (url.pathname === '/api/music/discover' && req.method === 'POST') {
      return send(res, 200, { speakers: await music.getSonosPlayers({ force: true }) });
    }

    if (url.pathname === '/api/music/command' && req.method === 'POST') {
      const body = await readBody(req);
      const s = currentSettings();
      const action = body.action;
      try {
        // Spotify Connect first when it's wired up: it drives the speaker
        // over Wi-Fi and knows about queue/shuffle. Sonos SOAP is the
        // account-free fallback.
        if (store.spotify?.accessToken && body.target !== 'sonos') {
          const map = { play: 'play', pause: 'pause', next: 'next', previous: 'previous' };
          if (!map[action]) return send(res, 400, { error: 'unknown-action' });
          const method = action === 'next' || action === 'previous' ? 'POST' : 'PUT';
          await spotifyCall(`/me/player/${map[action]}`, { method });
          return send(res, 200, { ok: true, via: 'spotify' });
        }
        if (!s.music.speakerIp) return send(res, 400, { error: 'no-speaker-selected' });
        await music.sonosCommand(s.music.speakerIp, action);
        return send(res, 200, { ok: true, via: 'sonos' });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    if (url.pathname === '/api/music/volume' && req.method === 'POST') {
      const body = await readBody(req);
      const s = currentSettings();
      try {
        if (store.spotify?.accessToken && body.target !== 'sonos') {
          await spotifyCall(`/me/player/volume?volume_percent=${Math.round(body.level)}`, { method: 'PUT' });
          return send(res, 200, { ok: true, via: 'spotify' });
        }
        if (!s.music.speakerIp) return send(res, 400, { error: 'no-speaker-selected' });
        await music.sonosSetVolume(s.music.speakerIp, body.level);
        return send(res, 200, { ok: true, via: 'sonos' });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    if (url.pathname === '/api/spotify/login' && req.method === 'GET') {
      const s = currentSettings();
      if (!s.music.spotifyClientId) return send(res, 400, { error: 'no-client-id' });
      res.writeHead(302, { Location: music.buildAuthUrl(s.music.spotifyClientId) });
      return res.end();
    }

    if (url.pathname === '/api/spotify/callback' && req.method === 'GET') {
      const s = currentSettings();
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const denied = url.searchParams.get('error');
      let ok = false;
      let message;
      let detail = '';

      if (denied) {
        message = `Spotify declined the sign-in: ${denied}`;
        detail =
          denied === 'access_denied'
            ? 'You pressed Cancel on Spotify\'s permission screen. Nothing was changed — press Connect again to retry.'
            : '';
      } else if (!code) {
        message = 'Spotify sent us back without an authorisation code.';
        detail = 'This usually means the link was opened directly rather than through the Connect button.';
      } else {
        try {
          saveSpotifyTokens(await music.exchangeCode(s.music.spotifyClientId, code, state));
          ok = true;
          message = 'Spotify connected.';
          detail = 'You can close this tab. If no speakers show up in the app, open Spotify on your phone and play something for a few seconds — Spotify only lists devices that are awake.';
        } catch (e) {
          message = 'Could not finish connecting.';
          // These three cover essentially every real failure, and each has a
          // different fix — a bare error string sends people in circles.
          if (/redirect/i.test(e.message)) {
            detail = `Spotify rejected the redirect URI. Add exactly this to your app at developer.spotify.com/dashboard → Settings → Redirect URIs: ${music.SPOTIFY_REDIRECT_URI}`;
          } else if (/client/i.test(e.message)) {
            detail = 'Spotify rejected the Client ID. Check it matches the one on your app\'s dashboard page — no spaces, no quotes.';
          } else if (/state/i.test(e.message)) {
            detail = 'This sign-in link had expired, or the server restarted mid-way. Press Connect again and finish within half an hour.';
          } else {
            detail = `Spotify said: ${e.message}`;
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(
        `<!doctype html><meta charset="utf-8"><title>Baja Blast · Spotify</title>` +
          `<body style="background:#000;color:#fff;font:16px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;padding:48px;max-width:640px">` +
          `<h1 style="font-weight:900;letter-spacing:-0.02em;margin:0 0 6px">Baja Blast</h1>` +
          `<p style="color:${ok ? '#00F5D4' : '#FF5C72'};font-weight:700;margin:0 0 14px">${message}</p>` +
          `<p style="color:#9a9a9a">${detail}</p>` +
          `</body>`
      );
    }

    // Opens the Spotify login in a real browser window on the kiosk.
    //
    // xdg-open is the desktop-agnostic way to say "open this the way the user
    // would" — it lands in whatever browser the session has, with an address
    // bar, a back button and saved passwords. Signing in inside the fullscreen
    // kiosk window means none of those, and no way to see what went wrong.
    //
    // If there's no desktop session to open it in — headless, or a browser
    // that isn't running — the URL is handed back instead so a phone can
    // finish the sign-in. That's the common case anyway.
    if (url.pathname === '/api/spotify/open-login' && req.method === 'POST') {
      const s = currentSettings();
      if (!s.music.spotifyClientId) return send(res, 400, { error: 'no-client-id' });
      const authUrl = music.buildAuthUrl(s.music.spotifyClientId);

      const opened = await new Promise((resolve) => {
        execFile('xdg-open', [authUrl], { timeout: 5000 }, (err) => resolve(!err));
      });
      return send(res, 200, { ok: true, opened, url: opened ? undefined : authUrl });
    }

    // Says exactly what is and isn't working, in facts rather than guesses.
    // "It says connected but nothing happens" has about five different
    // causes and they are indistinguishable from the outside.
    if (url.pathname === '/api/spotify/diagnose' && req.method === 'GET') {
      const s = currentSettings();
      const report = {
        clientIdSet: !!s.music.spotifyClientId,
        tokensPresent: !!store.spotify?.accessToken,
        redirectUri: music.SPOTIFY_REDIRECT_URI,
        profile: null,
        product: null,
        devices: null,
        deviceNames: [],
        error: null,
        verdict: '',
      };

      if (!report.clientIdSet) {
        report.verdict = 'No client ID yet. Create a free app at developer.spotify.com/dashboard and paste its Client ID.';
        return send(res, 200, report);
      }
      if (!report.tokensPresent) {
        report.verdict = 'Not signed in. Press Connect Spotify on the kiosk itself.';
        return send(res, 200, report);
      }

      try {
        const me = await spotifyCall('/me');
        report.profile = me?.display_name || me?.id || null;
        report.product = me?.product || null;
      } catch (e) {
        report.error = e.message;
        report.verdict =
          e.status === 401
            ? 'The sign-in has expired or was revoked. Press Disconnect, then Connect again.'
            : `Spotify rejected the request: ${e.message}`;
        return send(res, 200, report);
      }

      try {
        const data = await spotifyCall('/me/player/devices');
        report.devices = (data?.devices || []).length;
        report.deviceNames = (data?.devices || []).map((d) => `${d.name} (${d.type})`);
      } catch (e) {
        report.error = e.message;
      }

      if (report.product && report.product !== 'premium') {
        report.verdict =
          `Signed in as ${report.profile}, but this is a Spotify ${report.product} account. ` +
          'Spotify only allows apps to control playback on Premium — that is their restriction, not this app\'s. ' +
          'The embedded player lower down still works (30-second previews), and Sonos control over Wi-Fi works with no Spotify account at all.';
      } else if (report.error) {
        report.verdict = `Signed in as ${report.profile}, but listing devices failed: ${report.error}`;
      } else if (report.devices === 0) {
        report.verdict =
          `Signed in as ${report.profile} (Premium) and everything is wired up correctly — Spotify just isn't showing ` +
          'any devices right now. It only lists speakers that are awake: open Spotify on your phone or the Sonos app, ' +
          'play something for a few seconds, then press Refresh devices here. The speaker will appear and stay for a while.';
      } else {
        report.verdict = `Working. Signed in as ${report.profile}, ${report.devices} device(s) available.`;
      }
      return send(res, 200, report);
    }

    if (url.pathname === '/api/spotify/devices' && req.method === 'GET') {
      try {
        const data = await spotifyCall('/me/player/devices');
        return send(res, 200, { devices: data?.devices || [] });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    if (url.pathname === '/api/spotify/transfer' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        await spotifyCall('/me/player', { method: 'PUT', body: { device_ids: [body.deviceId], play: true } });
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    if (url.pathname === '/api/spotify/disconnect' && req.method === 'POST') {
      store.spotify = null;
      saveStore(store);
      return send(res, 200, { ok: true });
    }

    // ----- kiosk remote control ---------------------------------------------
    //
    // The kitchen display has no touchscreen, and the keyboard lives in a
    // drawer. So the phone can reach over and poke it: wake it out of the
    // ambient reel, or switch which calendar view it's showing.
    //
    // Deliberately a counter rather than a queue. The kiosk polls, sees a
    // number it hasn't acted on, and acts once. Nothing accumulates while the
    // Mac is asleep, so waking at 6am doesn't replay a week of button presses.

    if (url.pathname === '/api/kiosk/state' && req.method === 'GET') {
      return send(res, 200, { ...kioskCommand, status: kioskStatus, commands: kioskLog });
    }

    // The kiosk telling the phone what it's looking at.
    if (url.pathname === '/api/kiosk/report' && req.method === 'POST') {
      const body = await readBody(req);
      kioskStatus = {
        view: body.view || kioskStatus.view,
        rangeLabel: body.rangeLabel ?? kioskStatus.rangeLabel,
        idle: !!body.idle,
        at: new Date().toISOString(),
      };
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/kiosk/command' && req.method === 'POST') {
      const body = await readBody(req);
      pushCommand({
        seq: kioskCommand.seq + 1,
        wake: body.wake !== false,
        view: ['day', 'week', 'month'].includes(body.view) ? body.view : null,
        // prev / next / today — steps by whatever unit the current view uses.
        nav: ['prev', 'next', 'today'].includes(body.nav) ? body.nav : null,
        at: new Date().toISOString(),
      });
      return send(res, 200, kioskCommand);
    }

    // ----- chores, points and the leaderboard -------------------------------
    //
    // Completions are keyed by LOCAL date (YYYY-MM-DD), which is what makes
    // "today's list" reset at midnight where the family lives rather than at
    // 8pm, which is when UTC rolls over here.

    if (url.pathname === '/api/chores' && req.method === 'GET') {
      const s = currentSettings();
      const date = url.searchParams.get('date') || localDateString();
      const items = (s.chores.items || []).filter((c) => c.active);
      const completions = (store.completions || []).filter((c) => c.date === date);

      const weekStart = startOfWeek(date);
      const rewards = s.chores.rewards || [];
      const personGoals = s.chores.personGoals || {};
      const totals = {};

      for (const person of s.people) {
        const mine = items.filter((c) => !c.personId || c.personId === person.id);
        const doneToday = completions.filter((c) => c.personId === person.id);
        const all = (store.completions || []).filter((c) => c.personId === person.id);
        const totalPoints = all.reduce((n, c) => n + (c.points || 0), 0);

        // Each person saves up separately towards whichever reward they
        // picked, against their OWN running total — so one person cashing in
        // doesn't reset anyone else.
        const reward = rewards.find((r) => r.id === personGoals[person.id]) || null;
        const goalPoints = reward ? reward.points : 0;

        totals[person.id] = {
          todayDone: doneToday.length,
          todayTotal: mine.length,
          todayPoints: doneToday.reduce((n, c) => n + (c.points || 0), 0),
          weekPoints: all.filter((c) => c.date >= weekStart).reduce((n, c) => n + (c.points || 0), 0),
          totalPoints,
          goalLabel: reward ? reward.label : null,
          goalPoints,
          goalPct: goalPoints ? Math.min(100, (totalPoints / goalPoints) * 100) : 0,
          goalReached: !!reward && totalPoints >= goalPoints,
        };
      }

      // "Everyone finished theirs" — only counts people who actually picked a
      // reward, so an unassigned Household entry doesn't hold the family back.
      const withGoals = s.people.filter((p) => p.enabled && totals[p.id].goalLabel);

      return send(res, 200, {
        date,
        items,
        completions,
        totals,
        rewards,
        goal: s.chores.goal,
        // The household goal sits alongside the individual ones: everyone's
        // points push this one bar as well as their own.
        goalPoints: (store.completions || []).reduce((n, c) => n + (c.points || 0), 0),
        everyoneReached: withGoals.length > 0 && withGoals.every((p) => totals[p.id].goalReached),
      });
    }

    if (url.pathname === '/api/chores/toggle' && req.method === 'POST') {
      const body = await readBody(req);
      const s = currentSettings();
      const date = body.date || localDateString();
      const chore = (s.chores.items || []).find((c) => c.id === body.choreId);
      if (!chore) return send(res, 404, { error: 'no-such-chore' });
      if (!body.personId) return send(res, 400, { error: 'no-person' });

      const existing = (store.completions || []).find(
        (c) => c.choreId === body.choreId && c.personId === body.personId && c.date === date
      );

      if (existing) {
        store.completions = store.completions.filter((c) => c.id !== existing.id);
      } else {
        store.completions = [
          ...(store.completions || []),
          {
            id: crypto.randomUUID(),
            choreId: chore.id,
            personId: body.personId,
            date,
            points: chore.points || 0,
            at: new Date().toISOString(),
          },
        ];
      }

      // Keep roughly a year of history; the leaderboard doesn't need more and
      // the store stays small enough to rewrite on every tick.
      const cutoff = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      store.completions = store.completions.filter((c) => c.date >= cutoff);
      saveStore(store);

      // Tell the client whether this tick finished the person's whole list,
      // so it knows to celebrate — computed here so both surfaces agree.
      const mine = (s.chores.items || []).filter((c) => c.active && (!c.personId || c.personId === body.personId));
      const doneNow = store.completions.filter((c) => c.date === date && c.personId === body.personId);
      return send(res, 200, {
        done: !existing,
        completedAll: mine.length > 0 && doneNow.length === mine.length,
        todayDone: doneNow.length,
        todayTotal: mine.length,
      });
    }

    /* ---------------- recipes ---------------- */
    //
    // Fetched here rather than in the browser so one cache serves the wall
    // screen and every phone in the house, and so the kiosk keeps working
    // through a Wi-Fi hiccup (recipes.cjs serves stale on error).

    if (url.pathname === '/api/recipes/sections' && req.method === 'GET') {
      const s = currentSettings();
      const sections = [
        { key: 'baking', title: 'Baking', subtitle: 'Cakes, breads, cookies, pies' },
        { key: 'mocktails', title: 'Mocktails', subtitle: 'No alcohol' },
      ];
      if (s.recipes.showCocktails) sections.push({ key: 'cocktails', title: 'Cocktails', subtitle: 'Grown-ups only' });
      try {
        return send(res, 200, { sections, categories: await recipes.foodCategories() });
      } catch (err) {
        // A category list that can't load shouldn't 500 the screen: the three
        // built-in sections still work, and the UI shows why the rest didn't.
        return send(res, 200, { sections, categories: [], error: String(err.message || err) });
      }
    }

    const recipeSection = url.pathname.match(/^\/api\/recipes\/section\/(.+)$/);
    if (recipeSection && req.method === 'GET') {
      const name = decodeURIComponent(recipeSection[1]);
      // Honour the toggle at the API, not just by hiding the tab — a phone
      // with a stale page open shouldn't be a way around it.
      if (name === 'cocktails' && !currentSettings().recipes.showCocktails) {
        return send(res, 403, { error: 'cocktails-hidden' });
      }
      try {
        return send(res, 200, await recipes.section(name));
      } catch (err) {
        return send(res, 502, { error: String(err.message || err) });
      }
    }

    if (url.pathname === '/api/recipes/search' && req.method === 'GET') {
      try {
        const found = await recipes.search(url.searchParams.get('q') || '');
        const s = currentSettings();
        return send(res, 200, s.recipes.showCocktails ? found : found.filter((r) => r.kind !== 'cocktail'));
      } catch (err) {
        return send(res, 502, { error: String(err.message || err) });
      }
    }

    // Last, so it can't swallow /search or /section above.
    const recipeItem = url.pathname.match(/^\/api\/recipes\/(.+)$/);
    if (recipeItem && req.method === 'GET') {
      try {
        return send(res, 200, await recipes.lookup(decodeURIComponent(recipeItem[1])));
      } catch (err) {
        return send(res, 404, { error: String(err.message || err) });
      }
    }

    // What changed, and when. Read from CHANGELOG.md at the root of the
    // payload, so an update ships its own release notes.
    if (url.pathname === '/api/changelog' && req.method === 'GET') {
      return send(res, 200, { build: BUILD, entries: changelog.entries() });
    }

    /* ---------------- bake night ---------------- */

    if (url.pathname === '/api/bake' && req.method === 'GET') {
      const night = currentSettings().recipes.bakeNight;
      return send(res, 200, {
        enabled: night.enabled,
        label: night.label,
        time: night.time,
        durationMinutes: night.durationMinutes,
        ...bake.summary(store.bake, night.weekday, new Date(), 6),
        // The whole (pruned) map, not just the next few weeks: the calendar
        // can be scrolled back, and a March bake day should still say what
        // was made that Saturday.
        picks: bake.normalizeBake(store.bake).picks,
      });
    }

    // Pick what we're making. Called from the recipe browser, from the in-app
    // browser ("use this page"), and from a phone.
    if (url.pathname === '/api/bake/pick' && req.method === 'POST') {
      const body = await readBody(req);
      const weekday = currentSettings().recipes.bakeNight.weekday;
      const date =
        typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
          ? body.date
          : bake.dateKey(bake.nextBakeDate(weekday));

      const pick = bake.normalizePick(body.recipe ?? body);
      if (!pick) return send(res, 400, { error: 'a pick needs a title or a link' });

      store.bake = bake.prunePicks(bake.normalizeBake(store.bake));
      store.bake.picks[date] = pick;
      saveStore(store);
      // Whoever pressed this is usually standing somewhere else in the house.
      nudgeKiosk();
      return send(res, 200, { date, pick });
    }

    if (url.pathname === '/api/bake/pick' && req.method === 'DELETE') {
      const weekday = currentSettings().recipes.bakeNight.weekday;
      const date = url.searchParams.get('date') || bake.dateKey(bake.nextBakeDate(weekday));
      store.bake = bake.normalizeBake(store.bake);
      delete store.bake.picks[date];
      saveStore(store);
      return send(res, 200, { ok: true, date });
    }

    // ----- backup / restore -------------------------------------------------
    // Everything the household has put in, as one file they can keep. The
    // passcode hash and Spotify tokens are stripped: a backup ends up in
    // Downloads or a group chat, and neither belongs there.

    if (url.pathname === '/api/export' && req.method === 'GET') {
      const { auth, spotify, ...safe } = store;
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="baja-blast-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify({ exportedAt: new Date().toISOString(), build: BUILD, ...safe }, null, 2));
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || !Array.isArray(body.events)) {
        return send(res, 400, { error: 'not-a-backup-file' });
      }
      // Keep the current passcode and Spotify connection — you're restoring
      // the household's content, not re-locking or disconnecting the kiosk.
      store = {
        ...emptyStore(),
        events: body.events || [],
        grocery: body.grocery || [],
        photos: body.photos || [],
        settings: body.settings ? withDefaults(body.settings) : store.settings,
        // The export writes these out, so a restore that quietly dropped them
        // would lose every chore point the kids had earned and every baking
        // pick the household had made.
        completions: Array.isArray(body.completions) ? body.completions : [],
        bake: bake.normalizeBake(body.bake),
        auth: store.auth,
        spotify: store.spotify,
      };
      saveStore(store);
      return send(res, 200, { ok: true, events: store.events.length, grocery: store.grocery.length });
    }

    // Lets the kiosk show which build of the server it's actually talking to.
    if (url.pathname === '/api/version' && req.method === 'GET') {
      const running = require('./paths.cjs').payloadRoot();
      return send(res, 200, {
        build: BUILD,
        root: path.resolve(__dirname, '..'),
        rev: running.rev,
        source: running.source, // "bundled" (shipped in the .app) or "installed" (updated over the air)
        // Recomputed per request rather than cached at startup: a stick moved
        // to another Mac, or a DHCP lease that rolled over overnight, both
        // change this, and a stale address on screen is worse than none.
        phoneUrl: phoneUrl(),
        localUrl: localLanUrl(),
        remoteUrl: remoteUrl(), // null until setup/remote-setup.sh has run
      });
    }

    /* ---------------- updates ---------------- */

    if (url.pathname === '/api/update/status' && req.method === 'GET') {
      return send(res, 200, { ...updater.status(), autoUpdate: !!relaunchApp });
    }

    if (url.pathname === '/api/update/check' && req.method === 'POST') {
      const result = await updater.check();
      return send(res, result.ok ? 200 : 502, { ...result, status: updater.status() });
    }

    if (url.pathname === '/api/update/install' && req.method === 'POST') {
      // Check first if nobody has: pressing "Update now" on a phone that
      // hasn't polled yet shouldn't answer "nothing to install".
      if (!updater.state.latest) await updater.check();
      const result = await updater.install();
      if (result.ok) restartWhenQuiet();
      return send(res, result.ok ? 200 : 400, { ...result, status: updater.status() });
    }

    if (url.pathname === '/health') {
      return send(res, 200, { ok: true, build: BUILD });
    }

    send(res, 404, { error: 'not found' });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Already running (e.g. started separately for dev) — not fatal.
      console.log(`[baja-blast] Server already running on port ${PORT}`);
    } else {
      console.error('[baja-blast] Server error:', err);
    }
  });

  server.listen(PORT, () => {
    // The folder is printed on purpose: unzipping next to an existing copy
    // silently produces a second folder, and then "I ran all the commands"
    // and "I'm running the new code" quietly stop being the same statement.
    console.log('');
    console.log(`[baja-blast] Build ${BUILD}`);
    console.log(`[baja-blast] Running from: ${path.resolve(__dirname, '..')}`);
    // Worth printing every time: on a stick this is the folder that holds the
    // household, and "where does my calendar actually live" is the first
    // question anyone asks when they want to back it up or move it.
    console.log(`[baja-blast] Data folder:  ${DIR}`);
    console.log(`[baja-blast] Local server running.`);
    console.log(`[baja-blast] On your phone (same WiFi): ${localLanUrl()}`);
    console.log('');
    scheduleUpdates();
    scheduleDisplay();
  });

  return server;
}

module.exports = { startServer, PORT };

// Allow running standalone during development: `node app/server.cjs`
if (require.main === module) {
  startServer();
}
