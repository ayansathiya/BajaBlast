/**
 * WiZ lights, on the home Wi-Fi, with no account.
 *
 * WiZ bulbs answer small JSON messages on UDP port 38899 — the same thing the
 * WiZ app does when "Allow local communication" is on. So the Pi talks to them
 * directly: no cloud, no login, and it works with the internet down.
 *
 *   getPilot          → { mac, state, dimming, temp, r, g, b, sceneId }
 *   getSystemConfig   → { mac, roomId, moduleName, ... }
 *   setPilot(params)  → { success: true }
 *
 * A bulb's address can change whenever the router feels like it, so bulbs are
 * known by their MAC and found again by scanning when an address stops
 * answering. Names live here too: the WiZ app keeps its names in WiZ's cloud,
 * where the Pi can't (and needn't) reach them.
 *
 * A bulb on a switched-off wall switch has no power and can't answer anyone.
 */
const dgram = require('node:dgram');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = Number(process.env.BAJA_BLAST_WIZ_PORT) || 38899;

let socket = null;
const waiting = new Map(); // `${ip}|${method}` → [resolve]
let scanSink = null; // collects every getPilot answer during a scan

function sock() {
  if (socket) return socket;
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', () => {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    socket = null;
  });
  socket.on('message', (buf, rinfo) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    const key = `${rinfo.address}|${msg.method}`;
    const list = waiting.get(key);
    if (list && list.length) {
      waiting.delete(key);
      for (const resolve of list) resolve(msg);
    }
    if (scanSink && msg.method === 'getPilot' && msg.result) scanSink.set(rinfo.address, msg.result);
  });
  socket.bind(0, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* not fatal: unicast still works */
    }
  });
  socket.unref();
  return socket;
}

function transmit(ip, message) {
  const s = sock();
  const data = Buffer.from(JSON.stringify(message));
  return new Promise((resolve) => s.send(data, PORT, ip, () => resolve()));
}

/** One request, a couple of tries (it's UDP), resolves with the reply or null. */
async function request(ip, method, params = {}, { timeout = 700, tries = 3, sign = null } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const reply = await new Promise((resolve) => {
      const key = `${ip}|${method}`;
      const timer = setTimeout(() => {
        const list = waiting.get(key) || [];
        waiting.set(key, list.filter((r) => r !== done));
        resolve(null);
      }, timeout);
      const done = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };
      waiting.set(key, [...(waiting.get(key) || []), done]);
      transmit(ip, sign ? signed(method, params, sign) : { method, params }).catch(() => {});
    });
    if (reply) return reply;
  }
  return null;
}

/** Every IPv4 address on this machine's own networks (capped, so a /16 isn't 65k packets). */
function neighbourhood() {
  const out = new Set();
  const broadcasts = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family !== 'IPv4' || nic.internal) continue;
      const ip = nic.address.split('.').map(Number);
      const mask = nic.netmask.split('.').map(Number);
      const toInt = (q) => ((q[0] << 24) >>> 0) + (q[1] << 16) + (q[2] << 8) + q[3];
      const fromInt = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      let maskInt = toInt(mask);
      // Wider than a /22 (1,022 hosts): just the /22 around us.
      if (((~maskInt) >>> 0) > 1023) maskInt = 0xfffffc00;
      const base = (toInt(ip) & maskInt) >>> 0;
      const last = (base | (~maskInt >>> 0)) >>> 0;
      broadcasts.add(fromInt(last));
      for (let n = base + 1; n < last; n += 1) out.add(fromInt(n));
    }
  }
  return { hosts: [...out], broadcasts: [...broadcasts] };
}

/**
 * Find every WiZ bulb that's powered. A broadcast, then every address one by
 * one — some routers (mesh ones especially) don't pass broadcasts between
 * Wi-Fi and wired devices.
 */
async function scan({ hosts, listenMs = 2500 } = {}) {
  // BAJA_BLAST_WIZ_HOSTS: the tests' fake bulbs, instead of the whole network.
  const override = (process.env.BAJA_BLAST_WIZ_HOSTS || '').split(',').filter(Boolean);
  const area = hosts ? { hosts, broadcasts: [] } : override.length ? { hosts: override, broadcasts: [] } : neighbourhood();
  const found = new Map();
  scanSink = found;
  try {
    for (let round = 0; round < 2; round += 1) {
      for (const b of area.broadcasts) await transmit(b, { method: 'getPilot', params: {} }).catch(() => {});
      for (const h of area.hosts) await transmit(h, { method: 'getPilot', params: {} }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
    }
    await new Promise((r) => setTimeout(r, listenMs));
  } finally {
    scanSink = null;
  }
  const bulbs = [];
  for (const [ip, pilot] of found) {
    const config = await request(ip, 'getSystemConfig', {}, { timeout: 600, tries: 2 });
    bulbs.push({
      mac: String(pilot.mac || config?.result?.mac || ip).toLowerCase(),
      ip,
      roomId: config?.result?.roomId ?? null,
      model: config?.result?.moduleName ?? null,
    });
  }
  return bulbs;
}

async function status(ip) {
  const reply = await request(ip, 'getPilot', {}, { timeout: 600, tries: 2 });
  return reply?.result || null;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * { on, dimming (1-100), temp (2200-6500 K), color: [r,g,b] } → WiZ's setPilot.
 * WiZ won't go below 10% brightness; anything lower is 10.
 */
function pilotFor(change) {
  if (change.on === false) return { state: false };
  const p = { state: true };
  if (change.dimming != null) p.dimming = clamp(change.dimming, 10, 100);
  if (change.color) {
    [p.r, p.g, p.b] = change.color.map((c) => clamp(c, 0, 255));
  } else if (change.temp != null) {
    p.temp = clamp(change.temp, 2200, 6500);
  }
  return p;
}

/*
 * Signed commands.
 *
 * Newer WiZ firmware (1.34 and later) has a setting in the WiZ app, under
 * Settings → Security: "Allow all controls" or "Only verified controls". On
 * the second, a bulb still answers "what are you doing?" but turns down any
 * change that isn't signed with the home's key ("Invalid params", -32602) —
 * which is exactly how it looks when the lights can be seen but not switched.
 *
 * The key is the home's `udp_signing_key` (32 hex characters), from the WiZ
 * app: Home settings → Integrations → Local integrations. With it, a change
 * carries a timestamp and an HMAC-SHA256 of its parameters, and goes through
 * either way. Without it, "Allow all controls" is what's needed.
 */
let signingKey = null;

function setSigningKey(hex) {
  const clean = String(hex || '').trim().toLowerCase();
  signingKey = /^[0-9a-f]{32}$/.test(clean) ? Buffer.from(clean, 'hex') : null;
}

function signed(method, params, key) {
  const withTs = { ...params, sigTs: Math.floor(Date.now() / 1000) };
  const hmac = crypto.createHmac('sha256', key).update(JSON.stringify(withTs)).digest('base64');
  return { method, env: 'pro', params: withTs, hmac };
}

// Why the last change didn't happen, when a bulb answered but said no.
let lastRefusal = null;

async function set(ip, change) {
  const params = pilotFor(change);
  let reply = await request(ip, 'setPilot', params, { timeout: 700, tries: 3, sign: signingKey });
  if (reply?.result?.success) return true;
  // A key that's wrong (or a bulb that wants one we don't have).
  if (reply?.error) {
    lastRefusal = signingKey ? 'bad-key' : 'verified-only';
    // A key set but the bulb is on "Allow all controls" anyway: plain works.
    if (signingKey) {
      reply = await request(ip, 'setPilot', params, { timeout: 700, tries: 2 });
      if (reply?.result?.success) return true;
    }
  }
  return false;
}

/** What a bulb is doing now, in the same shape `set` takes — for saving moods. */
function changeFrom(pilot) {
  if (!pilot || !pilot.state) return { on: false };
  const c = { on: true, dimming: pilot.dimming ?? 100 };
  if (pilot.temp) c.temp = pilot.temp;
  else if (pilot.r != null && (pilot.r || pilot.g || pilot.b)) c.color = [pilot.r, pilot.g, pilot.b];
  return c;
}

module.exports = { scan, status, set, changeFrom, pilotFor, setSigningKey, signed, refusal: () => lastRefusal, clearRefusal: () => { lastRefusal = null; } };
