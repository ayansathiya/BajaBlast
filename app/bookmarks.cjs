/**
 * Bookmarks — the household's own list of places on the web.
 *
 * Kept on the server rather than in each browser's own bookmarks, because
 * the whole point is that they're shared: someone saves the school lunch menu
 * from the sofa and it's on the kitchen wall a second later, and on everyone
 * else's phone too. A bookmark saved in Safari would be in exactly one place.
 *
 * Deliberately small. This is a list of links, not a browsing history, not a
 * read-later queue, and not something that needs folders — a kitchen screen
 * with twenty links on it is already past the point of being useful.
 */

const MAX_BOOKMARKS = 60;

/**
 * Accept only what can actually be opened.
 *
 * http and https and nothing else: a kiosk that will open any URL it is
 * handed is a kiosk that will open `file:///` and read the disk, or
 * `javascript:` and run whatever the last person typed. Both are reachable
 * from the phone page by anyone on the Wi-Fi, so this is the boundary.
 */
function safeUrl(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

/** What to call a bookmark when nobody gave it a name: its site. */
function titleFor(url, given) {
  const title = String(given || '').trim();
  if (title) return title.slice(0, 120);
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalize(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const url = safeUrl(raw.url);
    if (!url) continue;
    // One entry per address. Saving the same page twice is always a mistake,
    // and a list with the same link three times looks broken.
    if (seen.has(url)) continue;
    seen.add(url);

    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : url,
      url,
      title: titleFor(url, raw.title),
      addedBy: typeof raw.addedBy === 'string' ? raw.addedBy.slice(0, 40) : '',
      addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString(),
    });
  }

  return out.slice(0, MAX_BOOKMARKS);
}

/**
 * Add one, or move it to the front if it's already there.
 *
 * Re-saving a page you already have is how people say "this one matters" —
 * so it rises rather than being rejected with an error nobody wants to read.
 */
function add(list, { url, title, addedBy }, now = new Date()) {
  const clean = safeUrl(url);
  if (!clean) return { error: 'that is not a web address' };

  const existing = normalize(list).filter((b) => b.url !== clean);
  const bookmark = {
    id: clean,
    url: clean,
    title: titleFor(clean, title),
    addedBy: String(addedBy || '').slice(0, 40),
    addedAt: now.toISOString(),
  };

  return { list: [bookmark, ...existing].slice(0, MAX_BOOKMARKS), bookmark };
}

function remove(list, id) {
  const target = String(id || '');
  return normalize(list).filter((b) => b.id !== target && b.url !== target);
}

module.exports = { normalize, add, remove, safeUrl, titleFor, MAX_BOOKMARKS };
