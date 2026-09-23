import { useCallback, useEffect, useRef, useState } from 'react';
import { BakePick } from '../data/models';
import { BakeState } from '../engine/bake';
import { useLiveRevision } from './live';

/**
 * This week's bake, kept in step with every other screen in the house.
 *
 * Picking a recipe on a phone has to show up on the wall without anyone
 * refreshing anything, so this re-reads whenever the live stream says the
 * store changed. The slow timer underneath is the fallback for when the
 * stream can't be held open — stale beats frozen.
 */
export function useBake(enabled = true, pollSeconds = 300) {
  const [state, setState] = useState<BakeState | null>(null);
  const revision = useLiveRevision();
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch('/api/bake');
      if (!res.ok) return;
      const data = (await res.json()) as BakeState;
      if (!cancelled.current) setState(data);
    } catch {
      // Server not up yet, or this is a plain `vite dev` session with no
      // server behind it. Keep whatever we already had.
    }
  }, [enabled]);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const timer = setInterval(refresh, pollSeconds * 1000);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, [refresh, pollSeconds, revision]);

  const pick = useCallback(
    async (recipe: Partial<BakePick> & { title: string }, date?: string) => {
      try {
        const res = await fetch('/api/bake/pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, recipe }),
        });
        await refresh();
        return res.ok;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  const clear = useCallback(
    async (date: string) => {
      try {
        await fetch(`/api/bake/pick?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
        await refresh();
      } catch {
        // ignore — the next refresh corrects it
      }
    },
    [refresh]
  );

  return { bake: state, pick, clear, refresh };
}
