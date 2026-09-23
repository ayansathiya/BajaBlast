import { useCallback, useEffect, useState } from 'react';
import { ChoreState } from '../data/models';
import { useLiveRevision } from './live';

const API_BASE = '';

interface ToggleResult {
  done: boolean;
  completedAll: boolean;
  todayDone: number;
  todayTotal: number;
}

interface ChoresHook {
  state: ChoreState | null;
  refresh: () => Promise<void>;
  toggle: (choreId: string, personId: string) => Promise<ToggleResult | null>;
}

/**
 * Today's chore list and the running point totals.
 *
 * The server decides what "today" means (local date, not UTC) and whether a
 * tick finished someone's whole list, so the kiosk and the phone can't
 * disagree about when to throw confetti.
 */
export function useChores(pollSeconds = 20, enabled = true): ChoresHook {
  const revision = useLiveRevision();
  const [state, setState] = useState<ChoreState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chores`, { cache: 'no-store' });
      if (!res.ok) return;
      setState(await res.json());
    } catch {
      // Offline-first: keep the last known board.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = setInterval(refresh, pollSeconds * 1000);
    return () => clearInterval(t);
  }, [refresh, pollSeconds, enabled, revision]);

  const toggle = useCallback(
    async (choreId: string, personId: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/chores/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choreId, personId }),
        });
        const data = res.ok ? await res.json() : null;
        await refresh();
        return data;
      } catch {
        return null;
      }
    },
    [refresh]
  );

  return { state, refresh, toggle };
}
