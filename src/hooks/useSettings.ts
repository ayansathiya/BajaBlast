import { useCallback, useEffect, useRef, useState } from 'react';
import { HouseholdSettings } from '../data/models';
import { useLiveRevision } from './live';

const API_BASE = '';

interface SettingsState {
  settings: HouseholdSettings;
  ready: boolean;
  updateSettings: (next: HouseholdSettings) => void;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep-merge stored settings over the built-in defaults.
 *
 * Settings live on disk, so a store written before a feature existed has no
 * key for it — it reads back `undefined`, which is falsy, so the feature
 * silently stays off and looks broken. (That is exactly why family photos
 * and the grocery rail appeared to do nothing.) Merging on every read means
 * new settings just show up, with no reset required.
 */
function mergeDefaults<T>(stored: unknown, base: T): T {
  if (!isPlainObject(stored)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(stored)) {
    const baseValue = out[key];
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      out[key] = mergeDefaults(value, baseValue);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Settings now live on the local server (see app/server.cjs) instead
 * of purely in the kiosk's own React state — that's what lets the phone's
 * full settings menu (people, display, ambient, intelligence, Baja) affect
 * the same kiosk. Polling is paused while `pauseWhileEditing` is true so a
 * phone-side change mid-edit on the kiosk doesn't clobber what's being typed.
 */
export function useSettings(defaults: HouseholdSettings, pauseWhileEditing: boolean, pollSeconds = 6): SettingsState {
  const revision = useLiveRevision();
  const [settings, setSettings] = useState<HouseholdSettings>(defaults);
  const [ready, setReady] = useState(false);
  const cancelledRef = useRef(false);
  // Held in a ref so `load` can stay a stable callback (it's used as a
  // polling interval) without going stale on the defaults object.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const remote = await res.json();
      if (cancelledRef.current) return;
      if (remote) {
        setSettings(mergeDefaults(remote, defaultsRef.current));
      } else {
        // First run ever — seed the server with the client defaults.
        await fetch(`${API_BASE}/api/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(defaultsRef.current),
        });
      }
      setReady(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch {
      // Offline-first: keep local defaults/last-known settings if the
      // server isn't reachable (e.g. plain `npm run dev` with no server).
      setReady(true);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  useEffect(() => {
    if (pauseWhileEditing) return;
    const interval = setInterval(load, pollSeconds * 1000);
    return () => clearInterval(interval);
  }, [pauseWhileEditing, pollSeconds, load, revision]);

  const updateSettings = useCallback((next: HouseholdSettings) => {
    setSettings(next); // optimistic — the kiosk reflects the change immediately
    fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {
      // If the server is unreachable the change still applies locally for
      // this session; it just won't be visible from the phone.
    });
  }, []);

  return { settings, ready, updateSettings };
}
