import { BakePick, BakeSummary, CalendarEvent } from '../data/models';

/**
 * Bake Night, as the calendar sees it.
 *
 * The server owns the picks; this turns them into events the day, week and
 * month views can draw without knowing anything about recipes.
 *
 * These are synthesised on every render rather than written into the store as
 * a repeating event, and that's the point: change the bake day from Saturday
 * to Sunday in Settings and every week moves at once, including the ones
 * already on screen. A stored recurring event would have needed its rule
 * rewritten, its past occurrences left alone, and its exceptions reconciled —
 * for something the household never edits directly anyway.
 */

export interface BakeState extends BakeSummary {
  enabled: boolean;
  label: string;
  time: string;
  durationMinutes: number;
  /** Local YYYY-MM-DD → what we're making that week. */
  picks: Record<string, BakePick>;
}

export const BAKE_CALENDAR_ID = 'bake-night';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local YYYY-MM-DD. Deliberately not toISOString(), which shifts to UTC. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** The next bake day on or after `from`. Today counts — see app/bake.cjs. */
export function nextBakeDate(weekday: number, from: Date = new Date()): Date {
  const start = startOfDay(from);
  const delta = (weekday - start.getDay() + 7) % 7;
  return addDays(start, delta);
}

export function bakeDatesBetween(weekday: number, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const end = startOfDay(to).getTime();
  let cursor = nextBakeDate(weekday, from);
  for (let i = 0; i < 400 && cursor.getTime() < end; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

function at(day: Date, time: string): Date {
  const [h, m] = String(time || '16:00')
    .split(':')
    .map(Number);
  const out = new Date(day);
  out.setHours(Number.isFinite(h) ? h : 16, Number.isFinite(m) ? m : 0, 0, 0);
  return out;
}

/**
 * One event per bake day in the window.
 *
 * A week with nothing picked still gets an event, and that's deliberate: the
 * empty slot on the calendar is the reminder to go and choose something. A
 * blank Saturday would just look like an ordinary Saturday.
 *
 * Past weeks are the exception — see the filter below.
 */
export function bakeEvents(state: BakeState | null, from: Date, to: Date, now: Date = new Date()): CalendarEvent[] {
  if (!state || !state.enabled) return [];
  const today = dateKey(startOfDay(now));

  return bakeDatesBetween(state.weekday, from, to)
    .filter((day) => {
      // A Saturday that has already been and gone with nothing chosen is just
      // a Saturday. Scrolling back through months of "pick a recipe" for weeks
      // nobody can pick for any more is clutter, and faintly accusatory.
      return dateKey(day) >= today || !!state.picks?.[dateKey(day)];
    })
    .map((day) => {
      const key = dateKey(day);
      const pick = state.picks?.[key] ?? null;
      const start = at(day, state.time);
      const end = new Date(start.getTime() + (state.durationMinutes || 90) * 60 * 1000);

      return {
        id: `bake:${key}`,
        title: pick ? `${state.label}: ${pick.title}` : `${state.label} — pick a recipe`,
        start: start.toISOString(),
        end: end.toISOString(),
        calendarId: BAKE_CALENDAR_ID,
        category: 'meal',
        // 1, not 0: it should survive the "what's coming up" filter, which drops
        // routine same-day items. It should not outrank a dentist appointment.
        importance: 1,
        description: pick
          ? pick.ingredients.slice(0, 3).join(' · ') || undefined
          : 'Nobody has chosen this week’s bake yet',
        // Nobody's in particular — it's the whole household, so it survives the
        // per-person filters the way an unassigned event does.
        personIds: [],
      } as CalendarEvent;
    });
}

/** Is this one of ours? Used to route a tap to the recipe instead of the editor. */
export function isBakeEvent(event: { id?: string; calendarId?: string }): boolean {
  return event.calendarId === BAKE_CALENDAR_ID || String(event.id || '').startsWith('bake:');
}

/** The date key inside a bake event's id, for looking the pick back up. */
export function bakeEventDate(event: { id?: string }): string | null {
  const match = /^bake:(\d{4}-\d{2}-\d{2})$/.exec(String(event.id || ''));
  return match ? match[1] : null;
}

/**
 * The same date after a verb: "make this **on Saturday**".
 *
 * Separate from bakeWhen because that one is written to stand alone in a
 * label ("this Saturday"), and dropping it into a sentence produces "Make
 * this this Saturday".
 */
export function bakeWhenPhrase(dateStr: string, dayName: string, now: Date = new Date()): string {
  const plain = bakeWhen(dateStr, dayName, now);
  return plain === 'today' || plain === 'tomorrow' ? plain : `on ${plain.replace(/^this /, '')}`;
}

/** "Saturday", "this Saturday", "today" — how the card introduces itself. */
export function bakeWhen(dateStr: string, dayName: string, now: Date = new Date()): string {
  const today = dateKey(now);
  if (dateStr === today) return 'today';
  if (dateStr === dateKey(addDays(now, 1))) return 'tomorrow';
  const days = Math.round(
    (startOfDay(new Date(`${dateStr}T00:00:00`)).getTime() - startOfDay(now).getTime()) / 86400000,
  );
  if (days <= 7) return `this ${dayName}`;
  return `${dayName} ${new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
