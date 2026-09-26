import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark } from '../data/models';
import { useLiveRevision } from './live';

/**
 * The household's bookmarks, same list everywhere.
 *
 * Re-reads whenever the live stream says the store changed, so a link saved
 * on a phone appears on the wall without anyone refreshing anything — which
 * is the only reason these live on the server instead of in each browser.
 */
export function useBookmarks(enabled = true, pollSeconds = 300) {
  const [items, setItems] = useState<Bookmark[]>([]);
  const revision = useLiveRevision();
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch('/api/bookmarks');
      if (!res.ok) return;
      const list = (await res.json()) as Bookmark[];
      if (!cancelled.current) setItems(list);
    } catch {
      // Server not up, or a plain dev session with nothing behind it.
      // Whatever was drawn last stays on screen.
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

  const add = useCallback(
    async (url: string, title?: string) => {
      try {
        const res = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, title }),
        });
        await refresh();
        return res.ok;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refresh();
      } catch {
        // The next refresh corrects it.
      }
    },
    [refresh]
  );

  return { bookmarks: items, addBookmark: add, removeBookmark: remove };
}
