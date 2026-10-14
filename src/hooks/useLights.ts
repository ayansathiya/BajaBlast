import { useCallback, useEffect, useState } from 'react';
import { useLiveRevision } from './live';
import { LightChange } from '../engine/lights';

export interface Bulb {
  mac: string;
  name: string;
  ip: string;
  online: boolean;
  on: boolean;
  dimming?: number;
  temp?: number;
  color?: [number, number, number];
}

export interface LightsState {
  bulbs: Bulb[];
  scenes: { id: string; name: string }[];
  scanning: boolean;
}

function post(path: string, body: unknown) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
}

/**
 * The WiZ lights (app/lights.cjs). Re-read whenever the household's data
 * changes (a light renamed, a mood saved) and, while `watch` is on, every
 * few seconds — the WiZ app or a wall switch can change a bulb behind our back.
 */
export function useLights(watch = false) {
  const [state, setState] = useState<LightsState | null>(null);
  const revision = useLiveRevision();

  const refresh = useCallback(() => {
    return fetch('/api/lights')
      .then((r) => r.json())
      .then((s: LightsState) => setState(s))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, revision]);

  useEffect(() => {
    if (!watch) return;
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, [watch, refresh]);

  const set = useCallback(
    async (target: 'all' | string[], change: LightChange) => {
      const result = await post('/api/lights/set', { target, ...change }).catch(() => ({ ok: false, reached: 0 }));
      refresh();
      return result as { ok: boolean; reached: number; of: number };
    },
    [refresh]
  );

  const scene = useCallback(
    async (name: string) => {
      const result = await post('/api/lights/scene', { name }).catch(() => ({ ok: false, reached: 0 }));
      refresh();
      return result as { ok: boolean; reached: number; of: number; name?: string };
    },
    [refresh]
  );

  const scan = useCallback(async () => {
    setState((s) => (s ? { ...s, scanning: true } : s));
    const result = await post('/api/lights/scan', {}).catch(() => null);
    if (result) setState(result);
  }, []);

  const saveScene = useCallback((name: string) => post('/api/lights/scenes', { name }), []);
  const rename = useCallback((mac: string, name: string) => post('/api/lights/rename', { mac, name }), []);
  const removeScene = useCallback((id: string) => fetch(`/api/lights/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' }), []);

  return { state, set, scene, scan, saveScene, rename, removeScene, refresh };
}
