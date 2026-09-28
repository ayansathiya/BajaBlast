/**
 * The Pi's full-screen launcher and the package's own upgrader.
 *
 * Both are shell scripts that end in a program we can't run here (Chromium,
 * apt), so each runs against fake versions of those programs on PATH that
 * log what they were asked to do. What's checked is the actual command line
 * the Pi would run.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const KIOSK = path.join(ROOT, 'packaging', 'pi', 'kiosk');
const UPGRADE = path.join(ROOT, 'packaging', 'pi', 'upgrade');
const NIGHT = path.join(ROOT, 'packaging', 'pi', 'night');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kiosk-'));

function fakeBin(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

// Only the fakes and the basics a script needs, so a real chromium or apt on
// the machine running the tests can never be the one that answers.
function basePath(bin) {
  const sys = fs.mkdtempSync(path.join(tmp, 'sys-'));
  for (const tool of ['sh', 'bash', 'sed', 'rm', 'mkdir', 'seq', 'sleep', 'cat', 'tr', 'tail', 'grep', 'mktemp', 'chmod', 'node', 'echo', 'cut', 'date', 'gzip']) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (found.startsWith('/')) fs.symlinkSync(found, path.join(sys, tool));
  }
  return `${bin}:${sys}`;
}

function listen() {
  return new Promise((resolve) => {
    const srv = net.createServer((s) => s.end());
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function kioskTests() {
  const srv = await listen();
  const url = `http://127.0.0.1:${srv.address().port}/`;

  function run({ conf = '', browser = 'chromium', prefs = null } = {}) {
    const dir = fs.mkdtempSync(path.join(tmp, 'k-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'args');
    fs.mkdirSync(bin);
    if (browser) fakeBin(bin, browser, `printf '%s\\n' "$@" > "${log}"`);
    const confFile = path.join(dir, 'default');
    fs.writeFileSync(confFile, `KIOSK_URL=${url}\n${conf}\n`);
    const home = path.join(dir, 'home');
    if (prefs) {
      const p = path.join(home, '.config', 'baja-blast-kiosk', 'Default');
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, 'Preferences'), prefs);
    }
    const r = spawnSync('/bin/bash', [KIOSK], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { PATH: basePath(bin), HOME: home, BAJA_BLAST_DEFAULTS: confFile, BAJA_BLAST_KIOSK_ONCE: '1', BAJA_BLAST_KIOSK_WAIT: '3' },
    });
    const args = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : null;
    const prefsAfter = prefs ? fs.readFileSync(path.join(home, '.config', 'baja-blast-kiosk', 'Default', 'Preferences'), 'utf8') : null;
    return { ...r, args, prefsAfter };
  }

  console.log('\nThe full-screen launcher');
  {
    const r = run();
    check('it starts Chromium', r.args !== null, r.stderr);
    const a = r.args || [];
    check('in kiosk mode, on the calendar', a[a.indexOf('--kiosk') + 1] === url);
    check('at the default scale of 1.25', a.includes('--force-device-scale-factor=1.25'));
    check('with pinch-zoom off', a.includes('--disable-pinch'));
    check('with swipe-back off', a.includes('--overscroll-history-navigation=0'));
    check('with no restore-pages bubble', a.includes('--disable-session-crashed-bubble'));
    check('in its own profile, not the desktop user\'s browser', a.some((x) => x.startsWith('--user-data-dir=') && x.endsWith('.config/baja-blast-kiosk')));
  }
  {
    const r = run({ conf: 'KIOSK_SCALE=1.5' });
    check('KIOSK_SCALE changes the scale', (r.args || []).includes('--force-device-scale-factor=1.5'));
  }
  {
    const r = run({ conf: 'KIOSK_SCALE=big' });
    check('a KIOSK_SCALE that isn\'t a number falls back to 1.25', (r.args || []).includes('--force-device-scale-factor=1.25'));
    check('and says so', /isn't a number/.test(r.stderr));
  }
  {
    const r = run({ conf: 'KIOSK=0' });
    check('KIOSK=0 leaves the desktop alone', r.args === null && r.status === 0);
  }
  {
    const r = run({ browser: 'chromium-browser' });
    check('the older chromium-browser name works too', r.args !== null);
  }
  {
    const r = run({ browser: null });
    check('no Chromium: it stops rather than looping', r.status === 1 && r.args === null);
    check('and says how to fix it', /sudo apt install chromium/.test(r.stderr));
  }
  {
    const r = run({ prefs: '{"profile":{"exited_cleanly":false,"exit_type":"Crashed"}}' });
    check('a power cut at the wall doesn\'t leave a restore bar', r.prefsAfter === '{"profile":{"exited_cleanly":true,"exit_type":"Normal"}}', r.prefsAfter);
  }

  srv.close();
}

function upgradeTests() {
  // installed: the rev this package was built as. latest: the release tag
  // GitHub's /releases/latest redirects to.
  function run({ installed = 5, latest = 8, standalone = false, conf = '', root = true, newer = true } = {}) {
    const dir = fs.mkdtempSync(path.join(tmp, 'u-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'log');
    fs.writeFileSync(log, '');
    const opt = path.join(dir, 'opt');
    fs.mkdirSync(opt);
    fs.writeFileSync(path.join(opt, 'build.json'), JSON.stringify({ rev: installed, updates: { owner: 'ayansathiya', repo: 'BajaBlast' } }));
    const confFile = path.join(dir, 'default');
    fs.writeFileSync(confFile, conf);

    fakeBin(bin, 'id', `echo ${root ? 0 : 1000}`);
    fakeBin(bin, 'curl', `
      echo "curl $*" >> "${log}"
      case "$*" in
        *-fsSI*) printf 'HTTP/2 302\\r\\nlocation: https://github.com/ayansathiya/BajaBlast/releases/tag/v${latest}\\r\\n\\r\\n' ;;
        *) while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { echo deb > "$2"; }; shift; done ;;
      esac`);
    fakeBin(bin, 'dpkg-deb', 'echo 2026-09-28-8+8');
    fakeBin(bin, 'dpkg-query', `
      case "$*" in
        *Status*baja-blast-standalone*) ${standalone ? "echo 'install ok installed'" : 'exit 1'} ;;
        *) echo 2026-09-20-5+5 ;;
      esac`);
    fakeBin(bin, 'dpkg', newer ? 'exit 0' : 'exit 1');
    fakeBin(bin, 'apt-get', `echo "apt-get $*" >> "${log}"`);

    const r = spawnSync('/bin/sh', [UPGRADE], {
      encoding: 'utf8',
      env: { PATH: basePath(bin), BAJA_BLAST_DEFAULTS: confFile, BAJA_BLAST_OPT: opt, TMPDIR: dir },
    });
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    return { ...r, apt: lines.filter((l) => l.startsWith('apt-get')), curl: lines.filter((l) => l.startsWith('curl')) };
  }

  console.log('\nThe package upgrader');
  {
    const r = run();
    check('a newer release is installed', r.apt.length === 1 && /baja-blast\.deb/.test(r.apt[0]), r.stderr);
    check('from that release, not whatever "latest" is a second later', r.curl.some((c) => c.includes('/releases/download/v8/baja-blast_latest_all.deb')));
    check('keeping the household\'s edited settings without asking', r.apt[0] && r.apt[0].includes('--force-confold') && r.apt[0].includes('-y'));
    check('on its own box only the one package', r.apt[0] && !r.apt[0].includes('standalone'));
  }
  {
    const r = run({ installed: 8, latest: 8 });
    check('nothing new: nothing is downloaded', r.status === 0 && r.apt.length === 0 && r.curl.length === 1);
  }
  {
    const r = run({ installed: 9, latest: 8 });
    check('never goes backwards', r.apt.length === 0 && r.curl.length === 1);
  }
  {
    const r = run({ standalone: true });
    check('a TV box gets both packages together, so apt keeps its kiosk', r.apt.length === 1 && /baja-blast\.deb .*baja-blast-standalone\.deb/.test(r.apt[0]));
  }
  {
    const r = run({ newer: false });
    check('a download that isn\'t actually newer isn\'t installed', r.apt.length === 0);
  }
  {
    const r = run({ conf: 'AUTO_UPGRADE=0' });
    check('AUTO_UPGRADE=0 switches it off', r.status === 0 && r.curl.length === 0 && r.apt.length === 0);
  }
  {
    const r = run({ root: false });
    check('refuses to run without root', r.status !== 0 && r.apt.length === 0);
  }
}

function nightTests() {
  // All times are New York local; the Pi's own time zone is what the
  // schedule in Settings means.
  function run({ at = '2026-09-28T23:01:00', model = 'Raspberry Pi 5 Model B Rev 1.0', uptime = 50000, schedule = { enabled: true, on: '06:00', off: '23:00' }, conf = '', alarmWritable = true } = {}) {
    const dir = fs.mkdtempSync(path.join(tmp, 'n-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'log');
    fs.writeFileSync(log, '');
    fakeBin(bin, 'systemctl', `echo "systemctl $*" >> "${log}"`);
    const data = path.join(dir, 'data');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'store.json'), JSON.stringify({ settings: { display: { schedule } } }));
    fs.writeFileSync(path.join(dir, 'model'), `${model}\0`);
    fs.writeFileSync(path.join(dir, 'uptime'), `${uptime}.12 1234.5\n`);
    const alarm = path.join(dir, 'wakealarm');
    fs.writeFileSync(alarm, '');
    // Missing rather than read-only: root can write a read-only file.
    if (!alarmWritable) fs.rmSync(alarm);
    fs.writeFileSync(path.join(dir, 'default'), conf);
    const r = spawnSync('/bin/sh', [NIGHT], {
      encoding: 'utf8',
      env: {
        PATH: basePath(bin),
        TZ: 'America/New_York',
        BAJA_BLAST_NOW: at,
        BAJA_BLAST_DEFAULTS: path.join(dir, 'default'),
        BAJA_BLAST_DATA: data,
        BAJA_BLAST_MODEL_FILE: path.join(dir, 'model'),
        BAJA_BLAST_WAKEALARM: alarm,
        BAJA_BLAST_UPTIME_FILE: path.join(dir, 'uptime'),
      },
    });
    const off = fs.readFileSync(log, 'utf8').includes('systemctl poweroff');
    const wake = fs.existsSync(alarm) ? fs.readFileSync(alarm, 'utf8').trim() : '';
    const wakeAt = wake ? new Date(Number(wake) * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }) : null;
    return { ...r, off, wakeAt };
  }

  console.log('\nPowering a Pi 5 off overnight');
  {
    const r = run();
    check('at 11pm a Pi 5 powers off', r.off, r.stderr);
    check('with its clock set to wake it at 6am tomorrow', r.wakeAt === '9/29/2026, 6:00:00 AM', r.wakeAt);
  }
  {
    const r = run({ at: '2026-09-28T22:59:00' });
    check('not a minute early', !r.off && !r.wakeAt);
  }
  {
    const r = run({ at: '2026-09-28T23:07:00' });
    check('and not long after, so switching it back on at 11:30 sticks', !r.off);
  }
  {
    const r = run({ uptime: 300 });
    check('not in the first 15 minutes after someone switched it on', !r.off);
  }
  {
    const r = run({ model: 'Raspberry Pi 4 Model B Rev 1.5' });
    check('never on a Pi 4, which has no clock to wake it', !r.off && !r.wakeAt);
  }
  {
    const r = run({ alarmWritable: false });
    check('never without a wake alarm it can set', !r.off);
  }
  {
    const r = run({ schedule: { enabled: true, on: '07:30', off: '21:30' }, at: '2026-09-28T21:31:00' });
    check('follows the times in Settings → Display', r.off && r.wakeAt === '9/29/2026, 7:30:00 AM', r.wakeAt);
  }
  {
    const r = run({ schedule: { enabled: true, on: '06:00', off: '00:30' }, at: '2026-09-29T00:31:00' });
    check('an off time after midnight wakes the same morning', r.off && r.wakeAt === '9/29/2026, 6:00:00 AM', r.wakeAt);
  }
  {
    const r = run({ schedule: { enabled: false, on: '06:00', off: '23:00' } });
    check('the schedule switched off in Settings: stays on', !r.off);
  }
  {
    const r = run({ conf: 'NIGHT_POWER_OFF=0' });
    check('NIGHT_POWER_OFF=0: stays on', !r.off);
  }
}

const RECEIVE = path.join(ROOT, 'setup', 'pi-receive.sh');
// The launcher only starts a build numbered above the one it shipped with,
// and in CI that's the real release number, stamped before the tests run.
const SHIPPED_REV = Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'build.json'), 'utf8')).rev) || 0;
const OLD_REV = SHIPPED_REV + 1;
const NEW_REV = SHIPPED_REV + 2;

function receiveTests() {
  // A payload as setup/deploy-pi.sh packs it, received into a data folder
  // that already has a GitHub build running — then asked of the launcher's
  // own code which build it would start.
  function run({ complete = true, existing = [] } = {}) {
    const dir = fs.mkdtempSync(path.join(tmp, 'r-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'log');
    fs.writeFileSync(log, '');
    fakeBin(bin, 'pkill', `echo "pkill $*" >> "${log}"`);
    fakeBin(bin, 'tar', `exec /usr/bin/tar "$@"`);
    fakeBin(bin, 'basename', `exec /usr/bin/basename "$@"`);
    fakeBin(bin, 'mv', `exec /bin/mv "$@"`);

    const data = path.join(dir, 'data');
    const updates = path.join(data, 'app');
    const running = path.join(updates, 'v9');
    fs.mkdirSync(path.join(running, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(running, 'app'), { recursive: true });
    fs.writeFileSync(path.join(running, 'build.json'), JSON.stringify({ build: '2026-09-28-9', rev: OLD_REV }));
    fs.writeFileSync(path.join(running, 'dist', 'index.html'), 'old');
    fs.writeFileSync(path.join(running, 'app', 'server.cjs'), '');
    fs.writeFileSync(path.join(updates, 'active.json'), JSON.stringify({ dir: 'v9', rev: OLD_REV, blocked: [] }));
    for (const name of existing) fs.mkdirSync(path.join(updates, name));

    const src = path.join(dir, 'src');
    fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(src, 'app'), { recursive: true });
    fs.writeFileSync(path.join(src, 'build.json'), JSON.stringify({ build: '2026-09-28-mac-abc123', rev: NEW_REV }));
    fs.writeFileSync(path.join(src, 'dist', 'index.html'), 'new');
    if (complete) fs.writeFileSync(path.join(src, 'app', 'server.cjs'), '');
    const tgz = path.join(dir, 'p.tgz');
    spawnSync('/usr/bin/tar', ['-czf', tgz, '-C', src, '.']);

    const r = spawnSync('/bin/sh', [RECEIVE, 'mac-2026-09-28-mac-abc123', tgz], {
      encoding: 'utf8',
      env: { PATH: basePath(bin), BAJA_BLAST_UPDATES: updates },
    });
    const boot = spawnSync('node', ['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(ROOT, 'app', 'paths.cjs'))}).payloadRoot()))`], {
      encoding: 'utf8',
      env: { ...process.env, BAJA_BLAST_DATA: data },
    });
    let chosen = {};
    try {
      chosen = JSON.parse(boot.stdout);
    } catch {
      /* reported by the checks */
    }
    const active = JSON.parse(fs.readFileSync(path.join(updates, 'active.json'), 'utf8'));
    return { ...r, chosen, active, restarted: fs.readFileSync(log, 'utf8').includes('pkill'), left: fs.readdirSync(updates).sort() };
  }

  console.log('\nSending a build straight from the Mac');
  {
    const r = run({ existing: ['mac-older', 'mac-oldest'] });
    check('it lands and becomes the active build', r.status === 0 && r.active.dir === 'mac-2026-09-28-mac-abc123', r.stderr);
    check('the launcher would start it', r.chosen.rev === NEW_REV && r.chosen.source === 'installed', JSON.stringify(r.chosen));
    check('the GitHub build it replaced is kept to roll back to', r.active.previous === 'v9' && r.left.includes('v9'));
    check('older Mac builds are tidied away', !r.left.includes('mac-older') && !r.left.includes('mac-oldest'));
    check('rollback bookkeeping is carried over', Array.isArray(r.active.blocked));
    check('and the calendar is restarted into it', r.restarted);
  }
  {
    const r = run({ complete: false });
    check('an incomplete build is refused', r.status !== 0 && /missing app\/server\.cjs/.test(r.stderr));
    check('and nothing changes', r.active.dir === 'v9' && !r.restarted && !r.left.includes('.deploy'));
  }
}

(async () => {
  try {
    await kioskTests();
    upgradeTests();
    nightTests();
    receiveTests();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
