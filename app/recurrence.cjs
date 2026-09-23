// Repeat expansion for the phone page.
//
// DELIBERATE DUPLICATE of src/engine/recurrence.ts — same rules, same
// occurrence-id format, same exception/override handling. The kiosk runs the
// TypeScript copy in the renderer (it re-expands as you navigate between
// weeks, and a round trip per arrow press would be silly); the phone has no
// build step, so it asks the server.
//
// If you change one, change the other. The end-to-end test in the README's
// "Repeating events" section covers both.

function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addMonthsClamped(d, months) {
  const target = new Date(d);
  const day = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function ruleDates(start, rule, from, to, cap = 500) {
  const interval = Math.max(1, rule.interval ?? 1);
  const until = rule.until ? new Date(`${rule.until}T23:59:59`) : null;
  const hardStop = until && until < to ? until : to;
  const out = [];

  if (rule.freq === 'weekly') {
    const weekdays = rule.byWeekday?.length ? [...rule.byWeekday].sort((a, b) => a - b) : [start.getDay()];
    const weekCursor = new Date(start);
    weekCursor.setDate(weekCursor.getDate() - weekCursor.getDay());
    weekCursor.setHours(0, 0, 0, 0);
    let weekIndex = 0;
    while (weekCursor <= hardStop && out.length < cap) {
      if (weekIndex % interval === 0) {
        for (const wd of weekdays) {
          const d = new Date(weekCursor);
          d.setDate(d.getDate() + wd);
          d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
          if (d >= start && d >= from && d <= hardStop) out.push(d);
        }
      }
      weekCursor.setDate(weekCursor.getDate() + 7);
      weekIndex++;
    }
    return out.sort((a, b) => a - b);
  }

  let cursor = new Date(start);
  let guard = 0;
  while (cursor <= hardStop && guard < cap * 4 && out.length < cap) {
    if (cursor >= from) out.push(new Date(cursor));
    if (rule.freq === 'daily') cursor.setDate(cursor.getDate() + interval);
    else if (rule.freq === 'monthly') cursor = addMonthsClamped(cursor, interval);
    else if (rule.freq === 'yearly') cursor = addMonthsClamped(cursor, 12 * interval);
    else break;
    guard++;
  }
  return out;
}

function expandEvents(events, from, to) {
  const out = [];
  const overrides = new Map();
  for (const e of events) {
    if (e.recurrenceParentId && e.occurrenceDate) overrides.set(`${e.recurrenceParentId}#${e.occurrenceDate}`, e);
  }

  for (const e of events) {
    if (e.recurrenceParentId) {
      const start = new Date(e.start);
      if (start >= from && start <= to) out.push({ ...e, isOccurrence: true });
      continue;
    }
    if (!e.recurrence) {
      out.push(e);
      continue;
    }

    const masterStart = new Date(e.start);
    const durationMs = new Date(e.end).getTime() - masterStart.getTime();
    const skipped = new Set(e.exceptions ?? []);

    for (const date of ruleDates(masterStart, e.recurrence, from, to)) {
      const key = localDateKey(date);
      if (skipped.has(key)) continue;
      if (overrides.has(`${e.id}#${key}`)) continue;
      out.push({
        ...e,
        id: `${e.id}#${key}`,
        start: date.toISOString(),
        end: new Date(date.getTime() + durationMs).toISOString(),
        isOccurrence: true,
        recurrenceParentId: e.id,
        occurrenceDate: key,
      });
    }
  }
  return out.sort((a, b) => new Date(a.start) - new Date(b.start));
}

module.exports = { expandEvents, localDateKey };
