import { useEffect, useState } from 'react';
import { StocksProvider } from '../providers/StocksProvider';
import { StockQuote } from '../data/models';
import { FeedStatus } from './useWeather';

interface StocksState {
  items: StockQuote[];
  status: FeedStatus;
  /** ms epoch of the last successful refresh, for the "updated N min ago" line. */
  updatedAt: number | null;
}

/**
 * Live quotes for the household ticker list. Polled every 3 minutes; the
 * server caches for 5, so this mostly just picks up the cached refresh
 * promptly rather than hammering anything upstream.
 *
 * `tickersKey` is passed in so editing the watchlist (from the kiosk or the
 * phone) re-fetches right away instead of waiting out the poll interval.
 */
export function useStocks(provider: StocksProvider, tickersKey: string, refreshMinutes = 3): StocksState {
  const [items, setItems] = useState<StockQuote[]>([]);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await provider.getQuotes();
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
  }, [provider, refreshMinutes, tickersKey]);

  return { items, status, updatedAt };
}
