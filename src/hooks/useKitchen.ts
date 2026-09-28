import { useCallback, useEffect, useRef, useState } from 'react';
import { KitchenTimer, MealDay, WallNote } from '../data/models';
import { useLiveRevision } from './live';

/**
 * Timers, the dinner plan and the notes board — all three live on the server
 * and follow the live stream, same as bookmarks and Bake Night. A slow poll
 * underneath is the fallback for when the stream can't be held open.
 */

function useServerJson<T>(url: string, initial: T, enabled = true, pollSeconds = 300) {
  const [data, setData] = useState<T>(initial);
  const revision = useLiveRevision();
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const body = (await res.json()) as T;
      if (!cancelled.current) setData(body);
    } catch {
      // Server not up, or a plain dev session. Keep what's drawn.
    }
  }, [url, enabled]);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const t = setInterval(refresh, pollSeconds * 1000);
    return () => {
      cancelled.current = true;
      clearInterval(t);
    };
  }, [refresh, pollSeconds, revision]);

  return { data, refresh };
}

async function call(url: string, method: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type TimerAction = 'pause' | 'resume' | 'add' | 'dismiss';

export function useTimers() {
  const { data, refresh } = useServerJson<{ serverNow: string; timers: KitchenTimer[] }>(
    '/api/timers',
    { serverNow: new Date().toISOString(), timers: [] },
    true,
    60
  );

  // How far this screen's clock is from the server's. Zero on the kiosk,
  // which is the server; it matters for a phone.
  const [skewMs, setSkewMs] = useState(0);
  useEffect(() => {
    const server = Date.parse(data.serverNow);
    if (Number.isFinite(server)) setSkewMs(server - Date.now());
  }, [data.serverNow]);

  const start = useCallback(
    async (seconds: number, label?: string) => {
      const ok = await call('/api/timers', 'POST', { seconds, label });
      await refresh();
      return ok;
    },
    [refresh]
  );

  const act = useCallback(
    async (id: string, action: TimerAction, seconds?: number) => {
      await call(`/api/timers/${encodeURIComponent(id)}/${action}`, 'POST', seconds ? { seconds } : {});
      await refresh();
    },
    [refresh]
  );

  return { timers: data.timers, skewMs, start, act };
}

export function useMeals(enabled = true) {
  const { data, refresh } = useServerJson<{ week: MealDay[] }>('/api/meals?days=7', { week: [] }, enabled);

  const addToGrocery = useCallback(
    async (date: string) => {
      try {
        const res = await fetch(`/api/meals/${date}/grocery`, { method: 'POST' });
        const body = await res.json();
        return (body.added as string[]) ?? [];
      } catch {
        return [];
      }
    },
    []
  );

  return { week: data.week, refresh, addToGrocery };
}

export function useNotes() {
  const { data, refresh } = useServerJson<WallNote[]>('/api/notes', []);

  const remove = useCallback(
    async (id: string) => {
      await call(`/api/notes/${encodeURIComponent(id)}`, 'DELETE');
      await refresh();
    },
    [refresh]
  );

  return { notes: data, removeNote: remove };
}
