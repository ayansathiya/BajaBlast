/**
 * Where things live on disk.
 *
 * Two questions, both answered here so the launcher, the server and the
 * updater can never disagree about them:
 *
 *   dataDir()     — where the household lives (events, photos, settings)
 *   payloadRoot() — where the *app code* lives, which is not necessarily
 *                   where the package installed it
 *
 * The split is what lets the thing update itself. The installed package under
 * /opt is owned by the package manager and is left alone; the code that
 * actually runs can be a newer copy pulled from GitHub, sitting in the data
 * directory where it can be replaced without root and without reinstalling
 * anything.
 *
 * Three layouts have to work:
 *
 *   installed   /opt/baja-blast + /var/lib/baja-blast     (the .deb on a Pi)
 *   portable    ./baja-blast-data next to the app          (a USB stick)
 *   developing  the checkout + ~/.baja-blast-kiosk-data    (npm run server)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const INSTALL_PREFIX = '/opt/baja-blast';
const SYSTEM_DATA_DIR = '/var/lib/baja-blast';

/** True when running from a package install rather than a checkout. */
function isInstalled() {
  return path.resolve(__dirname, '..').startsWith(INSTALL_PREFIX);
}

/**
 * Where the calendar, photos and settings live.
 *
 * In order of precedence:
 *
 *   1. $BAJA_BLAST_DATA. The systemd unit sets this, and it's also the way
 *      to put the store on an external drive or a network share.
 *
 *   2. /var/lib/baja-blast when running from an installed package. Survives
 *      upgrading, reinstalling, and removing the package — a household's
 *      calendar should not be something `apt remove` can delete by accident.
 *
 *   3. A `baja-blast-data` folder next to the app. Portable: put it beside
 *      the program on a USB stick and the whole household travels with it.
 *
 *   4. Otherwise a dot-directory in the home folder, which is what you want
 *      while developing.
 */
function dataDir() {
  if (process.env.BAJA_BLAST_DATA) return process.env.BAJA_BLAST_DATA;
  if (isInstalled()) return SYSTEM_DATA_DIR;

  const beside = path.resolve(__dirname, '..', '..', 'baja-blast-data');
  if (fs.existsSync(beside)) return beside;

  return path.join(os.homedir(), '.baja-blast-kiosk-data');
}

/** Everything the updater owns. Never contains household data. */
function updatesDir() {
  return path.join(dataDir(), 'app');
}

const ACTIVE_FILE = () => path.join(updatesDir(), 'active.json');
const BOOT_FILE = () => path.join(updatesDir(), 'boot-attempt.json');

/** A payload is only a payload if it has everything we're going to load. */
function isUsablePayload(dir) {
  if (!dir) return false;
  try {
    return (
      fs.existsSync(path.join(dir, 'build.json')) &&
      fs.existsSync(path.join(dir, 'dist', 'index.html')) &&
      fs.existsSync(path.join(dir, 'app', 'server.cjs'))
    );
  } catch {
    return false;
  }
}

function readBuild(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'build.json'), 'utf8'));
    return { build: raw.build || 'unknown', rev: Number(raw.rev) || 0, updates: raw.updates || null };
  } catch {
    return { build: 'unknown', rev: 0, updates: null };
  }
}

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** The copy that shipped in the package. Always present, never written to. */
function bundledRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Which code to actually run.
 *
 * Prefers an installed update, but only if it's genuinely newer than what the
 * package shipped and only if it looks complete. A half-extracted folder or a
 * payload from an older release is ignored rather than trusted, because the
 * failure mode of getting this wrong is a kitchen display that won't come up
 * and a household that can't fix it.
 */
function payloadRoot() {
  const bundled = bundledRoot();
  const active = readJSON(ACTIVE_FILE());
  if (!active || !active.dir) return { root: bundled, source: 'bundled', ...readBuild(bundled) };

  const dir = path.isAbsolute(active.dir) ? active.dir : path.join(updatesDir(), active.dir);
  if (!isUsablePayload(dir)) return { root: bundled, source: 'bundled', ...readBuild(bundled) };

  const installed = readBuild(dir);
  const shipped = readBuild(bundled);
  if (installed.rev <= shipped.rev) {
    // The package is newer — someone installed a fresh .deb over the top.
    return { root: bundled, source: 'bundled', ...shipped };
  }
  return { root: dir, source: 'installed', ...installed };
}

module.exports = {
  dataDir,
  updatesDir,
  bundledRoot,
  payloadRoot,
  isUsablePayload,
  isInstalled,
  readBuild,
  readJSON,
  writeJSONAtomic,
  ACTIVE_FILE,
  BOOT_FILE,
  INSTALL_PREFIX,
  SYSTEM_DATA_DIR,
};
