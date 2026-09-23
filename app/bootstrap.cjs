/**
 * Which build to run, and what to do when one won't start.
 *
 * Shared by both entry points — launch.cjs on the Pi and main.cjs on the Mac.
 * The rollback rules are the part you least want two copies of: a build that
 * fails on one platform and not the other, because the guards drifted apart,
 * is a bug nobody would find.
 *
 * A payload gets two chances to come up. Fail twice and it's blocked, the
 * previous one comes back, and nobody has to do anything — which matters
 * because the person standing in front of a blank kitchen display has no
 * keyboard and no idea what a log file is.
 */
const path = require('node:path');
const fs = require('node:fs');
const paths = require('./paths.cjs');

const MAX_BOOT_ATTEMPTS = 2;

// How long a payload has to survive before it counts as working. Long enough
// that something which starts, serves one request and then dies is caught;
// short enough that a restart loop resolves itself in a couple of minutes.
const HEALTHY_AFTER_MS = 45_000;

function blockAndDemote(rev, why) {
  const active = paths.readJSON(paths.ACTIVE_FILE()) || {};
  const blocked = Array.isArray(active.blocked) ? active.blocked.slice(-9) : [];
  if (!blocked.includes(rev)) blocked.push(rev);

  const prevDir = active.previous;
  const usable = prevDir && paths.isUsablePayload(path.join(paths.updatesDir(), prevDir));

  paths.writeJSONAtomic(paths.ACTIVE_FILE(), {
    dir: usable ? prevDir : null,
    build: usable ? paths.readBuild(path.join(paths.updatesDir(), prevDir)).build : null,
    rev: usable ? paths.readBuild(path.join(paths.updatesDir(), prevDir)).rev : 0,
    previous: null,
    blocked,
    rolledBackFrom: rev,
    rolledBackAt: new Date().toISOString(),
    reason: why,
  });

  try {
    fs.rmSync(paths.BOOT_FILE(), { force: true });
  } catch {
    /* nothing to clear */
  }

  console.error(`[baja-blast] Build rev ${rev} ${why} — rolled back to ${usable ? prevDir : 'the packaged copy'}.`);
}

function choose() {
  let chosen = paths.payloadRoot();

  if (chosen.source === 'installed') {
    const boot = paths.readJSON(paths.BOOT_FILE()) || {};
    const attempts = boot.rev === chosen.rev ? Number(boot.count) || 0 : 0;

    if (attempts >= MAX_BOOT_ATTEMPTS) {
      blockAndDemote(chosen.rev, 'failed to start twice');
      chosen = paths.payloadRoot();
    } else {
      paths.writeJSONAtomic(paths.BOOT_FILE(), {
        rev: chosen.rev,
        build: chosen.build,
        count: attempts + 1,
        at: new Date().toISOString(),
      });
    }
  }

  return chosen;
}


/**
 * Pick a payload, and fall back in this same launch if it can't be loaded at
 * all — rather than making someone wait for a restart that might not come.
 */
function chooseSafely() {
  const chosen = choose();
  try {
    require(path.join(chosen.root, 'app', 'server.cjs'));
    return chosen;
  } catch (err) {
    console.error('[baja-blast] Payload failed to load, falling back to the packaged copy.', err);
    if (chosen.source === 'installed') blockAndDemote(chosen.rev, 'could not be loaded');
    const bundled = paths.bundledRoot();
    return { root: bundled, source: 'bundled', ...paths.readBuild(bundled) };
  }
}

module.exports = { choose, chooseSafely, blockAndDemote, MAX_BOOT_ATTEMPTS, HEALTHY_AFTER_MS };
