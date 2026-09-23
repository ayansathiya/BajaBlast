import { useEffect, useState } from 'react';

/** Feature 29 — updates on real second boundaries rather than a fixed 1000ms drift-prone interval. */
export function useClock(tickSeconds = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const n = new Date();
      const msToNextTick = tickSeconds ? 1000 - n.getMilliseconds() : 60000 - (n.getSeconds() * 1000 + n.getMilliseconds());
      timeout = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, Math.max(msToNextTick, 50));
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [tickSeconds]);

  return now;
}
