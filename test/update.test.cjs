/**
 * End-to-end test of the over-the-air update path.
 *
 * Stands up a fake GitHub release server on localhost, builds real payload
 * tarballs, and drives the updater through the cases that actually happen:
 * a good update, a corrupted download, an archive that isn't a payload, and a
 * payload that won't boot.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SRC = path.resolve(__dirname, '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-update-'));
const DATA = path.join(ROOT, 'baja-blast-data');
const UPDATES = path.join(DATA, 'app');
fs.mkdirSync(UPDATES, { recursive: true });

process.env.BAJA_BLAST_DATA = DATA;

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

/* ---------------------------------------------------------------- *
 * Build a real payload tarball at a given rev
 * ---------------------------------------------------------------- */
function buildPayload(rev, { breakIt = false, incomplete = false } = {}) {
  const work = fs.mkdtempSync(path.join(ROOT, `payload-${rev}-`));
  fs.cpSync(path.join(SRC, 'app'), path.join(work, 'app'), { recursive: true });
  fs.mkdirSync(path.join(work, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(work, 'dist', 'index.html'), `<!doctype html><title>rev ${rev}</title>`);
  fs.writeFileSync(
    path.join(work, 'build.json'),
    JSON.stringify({ build: `test-${rev}`, rev, updates: { owner: 'fam', repo: 'baja-blast' } }, null, 2),
  );

  if (breakIt) {
    // Loads fine as a file, throws the moment it's required.
    fs.writeFileSync(path.join(work, 'app', 'server.cjs'), 'throw new Error("boom on require");\n');
  }
  if (incomplete) fs.rmSync(path.join(work, 'dist', 'index.html'));

  const tarball = path.join(ROOT, `payload-${rev}${breakIt ? '-broken' : ''}${incomplete ? '-incomplete' : ''}.tar.gz`);
  execFileSync('tar', ['-czf', tarball, '-C', work, 'build.json', 'dist', 'app']);
  return { tarball, dir: work };
}

/* ---------------------------------------------------------------- *
 * Fake GitHub
 * ---------------------------------------------------------------- */
const served = { rev: 0, tarball: null, sha: null, corrupt: false };
// What the fake GitHub has been asked for, so the tests can prove the
// conditional requests actually happen rather than assuming they do.
const seen = { releaseHits: 0, conditional: 0, notModified: 0 };

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function publish(rev, tarball, { corrupt = false } = {}) {
  served.rev = rev;
  served.tarball = tarball;
  served.sha = sha256(tarball);
  served.corrupt = corrupt;
}

let base;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');

  if (u.pathname === '/repos/fam/baja-blast/releases/latest') {
    seen.releaseHits += 1;

    // The ETag changes with the release, exactly as GitHub's does.
    const etag = `W/"release-${served.rev}"`;
    if (req.headers['if-none-match']) seen.conditional += 1;
    if (req.headers['if-none-match'] === etag) {
      seen.notModified += 1;
      res.writeHead(304, { etag });
      return res.end();
    }

    res.writeHead(200, { 'content-type': 'application/json', etag });
    return res.end(
      JSON.stringify({
        tag_name: `v${served.rev}`,
        name: `test-${served.rev}`,
        body: 'test release',
        published_at: new Date().toISOString(),
        assets: [
          { name: 'baja-blast-payload.tar.gz', size: fs.statSync(served.tarball).size, browser_download_url: `${base}/dl/payload` },
          { name: 'baja-blast-payload.sha256', size: 64, browser_download_url: `${base}/dl/sha` },
        ],
      }),
    );
  }

  if (u.pathname === '/dl/sha') {
    res.writeHead(200);
    return res.end(`${served.sha}  baja-blast-payload.tar.gz\n`);
  }

  // Redirect, the way GitHub hands assets to a different host.
  if (u.pathname === '/dl/payload') {
    res.writeHead(302, { location: `${base}/objects/payload` });
    return res.end();
  }

  if (u.pathname === '/objects/payload') {
    const buf = fs.readFileSync(served.tarball);
    if (served.corrupt) buf[Math.floor(buf.length / 2)] ^= 0xff;
    res.writeHead(200, { 'content-type': 'application/gzip' });
    return res.end(buf);
  }

  res.writeHead(404);
  res.end('no');
});

/* ---------------------------------------------------------------- *
 * Run
 * ---------------------------------------------------------------- */
async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.BAJA_BLAST_UPDATE_API = base;

  // The "bundled" copy: rev 1, pointed at our fake repo.
  const bundled = path.join(ROOT, 'bundle');
  fs.cpSync(path.join(SRC, 'app'), path.join(bundled, 'app'), { recursive: true });
  fs.mkdirSync(path.join(bundled, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(bundled, 'dist', 'index.html'), '<!doctype html><title>bundled</title>');
  fs.writeFileSync(
    path.join(bundled, 'build.json'),
    JSON.stringify({ build: 'test-1', rev: 1, updates: { owner: 'fam', repo: 'baja-blast' } }, null, 2),
  );

  const paths = require(path.join(bundled, 'app', 'paths.cjs'));
  const updater = require(path.join(bundled, 'app', 'updater.cjs'));

  console.log('\nA good update');
  const good = buildPayload(7);
  publish(7, good.tarball);

  let r = await updater.check();
  check('check finds the new release', r.ok && r.available && r.latest.rev === 7, JSON.stringify(r).slice(0, 160));

  r = await updater.install();
  check('install reports success', r.ok && r.rev === 7, r.error);

  const active = paths.readJSON(paths.ACTIVE_FILE());
  check('active.json points at v7', active && active.dir === 'v7', JSON.stringify(active));
  check('payload landed on disk', paths.isUsablePayload(path.join(UPDATES, 'v7')));
  check('payloadRoot() now resolves to the update', paths.payloadRoot().rev === 7, JSON.stringify(paths.payloadRoot()));
  check('staging folder cleaned up', !fs.existsSync(path.join(UPDATES, '.staging')));

  console.log('\nA second update, and the previous one is kept for rollback');
  const good2 = buildPayload(8);
  publish(8, good2.tarball);
  await updater.check();
  r = await updater.install();
  check('rev 8 installs', r.ok && r.rev === 8, r.error);
  const active2 = paths.readJSON(paths.ACTIVE_FILE());
  check('previous recorded as v7', active2.previous === 'v7', JSON.stringify(active2));
  check('v7 still on disk for rollback', fs.existsSync(path.join(UPDATES, 'v7')));

  console.log('\nA third update prunes the oldest');
  const good3 = buildPayload(9);
  publish(9, good3.tarball);
  await updater.check();
  await updater.install();
  check('v9 active', paths.payloadRoot().rev === 9);
  check('v8 kept', fs.existsSync(path.join(UPDATES, 'v8')));
  check('v7 pruned', !fs.existsSync(path.join(UPDATES, 'v7')));

  console.log('\nA corrupted download');
  const good4 = buildPayload(10);
  publish(10, good4.tarball, { corrupt: true });
  await updater.check();
  r = await updater.install();
  check('install refuses it', !r.ok, 'it accepted a corrupt payload');
  check('error names the checksum', /checksum/i.test(r.error || ''), r.error);
  check('still running rev 9', paths.payloadRoot().rev === 9);
  check('nothing left in staging', !fs.existsSync(path.join(UPDATES, '.staging')));
  check('v10 not created', !fs.existsSync(path.join(UPDATES, 'v10')));

  console.log('\nAn archive that is not a complete payload');
  const bad = buildPayload(11, { incomplete: true });
  publish(11, bad.tarball);
  await updater.check();
  r = await updater.install();
  check('install refuses it', !r.ok, 'it accepted an incomplete payload');
  check('still running rev 9', paths.payloadRoot().rev === 9);

  console.log('\nA release whose payload lies about its revision');
  const liar = buildPayload(12);
  // Publish it under tag v13 while build.json says 12.
  publish(13, liar.tarball);
  await updater.check();
  r = await updater.install();
  check('mismatch is caught', !r.ok && /rev/.test(r.error || ''), r.error);
  check('still running rev 9', paths.payloadRoot().rev === 9);

  console.log('\nA payload that installs fine but crashes on boot');
  const broken = buildPayload(14, { breakIt: true });
  publish(14, broken.tarball);
  await updater.check();
  r = await updater.install();
  check('it installs (nothing detectable yet)', r.ok, r.error);
  check('active is v14', paths.payloadRoot().rev === 14);

  // Now simulate the bootstrap: two failed starts.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const boot = paths.readJSON(paths.BOOT_FILE()) || {};
    const count = boot.rev === 14 ? Number(boot.count) || 0 : 0;
    paths.writeJSONAtomic(paths.BOOT_FILE(), { rev: 14, count: count + 1, at: new Date().toISOString() });
  }

  // Third launch: the bootstrap's own logic, run for real.
  const bootstrapResult = runBootstrapDecision(paths);
  check('bootstrap rolls back after two failures', bootstrapResult.rev === 9, JSON.stringify(bootstrapResult));
  const afterRollback = paths.readJSON(paths.ACTIVE_FILE());
  check('rev 14 is blocked', (afterRollback.blocked || []).includes(14), JSON.stringify(afterRollback.blocked));

  console.log('\nThe blocked revision is not re-installed');
  await updater.check();
  r = await updater.install();
  check('install refuses a blocked rev', !r.ok && /blocked/.test(r.error || ''), r.error);
  const st = updater.status();
  check('status reports no update available', st.updateAvailable === false, JSON.stringify(st.updateAvailable));

  console.log('\nA newer good release recovers the stick');
  const recover = buildPayload(15);
  publish(15, recover.tarball);
  await updater.check();
  r = await updater.install();
  check('rev 15 installs over the block', r.ok && r.rev === 15, r.error);
  check('running rev 15', paths.payloadRoot().rev === 15);

  console.log('\nNo network at all');
  process.env.BAJA_BLAST_UPDATE_API = 'http://127.0.0.1:1';
  r = await updater.check();
  check('check fails gracefully', !r.ok && !!r.error, JSON.stringify(r));
  check('still running rev 15', paths.payloadRoot().rev === 15);

  /*
    Asking often, for free.

    The screen checks every forty-five seconds now rather than every half
    hour, which is only affordable because an unchanged release answers 304
    and 304s don't count against GitHub's hourly limit. If the conditional
    requests ever stop happening, the polling becomes sixty-odd real API
    calls an hour and the household starts getting rate-limited — silently,
    and only after everything has worked fine for an hour. So it's worth
    proving rather than assuming.
  */
  console.log('\nChecking often, without spending requests');
  process.env.BAJA_BLAST_UPDATE_API = base;
  seen.releaseHits = 0;
  seen.conditional = 0;
  seen.notModified = 0;

  const first = await updater.check();
  check('the first check reads the release', first.ok && !first.unchanged, JSON.stringify(first));
  check('…and it was not conditional', seen.conditional === 0, `${seen.conditional}`);

  const second = await updater.check();
  check('the second check sends the tag', seen.conditional === 1, `${seen.conditional}`);
  check('…and GitHub answers 304', seen.notModified === 1, `${seen.notModified}`);
  check('…which the updater reports as unchanged', second.unchanged === true, JSON.stringify(second));
  check('…while still knowing the release', second.latest && second.latest.rev === 15, JSON.stringify(second.latest));

  for (let i = 0; i < 10; i += 1) await updater.check();
  check('ten more checks, ten more 304s', seen.notModified === 11, `${seen.notModified}`);

  // A real release still gets through — a cache that never invalidates is
  // worse than no cache, because the screen would stay on an old build
  // forever and nothing would look wrong.
  publish(16, recover.tarball);
  const after = await updater.check();
  check('a new release breaks the cache', after.ok && !after.unchanged, JSON.stringify(after));
  check('…and is seen as available', after.available === true, JSON.stringify(after));
  check('…at the new revision', after.latest && after.latest.rev === 16, JSON.stringify(after.latest));

  // A failed check must forget the tag, or the retry gets told "nothing
  // changed" about a release it never managed to read.
  process.env.BAJA_BLAST_UPDATE_API = 'http://127.0.0.1:1';
  await updater.check();
  process.env.BAJA_BLAST_UPDATE_API = base;
  seen.conditional = 0;
  await updater.check();
  check('a failure clears the tag, so the retry asks fully', seen.conditional === 0, `${seen.conditional}`);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

/**
 * Replays the decision main.cjs makes at startup, without Electron.
 * Kept in sync by construction: it calls the same paths.cjs helpers.
 */
function runBootstrapDecision(paths) {
  let chosen = paths.payloadRoot();
  if (chosen.source !== 'installed') return chosen;

  const boot = paths.readJSON(paths.BOOT_FILE()) || {};
  const attempts = boot.rev === chosen.rev ? Number(boot.count) || 0 : 0;

  if (attempts >= 2) {
    const active = paths.readJSON(paths.ACTIVE_FILE()) || {};
    const blocked = Array.isArray(active.blocked) ? active.blocked.slice(-9) : [];
    if (!blocked.includes(chosen.rev)) blocked.push(chosen.rev);
    const prev = active.previous && paths.isUsablePayload(path.join(paths.updatesDir(), active.previous)) ? active.previous : null;
    paths.writeJSONAtomic(paths.ACTIVE_FILE(), {
      dir: prev,
      build: prev ? paths.readBuild(path.join(paths.updatesDir(), prev)).build : null,
      rev: prev ? paths.readBuild(path.join(paths.updatesDir(), prev)).rev : 0,
      previous: null,
      blocked,
      rolledBackFrom: chosen.rev,
    });
    fs.rmSync(paths.BOOT_FILE(), { force: true });
    chosen = paths.payloadRoot();
  }
  return chosen;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
