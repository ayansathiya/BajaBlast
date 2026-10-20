import { ThemePeriod } from '../data/models';

/**
 * Feature 18 — Dynamic theme based on time of day.
 * Returns a period plus a 0-1 blend factor toward the *next* period so the
 * UI can interpolate colors continuously instead of snapping at boundaries.
 */
export function getThemePeriod(now: Date, sunrise?: Date, sunset?: Date): { period: ThemePeriod; blend: number } {
  const hour = now.getHours() + now.getMinutes() / 60;
  const sunriseHour = sunrise ? sunrise.getHours() + sunrise.getMinutes() / 60 : 6.5;
  const sunsetHour = sunset ? sunset.getHours() + sunset.getMinutes() / 60 : 19.3;

  const morningEnd = Math.min(sunriseHour + 5, 11.5);
  const afternoonEnd = sunsetHour - 1.5;
  const eveningEnd = sunsetHour + 3;

  if (hour < sunriseHour || hour >= eveningEnd) {
    return { period: 'night', blend: 0 };
  }
  if (hour < morningEnd) {
    return { period: 'morning', blend: (hour - sunriseHour) / (morningEnd - sunriseHour) };
  }
  if (hour < afternoonEnd) {
    return { period: 'afternoon', blend: (hour - morningEnd) / (afternoonEnd - morningEnd) };
  }
  return { period: 'evening', blend: (hour - afternoonEnd) / (eveningEnd - afternoonEnd) };
}

export interface ThemeTokens {
  /** Light or dark, for the things CSS needs to know it for (form controls, scrollbars). */
  scheme: 'dark' | 'light';
  bg: string;
  /** Cards and panels, one step off the background. */
  bgElevated: string;
  /** Inside a card: inputs, pills, hover. */
  surface2: string;
  text: string;
  textMuted: string;
  /** Least important text — timestamps, placeholders. */
  textFaint: string;
  accent: string;
  /** Text and icons drawn on top of the accent. */
  accentInk: string;
  /** Kept for things that need attention now: a timer ringing, "leave now". */
  urgent: string;
  hairline: string;
  /** Behind a panel that opens over the calendar. */
  scrim: string;
}

/*
 * Two looks, and nothing else: black, and beige.
 *
 * Black is the wall at night and for anyone who wants it always — true black
 * (the panel's pixels off), warm white text, and sand as the one accent
 * instead of the old neon teal and coral. Beige is the daytime kitchen —
 * a warm paper background, white cards, near-black ink. Coral survives only
 * as "urgent", for a timer going off.
 *
 * Within black, late evening and night still dim the text a step, so the
 * wall isn't a lamp in a dark room.
 */
const BLACK: ThemeTokens = {
  scheme: 'dark',
  bg: '#000000',
  bgElevated: '#0F0E0C',
  surface2: '#1A1815',
  text: '#F3EFE7',
  textMuted: '#9A9387',
  textFaint: '#5C574F',
  accent: '#D8C3A0',
  accentInk: '#14120E',
  urgent: '#FF6B5B',
  hairline: 'rgba(243, 239, 231, 0.09)',
  scrim: 'rgba(0, 0, 0, 0.78)',
};

const BLACK_NIGHT: ThemeTokens = {
  ...BLACK,
  bgElevated: '#0A0908',
  surface2: '#13110F',
  text: '#CDC7BC',
  textMuted: '#6F695F',
  textFaint: '#46423C',
  accent: '#A8936F',
  hairline: 'rgba(243, 239, 231, 0.06)',
};

const BEIGE: ThemeTokens = {
  scheme: 'light',
  bg: '#EEE7DB',
  bgElevated: '#FFFFFF',
  surface2: '#F6F1E8',
  text: '#1B1916',
  textMuted: '#6F685C',
  textFaint: '#A59C8E',
  accent: '#8C6A3F',
  accentInk: '#FFFFFF',
  urgent: '#C9442F',
  hairline: 'rgba(27, 25, 22, 0.09)',
  scrim: 'rgba(42, 36, 28, 0.38)',
};

export type ThemeChoice = 'auto' | 'dark' | 'light' | 'daylight';

/**
 * Which look is on the wall now.
 *
 *   auto      black, dimming a step in the late evening and at night
 *   dark      black, always the same
 *   light     beige, always
 *   daylight  beige while it's light out, black after sunset
 */
export function getThemeTokens(period: ThemePeriod, choice: ThemeChoice = 'auto'): ThemeTokens {
  if (choice === 'light') return BEIGE;
  if (choice === 'daylight') return period === 'night' || period === 'evening' ? BLACK_NIGHT : BEIGE;
  if (choice === 'dark') return BLACK;
  return period === 'night' || period === 'evening' ? BLACK_NIGHT : BLACK;
}
