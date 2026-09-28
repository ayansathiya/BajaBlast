import { CalendarEvent, ChoreState, KitchenTimer, Person } from '../data/models';
import { trafficBufferMinutes } from './intelligence';

/* ------------------------------------------------------------------ *
 * Timers
 * ------------------------------------------------------------------ */

/** Milliseconds left. Negative once it has gone off. */
export function timerRemaining(t: KitchenTimer, nowMs: number): number {
  if (t.remainingMs != null) return t.remainingMs;
  return Date.parse(t.endsAt ?? '') - nowMs;
}

export function isRinging(t: KitchenTimer, nowMs: number): boolean {
  return t.remainingMs == null && timerRemaining(t, nowMs) <= 0;
}

/**
 * 9:05 · 1:02:40 · and once it's gone off, how long ago, so "pasta +2:10"
 * tells whoever walks in how overcooked it is.
 */
export function formatCountdown(ms: number): string {
  // Ceil while counting down, so "0:00" only appears at the moment it rings
  // rather than for the whole last second.
  const total = ms >= 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return ms >= 0 ? body : `+${body}`;
}

/** Share of the timer used up, 0..1, for the progress ring. */
export function timerProgress(t: KitchenTimer, nowMs: number): number {
  if (t.durationMs <= 0) return 1;
  const left = Math.max(0, timerRemaining(t, nowMs));
  return Math.min(1, Math.max(0, 1 - left / t.durationMs));
}

/** Soonest first, with anything ringing ahead of everything. */
export function sortTimers(list: KitchenTimer[], nowMs: number): KitchenTimer[] {
  return [...list].sort((a, b) => timerRemaining(a, nowMs) - timerRemaining(b, nowMs));
}

/**
 * "set a timer for 10 minutes", "timer 90 seconds for the eggs",
 * "set a 1 hour 20 minute timer called roast". Returns null when the sentence
 * isn't asking for a timer, so the assistant can fall through to its other
 * commands.
 */
export function parseTimerRequest(text: string): { seconds: number; label?: string } | null {
  let q = text.toLowerCase();
  if (!/\btimer\b/.test(q)) return null;

  // Taken out before the unit scan, which would otherwise read the "an hour"
  // inside it as a whole hour and set ninety minutes.
  let seconds = 0;
  if (/\bhalf an hour\b/.test(q)) {
    seconds += 1800;
    q = q.replace(/\bhalf an hour\b/g, ' ');
  }

  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60,
  };
  const num = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : words[s] ?? NaN);

  const unit = /(\d+(?:\.\d+)?|[a-z-]+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  let match: RegExpExecArray | null;
  while ((match = unit.exec(q))) {
    const n = num(match[1]);
    if (!Number.isFinite(n)) continue;
    const u = match[2][0];
    seconds += u === 'h' ? n * 3600 : u === 'm' ? n * 60 : n;
  }
  if (/\band a half\b/.test(q) && /hour/.test(q)) seconds += 1800;
  if (seconds < 5) return null;

  const named = q.match(/\b(?:for|called|named)\s+(?:the\s+)?([a-z][a-z '-]{1,30})$/);
  // "for 10 minutes" is a duration, not a name.
  const label = named && !/\d|minute|second|hour/.test(named[1]) ? named[1].trim() : undefined;
  return { seconds: Math.round(seconds), label };
}

/* ------------------------------------------------------------------ *
 * Reminders — what the wall should be saying out loud right now
 * ------------------------------------------------------------------ */

export interface KitchenReminder {
  key: string;
  text: string;
  /** "soon" is a quiet line; "now" is the coral one you notice from the sink. */
  level: 'soon' | 'now';
  color?: string;
}

const MIN = 60_000;

function mins(ms: number): number {
  return Math.max(0, Math.round(ms / MIN));
}

function names(ids: string[], people: Person[]): string {
  const found = ids.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean) as string[];
  if (found.length === 0) return '';
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(', ')} & ${found[found.length - 1]}`;
}

/**
 * The next few things worth calling out, most urgent first.
 *
 * Events with a travel time get a "leave" reminder, starting 30 minutes
 * before you need to be out of the door. Events without one get a "starts in"
 * reminder from 30 minutes out. All-day things never do — "Grandma's
 * birthday starts in 20 minutes" is not a sentence anybody needs.
 *
 * In the evening, chores that aren't done yet get one line per person, so
 * the reminder comes from the wall rather than from a parent.
 */
export function buildReminders(
  events: CalendarEvent[],
  chores: ChoreState | null,
  people: Person[],
  now: Date,
  opts: { leadMinutes?: number; choreHour?: number } = {}
): KitchenReminder[] {
  const lead = (opts.leadMinutes ?? 30) * MIN;
  const nowMs = now.getTime();
  const out: (KitchenReminder & { at: number })[] = [];

  for (const e of events) {
    if (e.allDay) continue;
    const start = Date.parse(e.start);
    if (!Number.isFinite(start) || start <= nowMs) continue;
    const ids = e.personIds?.length ? e.personIds : e.personId ? [e.personId] : [];
    const who = names(ids, people);
    const color = people.find((p) => p.id === ids[0])?.color;
    const travel = e.location?.travelMinutes ? (e.location.travelMinutes + trafficBufferMinutes(now)) * MIN : 0;

    if (travel > 0) {
      const leaveAt = start - travel;
      const until = leaveAt - nowMs;
      if (until > lead) continue;
      const lead2 = who ? `${who}: ` : '';
      const text =
        until <= 0
          ? `${lead2}time to leave for ${e.title}`
          : `${lead2}leave for ${e.title} in ${mins(until)} min`;
      out.push({ key: `leave-${e.id}-${e.start}`, text, level: until <= 5 * MIN ? 'now' : 'soon', color, at: leaveAt });
    } else {
      const until = start - nowMs;
      if (until > lead) continue;
      const text = `${e.title}${who ? ` (${who})` : ''} starts in ${Math.max(1, mins(until))} min`;
      out.push({ key: `start-${e.id}-${e.start}`, text, level: until <= 5 * MIN ? 'now' : 'soon', color, at: start });
    }
  }

  const choreHour = opts.choreHour ?? 18;
  if (chores && now.getHours() >= choreHour && now.getHours() < 22) {
    for (const p of people) {
      if (!p.enabled) continue;
      const t = chores.totals[p.id];
      if (!t || !t.todayTotal) continue;
      const left = t.todayTotal - t.todayDone;
      if (left <= 0) continue;
      out.push({
        key: `chores-${p.id}`,
        text: `${p.name}: ${left} chore${left === 1 ? '' : 's'} left today`,
        level: 'soon',
        color: p.color,
        // After every timed thing, however far off.
        at: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at).map(({ at: _at, ...r }) => r);
}
