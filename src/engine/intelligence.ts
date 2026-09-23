import { CalendarEvent, HouseholdSettings, PreparationTemplate, WeatherSnapshot } from '../data/models';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function startOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export interface TimelineEvent extends CalendarEvent {
  status: 'past' | 'now' | 'soon' | 'future';
  minutesUntil: number;
}

/** Feature 2 — annotate today's events with past/now/soon/future for the timeline. */
export function annotateTimeline(events: CalendarEvent[], now: Date): TimelineEvent[] {
  return events.map((e) => {
    const start = new Date(e.start).getTime();
    const end = new Date(e.end).getTime();
    const minutesUntil = Math.round((start - now.getTime()) / MINUTE);
    let status: TimelineEvent['status'] = 'future';
    if (now.getTime() >= start && now.getTime() <= end) status = 'now';
    else if (now.getTime() > end) status = 'past';
    else if (start - now.getTime() <= 60 * MINUTE) status = 'soon';
    return { ...e, status, minutesUntil };
  });
}

/** Feature 9 — flag overlapping events (household-wide, not per-person). */
export interface Conflict {
  a: CalendarEvent;
  b: CalendarEvent;
}

export function findConflicts(events: CalendarEvent[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const sorted = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const aStart = new Date(a.start).getTime();
      const aEnd = new Date(a.end).getTime();
      const bStart = new Date(b.start).getTime();
      if (bStart >= aEnd) break; // sorted, so no further overlap possible with `a`
      const bEnd = new Date(b.end).getTime();
      if (bStart < aEnd && bEnd > aStart) conflicts.push({ a, b });
    }
  }
  return conflicts;
}

/** Feature 10 — the largest open gap in today's remaining schedule. */
export interface FreeWindow {
  start: Date;
  end: Date;
  minutes: number;
}

export function findLargestFreeWindow(events: CalendarEvent[], now: Date, dayEnd: Date): FreeWindow | null {
  const upcoming = events
    .filter((e) => new Date(e.end).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const points: { start: Date; end: Date }[] = [];
  let cursor = now;
  for (const e of upcoming) {
    const s = new Date(e.start);
    if (s.getTime() > cursor.getTime()) points.push({ start: cursor, end: s });
    const e2 = new Date(e.end);
    if (e2.getTime() > cursor.getTime()) cursor = e2;
  }
  if (cursor.getTime() < dayEnd.getTime()) points.push({ start: cursor, end: dayEnd });

  let best: FreeWindow | null = null;
  for (const p of points) {
    const minutes = (p.end.getTime() - p.start.getTime()) / MINUTE;
    if (minutes >= 90 && (!best || minutes > best.minutes)) {
      best = { start: p.start, end: p.end, minutes };
    }
  }
  return best;
}

/** Feature 3 — Leave Now indicator for the next event that has a location + travel time. */
export interface LeaveNowInfo {
  event: CalendarEvent;
  leaveInMinutes: number;
  traffic: 'Light' | 'Moderate' | 'Heavy';
}

export function computeLeaveNow(events: TimelineEvent[], now: Date): LeaveNowInfo | null {
  const candidate = events
    .filter((e) => e.status !== 'past' && e.location?.travelMinutes)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
  if (!candidate || !candidate.location?.travelMinutes) return null;

  const start = new Date(candidate.start).getTime();
  // Light buffer heuristic: pretend traffic is heavier during weekday rush hours.
  const hour = now.getHours();
  const traffic: LeaveNowInfo['traffic'] = hour >= 16 && hour <= 18 ? 'Moderate' : hour >= 7 && hour <= 9 ? 'Moderate' : 'Light';
  const bufferMinutes = traffic === 'Moderate' ? 5 : 0;
  const leaveAt = start - (candidate.location.travelMinutes + bufferMinutes) * MINUTE;
  const leaveInMinutes = Math.round((leaveAt - now.getTime()) / MINUTE);

  // Only surface when it's imminent-ish (within 90 min) so it isn't noise all day.
  if (leaveInMinutes > 90 || leaveInMinutes < -5) return null;

  return { event: candidate, leaveInMinutes: Math.max(leaveInMinutes, 0), traffic };
}

/** Feature 4 — preparation intelligence from user-configured templates only (never fabricated). */
export function resolvePreparation(event: CalendarEvent, templates: PreparationTemplate[]): string[] | null {
  if (event.preparationItems?.length) return event.preparationItems;
  const byCategory = templates.find((t) => t.matchCategory === event.category);
  const byKeyword = templates.find((t) => t.matchKeyword && event.title.toLowerCase().includes(t.matchKeyword.toLowerCase()));
  const match = byKeyword ?? byCategory;
  return match ? match.items : null;
}

/** Feature 5/6 — does this event's outdoor-ness intersect a rain window? */
export function isWeatherAtRisk(event: CalendarEvent, weather: WeatherSnapshot | null): boolean {
  if (!weather) return false;
  const outdoorHint = /soccer|practice|park|beach|hike|game|picnic|outdoor/i.test(event.title + ' ' + (event.location?.label ?? ''));
  if (!outdoorHint) return false;
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return weather.hourly.some((h) => {
    const t = new Date(h.time).getTime();
    return t >= start && t <= end + HOUR && h.precipChance >= 0.4;
  });
}

/** Feature 11/13 — a 0-1 "how busy is this day" score from scheduled hours + event count. */
export function computeDayLoad(events: CalendarEvent[]): { score: number; label: 'Quiet' | 'Light' | 'Busy' | 'Packed' } {
  const totalMinutes = events.reduce((sum, e) => sum + (new Date(e.end).getTime() - new Date(e.start).getTime()) / MINUTE, 0);
  const score = Math.min(1, totalMinutes / (6 * 60) /* 6 scheduled hours = "packed" */);
  let label: 'Quiet' | 'Light' | 'Busy' | 'Packed' = 'Quiet';
  if (score > 0.75) label = 'Packed';
  else if (score > 0.4) label = 'Busy';
  else if (score > 0.12) label = 'Light';
  return { score, label };
}

/** Feature 8 — a short natural-language household summary. */
export function buildWhatsNext(
  timelineToday: TimelineEvent[],
  weather: WeatherSnapshot | null,
  now: Date
): string[] {
  const lines: string[] = [];
  const next = timelineToday.find((e) => e.status === 'soon' || e.status === 'future');
  if (next) {
    const mins = next.minutesUntil;
    if (mins <= 60 && mins >= 0) {
      lines.push(`${next.title}${next.personId ? '' : ''} in ${mins} minute${mins === 1 ? '' : 's'}.`);
    } else {
      const t = new Date(next.start);
      lines.push(`${next.title} at ${formatClock(t)}.`);
    }
  }

  if (weather) {
    const rainy = weather.hourly.find((h) => h.precipChance >= 0.4);
    if (rainy) {
      const t = new Date(rainy.time);
      if (t.getTime() > now.getTime()) {
        lines.push(`Rain likely around ${formatClock(t)}.`);
      }
    }
  }

  const current = timelineToday.find((e) => e.status === 'now');
  if (current && lines.length < 2) {
    lines.push(`${current.title} is happening now.`);
  }

  return lines.slice(0, 3);
}

export function formatClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function weekAndDayOfYear(d: Date): { week: number; day: number } {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = (d.getTime() - start.getTime()) / (24 * HOUR);
  const day = Math.floor(diff) + 1;
  const week = Math.ceil((day + start.getDay()) / 7);
  return { week, day };
}
