// ---------------------------------------------------------------------------
// Music: Sonos (local network) + Spotify Connect.
//
// READ THIS FIRST — how audio actually reaches a speaker, because the obvious
// mental model ("the app Bluetooths the music to the Sonos") is not a thing
// any app can do:
//
//   * Sonos speakers are Wi-Fi devices. Most models have no Bluetooth audio
//     input at all, and the few that do (Roam, Move, Era) only accept a
//     Bluetooth pairing from the OS, not from a web page. No browser API —
//     Web Bluetooth included — can stream audio over Bluetooth. Web
//     Bluetooth speaks GATT (small data packets); music streaming is A2DP,
//     which lives in the operating system.
//
//   * So this file does the two things that ARE real:
//
//     1. SONOS LOCAL CONTROL (below). Every Sonos speaker runs a little
//        UPnP server on port 1400. We find them with SSDP and drive them
//        with SOAP: play, pause, skip, volume, and what's currently
//        playing. No account, no key, no cloud, works offline. This
//        controls what the SPEAKER plays from its own sources.
//
//     2. SPOTIFY CONNECT (below). Sonos speakers are Spotify Connect
//        targets. With the household's own Spotify app credentials we can
//        list their Connect devices — the Sonos shows up there — hand
//        playback to it, and drive it. The audio goes Spotify → speaker
//        over Wi-Fi, never touching this Mac. This is the good path, and
//        it's strictly better than Bluetooth would be: no pairing, no
//        range limit, no re-encoding.
//
//   * The third path needs no code at all: pair any Bluetooth speaker to
//     the Pi in its Bluetooth settings and every sound the Pi makes,
//     including the Spotify embed in the Music tab, comes out of it. That's
//     an OS setting, not something this app can or should do for you.
// ---------------------------------------------------------------------------

const dgram = require('node:dgram');
const crypto = require('node:crypto');

// ===========================================================================
// Sonos
// ===========================================================================

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SONOS_PORT = 1400;

let discovered = [];
let lastDiscovery = 0;

function xmlTag(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml || '');
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * SSDP M-SEARCH for Sonos ZonePlayers. Speakers answer over UDP with a
 * LOCATION header pointing at their device description; we fetch that to
 * learn the room name.
 */
function discoverSonos(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map();
    let socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      return resolve([]);
    }

    const message = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 1\r\n' +
        'ST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n'
    );

    socket.on('error', () => {
      try { socket.close(); } catch {}
      resolve([]);
    });

    socket.on('message', (msg) => {
      const text = msg.toString();
      const loc = /LOCATION:\s*(\S+)/i.exec(text);
      if (!loc) return;
      try {
        const url = new URL(loc[1]);
        if (!found.has(url.hostname)) found.set(url.hostname, url.href);
      } catch {
        // Malformed LOCATION header — skip this responder.
      }
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDR);
      } catch {
        // Some sandboxed environments refuse multicast; treat as "none found".
      }
    });

    setTimeout(async () => {
      try { socket.close(); } catch {}
      const players = [];
      for (const [ip, descUrl] of found) {
        try {
          const res = await fetch(descUrl, { signal: AbortSignal.timeout(3000) });
          const xml = await res.text();
          players.push({
            ip,
            id: xmlTag(xml, 'UDN')?.replace(/^uuid:/, '') || ip,
            room: xmlTag(xml, 'roomName') || xmlTag(xml, 'friendlyName') || ip,
            model: xmlTag(xml, 'displayName') || xmlTag(xml, 'modelName') || 'Sonos',
          });
        } catch {
          players.push({ ip, id: ip, room: ip, model: 'Sonos' });
        }
      }
      players.sort((a, b) => a.room.localeCompare(b.room));
      discovered = players;
      lastDiscovery = Date.now();
      resolve(players);
    }, timeoutMs);
  });
}

async function getSonosPlayers({ force = false } = {}) {
  if (!force && discovered.length > 0 && Date.now() - lastDiscovery < 60_000) return discovered;
  return discoverSonos();
}

async function soap(ip, path, service, action, body = '') {
  const envelope =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">` +
    `<InstanceID>0</InstanceID>${body}` +
    `</u:${action}></s:Body></s:Envelope>`;

  const res = await fetch(`http://${ip}:${SONOS_PORT}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:schemas-upnp-org:service:${service}:1#${action}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`sonos ${action} ${res.status}`);
  return res.text();
}

const AV = ['/MediaRenderer/AVTransport/Control', 'AVTransport'];
const RC = ['/MediaRenderer/RenderingControl/Control', 'RenderingControl'];

async function sonosCommand(ip, action) {
  switch (action) {
    case 'play':
      return soap(ip, ...AV, 'Play', '<Speed>1</Speed>');
    case 'pause':
      return soap(ip, ...AV, 'Pause');
    case 'next':
      return soap(ip, ...AV, 'Next');
    case 'previous':
      return soap(ip, ...AV, 'Previous');
    default:
      throw new Error('unknown sonos action');
  }
}

async function sonosSetVolume(ip, level) {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  return soap(ip, ...RC, 'SetVolume', `<Channel>Master</Channel><DesiredVolume>${v}</DesiredVolume>`);
}

async function sonosNowPlaying(ip) {
  const [transport, position, volume] = await Promise.all([
    soap(ip, ...AV, 'GetTransportInfo'),
    soap(ip, ...AV, 'GetPositionInfo'),
    soap(ip, ...RC, 'GetVolume', '<Channel>Master</Channel>'),
  ]);

  const state = xmlTag(transport, 'CurrentTransportState') || 'STOPPED';
  // TrackMetaData is DIDL-Lite XML, escaped inside the SOAP response.
  const meta = xmlTag(position, 'TrackMetaData') || '';
  return {
    source: 'sonos',
    playing: state === 'PLAYING' || state === 'TRANSITIONING',
    state,
    title: xmlTag(meta, 'dc:title'),
    artist: xmlTag(meta, 'dc:creator'),
    album: xmlTag(meta, 'upnp:album'),
    artwork: null, // Sonos art URLs are relative to the player and often transient.
    volume: Number(xmlTag(volume, 'CurrentVolume') ?? 0),
    position: xmlTag(position, 'RelTime'),
    duration: xmlTag(position, 'TrackDuration'),
  };
}

// ===========================================================================
// Spotify Connect
// ===========================================================================
//
// Authorization Code + PKCE against the household's OWN Spotify app, so no
// client secret ever lives in this repo. Tokens are kept on this local
// server and are deliberately NOT exposed through /api/settings — the phone
// gets to see "connected: true" and nothing more.
//
// One constraint worth knowing before you wonder why the phone won't do it:
// Spotify only accepts HTTPS redirect URIs or loopback (127.0.0.1). A LAN
// address like 192.168.1.42 is rejected. So the "Connect Spotify" step has
// to happen in a browser ON the kiosk itself. After that, control works from
// anywhere — phone included.

const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  // Lets us read `product` (premium/free). Worth the extra scope: Spotify's
  // playback API silently does nothing useful on a Free account, and without
  // this the only symptom is an empty device list that looks like a bug here.
  'user-read-private',
].join(' ');

const REDIRECT_URI = 'http://127.0.0.1:8787/api/spotify/callback';

const pending = new Map(); // state -> { verifier, createdAt }

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildAuthUrl(clientId) {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  pending.set(state, { verifier, createdAt: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.createdAt > 30 * 60 * 1000) pending.delete(k);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCode(clientId, code, state) {
  const entry = pending.get(state);
  if (!entry) throw new Error('unknown-or-expired-state');
  pending.delete(state);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: entry.verifier,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'token-exchange-failed');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

async function refreshToken(clientId, tokens) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('refresh-failed');
  return {
    accessToken: data.access_token,
    // Spotify only sometimes returns a new refresh token; keep the old one otherwise.
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

/**
 * Calls the Spotify Web API, refreshing the access token first if it's about
 * to expire. `save` persists rotated tokens back to the store.
 */
async function spotifyApi(clientId, tokens, save, path, { method = 'GET', body } = {}) {
  let live = tokens;
  if (!live?.accessToken) throw new Error('not-connected');
  if (Date.now() >= (live.expiresAt || 0)) {
    live = await refreshToken(clientId, live);
    save(live);
  }

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${live.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 204) return null; // "nothing is playing" and most commands
  const text = await res.text();
  if (!res.ok) {
    let message = `spotify-${res.status}`;
    try {
      message = JSON.parse(text)?.error?.message || message;
    } catch {
      // Non-JSON error body; the status code is all we have.
    }
    // 403 on a player endpoint means one thing in practice: Spotify only
    // allows playback control on Premium. Say that instead of echoing their
    // wording, which is usually just "Player command failed".
    if (res.status === 403) {
      message = `${message} — Spotify's playback API requires Premium; a Free account can't control speakers.`;
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function normalizeSpotifyPlayback(p) {
  if (!p || !p.item) return { source: 'spotify', playing: false, title: null };
  return {
    source: 'spotify',
    playing: !!p.is_playing,
    state: p.is_playing ? 'PLAYING' : 'PAUSED_PLAYBACK',
    title: p.item.name,
    artist: (p.item.artists || []).map((a) => a.name).join(', '),
    album: p.item.album?.name,
    artwork: p.item.album?.images?.[0]?.url || null,
    volume: p.device?.volume_percent ?? null,
    deviceName: p.device?.name || null,
    progressMs: p.progress_ms,
    durationMs: p.item.duration_ms,
  };
}

module.exports = {
  // Sonos
  discoverSonos,
  getSonosPlayers,
  sonosCommand,
  sonosSetVolume,
  sonosNowPlaying,
  // Spotify
  buildAuthUrl,
  exchangeCode,
  spotifyApi,
  normalizeSpotifyPlayback,
  SPOTIFY_REDIRECT_URI: REDIRECT_URI,
};
