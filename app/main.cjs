/**
 * Electron entry point — the Mac app.
 *
 * Same job as launch.cjs on the Pi: pick which copy of the app to run, then
 * run it. The difference is what "run it" means — here it opens a window; on
 * the Pi it serves headless and the browser is somebody else's problem.
 *
 * The payload-picking and rollback logic is shared rather than duplicated, so
 * a build that won't start gets the same two-strikes treatment on both.
 */
const path = require('node:path');
const { chooseSafely } = require('./bootstrap.cjs');

const chosen = chooseSafely();
console.log(`[baja-blast] Build ${chosen.build} (${chosen.source}) from ${chosen.root}`);

require(path.join(chosen.root, 'app', 'mac.cjs')).start({ payload: chosen });
