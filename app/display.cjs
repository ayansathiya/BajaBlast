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
 *
 * And, separately, HDMI-CEC — for a box plugged into a television rather
 * than a monitor. Blanking the signal is enough for a monitor, which sleeps
 * when it has nothing to show. A TV mostly doesn't: it sits there lit up
 * saying "No signal", drawing nearly full power, which defeats the point. CEC
 * is the wire in the HDMI cable that lets the box tell the TV to go to
 * standby, and to come back on in the morning. It's opt-in
 * (display.schedule.hdmiCec) because a TV is often shared — turning the
 * living-room set off at 11pm mid-film is not a feature.
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

/**
 * HDMI-CEC via cec-ctl (v4l-utils), talking to the kernel's /dev/cec0.
 *
 * The adapter has to claim a logical address before it may send anything,
 * which is what --playback does; it's idempotent, so it's done every time
 * rather than tracked. Waking sends Image View On (the TV powers up) and then
 * Active Source with our physical address, so the TV also switches to our
 * input instead of whatever it was last showing.
 */
const CEC_DEVICE = process.env.BAJA_BLAST_CEC_DEVICE || '/dev/cec0';

async function setCec(on) {
  const d = ['-d', CEC_DEVICE];
  const conf = await run('cec-ctl', [...d, '--playback', '--osd-name', 'Baja Blast']);
  if (!conf.ok) return { ok: false, error: conf.err || 'cec-ctl unavailable' };
  if (!on) {
    const r = await run('cec-ctl', [...d, '--to', '0', '--standby']);
    return { ok: r.ok, error: r.ok ? null : r.err };
  }
  const r = await run('cec-ctl', [...d, '--to', '0', '--image-view-on']);
  const phys = /Physical Address\s*:\s*([0-9a-f]\.[0-9a-f]\.[0-9a-f]\.[0-9a-f])/i.exec(conf.out);
  if (r.ok && phys && phys[1] !== 'f.f.f.f') {
    await run('cec-ctl', [...d, '--to', '15', '--active-source', `phys-addr=${phys[1]}`]);
  }
  return { ok: r.ok, error: r.ok ? null : r.err };
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
async function setDisplay(on, options = {}) {
  const attempts = [];

  // The TV first when waking, so it's already warming up while the signal
  // comes back; after the signal when sleeping. Either way it's in addition
  // to blanking, never instead of it: with CEC alone, a TV that ignores the
  // command would leave a lit calendar on all night.
  let cec = null;
  if (options.cec && on) cec = await setCec(true);

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
        if (options.cec && !on) cec = await setCec(false);
        return { ok: true, method: cec && cec.ok ? `${name}+cec` : name, on, cec };
      }
      attempts.push(name);
    } catch (err) {
      attempts.push(`${name} (${err.message})`);
    }
  }

  // No way to blank the signal, but the TV itself may still be told to sleep
  // — on a TV box that's the part that actually saves the power.
  if (options.cec && !on) cec = await setCec(false);
  if (cec && cec.ok) {
    lastMethod = null;
    lastError = null;
    currentlyOn = on;
    return { ok: true, method: 'cec', on, cec };
  }

  lastError = `no working method (tried ${attempts.join(', ')}${options.cec ? ', cec' : ''})`;
  return { ok: false, error: lastError, on: currentlyOn, cec };
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
