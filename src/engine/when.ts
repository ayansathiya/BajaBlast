/*
 * Times and dates the way people type them.
 *
 * The event editor used the browser's own date and time pickers, and on a
 * touch screen Chromium draws those as a cramped wheel with a handful of
 * choices and nowhere to type. These read what someone would actually put in
 * a box with the on-screen keyboard — "3pm", "330p", "15:45", "noon";
 * "tomorrow", "fri", "oct 25", "10/25" — and give back the plain
 * HH:MM / YYYY-MM-DD the rest of the app stores.
 *
 * Anything they can't read comes back null, and the editor says so beside
 * the box rather than saving a guess.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "3pm" → "15:00". Null when it isn't a time. */
export function parseTime(input: string): string | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\./g, '');
  if (!text) return null;
  if (text === 'noon' || text === 'midday') return '12:00';
  if (text === 'midnight') return '00:00';

  // "930" and "1545" are hours then minutes.
  const digits = /^(\d{1,2})(\d{2})\s*(a|am|p|pm)?$/.exec(text);
  const m = digits ?? /^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)?$/.exec(text);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  const half = m[3]?.[0] as 'a' | 'p' | undefined;

  if (minutes > 59) return null;

  if (half) {
    if (hours < 1 || hours > 12) return null;
    if (half === 'a') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return null;
  } else if (!m[2] && hours >= 1 && hours <= 6) {
    // "Piano at 4" is four in the afternoon. Nobody books 4am in a kitchen.
    hours += 12;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function validDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

/**
 * "fri" → the coming Friday. A date with no year is the next one: typing
 * "jan 5" in October means January next year, not one that's already gone.
 */
export function parseDate(input: string, now: Date = new Date()): string | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    // "Tue Oct 20 2026", as the editor shows a date back: the weekday is
    // only decoration once there's a month and day after it.
    .replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]* (?=[a-z]+ \d|\d)/, '');
  if (!text) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (days: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));

  if (text === 'today' || text === 'tonight') return isoDate(today);
  if (text === 'tomorrow' || text === 'tmrw' || text === 'tmr') return plus(1);

  // Already in the stored form.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const d = validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d ? isoDate(d) : null;
  }

  // A weekday, optionally "next fri": the next one after today.
  m = /^(next )?([a-z]+)$/.exec(text);
  if (m) {
    const day = DAYS.findIndex((d) => m![2].startsWith(d));
    if (day >= 0 && m[2].length >= 2) {
      let ahead = (day - today.getDay() + 7) % 7 || 7;
      if (m[1] && ahead < 7) ahead += 7;
      return plus(ahead);
    }
  }

  const yearOrNext = (month: number, day: number, year?: number) => {
    if (year !== undefined) {
      const y = year < 100 ? 2000 + year : year;
      return validDate(y, month, day);
    }
    const thisYear = validDate(today.getFullYear(), month, day);
    if (thisYear && thisYear >= today) return thisYear;
    return validDate(today.getFullYear() + 1, month, day);
  };

  // "oct 25", "october 25 2027", "25 oct"
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2,4}))?$/.exec(text) ?? null;
  if (m) {
    const month = MONTHS.findIndex((x) => m![1].startsWith(x));
    if (month >= 0) {
      const d = yearOrNext(month, Number(m[2]), m[3] ? Number(m[3]) : undefined);
      return d ? isoDate(d) : null;
    }
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{2,4}))?$/.exec(text);
  if (m) {
    const month = MONTHS.findIndex((x) => m![2].startsWith(x));
    if (month >= 0) {
      const d = yearOrNext(month, Number(m[1]), m[3] ? Number(m[3]) : undefined);
      return d ? isoDate(d) : null;
    }
  }

  // "10/25" or "10/25/27" — month first, as written in the US.
  m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(text);
  if (m) {
    const d = yearOrNext(Number(m[1]) - 1, Number(m[2]), m[3] ? Number(m[3]) : undefined);
    return d ? isoDate(d) : null;
  }
  return null;
}

/** "15:00" → "3:00 PM", for showing what was understood. */
export function showTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const half = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad(m)} ${half}`;
}

export function showDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  // Fixed to US English so what's shown is always something parseDate reads.
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A date and a time in one box, for reminders: "tomorrow 5pm", "fri 8am",
 * "oct 25 9:30", "5pm" (today), "fri" (that day, no time). Empty means no
 * time at all. Null when it can't be read.
 *
 * A time that has already passed today, with no date given, means the same
 * time tomorrow — "8am" typed at 9pm is tomorrow morning.
 */
export function parseWhen(input: string, now: Date = new Date()): { date: string | null; time: string | null } | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\bat\b/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return { date: null, time: null };

  const today = isoDate(now);
  const timeOnly = parseTime(text);
  if (timeOnly) {
    const [h, m] = timeOnly.split(':').map(Number);
    const passed = h * 60 + m <= now.getHours() * 60 + now.getMinutes();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { date: passed ? isoDate(tomorrow) : today, time: timeOnly };
  }
  const dateOnly = parseDate(text, now);
  if (dateOnly) return { date: dateOnly, time: null };

  // A time at the end — one word ("5pm") or two ("5 pm").
  const words = text.split(' ');
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const time = parseTime(words.slice(-take).join(' '));
    const date = parseDate(words.slice(0, -take).join(' '), now);
    if (time && date) return { date, time };
  }
  // Or at the start: "5pm tomorrow".
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const time = parseTime(words.slice(0, take).join(' '));
    const date = parseDate(words.slice(take).join(' '), now);
    if (time && date) return { date, time };
  }
  return null;
}

/** "Today, 5:00 PM", "Fri, Oct 23", "Tomorrow" — for showing a reminder's time. */
export function showWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const today = isoDate(now);
  const tomorrow = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const key = isoDate(d);
  const day =
    key === today
      ? 'Today'
      : key === tomorrow
        ? 'Tomorrow'
        : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime ? `${day}, ${showTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)}` : day;
}
