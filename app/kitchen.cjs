/**
 * The kitchen itself: timers, the week's dinners, and notes on the wall.
 *
 * Three small things that share one property — they're what a family actually
 * does standing at a counter — and one rule about where they live: on the
 * server, not in a browser. A timer started from a phone has to ring on the
 * wall; a dinner planned from the sofa has to be on the screen before anyone
 * walks back in; a note left at 7am has to be there when the kids come down.
 *
 * Every function here is pure and takes `now`, so the tests can stand at any
 * moment they like without waiting for a clock.
 */

const crypto = require('node:crypto');

/* ------------------------------------------------------------------ *
 * Timers
 * ------------------------------------------------------------------ *
 *
 * A running timer stores the moment it ends, not how long is left. That one
 * choice is what makes it survive everything a kitchen display goes through:
 * the server restarting for an update, the screen reloading at midnight, a
 * phone locking and unlocking. Every client works out the countdown from
 * `endsAt` on its own, so nothing has to tick on the server and nothing drifts.
 *
 * Paused is the exception — a paused timer has no end — so it keeps
 * `remainingMs` instead, and gets a fresh `endsAt` when it resumes.
 */

const MAX_TIMERS = 8;
const MIN_SECONDS = 5;
const MAX_SECONDS = 12 * 60 * 60;
// A finished timer rings until someone dismisses it, but not forever: nobody
// wants to come home to "pasta" flashing from lunchtime.
const RING_LIMIT_MS = 15 * 60 * 1000;

function clampSeconds(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < MIN_SECONDS) return null;
  return Math.min(n, MAX_SECONDS);
}

function cleanLabel(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return text || fallback;
}

/** "10 min", "1 h 30 min", "45 s" — the name a timer gets when nobody gives one. */
function describeDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  if (m && s) return `${m} min ${s} s`;
  if (m) return `${m} min`;
  return `${s} s`;
}

function normalizeTimer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const durationMs = Number(raw.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const paused = raw.remainingMs != null && Number.isFinite(Number(raw.remainingMs));
  const endsAt = typeof raw.endsAt === 'string' && !Number.isNaN(Date.parse(raw.endsAt)) ? raw.endsAt : null;
  if (!paused && !endsAt) return null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    label: cleanLabel(raw.label, describeDuration(Math.round(durationMs / 1000))),
    durationMs,
    endsAt: paused ? null : endsAt,
    remainingMs: paused ? Math.max(0, Number(raw.remainingMs)) : null,
    startedBy: typeof raw.startedBy === 'string' ? raw.startedBy.slice(0, 40) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
  };
}

/**
 * Tidy the list: drop anything malformed, and anything that finished ringing
 * so long ago that nobody is coming back for it.
 */
function normalizeTimers(list, now = new Date()) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const t = normalizeTimer(raw);
    if (!t) continue;
    if (t.endsAt && now.getTime() - Date.parse(t.endsAt) > RING_LIMIT_MS) continue;
    out.push(t);
  }
  return out.slice(0, MAX_TIMERS);
}

function startTimer(list, { label, seconds, startedBy } = {}, now = new Date()) {
  const secs = clampSeconds(seconds);
  if (!secs) return { error: `a timer needs at least ${MIN_SECONDS} seconds` };
  const current = normalizeTimers(list, now);
  if (current.length >= MAX_TIMERS) return { error: `that's ${MAX_TIMERS} timers already — dismiss one first` };

  const timer = {
    id: crypto.randomUUID(),
    label: cleanLabel(label, describeDuration(secs)),
    durationMs: secs * 1000,
    endsAt: new Date(now.getTime() + secs * 1000).toISOString(),
    remainingMs: null,
    startedBy: String(startedBy || '').slice(0, 40),
    createdAt: now.toISOString(),
  };
  return { list: [...current, timer], timer };
}

/** How much is left, in ms. Negative once it has gone off. */
function remainingMs(timer, now = new Date()) {
  if (timer.remainingMs != null) return timer.remainingMs;
  return Date.parse(timer.endsAt) - now.getTime();
}

/**
 * pause · resume · add (seconds, may be negative) · dismiss.
 *
 * Adding time to a timer that has already gone off restarts it from now —
 * "one more minute" said to a ringing oven timer means one more minute from
 * this moment, not a minute after it rang.
 */
function actOnTimer(list, id, action, { seconds } = {}, now = new Date()) {
  const current = normalizeTimers(list, now);
  const timer = current.find((t) => t.id === id);
  if (!timer) return { error: 'no such timer' };

  if (action === 'dismiss') {
    return { list: current.filter((t) => t.id !== id) };
  }

  let next;
  if (action === 'pause') {
    if (timer.remainingMs != null) return { list: current, timer };
    const left = remainingMs(timer, now);
    if (left <= 0) return { list: current, timer }; // already ringing; pausing means nothing
    next = { ...timer, endsAt: null, remainingMs: left };
  } else if (action === 'resume') {
    if (timer.remainingMs == null) return { list: current, timer };
    next = { ...timer, endsAt: new Date(now.getTime() + timer.remainingMs).toISOString(), remainingMs: null };
  } else if (action === 'add') {
    const delta = Math.round(Number(seconds)) * 1000;
    if (!Number.isFinite(delta) || delta === 0) return { error: 'add how much?' };
    const base = Math.max(0, remainingMs(timer, now));
    const left = Math.min(Math.max(base + delta, 1000), MAX_SECONDS * 1000);
    next =
      timer.remainingMs != null
        ? { ...timer, remainingMs: left, durationMs: Math.max(timer.durationMs, left) }
        : { ...timer, endsAt: new Date(now.getTime() + left).toISOString(), durationMs: Math.max(timer.durationMs, left) };
  } else {
    return { error: 'unknown action' };
  }

  return { list: current.map((t) => (t.id === id ? next : t)), timer: next };
}

/* ------------------------------------------------------------------ *
 * Meals — what's for dinner, each night of the week
 * ------------------------------------------------------------------ *
 *
 * Same shape of idea as Bake Night: keyed by the real local date, so the week
 * rolls over by itself and planning next Tuesday is no different from
 * planning tonight. A meal copies its ingredients at the moment it's chosen,
 * for the same reason a bake pick does.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeMeal(input, now = new Date()) {
  const raw = input && typeof input === 'object' ? input : {};
  const title = String(raw.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) return null;
  const url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url.trim()) ? raw.url.trim() : null;
  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients.map((s) => String(s).trim()).filter(Boolean).slice(0, 40)
    : [];

  return {
    title,
    url,
    image: typeof raw.image === 'string' && /^https?:\/\//i.test(raw.image) ? raw.image : null,
    ingredients,
    note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '',
    cook: typeof raw.cook === 'string' ? raw.cook.slice(0, 40) : '',
    plannedAt: typeof raw.plannedAt === 'string' ? raw.plannedAt : now.toISOString(),
  };
}

function normalizeMeals(meals) {
  const out = {};
  if (!meals || typeof meals !== 'object' || Array.isArray(meals)) return out;
  for (const [key, value] of Object.entries(meals)) {
    if (!DATE_KEY.test(key)) continue;
    const meal = normalizeMeal(value);
    if (meal) out[key] = { ...meal, plannedAt: value.plannedAt || meal.plannedAt };
  }
  return out;
}

/** Forget dinners older than two months. Nobody scrolls back to plan those. */
function pruneMeals(meals, now = new Date()) {
  const cutoff = dateKey(addDays(now, -62));
  const out = {};
  for (const [key, value] of Object.entries(normalizeMeals(meals))) {
    if (key >= cutoff) out[key] = value;
  }
  return out;
}

/** Today and the six nights after it, planned or not — the week the screen shows. */
function mealWeek(meals, now = new Date(), days = 7) {
  const clean = normalizeMeals(meals);
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = addDays(now, i);
    const key = dateKey(d);
    out.push({ date: key, weekday: d.getDay(), isToday: i === 0, meal: clean[key] || null });
  }
  return out;
}

/**
 * Which ingredients aren't already on the grocery list.
 *
 * "Add to grocery list" pressed twice, or for two dinners that both need
 * onions, shouldn't put onions on the list twice. Compared loosely — case and
 * spacing — because "Onions" and "onions " are the same thing at the shop.
 */
function missingFromGrocery(ingredients, grocery) {
  const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const have = new Set((Array.isArray(grocery) ? grocery : []).filter((g) => g && !g.done).map((g) => key(g.label)));
  const out = [];
  for (const item of ingredients || []) {
    const k = key(item);
    if (!k || have.has(k)) continue;
    have.add(k);
    out.push(String(item).trim());
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Notes — the fridge door
 * ------------------------------------------------------------------ *
 *
 * Short, and they expire. A note board that keeps everything becomes a wall of
 * things nobody reads any more, which is exactly what a fridge door turns into.
 * The default is three days; "until someone clears it" is allowed but has to
 * be asked for.
 */

const MAX_NOTES = 12;
const MAX_NOTE_LENGTH = 200;
const NOTE_LIFETIMES = { day: 1, '3days': 3, week: 7, keep: null };

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    text,
    from: typeof raw.from === 'string' ? raw.from.replace(/\s+/g, ' ').trim().slice(0, 30) : '',
    personId: typeof raw.personId === 'string' ? raw.personId.slice(0, 60) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    expiresAt: typeof raw.expiresAt === 'string' && !Number.isNaN(Date.parse(raw.expiresAt)) ? raw.expiresAt : null,
  };
}

function normalizeNotes(list, now = new Date()) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const n = normalizeNote(raw);
    if (!n) continue;
    if (n.expiresAt && Date.parse(n.expiresAt) <= now.getTime()) continue;
    out.push(n);
  }
  // Newest first: the wall has room for a few, and the latest is the one
  // somebody walked over to read.
  out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return out.slice(0, MAX_NOTES);
}

function addNote(list, { text, from, personId, lasts } = {}, now = new Date()) {
  const lifetime = Object.prototype.hasOwnProperty.call(NOTE_LIFETIMES, lasts) ? NOTE_LIFETIMES[lasts] : NOTE_LIFETIMES['3days'];
  const note = normalizeNote({
    id: crypto.randomUUID(),
    text,
    from,
    personId,
    createdAt: now.toISOString(),
    expiresAt: lifetime == null ? null : new Date(now.getTime() + lifetime * 86400000).toISOString(),
  });
  if (!note) return { error: 'a note needs some words' };
  // The oldest falls off the end rather than the new one being refused: the
  // person posting now is the one who's here.
  return { list: normalizeNotes([note, ...(Array.isArray(list) ? list : [])], now), note };
}

function removeNote(list, id, now = new Date()) {
  return normalizeNotes(list, now).filter((n) => n.id !== String(id || ''));
}

module.exports = {
  // timers
  MAX_TIMERS,
  MIN_SECONDS,
  MAX_SECONDS,
  RING_LIMIT_MS,
  describeDuration,
  normalizeTimers,
  startTimer,
  actOnTimer,
  remainingMs,
  // meals
  dateKey,
  normalizeMeal,
  normalizeMeals,
  pruneMeals,
  mealWeek,
  missingFromGrocery,
  // notes
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  NOTE_LIFETIMES,
  normalizeNotes,
  addNote,
  removeNote,
};
