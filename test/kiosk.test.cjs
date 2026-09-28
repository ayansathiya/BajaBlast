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
  for (const tool of ['sh', 'bash', 'sed', 'rm', 'mkdir', 'seq', 'sleep', 'cat', 'tr', 'tail', 'grep', 'mktemp', 'chmod', 'node', 'echo']) {
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

(async () => {
  try {
    await kioskTests();
    upgradeTests();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
