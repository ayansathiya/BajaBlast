import { CalendarEvent, WeatherSnapshot } from '../data/models';
import { isSameDay } from './intelligence';

/*
 * The Good Morning page: what it shows, and when.
 *
 * It comes up by itself when the screen wakes for the day and stays until
 * someone taps "Start the day" or mid-morning arrives, whichever is first.
 * Kept free of React so the rules can be read in one place.
 */

/** The page goes away on its own at this hour even if nobody touched it. */
export const MORNING_UNTIL = '10:00';

function minutesOf(hhmm: string | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Between the screen's wake-up time and MORNING_UNTIL. */
export function isMorning(now: Date, wakeAt: string | undefined): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(wakeAt, 6 * 60);
  const until = minutesOf(MORNING_UNTIL, 10 * 60);
  // A wake-up time after ten would otherwise mean the page never shows.
  return mins >= Math.min(from, until - 60) && mins < until;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export interface MorningWeather {
  nowF: number;
  highF: number;
  lowF: number;
  condition: string;
  icon: WeatherSnapshot['now']['icon'];
  /** Highest chance of rain between now and the evening, 0–1. */
  rainChance: number;
  wear: string;
}

/**
 * The part of today people are out in: from now until 9pm. The overnight low
 * at 4am says nothing about what a kid needs at the bus stop.
 */
export function morningWeather(weather: WeatherSnapshot | null, now: Date): MorningWeather | null {
  if (!weather) return null;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21).getTime();
  const hours = weather.hourly.filter((h) => {
    const t = Date.parse(h.time);
    return t >= now.getTime() - 60 * 60 * 1000 && t <= end;
  });
  const temps = [weather.now.tempF, ...hours.map((h) => h.tempF)];
  const highF = Math.round(Math.max(...temps));
  const lowF = Math.round(Math.min(...temps));
  const rainChance = Math.max(0, ...hours.map((h) => h.precipChance));
  const snowy = weather.now.icon === 'snow' || hours.some((h) => h.icon === 'snow' && h.precipChance >= 0.3);
  return {
    nowF: Math.round(weather.now.tempF),
    highF,
    lowF,
    condition: weather.now.condition,
    icon: weather.now.icon,
    rainChance,
    wear: whatToWear(lowF, highF, rainChance, snowy),
  };
}

/** One line, for a person with one arm in a coat sleeve. */
export function whatToWear(lowF: number, highF: number, rainChance: number, snowy = false): string {
  let wear: string;
  if (lowF < 35) wear = 'A winter coat, hat and gloves';
  else if (lowF < 50) wear = 'A warm jacket';
  else if (lowF < 62) wear = 'A light jacket or a sweater';
  else if (highF < 85) wear = 'T-shirt weather';
  else wear = 'Shorts and sunscreen — it gets hot';

  // A cold morning that turns warm is the one that catches people out.
  if (lowF < 62 && highF - lowF >= 15) wear += `, in layers — it warms up to ${highF}°`;

  if (snowy) wear += '. Boots — there may be snow';
  else if (rainChance >= 0.5) wear += '. Take an umbrella';
  else if (rainChance >= 0.3) wear += '. Maybe an umbrella';
  return `${wear}.`;
}

/** Birthdays today and in the next week, nearest first. */
export function upcomingBirthdays(events: CalendarEvent[], now: Date, days = 7): CalendarEvent[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + days * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  return events
    .filter((e) => e.category === 'birthday' || /birthday/i.test(e.title))
    .filter((e) => {
      const t = Date.parse(e.start);
      return t >= start && t < end;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .filter((e) => {
      // A yearly birthday expands into one occurrence per year; one is plenty.
      const k = `${e.title}-${dayKey(new Date(e.start))}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function whenLabel(d: Date, now: Date): string {
  if (isSameDay(d, now)) return 'Today';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}
