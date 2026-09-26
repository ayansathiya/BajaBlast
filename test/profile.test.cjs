/**
 * Device profiles and the TV's standby over HDMI-CEC.
 *
 * The profile is what makes a 1GB TV box come up in low power mode without
 * anybody finding the switch, so the cases that matter are the ones about
 * *not* doing it: not on a second boot, not after someone turned it off, not
 * because of a broken file.
 *
 * The CEC half drives display.cjs against fake `xset` and `cec-ctl` programs
 * on PATH that log what they were asked to do, so it checks the actual
 * commands a TV would receive.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { withDefaults, DEFAULT_SETTINGS } = require(path.join(ROOT, 'app', 'defaults.cjs'));
const profile = require(path.join(ROOT, 'app', 'profile.cjs'));

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-profile-'));
const isLowPower = (s) => s.display.reducedMotion === true && s.ambient.enabled === false && s.feeds.showPhotoFrame === false;

console.log('\nApplying a profile');
{
  const store = { settings: null };
  const changed = profile.applyProfile(store, withDefaults, { lowPower: true });
  check('a brand-new box starts in low power mode', changed && isLowPower(store.settings));
  check('the rest of the settings are the ordinary defaults', store.settings.householdName === DEFAULT_SETTINGS.householdName && store.settings.chores.items.length === DEFAULT_SETTINGS.chores.items.length);
  check('it is recorded as applied', JSON.stringify(store.profileApplied) === '["lowPower"]');

  check('a second start changes nothing', profile.applyProfile(store, withDefaults, { lowPower: true }) === false);

  // Somebody turns it off in Settings. The next boot must leave it off.
  store.settings = { ...store.settings, display: { ...store.settings.display, reducedMotion: false }, ambient: { ...store.settings.ambient, enabled: true }, feeds: { ...store.settings.feeds, showPhotoFrame: true } };
  profile.applyProfile(store, withDefaults, { lowPower: true });
  check('turning it off in Settings survives a restart', !isLowPower(store.settings));
}
{
  const store = { settings: { ...structuredClone(DEFAULT_SETTINGS), householdName: 'The Satishes' } };
  profile.applyProfile(store, withDefaults, { lowPower: true });
  check('a box that already had settings keeps them', store.settings.householdName === 'The Satishes' && isLowPower(store.settings));
}
{
  const store = { settings: null };
  check('no profile, no change', profile.applyProfile(store, withDefaults, null) === false && store.settings === null);
  check('lowPower: false is not a request', profile.applyProfile(store, withDefaults, { lowPower: false }) === false);
}
{
  const store = { settings: null };
  profile.applyProfile(store, withDefaults, { lowPower: true, hdmiCec: true });
  check('the TV-box profile turns on HDMI-CEC standby', store.settings.display.schedule.hdmiCec === true && isLowPower(store.settings));
  check('and keeps the schedule itself', store.settings.display.schedule.on === '06:00' && store.settings.display.schedule.enabled === true);
  check('both are recorded', JSON.stringify(store.profileApplied.sort()) === '["hdmiCec","lowPower"]');
}
check('HDMI-CEC is off unless chosen', withDefaults(null).display.schedule.hdmiCec === false);

console.log('\nReading the file');
{
  const good = path.join(tmp, 'good.json');
  fs.writeFileSync(good, '{"lowPower": true}');
  check('reads a real file', profile.readProfile(good).lowPower === true);
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, '{"lowPower": tr');
  check('a malformed file is ignored, not fatal', profile.readProfile(bad) === null);
  check('a missing file is ignored', profile.readProfile(path.join(tmp, 'nope.json')) === null);
  fs.writeFileSync(bad, '[true]');
  check('a file that is not an object is ignored', profile.readProfile(bad) === null);
}

console.log('\nThe server applies it at start');
{
  const data = path.join(tmp, 'data');
  const file = path.join(tmp, 'profile.json');
  fs.writeFileSync(file, JSON.stringify({ lowPower: true, hdmiCec: true }));
  const { execFileSync } = require('node:child_process');
  // A fresh process, so server.cjs loads against this data folder.
  const script = `
    const s = require(${JSON.stringify(path.join(ROOT, 'app', 'server.cjs'))});
    setTimeout(() => {
      const st = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(data, 'store.json'))}, 'utf8'));
      console.log(JSON.stringify({ applied: st.profileApplied, rm: st.settings.display.reducedMotion, cec: st.settings.display.schedule.hdmiCec }));
      process.exit(0);
    }, 300);
  `;
  let out = '';
  try {
    out = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, BAJA_BLAST_DATA: data, BAJA_BLAST_PROFILE: file },
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch (err) {
    out = String(err.stdout || '') + String(err.message);
  }
  const line = out.trim().split('\n').pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* reported below */ }
  check('store.json is written with the profile applied', parsed && parsed.rm === true && parsed.cec === true && parsed.applied.length === 2, line);
}

console.log('\nThe TV, over HDMI-CEC');
(async () => {
  const bin = path.join(tmp, 'bin');
  const log = path.join(tmp, 'calls.log');
  fs.mkdirSync(bin);
  const fake = (name, body) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  fake('cec-ctl', 'case "$*" in *--playback*) echo "Physical Address           : 1.0.0.0";; esac\nexit 0');
  fake('xset', 'exit 0');
  // No wlopm or vcgencmd on this PATH, so x11 is the method that works.
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);

  const runDisplay = (code) => {
    const { execFileSync } = require('node:child_process');
    fs.rmSync(log, { force: true });
    const out = execFileSync(process.execPath, ['-e', `
      const d = require(${JSON.stringify(path.join(ROOT, 'app', 'display.cjs'))});
      (async () => { ${code} })().then((r) => console.log(JSON.stringify(r)));
    `], { env, encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out.trim().split('\n').pop());
  };

  let r = runDisplay('return d.setDisplay(false)');
  check('without the setting, the TV is left alone', r.ok && r.method === 'x11' && !calls().some((c) => c.startsWith('cec-ctl')));

  r = runDisplay('return d.setDisplay(false, { cec: true })');
  let c = calls();
  check('sleeping blanks the signal and sends standby', r.ok && r.method === 'x11+cec' && c.some((x) => x.includes('dpms force off')) && c.some((x) => x.includes('--to 0 --standby')));
  check('standby goes after the signal is blanked', c.findIndex((x) => x.includes('dpms force off')) < c.findIndex((x) => x.includes('--standby')));

  r = runDisplay('return d.setDisplay(true, { cec: true })');
  c = calls();
  check('waking turns the TV on', r.ok && c.some((x) => x.includes('--to 0 --image-view-on')));
  check('and switches it to our input', c.some((x) => x.includes('--active-source phys-addr=1.0.0.0')));
  check('the TV is woken before the signal returns', c.findIndex((x) => x.includes('--image-view-on')) < c.findIndex((x) => x.includes('dpms force on')));

  // No way to blank the signal at all — CEC on its own still counts.
  fs.unlinkSync(path.join(bin, 'xset'));
  r = runDisplay('return d.setDisplay(false, { cec: true })');
  check('with nothing else working, CEC alone still sleeps the TV', r.ok && r.method === 'cec');

  fake('cec-ctl', 'exit 1');
  r = runDisplay('return d.setDisplay(false, { cec: true })');
  check('with no CEC either, it says so rather than pretending', r.ok === false && /cec/.test(r.error));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
