import { useEffect, useState } from 'react';
import { WeatherProvider } from '../providers/WeatherProvider';
import { WeatherSnapshot } from '../data/models';

export type FeedStatus = 'loading' | 'ok' | 'unavailable';

interface WeatherState {
  snapshot: WeatherSnapshot | null;
  status: FeedStatus;
}

/**
 * Real weather, refreshed every 10 minutes by default.
 *
 * `status` exists so the UI can tell "still loading" apart from "we tried
 * and there's nothing" — the rail says so out loud instead of quietly
 * rendering an invented temperature.
 */
export function useWeather(provider: WeatherProvider, refreshMinutes = 10): WeatherState {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await provider.getSnapshot();
        if (cancelled) return;
        setSnapshot(snap);
        setStatus('ok');
      } catch {
        // Keep the last good reading if we ever had one; only say
        // "unavailable" when we have literally nothing to show.
        if (cancelled) return;
        setStatus((prev) => (prev === 'ok' ? 'ok' : 'unavailable'));
      }
    }
    load();
    const interval = setInterval(load, refreshMinutes * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [provider, refreshMinutes]);

  return { snapshot, status };
}
