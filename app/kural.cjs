/**
 * A Thirukkural a day.
 *
 * All 1,330 couplets, in order, one per day: the first day this shipped is
 * Kural 1, the next day Kural 2, and after Kural 1330 it starts again. In
 * order rather than at random so the household reads the book the way it's
 * written — ten couplets to a chapter — instead of dipping in.
 *
 * The text, transliteration and English meaning come from
 * https://github.com/tk120404/thirukkural (Apache-2.0), trimmed to the fields
 * the wall shows; see thirukkural.json.
 */
const fs = require('node:fs');
const path = require('node:path');

// 5 October 2026: Kural 1.
const EPOCH = Date.UTC(2026, 9, 5);
const DAY = 86_400_000;

let kurals = null;
function all() {
  if (!kurals) {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'thirukkural.json'), 'utf8'));
    kurals = data.kural;
  }
  return kurals;
}

/** "2026-10-05" → the kural for that (local) day. */
function forDay(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey || '');
  if (!m) return null;
  const list = all();
  const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / DAY);
  const index = ((days % list.length) + list.length) % list.length;
  return byNumber(index + 1);
}

function byNumber(n) {
  const row = all()[n - 1];
  if (!row) return null;
  const [num, tamil1, tamil2, translit1, translit2, meaning] = row;
  return {
    n: num,
    // Ten to a chapter, and three books: virtue, wealth, love.
    chapter: Math.ceil(num / 10),
    book: num <= 380 ? 'Aram · Virtue' : num <= 1080 ? 'Porul · Wealth' : 'Inbam · Love',
    tamil: [tamil1, tamil2],
    transliteration: [translit1, translit2],
    meaning,
  };
}

module.exports = { forDay, byNumber };
