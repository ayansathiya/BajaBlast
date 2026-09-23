import { CalendarEvent } from '../data/models';

export type ViewMode = 'day' | 'week' | 'month';

/**
 * How far the arrows will take you.
 *
 * A year back for looking things up, and through the end of the year after
 * next for planning. Both are computed from today, so the horizon moves on
 * its own — in 2026 it reaches the end of 2028, and on New Year's Day 2027 it
 * silently becomes 2029. Nothing to update, no date baked into the code.
 */
export function navigationBounds(now: Date): { min: Date; max: Date } {
  return {
    min: new Date(now.getFullYear() - 1, 0, 1),
    max: new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59),
  };
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Weeks run Sunday→Saturday, matching how the month grid reads. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** The 7-column grid a month is drawn on: whole weeks, so it starts on a Sunday. */
export function monthGridStart(d: Date): Date {
  return startOfWeek(startOfMonth(d));
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Step the anchor one unit in the current view, clamped to the bounds. */
export function stepAnchor(anchor: Date, mode: ViewMode, direction: 1 | -1, now: Date): Date {
  const next = new Date(anchor);
  if (mode === 'day') next.setDate(next.getDate() + direction);
  else if (mode === 'week') next.setDate(next.getDate() + 7 * direction);
  else next.setMonth(next.getMonth() + direction);

  const { min, max } = navigationBounds(now);
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

export function canStep(anchor: Date, mode: ViewMode, direction: 1 | -1, now: Date): boolean {
  const next = stepAnchor(anchor, mode, direction, now);
  return next.getTime() !== anchor.getTime();
}

/** Events that touch a given day, earliest first. */
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const from = startOfDay(day).getTime();
  const to = from + 24 * 3600 * 1000;
  return events
    .filter((e) => {
      const start = new Date(e.start).getTime();
      const end = new Date(e.end).getTime();
      // Overlap, not just "starts today" — a multi-day trip should appear on
      // every day it covers.
      return start < to && end > from;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** The label above the view: "Today", "Sep 7 – 13", "September 2026". */
export function rangeLabel(anchor: Date, mode: ViewMode, now: Date): string {
  if (mode === 'day') {
    if (isSameDate(anchor, now)) return 'Today';
    if (isSameDate(anchor, addDays(now, 1))) return 'Tomorrow';
    if (isSameDate(anchor, addDays(now, -1))) return 'Yesterday';
    return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  if (mode === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    const sameMonth = from.getMonth() === to.getMonth();
    const left = from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const right = to.toLocaleDateString(
      undefined,
      sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' }
    );
    const year = from.getFullYear() === now.getFullYear() ? '' : ` ${from.getFullYear()}`;
    return `${left} – ${right}${year}`;
  }
  return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
