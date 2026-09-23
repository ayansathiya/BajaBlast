import { CalendarEvent, RecurrenceRule } from '../data/models';

/**
 * Repeating events, expanded on read.
 *
 * The store keeps one master event with a rule on it, never a row per
 * occurrence. A weekly piano lesson running to the end of 2028 is one record,
 * not 120 — which matters when the whole store is rewritten to disk on every
 * grocery tap.
 *
 * Two escape hatches make "edit just this one" work without giving that up:
 *
 *   - `exceptions`: dates the master skips. Deleting one occurrence, or
 *     moving it, adds its date here.
 *   - override events: ordinary events carrying `recurrenceParentId` and
 *     `occurrenceDate`. They live alongside everything else, so a moved
 *     occurrence is just an event — no special case anywhere downstream.
 *
 * Occurrence ids are `masterId#YYYY-MM-DD`, which is stable across reloads
 * and tells you both halves of what you're looking at.
 */

export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function occurrenceId(masterId: string, date: Date): string {
  return `${masterId}#${localDateKey(date)}`;
}

/** Splits an occurrence id back into its parts. */
export function parseOccurrenceId(id: string): { masterId: string; date: string | null } {
  const hash = id.indexOf('#');
  if (hash === -1) return { masterId: id, date: null };
  return { masterId: id.slice(0, hash), date: id.slice(hash + 1) };
}

function addMonthsClamped(d: Date, months: number): Date {
  // "The 31st, monthly" has to mean something in February. Clamp to the last
  // day of the target month rather than rolling into March, which is what
  // naive setMonth does and always reads as a bug.
  const target = new Date(d);
  const day = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/**
 * Every start date this rule produces between `from` and `to`.
 * Capped so a malformed rule can't spin forever.
 */
function ruleDates(start: Date, rule: RecurrenceRule, from: Date, to: Date, cap = 500): Date[] {
  const interval = Math.max(1, rule.interval ?? 1);
  const until = rule.until ? new Date(`${rule.until}T23:59:59`) : null;
  const hardStop = until && until < to ? until : to;
  const out: Date[] = [];

  if (rule.freq === 'weekly') {
    // byWeekday lets one rule cover "Tuesdays and Thursdays". With none
    // given, it repeats on the weekday the event itself starts on.
    const weekdays = rule.byWeekday?.length ? [...rule.byWeekday].sort((a, b) => a - b) : [start.getDay()];

    // Walk whole weeks from the start's week, honouring `interval`.
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
    return out.sort((a, b) => a.getTime() - b.getTime());
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

/**
 * Turn the stored events into the ones to display between two dates.
 *
 * Non-repeating events pass straight through. A master with a rule becomes
 * one event per occurrence, minus its exceptions. Overrides are emitted as
 * themselves, so a moved lesson shows at its new time.
 */
export function expandEvents(events: CalendarEvent[], from: Date, to: Date): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const overrides = new Map<string, CalendarEvent>();

  for (const e of events) {
    if (e.recurrenceParentId && e.occurrenceDate) {
      overrides.set(`${e.recurrenceParentId}#${e.occurrenceDate}`, e);
    }
  }

  for (const e of events) {
    // Overrides are emitted when their own window is reached, below.
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
      // A moved or edited occurrence replaces the generated one.
      if (overrides.has(`${e.id}#${key}`)) continue;

      out.push({
        ...e,
        id: occurrenceId(e.id, date),
        start: date.toISOString(),
        end: new Date(date.getTime() + durationMs).toISOString(),
        isOccurrence: true,
        recurrenceParentId: e.id,
        occurrenceDate: key,
      });
    }
  }

  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** A plain-English summary of a rule, for the event list. */
export function describeRecurrence(rule: RecurrenceRule | undefined): string | null {
  if (!rule) return null;
  const every = rule.interval && rule.interval > 1 ? `every ${rule.interval} ` : '';
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

  let base: string;
  if (rule.freq === 'daily') base = every ? `Every ${rule.interval} days` : 'Every day';
  else if (rule.freq === 'weekly') {
    base = rule.byWeekday?.length
      ? `${every ? `Every ${rule.interval} weeks on ` : ''}${rule.byWeekday.map((d) => days[d]).join(', ')}`
      : `${every ? `Every ${rule.interval} weeks` : 'Every week'}`;
  } else if (rule.freq === 'monthly') base = every ? `Every ${rule.interval} months` : 'Every month';
  else base = every ? `Every ${rule.interval} years` : 'Every year';

  if (rule.until) {
    const end = new Date(`${rule.until}T00:00:00`);
    return `${base}, until ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return base;
}

/** One series, folded down to its next occurrence. */
export interface CollapsedEvent {
  /** The next occurrence — a normal event, safe to render anywhere. */
  event: CalendarEvent;
  /** How many further occurrences fall inside the window being shown. */
  moreCount: number;
}

/**
 * Fold repeating events down to one row each.
 *
 * Expanding a weekly class across a sixty-day window produces eight or nine
 * identical-looking rows. On a month grid that's correct — that's what a
 * calendar IS. In a *list* it's noise: the events list becomes forty rows of
 * the same five things, and "Coming up" shows piano, piano, piano instead of
 * the next three things that are actually different.
 *
 * So lists get the next occurrence of each series plus a count of the rest,
 * and grids keep every occurrence. Same data, two presentations, and the rule
 * for which is which is simply whether the dates are already laid out on the
 * page.
 *
 * Order is preserved: series sort by the date of the occurrence that survives,
 * which is the one being shown.
 */
export function collapseSeries(events: CalendarEvent[]): CollapsedEvent[] {
  const byStart = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // A one-off is its own series. An occurrence belongs to the master it came
  // from — and an override event, which has its own id but the same parent,
  // has to land in the same bucket or an edited week shows up twice.
  const seen = new Map<string, CollapsedEvent>();

  for (const event of byStart) {
    const key = event.recurrenceParentId ?? event.id;
    const already = seen.get(key);
    if (already) already.moreCount += 1;
    else seen.set(key, { event, moreCount: 0 });
  }

  return [...seen.values()].sort(
    (a, b) => new Date(a.event.start).getTime() - new Date(b.event.start).getTime(),
  );
}

/** The same, when you only want the events and not the counts. */
export function nextPerSeries(events: CalendarEvent[]): CalendarEvent[] {
  return collapseSeries(events).map((c) => c.event);
}
