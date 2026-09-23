import { WeatherSnapshot } from '../data/models';
import { formatClock } from '../engine/intelligence';
import { FeedStatus } from '../hooks/useWeather';

interface Props {
  weather: WeatherSnapshot | null;
  status: FeedStatus;
  place: string;
  now: Date;
}

function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'Updated just now';
  if (mins === 1) return 'Updated 1 min ago';
  if (mins < 60) return `Updated ${mins} min ago`;
  return `Updated ${Math.round(mins / 60)}h ago`;
}

/**
 * Weather, moved up beside the clock.
 *
 * It used to sit at the top of the right rail, where it pushed everything
 * else — grocery, headlines, tickers — off the bottom of the screen while
 * the top-right corner of the display sat completely empty.
 */
export function HeaderWeather({ weather, status, place, now }: Props) {
  const rainHour = weather?.hourly.find((h) => h.precipChance >= 0.4);

  return (
    <div className="header-weather">
      {weather ? (
        <>
          <div className="header-weather-main">
            <span className="header-weather-temp tabular">{Math.round(weather.now.tempF)}°</span>
            <span className="header-weather-cond">{weather.now.condition}</span>
          </div>
          <div className="header-weather-meta">
            {place}
            {rainHour && <span className="header-weather-rain"> · Rain likely {formatClock(new Date(rainHour.time))}</span>}
          </div>
          <div className="header-weather-stamp">{ago(weather.fetchedAt, now)}</div>
        </>
      ) : (
        <div className="header-weather-meta">
          {status === 'loading' ? 'Loading weather…' : 'Weather unavailable — no connection.'}
        </div>
      )}
    </div>
  );
}
