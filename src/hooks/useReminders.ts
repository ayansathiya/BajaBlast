import { useCallback, useEffect, useState } from 'react';
import { useLiveRevision } from './live';

export interface ReminderItem {
  id: string;
  text: string;
  /** ISO, or null for "whenever". */
  due: string | null;
  personId: string | null;
  done: boolean;
  doneAt: string | null;
  source: 'hand' | 'photo' | 'voice';
}

function post(path: string, body: unknown) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** The household's reminders, live: a phone adding one shows on the wall at once. */
export function useReminders() {
  const [items, setItems] = useState<ReminderItem[]>([]);
  const revision = useLiveRevision();

  const refresh = useCallback(() => {
    fetch('/api/reminders')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, revision]);

  // Re-read now and then too, so one falling due shows without a change.
  useEffect(() => {
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const add = useCallback(
    async (text: string, due: string | null) => {
      await post('/api/reminders', { text, due }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  const toggle = useCallback(
    async (item: ReminderItem) => {
      setItems((list) => list.map((r) => (r.id === item.id ? { ...r, done: !r.done } : r)));
      await post(`/api/reminders/${encodeURIComponent(item.id)}`, { done: !item.done }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      setItems((list) => list.filter((r) => r.id !== id));
      await fetch(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  return { items, add, toggle, remove };
}
