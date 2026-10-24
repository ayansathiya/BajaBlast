/**
 * Where the wall's sound comes out.
 *
 * A Bluetooth speaker showing "Connected" isn't the same as sound coming out
 * of it. The Pi's sound system (PipeWire, spoken to here through pactl) keeps
 * playing to whatever it was using — the screen's HDMI — unless it's told
 * otherwise, and the calendar's own stream stays where it started. So after a
 * speaker connects, this:
 *
 *   1. waits for the speaker to show up as an output (a second or two);
 *   2. puts it in music mode (A2DP) — some speakers connect in phone-call
 *      mode, which is mono, muffled, or silent;
 *   3. makes it the default output;
 *   4. moves anything already playing — the calendar itself — onto it.
 *
 * Runs as the desktop user with its XDG_RUNTIME_DIR (see the service file),
 * which is how pactl finds that user's sound system.
 */
const { execFile } = require('node:child_process');

function pactl(args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile('pactl', args, { timeout, env: { ...process.env, LANG: 'C' } }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || ''), missing: !!(err && err.code === 'ENOENT') });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const macKey = (mac) => String(mac).toUpperCase().replace(/:/g, '_');

/** `pactl list sinks` → [{ name, description }]. */
function parseSinks(text) {
  const sinks = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    const name = /^\s*Name:\s*(\S+)/.exec(line);
    const desc = /^\s*Description:\s*(.+?)\s*$/.exec(line);
    if (/^Sink #/.test(line)) {
      current = { name: '', description: '' };
      sinks.push(current);
    } else if (current && name) current.name = name[1];
    else if (current && desc) current.description = desc[1];
  }
  return sinks.filter((s) => s.name);
}

async function sinks() {
  const r = await pactl(['list', 'sinks']);
  return r.ok ? parseSinks(r.out) : [];
}

/** Where sound is going right now: { name, description, bluetooth }. */
async function status() {
  const def = await pactl(['get-default-sink']);
  if (def.missing) return { available: false, error: "This machine has no pactl, so the calendar can't choose where sound goes." };
  const name = def.out.trim();
  const found = (await sinks()).find((s) => s.name === name);
  return { available: true, name, description: found ? found.description : name || 'nothing', bluetooth: /^bluez_/.test(name) };
}

/** Send all the wall's sound to this Bluetooth speaker. */
async function useBluetooth(mac, { waitMs = 10000, stepMs = 500 } = {}) {
  const key = macKey(mac);
  // Music mode, before looking for the output: in phone-call mode some
  // speakers have no output at all.
  await pactl(['set-card-profile', `bluez_card.${key}`, 'a2dp-sink']);
  let sink = null;
  for (let waited = 0; waited <= waitMs; waited += stepMs) {
    sink = (await sinks()).find((s) => s.name.includes(key));
    if (sink) break;
    await sleep(stepMs);
  }
  if (!sink) return { ok: false, error: "The speaker connected, but the Pi's sound system didn't see it. Turn the speaker off and on again, then tap Connect." };
  const set = await pactl(['set-default-sink', sink.name]);
  if (!set.ok) return { ok: false, error: "Couldn't switch the sound to the speaker." };
  // Whatever is already playing — the calendar's own stream — moves too.
  const inputs = await pactl(['list', 'short', 'sink-inputs']);
  for (const line of inputs.out.split('\n')) {
    const id = line.split('\t')[0];
    if (/^\d+$/.test(id)) await pactl(['move-sink-input', id, sink.name]);
  }
  return { ok: true, sink: sink.name, description: sink.description };
}

module.exports = { status, useBluetooth, parseSinks, macKey };
