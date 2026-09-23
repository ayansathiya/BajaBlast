import { useEffect, useRef, useState } from 'react';
import { ViewMode } from '../engine/calendarRange';
import { useLiveRevision } from './live';

const API_BASE = '';

export interface KioskCommand {
  seq: number;
  wake: boolean;
  view: ViewMode | null;
  /** Step the calendar by one unit of the current view, or jump to today. */
  nav: 'prev' | 'next' | 'today' | null;
  at: string | null;
}

/**
 * Lets a phone reach over and poke the kitchen display.
 *
 * The monitor isn't a touchscreen and the keyboard lives in a drawer, so
 * without this the only way out of the ambient reel is to go and find a
 * mouse. The phone posts a command, this notices and acts on it.
 *
 * Returns a counter that increments on each new command. Feed it to the idle
 * timer and it behaves exactly like someone waving at the screen — which is
 * the point: the wake path is the same one a human uses, not a second
 * mechanism that can disagree with it.
 *
 * Polled roughly once a second. That's a lot of requests on paper and
 * nothing at all in practice — it's a local server on the same machine — and
 * the alternative is a remote where pressing an arrow feels broken for two
 * seconds before anything moves.
 *
 * The first poll is swallowed deliberately. Whatever the sequence number is
 * when the page loads is history — replaying it would mean a reload always
 * yanked the display to whatever was last pressed.
 */
export function useKioskRemote(onCommand: (command: KioskCommand) => void, pollSeconds = 30): number {
  const [wakeSignal, setWakeSignal] = useState(0);
  // The stream tells us the instant a button is pressed. The poll below is the
  // fallback for when it isn't connected, which is why it went from just over
  // a second to half a minute: nobody is waiting on it any more.
  const revision = useLiveRevision();
  const lastSeq = useRef<number | null>(null);
  const handler = useRef(onCommand);
  handler.current = onCommand;

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/api/kiosk/state`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const state: KioskCommand & { commands?: KioskCommand[] } = await res.json();

        if (lastSeq.current === null) {
          lastSeq.current = state.seq; // establish the baseline, act on nothing
          return;
        }
        if (state.seq === lastSeq.current) return;

        // Replay every command we haven't applied, in order. Two quick arrow
        // presses have to move two steps, not one — reading only the latest
        // command would silently drop the first.
        const pending = (state.commands ?? [])
          .filter((c) => c.seq > lastSeq.current!)
          .sort((a, b) => a.seq - b.seq);

        lastSeq.current = state.seq;
        for (const command of pending.length ? pending : [state]) {
          handler.current(command);
          if (command.wake) setWakeSignal((n) => n + 1);
        }
      } catch {
        // Server not up yet, or briefly unreachable. The next tick retries.
      }
    }

    poll();
    const t = setInterval(poll, pollSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pollSeconds, revision]);

  return wakeSignal;
}
