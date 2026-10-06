import { useEffect, useState } from 'react';
import { dayKey } from '../engine/morning';

export interface Kural {
  n: number;
  chapter: number;
  book: string;
  tamil: [string, string];
  transliteration: [string, string];
  meaning: string;
}

/**
 * Today's Thirukkural, fetched once a day (app/kural.cjs picks it: Kural 1
 * on the first day, then one a day, in order, round again after 1,330).
 */
export function useDailyKural(now: Date, enabled: boolean): Kural | null {
  const day = dayKey(now);
  const [kural, setKural] = useState<Kural | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/kural?day=${day}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((k) => live && setKural(k))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [day, enabled]);
  return enabled ? kural : null;
}

/**
 * The kural of the day, small, in the space beside the date.
 *
 * The Tamil first, as written; then the transliteration, for anyone who
 * speaks it but doesn't read the script; then what it means. Small enough to
 * leave the calendar alone, large enough to read standing at the counter.
 */
export function DailyKural({ kural, variant = 'header' }: { kural: Kural | null; variant?: 'header' | 'morning' }) {
  if (!kural) return null;
  // Two lines, as the couplet is written — except beside the date, where
  // there's room for one: there the pair runs on with a slash between, the
  // way verse is quoted inside a sentence.
  const split = variant === 'header' ? ' / ' : <br />;
  return (
    <section className={`kural kural-${variant}`} aria-label={`Thirukkural ${kural.n}`}>
      <div className="kural-label">
        Thirukkural <span className="kural-num">{kural.n}</span>
      </div>
      <div className="kural-tamil" lang="ta">
        {kural.tamil[0]}
        {split}
        {kural.tamil[1]}
      </div>
      <div className="kural-translit">
        {kural.transliteration[0]}
        {split}
        {kural.transliteration[1]}
      </div>
      <div className="kural-meaning">{kural.meaning}</div>
    </section>
  );
}
