/**
 * Tests the launcher itself — the bootstrap.
 *
 * Worth its own harness because it's the one file that can never be fixed by
 * an update: it ships inside the frozen .app bundle. If it picks the wrong
 * payload, or fails to roll back, the fix is a physical trip to the stick.
 *
 * Electron is stubbed, and app.whenReady() never resolves, so kiosk.cjs is
 * loaded and its start() runs but no window is ever created.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const SRC = path.resolve(__dirname, '..');
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

/** A package install: /opt/baja-blast alongside /var/lib/baja-blast. */
function makeStick() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-boot-'));
  const opt = path.join(root, 'opt', 'baja-blast');
  fs.cpSync(path.join(SRC, 'app'), path.join(opt, 'app'), { recursive: true });
  fs.mkdirSync(path.join(opt, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(opt, 'dist', 'index.html'), '<!doctype html><title>packaged</title>');
  fs.writeFileSync(
    path.join(opt, 'build.json'),
    JSON.stringify({ build: 'packaged-0', rev: 0, updates: { owner: 'fam', repo: 'bb' } }, null, 2),
  );
  fs.mkdirSync(path.join(root, 'var', 'lib', 'baja-blast', 'app'), { recursive: true });
  return {
    root,
    main: path.join(opt, 'app', 'launch.cjs'),
    opt,
    data: path.join(root, 'var', 'lib', 'baja-blast'),
    updates: path.join(root, 'var', 'lib', 'baja-blast', 'app'),
  };
}

/** An installed payload at a given rev. */
function installPayload(stick, rev, { broken = false } = {}) {
  const dir = path.join(stick.updates, `v${rev}`);
  fs.cpSync(path.join(SRC, 'app'), path.join(dir, 'app'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), `<!doctype html><title>rev ${rev}</title>`);
  fs.writeFileSync(
    path.join(dir, 'build.json'),
    JSON.stringify({ build: `installed-${rev}`, rev, updates: { owner: 'fam', repo: 'bb' } }, null, 2),
  );
  if (broken) fs.writeFileSync(path.join(dir, 'app', 'server.cjs'), 'throw new Error("boom on require");\n');
  return dir;
}

function setActive(stick, active) {
  fs.writeFileSync(path.join(stick.updates, 'active.json'), JSON.stringify(active, null, 2));
}

/**
 * Run the real launcher in boot-check mode and report what it chose.
 *
 * No stubbing: this is the same code path systemd takes, right up to the
 * point where it would start serving.
 */
function runBootstrap(stick) {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('node', [stick.main], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, BAJA_BLAST_DATA: stick.data, BAJA_BLAST_BOOT_CHECK: '1' },
  });
  // Both streams: ordinary choices go to stdout, rollbacks to stderr, and the
  // tests care about both.
  return `${r.stdout || ''}${r.stderr || ''}`;
}

function activeJson(stick) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stick.updates, 'active.json'), 'utf8'));
  } catch {
    return null;
  }
}

function bootFile(stick) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stick.updates, 'boot-attempt.json'), 'utf8'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */

console.log('\nA fresh install with no updates yet');
{
  const stick = makeStick();
  const out = runBootstrap(stick);
  check('runs the copy from /opt', /Build packaged-0 \(bundled\)/.test(out), out.trim().split('\n').pop());
  check('writes no boot-attempt file', bootFile(stick) === null);
}

console.log('\nAn update is installed');
{
  const stick = makeStick();
  installPayload(stick, 12);
  setActive(stick, { dir: 'v12', build: 'installed-12', rev: 12, previous: null, blocked: [] });

  const out = runBootstrap(stick);
  check('runs the installed payload', /Build installed-12 \(installed\)/.test(out), out.trim().split('\n').pop());
  check('records the boot attempt', bootFile(stick)?.rev === 12 && bootFile(stick)?.count === 1, JSON.stringify(bootFile(stick)));
}

console.log('\nThe same update fails to come up, twice');
{
  const stick = makeStick();
  installPayload(stick, 12);
  installPayload(stick, 13);
  setActive(stick, { dir: 'v13', build: 'installed-13', rev: 13, previous: 'v12', blocked: [] });

  runBootstrap(stick); // attempt 1 — window never reached, so nothing clears it
  check('attempt 1 counted', bootFile(stick)?.count === 1, JSON.stringify(bootFile(stick)));

  runBootstrap(stick); // attempt 2
  check('attempt 2 counted', bootFile(stick)?.count === 2, JSON.stringify(bootFile(stick)));

  const out = runBootstrap(stick); // third launch: give up on it
  check('third launch rolls back to v12', /Build installed-12 \(installed\)/.test(out), out.trim().split('\n').pop());
  check('says why', /failed to start twice/.test(out));
  check('rev 13 is blocked', (activeJson(stick).blocked || []).includes(13), JSON.stringify(activeJson(stick)));
  check('boot-attempt cleared', bootFile(stick) === null);
}

console.log('\nAn update that throws the moment it is loaded');
{
  const stick = makeStick();
  installPayload(stick, 20, { broken: true });
  setActive(stick, { dir: 'v20', build: 'installed-20', rev: 20, previous: null, blocked: [] });

  const out = runBootstrap(stick);
  check('falls back in the same launch', /Build packaged-0 \(bundled\)/.test(out), out.trim().split('\n').pop());
  check('does not wait for a restart', /falling back to the packaged copy/.test(out));
  check('rev 20 is blocked', (activeJson(stick).blocked || []).includes(20), JSON.stringify(activeJson(stick)));
}

console.log('\nA half-extracted payload that active.json still points at');
{
  const stick = makeStick();
  const dir = installPayload(stick, 30);
  fs.rmSync(path.join(dir, 'dist', 'index.html')); // interrupted mid-write
  setActive(stick, { dir: 'v30', build: 'installed-30', rev: 30, previous: null, blocked: [] });

  const out = runBootstrap(stick);
  check('ignores it and runs the bundled copy', /Build packaged-0 \(bundled\)/.test(out), out.trim().split('\n').pop());
}

console.log('\nA newer package installed over an older update');
{
  const stick = makeStick();
  // Bundle claims rev 40 — someone rebuilt the stick from a newer checkout.
  const resources = stick.opt;
  fs.writeFileSync(
    path.join(resources, 'build.json'),
    JSON.stringify({ build: 'packaged-40', rev: 40, updates: { owner: 'fam', repo: 'bb' } }, null, 2),
  );
  installPayload(stick, 12);
  setActive(stick, { dir: 'v12', build: 'installed-12', rev: 12, previous: null, blocked: [] });

  const out = runBootstrap(stick);
  check('the newer package wins', /Build packaged-40 \(bundled\)/.test(out), out.trim().split('\n').pop());
}

console.log('\nThe household data lives outside the package');
{
  const stick = makeStick();
  installPayload(stick, 12);
  setActive(stick, { dir: 'v12', build: 'installed-12', rev: 12, previous: null, blocked: [] });
  runBootstrap(stick);
  check('used the data directory', /baja-blast-data/.test(JSON.stringify(fs.readdirSync(stick.data))) || fs.existsSync(path.join(stick.data, 'app')));
  check('nothing written inside /opt', !fs.existsSync(path.join(stick.root, 'userdata')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
