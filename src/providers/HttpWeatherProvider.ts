import { WeatherProvider } from './WeatherProvider';
import { WeatherSnapshot } from '../data/models';

const API_BASE = '';

/**
 * Real weather, via the local server's Open-Meteo proxy.
 *
 * The renderer can't call Open-Meteo directly — it's a browser, and the
 * request is cross-origin. The server process can, so the server
 * fetches, caches and reshapes it, and this just reads our own endpoint.
 *
 * Throws when the data is genuinely unavailable, so useWeather keeps the
 * last good snapshot rather than the UI inventing a temperature.
 */
export class HttpWeatherProvider implements WeatherProvider {
  async getSnapshot(): Promise<WeatherSnapshot> {
    const res = await fetch(`${API_BASE}/api/weather`, { cache: 'no-store' });
    if (!res.ok) throw new Error('weather request failed');
    const data = await res.json();
    if (data.unavailable) throw new Error('weather unavailable');
    return { now: data.now, hourly: data.hourly, fetchedAt: data.fetchedAt };
  }
}
