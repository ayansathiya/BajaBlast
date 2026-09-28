import { useSyncExternalStore } from 'react';

/**
 * One live connection for the whole app, shared by every hook that reads data.
 *
 * A module-level singleton rather than a context provider, deliberately. Every
 * data hook needs this signal, they're scattered several levels deep, and
 * threading a prop through all of them — or wrapping the tree in yet another
 * provider — buys nothing when there is exactly one connection and it lasts as
 * long as the page does.
 *
 * Hooks depend on `useLiveRevision()` instead of a timer. When the number
 * moves, something changed and they re-read. They keep a slow poll as a
 * fallback so that if the stream can't be held — a proxy that buffers, a
 * browser that's given up — the display gets stale rather than frozen.
 */

let revision = 0;
let connected = false;
let es: EventSource | null = null;
let retryTimer: number | null = null;
// The build the server was running when this page loaded. See 'hello' below.
let pageBuild: string | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Snapshot has to be a stable primitive.
 *
 * Returning an object here would allocate a new one on every render and
 * useSyncExternalStore would loop forever, so the two facts are packed into a
 * single number: revision, with the connection state as its sign bit. Ugly,
 * and much less ugly than the alternative.
 */
function snapshot(): number {
  return connected ? revision : -revision - 1;
}

export function startLive(): void {
  if (es) return; // already running; StrictMode double-invokes effects

  function connect() {
    es = new EventSource('/api/stream');

    es.addEventListener('hello', (ev) => {
      connected = true;
      emit();

      // The server restarts itself into an update, but this page is still
      // the old front end, and on a wall nobody presses reload — it used to
      // stay stale until midnight. A hello naming a different build than the
      // one this page first saw means exactly that, so load the new one.
      let build: string | null = null;
      try {
        build = JSON.parse((ev as MessageEvent).data).build ?? null;
      } catch {
        // An old server's hello; nothing to compare.
      }
      if (!build) return;
      if (pageBuild === null) pageBuild = build;
      else if (build !== pageBuild) window.location.reload();
    });

    es.addEventListener('change', () => {
      revision += 1;
      emit();
    });

    es.onerror = () => {
      connected = false;
      emit();
      // EventSource reconnects on its own while the server is merely slow, but
      // gives up once the connection is refused outright. That's exactly the
      // case that matters here — the Pi rebooting — so reconnect by hand.
      if (es && es.readyState === EventSource.CLOSED) {
        es.close();
        es = null;
        if (retryTimer) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(connect, 1000);
      }
    };
  }

  connect();
}

/** Increments whenever the server says something changed. */
export function useLiveRevision(): number {
  const packed = useSyncExternalStore(subscribe, snapshot, () => 0);
  // Mirror of snapshot()'s encoding. Not Math.abs: disconnected-at-revision-0
  // packs to -1, and abs would report that as revision 1 and trigger a
  // spurious reload the moment the connection dropped.
  return packed >= 0 ? packed : -packed - 1;
}

/** Whether the live connection is currently up. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => 0) >= 0;
}
