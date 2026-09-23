import {
  AmbientSettings,
  CalendarEvent,
  FamilyPhoto,
  GroceryItem,
  IdleScene,
  NewsHeadline,
  NowPlaying,
  WeatherSnapshot,
} from '../data/models';
import { formatClock, isSameDay } from './intelligence';

/**
 * Feature 20/21 — builds the ordered list of idle-reel scenes.
 * This intentionally filters aggressively: routine events (importance 0)
 * never make it into the reel unless nothing else qualifies.
 */
export function buildIdleScenes(
  allUpcoming: CalendarEvent[],
  weather: WeatherSnapshot | null,
  settings: AmbientSettings,
  now: Date,
  news: NewsHeadline[] = [],
  grocery: GroceryItem[] = [],
  photos: FamilyPhoto[] = [],
  nowPlaying: NowPlaying | null = null
): IdleScene[] {
  const scenes: IdleScene[] = [];

  // Music leads when the speakers are actually on: if something is playing,
  // that's the most likely reason anyone glances at the screen.
  if (nowPlaying?.playing && nowPlaying.title) {
    scenes.push({
      id: `scene-music-${nowPlaying.title}`,
      kind: 'music',
      title: nowPlaying.title,
      subtitle: nowPlaying.artist || undefined,
      detailLines: nowPlaying.deviceName ? [nowPlaying.deviceName] : undefined,
      background: 'gradient-night',
      durationMs: 6000,
    });
  }

  const today = allUpcoming.filter((e) => isSameDay(new Date(e.start), now) && new Date(e.end).getTime() > now.getTime());
  const future = allUpcoming.filter((e) => new Date(e.start).getTime() > now.getTime());

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  scenes.push({
    id: 'scene-today',
    kind: 'today',
    title: 'Today',
    subtitle: dateLabel,
    background: 'gradient-warm',
    durationMs: 6000,
  });

  // Feature: family photos woven into the reel like a digital picture
  // frame — a couple, picked in rotation so repeated idle cycles don't
  // always show the same ones first, right up near the front since this
  // is often the most-loved part of an ambient display.
  if (settings.showPhotos && photos.length > 0) {
    const rotationOffset = Math.floor(now.getTime() / 60000) % photos.length;
    const rotated = [...photos.slice(rotationOffset), ...photos.slice(0, rotationOffset)];
    rotated.slice(0, 2).forEach((photo, i) => {
      scenes.push({
        id: `scene-photo-${photo.id}`,
        kind: 'photo',
        title: photo.caption || '',
        background: 'photo',
        imageUrl: `${photo.url}`,
        durationMs: 7000,
      });
    });
  }

  const next = today[0] ?? future[0];
  if (next) {
    scenes.push({
      id: 'scene-next',
      kind: 'next',
      title: next.title,
      subtitle: formatClock(new Date(next.start)),
      detailLines: next.location ? [next.location.label] : undefined,
      background: 'gradient-warm',
      durationMs: 6000,
    });
  }

  const tomorrow = future.find((e) => {
    const d = new Date(e.start);
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return isSameDay(d, t) && e.importance >= 1;
  });
  if (tomorrow) {
    scenes.push({
      id: 'scene-tomorrow',
      kind: 'tomorrow',
      title: tomorrow.title,
      subtitle: `Tomorrow · ${formatClock(new Date(tomorrow.start))}`,
      background: 'gradient-cool',
      durationMs: 6000,
    });
  }

  if (settings.showBirthdays) {
    const birthday = future.find((e) => e.category === 'birthday' || e.isSpecialDay);
    if (birthday) {
      scenes.push({
        id: 'scene-birthday',
        kind: 'birthday',
        title: birthday.title,
        subtitle: new Date(birthday.start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
        background: 'gradient-celebration',
        durationMs: 6000,
      });
    }
  }

  // "Coming this week" — importance >= 2 events over the next 7 days, excluding ones already shown.
  const shownIds = new Set(scenes.map((s) => s.id));
  const weekAhead = future
    .filter((e) => e.importance >= 2)
    .filter((e) => {
      const days = (new Date(e.start).getTime() - now.getTime()) / (24 * 3600 * 1000);
      return days <= 7;
    })
    .slice(0, 3);

  if (weekAhead.length && !shownIds.has('scene-week')) {
    scenes.push({
      id: 'scene-week',
      kind: 'week',
      title: 'Coming This Week',
      detailLines: weekAhead.map(
        (e) => `${new Date(e.start).toLocaleDateString(undefined, { weekday: 'long' })} · ${e.title}`
      ),
      background: 'gradient-cool',
      durationMs: 7000,
    });
  }

  if (settings.showWeather && weather) {
    scenes.push({
      id: 'scene-weather',
      kind: 'weather',
      title: `${Math.round(weather.now.tempF)}°`,
      subtitle: weather.now.condition,
      background: 'gradient-cool',
      durationMs: 5000,
    });
  }

  if (settings.showGrocery) {
    const pending = grocery.filter((g) => !g.done);
    if (pending.length > 0) {
      scenes.push({
        id: 'scene-grocery',
        kind: 'grocery',
        title: 'Grocery List',
        detailLines: pending.slice(0, 5).map((g) => g.label),
        background: 'gradient-warm',
        durationMs: 6000,
      });
    }
  }

  if (settings.showNews && news.length > 0) {
    scenes.push({
      id: 'scene-news',
      kind: 'news',
      title: 'Today, Briefly',
      detailLines: news.slice(0, 3).map((n) => `${n.source} · ${n.headline}`),
      background: 'gradient-night',
      durationMs: 7000,
    });
  }

  if (scenes.length <= 1) {
    scenes.push({
      id: 'scene-quiet',
      kind: 'quiet',
      title: 'A quiet day',
      subtitle: 'Nothing pressing on the calendar.',
      background: 'gradient-warm',
      durationMs: 6000,
    });
  }

  // Respect max reel duration by trimming from the end.
  let total = 0;
  const trimmed: IdleScene[] = [];
  for (const s of scenes) {
    if (total + s.durationMs > settings.maxReelDurationSeconds * 1000 && trimmed.length > 0) break;
    trimmed.push(s);
    total += s.durationMs;
  }
  return trimmed;
}
