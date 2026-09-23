import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarProvider } from '../providers/CalendarProvider';
import { CalendarEvent } from '../data/models';
import { startOf, endOf } from '../engine/intelligence';
import { useLiveRevision } from './live';

interface CalendarState {
  events: CalendarEvent[];
  loading: boolean;
  lastSyncedAt: string | null;
  error: string | null;
  /** Re-fetch immediately — call this right after creating/editing/deleting an event. */
  refresh: () => Promise<void>;
}

/**
 * Feature 17 — offline-first: on failure, keep the last-known-good events
 * instead of clearing the screen or throwing an error banner.
 */
export function useCalendar(provider: CalendarProvider, windowDays = 14): CalendarState {
  const revision = useLiveRevision();
  const [state, setState] = useState<Omit<CalendarState, 'refresh'>>({
    events: [],
    loading: true,
    lastSyncedAt: null,
    error: null,
  });
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const start = startOf(new Date());
      const end = endOf(new Date(Date.now() + windowDays * 24 * 3600 * 1000));
      const events = await provider.listEvents(start.toISOString(), end.toISOString());
      if (!cancelledRef.current) {
        setState({ events, loading: false, lastSyncedAt: provider.lastSyncedAt(), error: null });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setState((prev) => ({ ...prev, loading: false, error: 'sync-failed' }));
      }
    }
  }, [provider, windowDays]);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    // Fallback only. The live stream delivers phone-added events immediately.
    const interval = setInterval(load, 180 * 1000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [load, revision]);

  return { ...state, refresh: load };
}
