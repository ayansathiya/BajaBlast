// ---------------------------------------------------------------------------
// Live data: weather, news, stocks.
//
// This all runs in the server process (Node), not the browser, on
// purpose. Browsers block cross-origin requests to these providers; Node
// doesn't. So the kiosk and the phone both just hit our own local server,
// and this file is the only thing that talks to the outside world.
//
// Every source here is free and needs no signup, no API key, no account:
//   - Weather  : Open-Meteo          (open-meteo.com)
//   - News     : public RSS feeds    (BBC, NPR, CNBC, Ars Technica)
//   - Stocks   : Yahoo Finance chart endpoint, with Stooq CSV as a fallback
//
// Everything is cached and served stale-on-error, so a flaky kitchen WiFi
// degrades to "slightly old numbers" instead of a blank rail. If a source
// has NEVER succeeded, we return null/[] rather than inventing numbers —
// the UI shows an honest "unavailable" line instead of fake data.
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function fetchWithTimeout(url, ms = 9000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...extraHeaders },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Simple time-based cache with stale-on-error semantics. */
function makeCache(ttlMs, loader) {
  let value = null;
  let fetchedAt = 0;
  let inFlight = null;

  return async function get(...args) {
    const fresh = value !== null && Date.now() - fetchedAt < ttlMs;
    if (fresh) return { value, fetchedAt, stale: false };
    if (inFlight) {
      await inFlight.catch(() => {});
      return { value, fetchedAt, stale: value !== null && Date.now() - fetchedAt >= ttlMs };
    }
    inFlight = (async () => {
      const next = await loader(...args);
      value = next;
      fetchedAt = Date.now();
    })();
    try {
      await inFlight;
    } catch {
      // Keep whatever we had. Never throw upward — a dead feed must not
      // take the rest of the rail down with it.
    } finally {
      inFlight = null;
    }
    return { value, fetchedAt, stale: false };
  };
}

// ---------------------------------------------------------------------------
// Weather — Open-Meteo
// ---------------------------------------------------------------------------

// WMO weather interpretation codes -> our icon set + a human label.
const WMO = {
  0: ['sun', 'Clear'],
  1: ['sun', 'Mostly Clear'],
  2: ['partly', 'Partly Cloudy'],
  3: ['cloud', 'Overcast'],
  45: ['cloud', 'Fog'],
  48: ['cloud', 'Freezing Fog'],
  51: ['rain', 'Light Drizzle'],
  53: ['rain', 'Drizzle'],
  55: ['rain', 'Heavy Drizzle'],
  56: ['rain', 'Freezing Drizzle'],
  57: ['rain', 'Freezing Drizzle'],
  61: ['rain', 'Light Rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy Rain'],
  66: ['rain', 'Freezing Rain'],
  67: ['rain', 'Freezing Rain'],
  71: ['snow', 'Light Snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy Snow'],
  77: ['snow', 'Snow Grains'],
  80: ['rain', 'Rain Showers'],
  81: ['rain', 'Rain Showers'],
  82: ['rain', 'Heavy Showers'],
  85: ['snow', 'Snow Showers'],
  86: ['snow', 'Snow Showers'],
  95: ['storm', 'Thunderstorms'],
  96: ['storm', 'Thunderstorms'],
  99: ['storm', 'Severe Storms'],
};

function decodeWmo(code) {
  return WMO[code] || ['partly', 'Unsettled'];
}

async function loadWeather(lat, lon) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code' +
    '&hourly=temperature_2m,precipitation_probability,weather_code' +
    '&daily=sunrise,sunset' +
    '&temperature_unit=fahrenheit&timezone=auto&forecast_days=2';

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const d = await res.json();

  const [icon, condition] = decodeWmo(d.current?.weather_code);
  const nowMs = Date.now();

  // Open-Meteo returns local-time strings without a zone suffix ("2026-09-08T14:00").
  // new Date() parses those as local time, which is exactly what we want on a
  // kiosk that only ever displays its own timezone.
  const hourly = [];
  const times = d.hourly?.time || [];
  for (let i = 0; i < times.length && hourly.length < 12; i++) {
    const t = new Date(times[i]);
    if (t.getTime() < nowMs - 30 * 60 * 1000) continue;
    hourly.push({
      time: t.toISOString(),
      tempF: d.hourly.temperature_2m[i],
      precipChance: (d.hourly.precipitation_probability?.[i] ?? 0) / 100,
      icon: decodeWmo(d.hourly.weather_code?.[i])[0],
    });
  }

  return {
    now: {
      tempF: d.current?.temperature_2m ?? 0,
      condition,
      icon,
      sunrise: new Date(d.daily?.sunrise?.[0] || nowMs).toISOString(),
      sunset: new Date(d.daily?.sunset?.[0] || nowMs).toISOString(),
    },
    hourly,
    fetchedAt: new Date().toISOString(),
  };
}

// Keyed by "lat,lon" so changing the home location doesn't serve the old city.
const weatherCaches = new Map();
function getWeather(lat, lon) {
  const key = `${lat},${lon}`;
  if (!weatherCaches.has(key)) {
    weatherCaches.set(key, makeCache(10 * 60 * 1000, () => loadWeather(lat, lon)));
  }
  return weatherCaches.get(key)();
}

// ---------------------------------------------------------------------------
// News — plain RSS, parsed without a dependency
// ---------------------------------------------------------------------------

const FEEDS = [
  { source: 'BBC', category: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'NPR', category: 'world', url: 'https://feeds.npr.org/1001/rss.xml' },
  { source: 'CNBC', category: 'business', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' },
  { source: 'Ars Technica', category: 'tech', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml, feed, limit = 6) {
  const items = [];
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const block of blocks.slice(0, limit)) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    if (!titleMatch) continue;
    const headline = decodeEntities(titleMatch[1]);
    if (!headline) continue;
    const dateMatch = /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i.exec(block);
    const published = dateMatch ? new Date(decodeEntities(dateMatch[1])) : new Date();
    items.push({
      id: `${feed.source}-${headline.slice(0, 60)}`,
      source: feed.source,
      headline,
      category: feed.category,
      publishedAt: (isNaN(published.getTime()) ? new Date() : published).toISOString(),
    });
  }
  return items;
}

async function loadNews() {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const res = await fetchWithTimeout(feed.url, 8000);
      if (!res.ok) throw new Error(`${feed.source} ${res.status}`);
      return parseRss(await res.text(), feed);
    })
  );

  const perFeed = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
  if (perFeed.every((f) => f.length === 0)) throw new Error('all news feeds failed');

  // Interleave so the rail never shows four BBC headlines in a row — one
  // from each source, then the next from each, and so on.
  const merged = [];
  for (let round = 0; round < 6; round++) {
    for (const feedItems of perFeed) {
      if (feedItems[round]) merged.push(feedItems[round]);
    }
  }
  return merged.slice(0, 12);
}

const newsCache = makeCache(12 * 60 * 1000, loadNews);

// ---------------------------------------------------------------------------
// Stocks — Yahoo Finance chart endpoint, Stooq CSV as fallback
// ---------------------------------------------------------------------------

const NAME_HINTS = {
  AAPL: 'Apple',
  NVDA: 'NVIDIA',
  MSFT: 'Microsoft',
  TSLA: 'Tesla',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  META: 'Meta',
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
  'BTC-USD': 'Bitcoin',
};

// Yahoo answers a plain client and turns away one dressed as a browser:
// since early October 2026 the Chrome-like UA above gets 429 "Too Many
// Requests" on every call, which left the ticker saying "Market data
// unavailable" all day. Two hosts, because one is sometimes throttled when
// the other isn't.
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function yahooJson(pathAndQuery) {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetchWithTimeout(`https://${host}${pathAndQuery}`, 8000, YAHOO_HEADERS);
      if (!res.ok) throw new Error(`yahoo ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function quoteFrom(meta, symbol) {
  if (!meta) return null;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  if (typeof price !== 'number' || typeof prev !== 'number' || prev === 0) return null;
  const sym = (meta.symbol || symbol).toUpperCase();
  return {
    symbol: sym,
    name: meta.shortName || NAME_HINTS[sym] || sym,
    price,
    changePct: ((price - prev) / prev) * 100,
  };
}

async function yahooQuote(symbol) {
  const data = await yahooJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
  const quote = quoteFrom(data?.chart?.result?.[0]?.meta, symbol);
  if (!quote) throw new Error('yahoo shape');
  return quote;
}

// The fallback: every symbol in one request. (It used to be Stooq's CSV
// download, which Stooq has since taken down.)
async function yahooSpark(symbols) {
  const data = await yahooJson(`/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=1d`);
  const out = (data?.spark?.result || [])
    .map((r) => quoteFrom(r?.response?.[0]?.meta, r?.symbol || ''))
    .filter(Boolean);
  if (out.length === 0) throw new Error('spark empty');
  return out;
}

async function loadStocks(symbols) {
  const settled = await Promise.allSettled(symbols.map(yahooQuote));
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (ok.length === symbols.length) return ok;
  // Some or all refused — one request for the lot before giving up.
  const spark = await yahooSpark(symbols).catch(() => []);
  const merged = new Map([...spark, ...ok].map((q) => [q.symbol, q]));
  if (merged.size === 0) throw new Error('no market data');
  return [...merged.values()];
}

const stockCaches = new Map();
function getStocks(symbols) {
  const key = symbols.join(',');
  if (!stockCaches.has(key)) {
    stockCaches.set(key, makeCache(5 * 60 * 1000, () => loadStocks(symbols)));
  }
  return stockCaches.get(key)();
}

module.exports = { getWeather, getNews: () => newsCache(), getStocks };
