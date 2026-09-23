import { useCallback, useEffect, useState } from 'react';
import { MusicState } from '../data/models';

const API_BASE = '';

interface MusicHook {
  state: MusicState | null;
  refresh: () => Promise<void>;
  command: (action: 'play' | 'pause' | 'next' | 'previous') => Promise<void>;
  setVolume: (level: number) => Promise<void>;
  discover: () => Promise<void>;
  transfer: (deviceId: string) => Promise<void>;
}

/**
 * Speaker state, polled from the local server.
 *
 * The server is the only thing that talks to Sonos or Spotify — Sonos speaks
 * UPnP over the LAN (not reachable from a browser) and the Spotify tokens
 * deliberately never leave the kiosk.
 */
export function useMusic(pollSeconds = 8, enabled = true): MusicHook {
  const [state, setState] = useState<MusicState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/music/state`, { cache: 'no-store' });
      if (!res.ok) return;
      setState(await res.json());
    } catch {
      // Offline-first: hold on to the last known state.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = setInterval(refresh, pollSeconds * 1000);
    return () => clearInterval(t);
  }, [refresh, pollSeconds, enabled]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      try {
        await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        // Swallow: the next poll reports the real state either way.
      }
      // Speakers take a beat to report the new state back.
      setTimeout(refresh, 700);
    },
    [refresh]
  );

  return {
    state,
    refresh,
    command: (action) => post('/api/music/command', { action }),
    setVolume: (level) => post('/api/music/volume', { level }),
    discover: () => post('/api/music/discover'),
    transfer: (deviceId) => post('/api/spotify/transfer', { deviceId }),
  };
}
