/**
 * Over-the-air updates.
 *
 * The package under /opt is owned by apt: reinstalling it needs root, and
 * anything that rewrote files there would be fighting the package manager
 * every upgrade. So this updater never touches it. It replaces the *payload* —
 * the compiled front end and the Node code, a few hundred KB — which lives
 * beside the household data and is just files in a directory the service can
 * already write.
 *
 * What that buys: pushing to GitHub updates the kitchen display with no root,
 * no apt, and nobody at a terminal. What it doesn't buy: a new Node version or
 * a change to the service file. Those are in the package, so they need a new
 * .deb — which is a once-a-year job against this being a once-a-week one.
 *
 * Safety, in order of how much it matters:
 *
 *   1. Nothing is trusted until its SHA-256 matches the checksum published
 *      alongside it. A truncated download on a flaky connection is the common
 *      case, not the exotic one.
 *   2. Nothing is installed in place. The tarball is extracted to a staging
 *      folder, checked for completeness, and only then renamed into position
 *      — an atomic operation on the same filesystem, so there is no moment
 *      where the app directory is half-written.
 *   3. The previous payload is kept. If the new one fails to start twice, the
 *      launcher blocks that revision and puts the old one back without anyone
 *      being told about it.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const paths = require('./paths.cjs');

const USER_AGENT = 'baja-blast-kiosk';
const ASSET_NAME = 'baja-blast-payload.tar.gz';
const CHECKSUM_NAME = 'baja-blast-payload.sha256';

// Big enough for a payload that has grown a lot, small enough that a wrong
// URL serving something enormous can't fill a USB stick.
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;

const state = {
  status: 'idle', // idle | checking | downloading | installing | ready | error
  latest: null, // { build, rev, url, sha, notes }
  lastChecked: null,
  lastError: null,
  lastInstalled: null,
  busy: false,
};

/* ------------------------------------------------------------------ *
 * HTTP, with no dependencies and no surprises
 * ------------------------------------------------------------------ */

// Normally api.github.com. Overridable so the update path can be exercised
// against a local server in tests without pointing a real household at a
// staging repo. Not a security boundary — anyone who can set this variable is
// already running code on the machine.
const apiBase = () => process.env.BAJA_BLAST_UPDATE_API || 'https://api.github.com';

function request(url, { redirects = 5, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('http://') ? http : https;
    const req = transport.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, ...headers }, timeout: 20_000 },
      (res) => {
        const { statusCode, headers: resHeaders } = res;

        // GitHub hands release assets off to a different host, so following
        // redirects isn't optional here — it's the normal path.
        if (statusCode >= 300 && statusCode < 400 && resHeaders.location) {
          res.resume();
          if (redirects <= 0) return reject(new Error('too many redirects'));
          return resolve(request(new URL(resHeaders.location, url).toString(), { redirects: redirects - 1, headers }));
        }

        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} for ${url}`));
        }

        resolve(res);
      },
    );

    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

async function getText(url, opts) {
  const res = await request(url, opts);
  const chunks = [];
  let total = 0;
  for await (const chunk of res) {
    total += chunk.length;
    if (total > 4 * 1024 * 1024) throw new Error('response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getJSON(url) {
  return JSON.parse(await getText(url, { headers: { Accept: 'application/vnd.github+json' } }));
}

/**
 * Stream to disk while hashing, so the file is never read twice and a
 * too-large response is cut off rather than written out in full.
 */
async function download(url, dest) {
  const res = await request(url);
  const hash = crypto.createHash('sha256');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest);

  let total = 0;
  try {
    for await (const chunk of res) {
      total += chunk.length;
      if (total > MAX_PAYLOAD_BYTES) throw new Error('payload larger than expected — refusing it');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }

  return { sha256: hash.digest('hex'), bytes: total };
}

/* ------------------------------------------------------------------ *
 * Where to look
 * ------------------------------------------------------------------ */

function repoConfig() {
  const bundled = paths.readBuild(paths.bundledRoot());
  const running = paths.readBuild(paths.payloadRoot().root);
  const cfg = running.updates || bundled.updates;
  if (!cfg || !cfg.owner || !cfg.repo) return null;
  return { owner: cfg.owner, repo: cfg.repo };
}

function currentRev() {
  return paths.payloadRoot().rev || 0;
}

function blockedRevs() {
  const active = paths.readJSON(paths.ACTIVE_FILE()) || {};
  return Array.isArray(active.blocked) ? active.blocked : [];
}

/* ------------------------------------------------------------------ *
 * Check
 * ------------------------------------------------------------------ */

/**
 * Ask GitHub what the newest release is.
 *
 * The release body carries the revision number and the checksum asset carries
 * the hash, so one API call plus one tiny text fetch is the whole check —
 * roughly 2KB, which is why running it every half hour on a home connection
 * is nothing to worry about.
 */
async function check() {
  const repo = repoConfig();
  if (!repo) {
    state.status = 'error';
    state.lastError = 'No GitHub repository configured — run setup/github-setup.sh.';
    return { ok: false, error: state.lastError };
  }

  state.status = 'checking';
  state.lastError = null;

  try {
    const release = await getJSON(`${apiBase()}/repos/${repo.owner}/${repo.repo}/releases/latest`);
    const assets = release.assets || [];
    const payload = assets.find((a) => a.name === ASSET_NAME);
    const checksum = assets.find((a) => a.name === CHECKSUM_NAME);

    if (!payload || !checksum) throw new Error('release has no payload attached yet');

    // The tag is the source of truth for the revision: "v41" → 41. The build
    // string inside build.json is for humans and isn't safely comparable.
    const rev = Number(String(release.tag_name || '').replace(/^v/, '')) || 0;
    if (!rev) throw new Error(`release tag "${release.tag_name}" isn't a revision number`);

    const shaText = await getText(checksum.browser_download_url);
    const sha = (shaText.trim().split(/\s+/)[0] || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('checksum file is not a sha256');

    state.latest = {
      rev,
      build: release.name || release.tag_name,
      url: payload.browser_download_url,
      sha,
      bytes: payload.size,
      notes: (release.body || '').slice(0, 500),
      publishedAt: release.published_at,
    };
    state.lastChecked = new Date().toISOString();
    state.status = rev > currentRev() && !blockedRevs().includes(rev) ? 'ready' : 'idle';

    return { ok: true, available: state.status === 'ready', latest: state.latest, current: currentRev() };
  } catch (err) {
    state.status = 'error';
    state.lastError = err.message;
    state.lastChecked = new Date().toISOString();
    return { ok: false, error: err.message };
  }
}

/* ------------------------------------------------------------------ *
 * Install
 * ------------------------------------------------------------------ */

function extract(tarball, into) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(into, { recursive: true });
    // tar ships with macOS and every Linux worth the name, and unlike unzip it
    // keeps file modes. -z for gzip, and no -P, so an archive containing
    // "../.." can't escape the staging folder.
    execFile('tar', ['-xzf', tarball, '-C', into], { timeout: 120_000 }, (err, _out, stderr) => {
      if (err) return reject(new Error(`extract failed: ${stderr || err.message}`));
      resolve();
    });
  });
}

/**
 * Find the payload inside whatever shape the archive has.
 *
 * Tarring a folder and tarring a folder's contents both look reasonable to
 * whoever writes the workflow, and the difference is one wrapper directory.
 * Rather than depend on getting that right forever, look one level down too.
 */
function locatePayload(dir) {
  if (paths.isUsablePayload(dir)) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(dir, entry.name);
    if (paths.isUsablePayload(nested)) return nested;
  }
  return null;
}

async function install(target = state.latest) {
  if (!target) return { ok: false, error: 'nothing to install — check first' };
  if (state.busy) return { ok: false, error: 'an update is already in progress' };
  if (blockedRevs().includes(target.rev)) {
    return { ok: false, error: `rev ${target.rev} previously failed to start and is blocked` };
  }

  state.busy = true;
  state.status = 'downloading';
  state.lastError = null;

  const updates = paths.updatesDir();
  const staging = path.join(updates, '.staging');
  const tarball = path.join(staging, ASSET_NAME);

  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });

    const { sha256, bytes } = await download(target.url, tarball);

    // Before anything is unpacked. A mismatch here means a truncated
    // download or a tampered file, and either way the correct response is to
    // throw it away without letting tar look at it.
    if (sha256 !== target.sha) {
      throw new Error(`checksum mismatch — expected ${target.sha.slice(0, 12)}…, got ${sha256.slice(0, 12)}…`);
    }

    state.status = 'installing';
    const unpacked = path.join(staging, 'unpacked');
    await extract(tarball, unpacked);

    const found = locatePayload(unpacked);
    if (!found) throw new Error('archive did not contain a complete app payload');

    const got = paths.readBuild(found);
    if (got.rev !== target.rev) {
      throw new Error(`payload says rev ${got.rev}, release says ${target.rev}`);
    }

    const active = paths.readJSON(paths.ACTIVE_FILE()) || {};
    const destName = `v${target.rev}`;
    const dest = path.join(updates, destName);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(found, dest); // atomic: same filesystem, one syscall

    paths.writeJSONAtomic(paths.ACTIVE_FILE(), {
      dir: destName,
      build: got.build,
      rev: got.rev,
      previous: active.dir && active.dir !== destName ? active.dir : null,
      blocked: blockedRevs(),
      installedAt: new Date().toISOString(),
      bytes,
    });

    prune(updates, [destName, active.dir].filter(Boolean));

    state.lastInstalled = { rev: got.rev, build: got.build, at: new Date().toISOString() };
    state.status = 'installed';
    return { ok: true, rev: got.rev, build: got.build };
  } catch (err) {
    state.status = 'error';
    state.lastError = err.message;
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    state.busy = false;
  }
}

/** Keep the running payload and the one before it. Sticks are small. */
function prune(updates, keep) {
  for (const entry of fs.readdirSync(updates, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^v\d+$/.test(entry.name)) continue;
    if (keep.includes(entry.name)) continue;
    fs.rmSync(path.join(updates, entry.name), { recursive: true, force: true });
  }
}

function status() {
  const running = paths.payloadRoot();
  return {
    current: { build: running.build, rev: running.rev, source: running.source },
    latest: state.latest,
    status: state.status,
    lastChecked: state.lastChecked,
    lastError: state.lastError,
    lastInstalled: state.lastInstalled,
    blocked: blockedRevs(),
    repo: repoConfig(),
    updateAvailable: !!(state.latest && state.latest.rev > running.rev && !blockedRevs().includes(state.latest.rev)),
  };
}

module.exports = { check, install, status, state, prune, locatePayload, _internals: { download, request, getJSON, getText } };
