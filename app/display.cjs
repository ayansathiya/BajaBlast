/**
 * Turning the screen off at night.
 *
 * Worth being precise about what's being saved here, because the intuition is
 * usually backwards. A Raspberry Pi showing a calendar draws about 5 watts.
 * Left on every hour of every year that's roughly 44 kWh — around $13 at New
 * Hampshire's ~29c/kWh. The monitor next to it draws five or six times that.
 *
 * So switching the *Pi* off overnight saves about four dollars a year, and
 * costs you a machine that can't turn itself back on: a halted Pi has no way
 * to wake on a schedule without extra hardware, which is why every "shut down
 * at 11, boot at 6" guide ends with someone pressing a button in the morning.
 *
 * Switching the *screen* off saves five times as much, takes one command, and
 * a fingertip brings it back. So the Pi stays up — still serving your phone,
 * still taking updates at 4am — and the panel sleeps.
 *
 * Three ways to do it, because Raspberry Pi OS changed compositors and both
 * are still in the wild:
 *
 *   wlopm      Wayland (Bookworm and later, labwc or wayfire)
 *   xset dpms  X11 (older images, and anyone who switched back)
 *   vcgencmd   the Broadcom firmware call, as a last resort
 */
const { execFile } = require('node:child_process');

const TIMEOUT = 5_000;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: TIMEOUT }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '').trim(), err: err ? err.message : (stderr || '').trim() });
    });
  });
}

/** Ask the compositor which outputs exist, so we don't guess at HDMI-A-1. */
async function wlOutputs() {
  const res = await run('wlopm', []);
  if (!res.ok) return [];
  // Lines look like: "HDMI-A-1 on"
  return res.out
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

let lastMethod = null;
let lastError = null;
let currentlyOn = true;

/**
 * Turn the panel on or off.
 *
 * Tries each method in turn and remembers which one worked, so the second
 * call doesn't pay for the failures again. Returns what actually happened
 * rather than throwing: a display that won't blank is a wasted few watts, not
 * a reason to take the calendar down.
 */
async function setDisplay(on) {
  const attempts = [];

  const tryWayland = async () => {
    const outputs = await wlOutputs();
    if (!outputs.length) return false;
    let any = false;
    for (const output of outputs) {
      const r = await run('wlopm', [on ? '--on' : '--off', output]);
      any = any || r.ok;
    }
    return any;
  };

  const tryX11 = async () => {
    // force off / force on, rather than toggling DPMS settings, so this
    // doesn't fight whatever screen-blanking policy the desktop has.
    const r = await run('xset', ['dpms', 'force', on ? 'on' : 'off']);
    return r.ok;
  };

  const tryVcgencmd = async () => {
    const r = await run('vcgencmd', ['display_power', on ? '1' : '0']);
    return r.ok;
  };

  const methods = { wayland: tryWayland, x11: tryX11, vcgencmd: tryVcgencmd };
  const order = lastMethod ? [lastMethod, ...Object.keys(methods).filter((m) => m !== lastMethod)] : Object.keys(methods);

  for (const name of order) {
    try {
      if (await methods[name]()) {
        lastMethod = name;
        lastError = null;
        currentlyOn = on;
        return { ok: true, method: name, on };
      }
      attempts.push(name);
    } catch (err) {
      attempts.push(`${name} (${err.message})`);
    }
  }

  lastError = `no working method (tried ${attempts.join(', ')})`;
  return { ok: false, error: lastError, on: currentlyOn };
}

/** Minutes past midnight, for comparing against a HH:MM setting. */
function minutesNow(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function parseHHMM(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return h * 60 + min;
}

/**
 * Should the screen be on right now?
 *
 * Handles the schedule wrapping past midnight, which is the normal case — "on
 * at 06:00, off at 23:00" doesn't wrap, but someone working nights who sets
 * 18:00 to 09:00 does, and getting that wrong means the screen is off all day.
 */
function shouldBeOn(settings, now = new Date()) {
  const schedule = (settings && settings.display && settings.display.schedule) || {};
  if (schedule.enabled === false) return true;

  const on = parseHHMM(schedule.on, 6 * 60);
  const off = parseHHMM(schedule.off, 23 * 60);
  const t = minutesNow(now);

  if (on === off) return true; // a zero-length window means "always on"
  if (on < off) return t >= on && t < off;
  return t >= on || t < off; // wraps past midnight
}

function status() {
  return { on: currentlyOn, method: lastMethod, error: lastError };
}

module.exports = { setDisplay, shouldBeOn, status, parseHHMM, _minutesNow: minutesNow };
