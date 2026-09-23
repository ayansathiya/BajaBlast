import { useEffect, useRef } from 'react';

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Starts the day fresh, and recovers from the Mac sleeping.
 *
 * Two things go stale on a display that runs for months without anyone
 * touching it:
 *
 *   1. **Midnight.** The clock itself is fine — it re-reads the system time
 *      every tick — but everything derived from "today" was fetched
 *      yesterday: the calendar window, the headline cache, the weather
 *      snapshot, the idle reel's date label. Rather than chase each one, the
 *      whole page reloads once when the local date changes. Nobody is
 *      standing at a kitchen display at midnight, so a reload costs nothing
 *      and eliminates a whole category of "why is it showing yesterday".
 *
 *   2. **Waking up.** When the Mac sleeps at 11pm and wakes at 6am, timers
 *      resume mid-flight and the Wi-Fi usually isn't up yet, so the first
 *      few fetches fail and the next retry may be ten minutes away — long
 *      enough to walk into the kitchen and see stale everything. A jump in
 *      wall-clock time much larger than the interval that produced it is the
 *      giveaway, so that triggers a reload too, after a short grace period
 *      for the network to come back.
 *
 * `enabled` exists so the settings panel can hold it off — reloading while
 * someone is typing an API key into a form would be its own bug.
 */
export function useDailyReload(enabled = true, checkSeconds = 30, wakeThresholdMs = 5 * 60 * 1000) {
  const dayRef = useRef(localDayKey(new Date()));
  const lastSeenRef = useRef(Date.now());
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      // Keep the marks current while paused, so closing the panel doesn't
      // immediately look like a seven-hour jump.
      lastSeenRef.current = Date.now();
      dayRef.current = localDayKey(new Date());
      return;
    }

    function reload(reason: string) {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      // eslint-disable-next-line no-console
      console.log(`[baja-blast] reloading: ${reason}`);
      window.location.reload();
    }

    function check() {
      const now = new Date();
      const elapsed = now.getTime() - lastSeenRef.current;
      lastSeenRef.current = now.getTime();

      // Far more time passed than the timer that woke us — the machine slept.
      if (elapsed > wakeThresholdMs) {
        window.setTimeout(() => reload('woke from sleep'), 20_000);
        return;
      }

      const key = localDayKey(now);
      if (key !== dayRef.current) {
        dayRef.current = key;
        reload('new day');
      }
    }

    const interval = window.setInterval(check, checkSeconds * 1000);
    // A resumed machine fires visibilitychange before the interval does.
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    };
  }, [enabled, checkSeconds, wakeThresholdMs]);
}
