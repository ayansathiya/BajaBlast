import { useEffect, useState } from 'react';
import { FamilyPhoto } from '../data/models';
import { useLiveRevision } from './live';

const API_BASE = '';

export function usePhotos(pollSeconds = 30): FamilyPhoto[] {
  const revision = useLiveRevision();
  const [photos, setPhotos] = useState<FamilyPhoto[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/photos`);
        if (!res.ok) return;
        const items = await res.json();
        if (!cancelled) setPhotos(items);
      } catch {
        // offline-first: keep whatever we already have
      }
    }
    load();
    const interval = setInterval(load, pollSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollSeconds, revision]);

  return photos;
}
