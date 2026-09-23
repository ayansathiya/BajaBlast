/**
 * Runs the live-update suite against a server this script starts and stops.
 *
 * Separate from live.test.cjs so that suite can also be pointed at a running
 * instance by hand, which is what you want when something is misbehaving on
 * the actual Pi.
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-live-'));

const server = spawn('node', [path.join(ROOT, 'app', 'launch.cjs')], {
  env: { ...process.env, BAJA_BLAST_DATA: DATA },
  stdio: 'ignore',
  detached: true,
});

function stop() {
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    try { server.kill('SIGKILL'); } catch { /* gone */ }
  }
}

async function waitForIt() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:8787/health');
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  if (!(await waitForIt())) {
    console.error('server never came up');
    stop();
    process.exit(1);
  }
  const r = spawnSync('node', [path.join(ROOT, 'test', 'live.test.cjs')], { stdio: 'inherit' });
  stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(r.status === null ? 1 : r.status);
})();
