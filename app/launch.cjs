/**
 * The entry point. This is what systemd starts.
 *
 * It is deliberately tiny, because it is the one file an update can't replace:
 * it ships in the package under /opt and the package manager owns it. So it
 * does one thing — work out which copy of the app to run, and run it.
 *
 * Everything with opinions in it lives in server.cjs, which comes from the
 * payload and can be swapped by pushing to GitHub.
 *
 * The guard below matters more than it looks. A kitchen display that won't
 * start is not like a laptop app that won't start: nobody standing in front of
 * it knows what a log file is, and the fix can't be "plug in a keyboard". So a
 * payload gets two chances to come up and stay up. Fail twice and it's
 * blocked, the previous one comes back, and nobody has to do anything.
 */
const path = require('node:path');
const fs = require('node:fs');
const paths = require('./paths.cjs');
const { choose, blockAndDemote, HEALTHY_AFTER_MS } = require('./bootstrap.cjs');

const chosen = choose();

let startServer;
try {
  ({ startServer } = require(path.join(chosen.root, 'app', 'server.cjs')));
  if (typeof startServer !== 'function') throw new Error('server.cjs exported no startServer()');
} catch (err) {
  // Complete enough to pass the file checks and still not loadable. Don't wait
  // for a restart to recover — fall back in this same launch.
  console.error('[baja-blast] Payload failed to load, falling back to the packaged copy.', err);
  if (chosen.source === 'installed') blockAndDemote(chosen.rev, 'could not be loaded');
  const bundled = paths.bundledRoot();
  ({ startServer } = require(path.join(bundled, 'app', 'server.cjs')));
  chosen.root = bundled;
  chosen.source = 'bundled';
  Object.assign(chosen, paths.readBuild(bundled));
}

console.log(`[baja-blast] Build ${chosen.build} (${chosen.source}) from ${chosen.root}`);

// Answer "which build would you run, and why?" without starting anything.
// Useful on a Pi that's misbehaving, and it's what makes the rollback logic
// above testable without binding a port or stubbing a server.
if (process.env.BAJA_BLAST_BOOT_CHECK === '1') {
  console.log(JSON.stringify({ build: chosen.build, rev: chosen.rev, source: chosen.source, root: chosen.root }));
  process.exit(0);
}

startServer({
  payload: chosen,
  // systemd has Restart=always, so exiting IS the restart. No process manager
  // of our own, no PID files, no double supervision fighting itself.
  relaunch: () => {
    console.log('[baja-blast] Exiting so systemd restarts us into the new build.');
    process.exit(0);
  },
});

// Survived long enough to count. Clearing this is what stops a good build
// being rolled back on its third ordinary restart weeks later.
if (chosen.source === 'installed') {
  const timer = setTimeout(() => {
    try {
      fs.rmSync(paths.BOOT_FILE(), { force: true });
      console.log(`[baja-blast] Build ${chosen.build} looks healthy.`);
    } catch {
      /* already gone */
    }
  }, HEALTHY_AFTER_MS);
  timer.unref(); // never hold the process open just for this
}

// A crash in an async corner shouldn't take the kitchen display down silently.
// Log it and let systemd restart us; if it's the new payload's fault, the boot
// counter above will catch it on the second try.
process.on('uncaughtException', (err) => {
  console.error('[baja-blast] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[baja-blast] Unhandled rejection:', err);
});
