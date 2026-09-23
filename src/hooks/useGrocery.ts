import { useCallback, useEffect, useRef, useState } from 'react';
import { GroceryProvider } from '../providers/GroceryProvider';
import { GroceryItem } from '../data/models';
import { useLiveRevision } from './live';

interface GroceryState {
  items: GroceryItem[];
  add: (label: string, addedBy?: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useGrocery(provider: GroceryProvider, pollSeconds = 180): GroceryState {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const revision = useLiveRevision();
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const list = await provider.list();
      if (!cancelledRef.current) setItems(list);
    } catch {
      // Offline-first: the local server may not be up yet (or at all in a
      // plain browser dev session) — keep whatever we already have.
    }
  }, [provider]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    // The live stream is what makes something added on a phone appear here
    // immediately. This timer is the fallback for when the stream can't be
    // held open — so the list goes stale rather than frozen, which is why it's
    // minutes rather than seconds.
    const interval = setInterval(refresh, pollSeconds * 1000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [refresh, pollSeconds, revision]);

  const add = useCallback(
    async (label: string, addedBy?: string) => {
      try {
        await provider.add(label, addedBy);
        await refresh();
      } catch {
        // Swallow — the UI stays responsive even if the local server is down.
      }
    },
    [provider, refresh]
  );

  const toggle = useCallback(
    async (id: string) => {
      try {
        await provider.toggle(id);
        await refresh();
      } catch {
        // ignore
      }
    },
    [provider, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await provider.remove(id);
        await refresh();
      } catch {
        // ignore
      }
    },
    [provider, refresh]
  );

  return { items, add, toggle, remove };
}
