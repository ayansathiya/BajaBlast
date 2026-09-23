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
  bg: string;
  bgElevated: string;
  text: string;
  textMuted: string;
  accent: string;
  hairline: string;
}

const THEMES: Record<ThemePeriod, ThemeTokens> = {
  morning: {
    bg: '#000000',
    bgElevated: '#0A0A0A',
    text: '#FFFFFF',
    textMuted: '#8A8A8A',
    accent: '#00F5D4',
    hairline: 'rgba(255,255,255,0.14)',
  },
  afternoon: {
    bg: '#000000',
    bgElevated: '#0A0A0A',
    text: '#FFFFFF',
    textMuted: '#7A7A7A',
    accent: '#00F5D4',
    hairline: 'rgba(255,255,255,0.12)',
  },
  evening: {
    bg: '#000000',
    bgElevated: '#0A0A0A',
    text: '#F5F5F5',
    textMuted: '#6A6A6A',
    accent: '#FF5C72',
    hairline: 'rgba(255,255,255,0.10)',
  },
  night: {
    bg: '#000000',
    bgElevated: '#070707',
    text: '#C9C9C9',
    textMuted: '#4A4A4A',
    accent: '#B33B4C',
    hairline: 'rgba(255,255,255,0.07)',
  },
};

export function getThemeTokens(period: ThemePeriod): ThemeTokens {
  return THEMES[period];
}
