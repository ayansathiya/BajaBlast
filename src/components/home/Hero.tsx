import { ReactNode } from 'react';
import { CalendarEvent, DisplaySettings, Person, WeatherSnapshot, eventPeople } from '../../data/models';
import { formatClock, isSameDay } from '../../engine/intelligence';
import { morningWeather } from '../../engine/morning';
import { Icon, IconName } from '../Icon';

interface Props {
  now: Date;
  clockStyle: DisplaySettings['clockStyle'];
  weather: WeatherSnapshot | null;
  weatherLoading: boolean;
  /** The next thing on the calendar, from now on. */
  next: CalendarEvent | null;
  people: Person[];
  /** Today's Thirukkural, already drawn. */
  kural?: ReactNode;
}

const WEATHER_ICON: Record<WeatherSnapshot['now']['icon'], IconName> = {
  sun: 'sun',
  partly: 'partly',
  cloud: 'cloud',
  rain: 'rain',
  snow: 'snow',
  storm: 'storm',
};

/** "in 25 min", "in 2 h 10 min", "tomorrow, 4:00 PM", "Saturday, 4:00 PM". */
export function untilText(start: Date, now: Date): string {
  const mins = Math.round((start.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (isSameDay(start, now)) {
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m >= 5 ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = isSameDay(start, tomorrow) ? 'Tomorrow' : start.toLocaleDateString(undefined, { weekday: 'long' });
  return `${day}, ${formatClock(start)}`;
}

/**
 * The left of the wall: the moment.
 *
 * What a glance from the doorway is for — the time, the day, whether to
 * take a coat, and what's next — set large in one column, with nothing
 * around it. The calendar to its right is for reading; this is for seeing.
 */
export function Hero({ now, clockStyle, weather, weatherLoading, next, people, kural }: Props) {
  let h = now.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const w = morningWeather(weather, now);
  const owner = next ? people.find((p) => p.id === eventPeople(next)[0]) : undefined;

  return (
    <aside className="hero">
      <div className="hero-time tabular" aria-label={`${h}:${minutes} ${ampm}`}>
        <span className="hero-hm">
          {h}:{minutes}
          {clockStyle === 'digital-seconds' && <span className="hero-sec">{String(now.getSeconds()).padStart(2, '0')}</span>}
        </span>
        <span className="hero-ampm">{ampm}</span>
      </div>

      <div className="hero-date">
        <div className="hero-day">{now.toLocaleDateString(undefined, { weekday: 'long' })}</div>
        <div className="hero-month">{now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>
      </div>

      <div className="hero-weather">
        {w ? (
          <>
            <div className="hero-weather-now">
              <Icon name={WEATHER_ICON[w.icon]} size={34} />
              <span className="hero-temp tabular">{w.nowF}°</span>
              <span className="hero-cond">{w.condition}</span>
            </div>
            <div className="hero-weather-more tabular">
              High {w.highF}° · Low {w.lowF}°{w.rainChance >= 0.3 ? ` · ${Math.round(w.rainChance * 100)}% rain` : ''}
            </div>
          </>
        ) : (
          <div className="hero-weather-more">{weatherLoading ? 'Weather is on its way' : 'No weather right now'}</div>
        )}
      </div>

      <div className="hero-next">
        <div className="hero-label">Next</div>
        {next ? (
          <>
            <div className="hero-next-title">
              {owner && <span className="person-dot" style={{ background: owner.color }} aria-hidden />}
              {next.title}
            </div>
            <div className="hero-next-when">{untilText(new Date(next.start), now)}</div>
          </>
        ) : (
          <div className="hero-next-when">Nothing coming up</div>
        )}
      </div>

      {kural && <div className="hero-kural">{kural}</div>}
    </aside>
  );
}
