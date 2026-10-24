/**
 * Bluetooth speakers, from the wall.
 *
 * A thin wrapper round bluetoothctl, the Pi's own Bluetooth tool: find what's
 * nearby, pair, trust (so it reconnects by itself next time), connect,
 * disconnect, forget. Once a speaker is connected, the Pi's sound system
 * moves everything — Baja, timers' chimes, music — to it on its own.
 *
 * Every address is checked before it goes anywhere near a command line, and
 * bluetoothctl is run with arguments, never through a shell.
 */
const { execFile } = require('node:child_process');
const audio = require('./audio.cjs');

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

function run(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('bluetoothctl', args, { timeout, env: { ...process.env, LANG: 'C' } }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`, missing: !!(err && err.code === 'ENOENT') });
    });
  });
}

/** "Device AA:BB:CC:DD:EE:FF JBL Flip 5" lines → [{ mac, name }]. */
function parseDevices(text) {
  const seen = new Set();
  const list = [];
  for (const line of String(text).split('\n')) {
    const m = /Device\s+([0-9A-F:]{17})\s+(.+?)\s*$/i.exec(line);
    if (!m || seen.has(m[1].toUpperCase())) continue;
    seen.add(m[1].toUpperCase());
    list.push({ mac: m[1].toUpperCase(), name: m[2] });
  }
  return list;
}

/** `bluetoothctl info` → the few things worth showing. */
function parseInfo(text) {
  const yes = (key) => new RegExp(`^\\s*${key}:\\s*yes`, 'im').test(text);
  const icon = (/^\s*Icon:\s*(\S+)/im.exec(text) || [])[1] || '';
  return {
    paired: yes('Paired'),
    trusted: yes('Trusted'),
    connected: yes('Connected'),
    // audio-card, audio-headset, audio-headphones: the ones that play sound.
    audio: /^audio/.test(icon) || /UUID:\s*Audio Sink/i.test(text),
    icon,
  };
}

/** Everything known: paired first, then what a scan found. */
async function list() {
  const all = await run(['devices']);
  if (all.missing) return { available: false, error: "This machine has no Bluetooth tools (bluetoothctl isn't installed)." };
  const devices = [];
  for (const d of parseDevices(all.out)) {
    const info = await run(['info', d.mac], 5000);
    // Unnamed devices show their address as the name; nobody can pick those.
    if (d.name.replace(/-/g, ':').toUpperCase() === d.mac) continue;
    devices.push({ ...d, ...parseInfo(info.out) });
  }
  devices.sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || Number(b.audio) - Number(a.audio) || a.name.localeCompare(b.name));
  const show = await run(['show'], 5000);
  return { available: true, powered: /Powered:\s*yes/i.test(show.out), devices, output: await audio.status() };
}

/** Look for nearby devices for a few seconds. Put the speaker in pairing mode first. */
async function scan(seconds = 12) {
  await run(['power', 'on'], 5000);
  await run(['--timeout', String(seconds), 'scan', 'on'], (seconds + 5) * 1000);
  return list();
}

/** Pair, trust and connect — each step only if it's needed. */
async function connect(mac) {
  if (!MAC.test(String(mac || ''))) return { ok: false, error: 'not a Bluetooth address' };
  await run(['power', 'on'], 5000);
  let info = parseInfo((await run(['info', mac], 5000)).out);
  if (!info.paired) {
    const paired = await run(['pair', mac], 30000);
    if (!paired.ok && !/AlreadyExists|already paired|Pairing successful/i.test(paired.out)) {
      return { ok: false, error: /not available/i.test(paired.out) ? 'It went out of range — put it back in pairing mode and scan again.' : "It wouldn't pair. Put the speaker in pairing mode and try again." };
    }
  }
  if (!info.trusted) await run(['trust', mac], 5000);
  const connected = await run(['connect', mac], 30000);
  info = parseInfo((await run(['info', mac], 5000)).out);
  if (!info.connected) {
    return { ok: false, error: /not available/i.test(connected.out) ? 'It went out of range.' : "Paired, but it didn't connect. Is it switched on and nearby?" };
  }
  // Connected isn't playing: send the sound to it.
  const routed = await audio.useBluetooth(mac);
  return routed.ok ? { ok: true, output: routed.description } : { ok: false, connected: true, error: routed.error };
}

async function disconnect(mac) {
  if (!MAC.test(String(mac || ''))) return { ok: false, error: 'not a Bluetooth address' };
  const r = await run(['disconnect', mac], 15000);
  return { ok: r.ok };
}

/** Unpair. It won't reconnect until it's paired again. */
async function forget(mac) {
  if (!MAC.test(String(mac || ''))) return { ok: false, error: 'not a Bluetooth address' };
  const r = await run(['remove', mac], 15000);
  return { ok: r.ok };
}

/** For a speaker that's already connected: send the sound to it. */
async function useForSound(mac) {
  if (!MAC.test(String(mac || ''))) return { ok: false, error: 'not a Bluetooth address' };
  const routed = await audio.useBluetooth(mac);
  return routed.ok ? { ok: true, output: routed.description } : { ok: false, error: routed.error };
}

module.exports = { list, scan, connect, disconnect, forget, useForSound, parseDevices, parseInfo };
