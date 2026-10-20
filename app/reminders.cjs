/**
 * Reminders: small things to remember, with or without a time.
 *
 * "Call the dentist", "Permission slip — Friday 8am", "Bins out tonight".
 * Not events — nobody is busy at that time — and not chores — they happen
 * once. Kept in the store as a plain list; the wall shows what's due, and a
 * reminder's time arriving lights the screen and puts it at the top.
 */
const crypto = require('node:crypto');

const MAX_TEXT = 140;
const MAX_REMINDERS = 300;

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/** An ISO time, or null. Anything that isn't a real date is null, not "Invalid Date". */
function cleanDue(due) {
  if (due == null || due === '') return null;
  const t = Date.parse(due);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && typeof r.id === 'string' && cleanText(r.text))
    .map((r) => ({
      id: r.id,
      text: cleanText(r.text),
      due: cleanDue(r.due),
      personId: typeof r.personId === 'string' ? r.personId : null,
      done: !!r.done,
      createdAt: r.createdAt || new Date(0).toISOString(),
      doneAt: r.done ? r.doneAt || null : null,
      source: r.source === 'photo' ? 'photo' : r.source === 'voice' ? 'voice' : 'hand',
    }));
}

/**
 * Due ones first (soonest first), then the undated ones newest first, then
 * the ticked-off ones, most recent first. Ticked-off reminders older than a
 * week drop off, so the list doesn't become an archive.
 */
function sorted(list, now = new Date()) {
  const weekAgo = now.getTime() - 7 * 86400_000;
  const items = normalize(list).filter((r) => !r.done || !r.doneAt || Date.parse(r.doneAt) > weekAgo);
  const open = items.filter((r) => !r.done);
  const dated = open.filter((r) => r.due).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const undated = open.filter((r) => !r.due).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const done = items.filter((r) => r.done).sort((a, b) => Date.parse(b.doneAt || 0) - Date.parse(a.doneAt || 0));
  return [...dated, ...undated, ...done];
}

function add(list, { text, due, personId, source } = {}, now = new Date()) {
  const clean = cleanText(text);
  if (!clean) return { error: 'a reminder needs some words' };
  const current = normalize(list);
  if (current.length >= MAX_REMINDERS) return { error: 'that is a lot of reminders — tick some off first' };
  const reminder = {
    id: crypto.randomUUID(),
    text: clean,
    due: cleanDue(due),
    personId: typeof personId === 'string' && personId ? personId : null,
    done: false,
    createdAt: now.toISOString(),
    doneAt: null,
    source: source === 'photo' || source === 'voice' ? source : 'hand',
  };
  return { list: [...current, reminder], reminder };
}

/** { done } and/or { text, due } — whatever is given changes. */
function update(list, id, changes = {}, now = new Date()) {
  const current = normalize(list);
  const found = current.find((r) => r.id === id);
  if (!found) return { error: 'no such reminder' };
  const next = { ...found };
  if (typeof changes.done === 'boolean') {
    next.done = changes.done;
    next.doneAt = changes.done ? now.toISOString() : null;
  }
  if (changes.text !== undefined) {
    const t = cleanText(changes.text);
    if (!t) return { error: 'a reminder needs some words' };
    next.text = t;
  }
  if (changes.due !== undefined) next.due = cleanDue(changes.due);
  return { list: current.map((r) => (r.id === id ? next : r)), reminder: next };
}

function remove(list, id) {
  return normalize(list).filter((r) => r.id !== id);
}

/** Open reminders whose time has come. */
function due(list, now = new Date()) {
  return normalize(list).filter((r) => !r.done && r.due && Date.parse(r.due) <= now.getTime());
}

/** The next time a reminder falls due, for waking the screen then. */
function nextDue(list, now = new Date()) {
  const upcoming = normalize(list)
    .filter((r) => !r.done && r.due && Date.parse(r.due) > now.getTime())
    .map((r) => Date.parse(r.due));
  return upcoming.length ? Math.min(...upcoming) : null;
}

module.exports = { normalize, sorted, add, update, remove, due, nextDue, MAX_TEXT };
