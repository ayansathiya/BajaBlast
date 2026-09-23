import { useEffect, useState } from 'react';
import { NewsProvider } from '../providers/NewsProvider';
import { NewsHeadline } from '../data/models';
import { FeedStatus } from './useWeather';

interface NewsState {
  items: NewsHeadline[];
  status: FeedStatus;
  /** ms epoch of the last successful refresh, for the "updated N min ago" line. */
  updatedAt: number | null;
}

/** Live headlines. Polled every 10 minutes; the server caches for 12. */
export function useNews(provider: NewsProvider, refreshMinutes = 10): NewsState {
  const [items, setItems] = useState<NewsHeadline[]>([]);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await provider.getHeadlines();
        if (cancelled) return;
        if (next.length > 0) {
          setItems(next);
          setStatus('ok');
          setUpdatedAt(Date.now());
        } else {
          setStatus((prev) => (prev === 'ok' ? 'ok' : 'unavailable'));
        }
      } catch {
        if (!cancelled) setStatus((prev) => (prev === 'ok' ? 'ok' : 'unavailable'));
      }
    }
    load();
    const interval = setInterval(load, refreshMinutes * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [provider, refreshMinutes]);

  return { items, status, updatedAt };
}
