/**
 * Bake Night — one day a week the family bakes something together.
 *
 * The whole feature is two ideas:
 *
 *   1. A weekday. Saturday by default, changeable in Settings.
 *   2. A pick per bake date — the recipe chosen for that particular week.
 *
 * Picks are keyed by the actual date of the bake day (`2026-09-26`), not by
 * "current" and "previous". That one decision buys three things for free:
 * picking ahead for next week works, the week rolls over on its own with no
 * timer and nothing to reset, and the calendar can draw the right recipe on
 * any week that has one — including last month's, if you scroll back.
 *
 * Every function here is pure and works in local time, because "Saturday" on
 * a kitchen wall means the household's Saturday. Date arithmetic in UTC is how
 * you end up baking on Friday night in October when the clocks change.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Local YYYY-MM-DD. Not toISOString(), which converts to UTC first. */
function dateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a YYYY-MM-DD back into local midnight. */
function fromKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

function normalizeWeekday(weekday) {
  const n = Number(weekday);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 6; // Saturday
}

/**
 * The next bake day on or after `from`.
 *
 * Today counts. On bake day itself the card should still say "today we're
 * making banana bread" — not skip ahead to next week the moment midnight
 * passes, which would hide the recipe on the one day it's needed.
 */
function nextBakeDate(weekday, from = new Date()) {
  const target = normalizeWeekday(weekday);
  const start = startOfDay(from);
  const delta = (target - start.getDay() + 7) % 7;
  return addDays(start, delta);
}

/** Every bake day whose date falls in [from, to). Used to draw the calendar. */
function bakeDatesBetween(weekday, from, to) {
  const out = [];
  const end = startOfDay(to).getTime();
  let cursor = nextBakeDate(weekday, from);
  // A year of weeks is the ceiling; the month grid asks for six. This stops a
  // reversed or absurd range from spinning forever.
  for (let i = 0; i < 400 && cursor.getTime() < end; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

/**
 * Tidy a pick before it goes in the store.
 *
 * A pick comes from one of two places and has to survive both: a recipe from
 * the API (an id, a photo, ingredients and steps) or a page someone found in
 * the in-app browser (a URL and whatever the page called itself). The shape
 * below is the intersection plus whichever extras arrived, so the card can
 * show a photo when there is one and a plain link when there isn't.
 */
function normalizePick(input, now = new Date()) {
  const raw = input && typeof input === 'object' ? input : {};
  const title = String(raw.title || '').trim();
  const url = String(raw.url || '').trim();
  const id = String(raw.id || '').trim();

  // Something has to identify it. A pick with no name and no link is a blank
  // card nobody can act on, so it's rejected rather than stored.
  if (!title && !url) return null;
  if (url && !/^https?:\/\//i.test(url)) return null;

  return {
    id: id || (url ? `web:${url}` : `note:${title}`),
    title: title || url,
    image: typeof raw.image === 'string' && /^https?:\/\//i.test(raw.image) ? raw.image : null,
    url: url || null,
    kind: raw.kind === 'web' || (!id && url) ? 'web' : raw.kind || 'food',
    // Copied, not looked up later: the household should still see the
    // ingredients on bake day if the recipe API is down or the site is gone.
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.slice(0, 40).map(String) : [],
    steps: Array.isArray(raw.steps) ? raw.steps.slice(0, 40).map(String) : [],
    note: typeof raw.note === 'string' ? raw.note.slice(0, 400) : '',
    pickedBy: typeof raw.pickedBy === 'string' ? raw.pickedBy.slice(0, 40) : '',
    pickedAt: now.toISOString(),
  };
}

function emptyBake() {
  return { picks: {} };
}

function normalizeBake(bake) {
  if (!bake || typeof bake !== 'object') return emptyBake();
  const picks = bake.picks && typeof bake.picks === 'object' ? bake.picks : {};
  const out = {};
  for (const [key, value] of Object.entries(picks)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && value && typeof value === 'object') out[key] = value;
  }
  return { picks: out };
}

/**
 * Forget picks older than a year.
 *
 * Nobody scrolls the calendar back past last Christmas, and without this the
 * store grows a row a week forever on a machine that is never reinstalled.
 */
function prunePicks(bake, now = new Date()) {
  const cutoff = dateKey(addDays(now, -370));
  const picks = {};
  for (const [key, value] of Object.entries(bake.picks || {})) {
    if (key >= cutoff) picks[key] = value;
  }
  return { picks };
}

/**
 * What the wall screen and the phone both ask for: this week's bake day, what
 * we're making, and the next few weeks so someone can plan ahead.
 */
function summary(bake, weekday, now = new Date(), weeks = 4) {
  const picks = normalizeBake(bake).picks;
  const upcoming = [];
  let cursor = nextBakeDate(weekday, now);

  for (let i = 0; i < weeks; i += 1) {
    const key = dateKey(cursor);
    upcoming.push({
      date: key,
      weekday: cursor.getDay(),
      dayName: DAY_NAMES[cursor.getDay()],
      isToday: key === dateKey(now),
      pick: picks[key] || null,
    });
    cursor = addDays(cursor, 7);
  }

  return {
    weekday: normalizeWeekday(weekday),
    dayName: DAY_NAMES[normalizeWeekday(weekday)],
    next: upcoming[0],
    upcoming,
  };
}

module.exports = {
  DAY_NAMES,
  dateKey,
  fromKey,
  addDays,
  startOfDay,
  normalizeWeekday,
  nextBakeDate,
  bakeDatesBetween,
  normalizePick,
  normalizeBake,
  emptyBake,
  prunePicks,
  summary,
};
