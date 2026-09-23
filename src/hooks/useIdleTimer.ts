import { useEffect, useRef, useState } from 'react';

/**
 * Feature 20/11 — after `timeoutSeconds` of no meaningful interaction, flips
 * to idle. Any real input (mouse move beyond a tiny threshold, click, key,
 * touch) wakes it immediately. A small movement threshold avoids waking on
 * accidental vibration/jitter from a touch display.
 *
 * `wakeSignal` is the remote equivalent: bump it and the display wakes as if
 * someone had touched it. That's how the phone gets the kiosk out of ambient
 * mode without a keyboard or mouse anywhere near the kitchen — and routing it
 * through the same reset as a real input means the two can't disagree.
 */
export function useIdleTimer(timeoutSeconds: number, enabled: boolean, wakeSignal = 0): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setIsIdle(false);
      return;
    }

    const reset = () => {
      setIsIdle(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setIsIdle(true), timeoutSeconds * 1000);
    };

    const onMove = (e: MouseEvent) => {
      const prev = lastPos.current;
      lastPos.current = { x: e.clientX, y: e.clientY };
      if (prev && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 4) return; // ignore jitter
      reset();
    };

    const onWake = () => reset();

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onWake);
    window.addEventListener('keydown', onWake);
    window.addEventListener('touchstart', onWake);
    window.addEventListener('wheel', onWake);

    reset();

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onWake);
      window.removeEventListener('keydown', onWake);
      window.removeEventListener('touchstart', onWake);
      window.removeEventListener('wheel', onWake);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutSeconds, enabled, wakeSignal]);

  return isIdle;
}
