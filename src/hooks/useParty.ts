import { useCallback, useEffect, useState } from 'react';
import { useLiveRevision } from './live';

export interface PartyTeam {
  id: string;
  name: string;
  color: string;
  ink: string;
  size: number;
  here: number;
  members?: string[];
}

export interface PartyGuest {
  id: string;
  name: string;
  /** Only once this guest has seen it (or on the host's "every team" view). */
  teamId: string | null;
  revealed: boolean;
}

export interface PartyTip {
  enabled: boolean;
  /** 'tap': a phone beside the screen (Tap to Cash). 'qr': a code that opens Messages. */
  mode: 'tap' | 'qr';
  /** Who made the screen — "buy {name} a coffee". */
  name: string;
  /** The phone number or email their Apple Cash is on. */
  handle: string;
}

export interface PartyState {
  title: string;
  tip: PartyTip;
  open: boolean;
  drawnAt: string | null;
  palette: { name: string; color: string; ink: string }[];
  teams: PartyTeam[];
  guests: PartyGuest[];
}

export interface Reveal {
  guest: string;
  team: { id: string; name: string; color: string; ink: string };
  teammates: string[];
  size: number;
}

const send = (path: string, method: string, body?: unknown) =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json());

/** Party teams (app/party.cjs), re-read whenever anything in the house changes. */
export function useParty() {
  const [party, setParty] = useState<PartyState | null>(null);
  const revision = useLiveRevision();

  const refresh = useCallback(
    () =>
      fetch('/api/party')
        .then((r) => r.json())
        .then(setParty)
        .catch(() => undefined),
    []
  );

  useEffect(() => {
    refresh();
  }, [refresh, revision]);

  return {
    party,
    refresh,
    setup: (body: { title?: string; teams?: { name: string }[]; guests?: string[]; tip?: PartyTip }) =>
      send('/api/party/setup', 'PUT', body).then((p: PartyState) => {
        setParty(p);
        return p;
      }),
    setOpen: (open: boolean) => send('/api/party/open', 'POST', { open }).then(setParty),
    redraw: () => send('/api/party/redraw', 'POST').then(setParty),
    reveal: (guestId: string) => send('/api/party/reveal', 'POST', { guestId }) as Promise<Reveal>,
    everyone: () => fetch('/api/party?all=1').then((r) => r.json()) as Promise<PartyState>,
  };
}
