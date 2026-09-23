import { WeatherSnapshot } from '../data/models';

export interface WeatherProvider {
  getSnapshot(): Promise<WeatherSnapshot>;
}

/**
 * Deterministic-ish mock so the demo looks alive without network access.
 * A real provider (e.g. wrapping a weather API) implements the same
 * interface and can be swapped in via household settings.
 */
export class MockWeatherProvider implements WeatherProvider {
  private cached: WeatherSnapshot | null = null;

  async getSnapshot(): Promise<WeatherSnapshot> {
    const now = new Date();
    const sunrise = new Date(now);
    sunrise.setHours(6, 42, 0, 0);
    const sunset = new Date(now);
    sunset.setHours(19, 18, 0, 0);

    const hourly = Array.from({ length: 12 }).map((_, i) => {
      const t = new Date(now);
      t.setHours(now.getHours() + i, 0, 0, 0);
      const hour = t.getHours();
      const rainWindow = hour >= 16 && hour <= 18;
      return {
        time: t.toISOString(),
        tempF: 72 - Math.abs(hour - 15) * 1.2,
        precipChance: rainWindow ? 0.6 : 0.05,
        icon: rainWindow ? ('rain' as const) : ('partly' as const),
      };
    });

    this.cached = {
      now: {
        tempF: 72,
        condition: 'Mostly Sunny',
        icon: 'partly',
        sunrise: sunrise.toISOString(),
        sunset: sunset.toISOString(),
      },
      hourly,
      fetchedAt: now.toISOString(),
    };
    return this.cached;
  }
}
