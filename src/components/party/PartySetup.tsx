import { FormEvent, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { PartyState } from '../../hooks/useParty';

interface Props {
  party: PartyState;
  household: string[];
  onSetup: (body: { title: string; teams: { name: string }[]; guests: string[] }) => Promise<PartyState>;
  onOpen: (open: boolean) => void;
  onRedraw: () => void;
  onShowEveryone: () => void;
  onClose: () => void;
}

/** "11 guests in teams of 4, 4 and 3" — the sizes the draw will produce. */
function shape(guests: number, teams: number): string {
  if (guests === 0) return 'Add the guests, and they’ll be drawn into teams at random.';
  const base = Math.floor(guests / teams);
  const extra = guests % teams;
  const sizes = [...Array(extra).fill(base + 1), ...Array(teams - extra).fill(base)];
  const list = sizes.length > 1 ? `${sizes.slice(0, -1).join(', ')} and ${sizes[sizes.length - 1]}` : String(sizes[0]);
  const who = `${guests} ${guests === 1 ? 'guest' : 'guests'}`;
  return base === 0 ? `${who} — that’s fewer people than teams.` : extra === 0 ? `${who}, ${teams} teams of ${base}.` : `${who} in teams of ${list}.`;
}

/**
 * Setting up the draw, beforehand.
 *
 * Two columns and no boxes: the left says what the teams are, the right says
 * who's coming. Every change saves itself, and the draw is made again on
 * the Pi each time — but nobody's team is ever shown here, so the host can
 * play too.
 */
export function PartySetup({ party, household, onSetup, onOpen, onRedraw, onShowEveryone, onClose }: Props) {
  const [title, setTitle] = useState(party.title);
  const [teams, setTeams] = useState(party.teams.map((t) => t.name));
  const [guests, setGuests] = useState(party.guests.map((g) => g.name));
  const [adding, setAdding] = useState('');
  const [confirmRedraw, setConfirmRedraw] = useState(false);
  const first = useRef(true);
  const addBox = useRef<HTMLInputElement | null>(null);

  // Save a moment after the last change — and straight away on the way out,
  // so a name typed just before "Open the doors" isn't left behind.
  const pending = useRef<number | null>(null);
  const draft = () => ({ title, teams: teams.map((name) => ({ name })), guests });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = window.setTimeout(() => {
      pending.current = null;
      onSetup(draft());
    }, 350);
    return () => {
      if (pending.current) window.clearTimeout(pending.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, teams, guests]);

  async function flush() {
    if (pending.current) {
      window.clearTimeout(pending.current);
      pending.current = null;
      await onSetup(draft());
    }
  }

  function setCount(n: number) {
    setTeams((current) => Array.from({ length: n }, (_, i) => current[i] ?? party.palette[i].name));
  }

  function add(e?: FormEvent) {
    e?.preventDefault();
    // A pasted list works too: "Raj, Meena, Arjun".
    const names = adding
      .split(/[,\n]/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (!names.length) return;
    setGuests((g) => [...g, ...names.filter((n) => !g.some((x) => x.toLowerCase() === n.toLowerCase()))]);
    setAdding('');
    addBox.current?.focus();
  }

  const missingFamily = household.filter((n) => !guests.some((g) => g.toLowerCase() === n.toLowerCase()));
  const told = party.guests.filter((g) => g.revealed).length;

  return (
    <div className="party-setup" role="dialog" aria-label="Set up party teams">
      <header className="party-setup-head">
        <div>
          <div className="party-kicker">Party teams</div>
          <h2>Set up the draw</h2>
        </div>
        <button className="party-icon-btn" onClick={() => flush().then(onClose)} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className="party-setup-body">
        <section className="party-setup-col">
          <label className="party-field">
            <span>What’s the occasion</span>
            <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Thanksgiving" />
          </label>

          <div className="party-field">
            <span>How many teams</span>
            <div className="party-count" role="radiogroup" aria-label="Number of teams">
              {[2, 3, 4, 5, 6].map((n) => (
                <button key={n} role="radio" aria-checked={teams.length === n} className={teams.length === n ? 'on' : ''} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="party-field">
            <span>Team names</span>
            <ol className="party-team-names">
              {teams.map((name, i) => (
                <li key={i} style={{ ['--team' as string]: party.palette[i].color }}>
                  <i aria-hidden />
                  <input
                    value={name}
                    maxLength={24}
                    aria-label={`Team ${i + 1} name`}
                    onChange={(e) => setTeams((t) => t.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="party-setup-col">
          <div className="party-field">
            <span>
              Who’s coming <em>{guests.length || ''}</em>
            </span>
            <form className="party-add" onSubmit={add}>
              <input ref={addBox} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a name — or several, with commas" />
              <button type="submit" disabled={!adding.trim()}>
                Add
              </button>
            </form>
            {missingFamily.length > 0 && (
              <button className="party-link" onClick={() => setGuests((g) => [...g, ...missingFamily])}>
                + Add the family ({missingFamily.join(', ')})
              </button>
            )}
          </div>

          <ul className="party-guest-list">
            {guests.map((name) => (
              <li key={name}>
                {name}
                <button aria-label={`Remove ${name}`} onClick={() => setGuests((g) => g.filter((x) => x !== name))}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="party-setup-foot">
        <p>
          {shape(guests.length, teams.length)}
          {guests.length > 0 && told === 0 && <> Drawn at random; secret until each person taps their name.</>}
          {told > 0 && <> {told} {told === 1 ? 'has' : 'have'} seen their team, and keep it.</>}
        </p>
        <div className="party-actions">
          {told > 0 &&
            (confirmRedraw ? (
              <button
                className="party-btn quiet"
                onClick={() => {
                  onRedraw();
                  setConfirmRedraw(false);
                }}
              >
                Yes — forget every reveal and draw again
              </button>
            ) : (
              <button className="party-btn quiet" onClick={() => setConfirmRedraw(true)}>
                Draw again
              </button>
            ))}
          {party.open && (
            <button
              className="party-btn quiet"
              onClick={async () => {
                await flush();
                onShowEveryone();
                onClose();
              }}
            >
              Show every team on the wall
            </button>
          )}
          {party.open ? (
            <button className="party-btn quiet" onClick={() => onOpen(false)}>
              Put the welcome screen away
            </button>
          ) : null}
          <button
            className="party-btn"
            disabled={guests.length < teams.length}
            onClick={async () => {
              await flush();
              onOpen(true);
              onClose();
            }}
          >
            {party.open ? 'Back to the welcome screen' : 'Open the doors'}
          </button>
        </div>
      </footer>
    </div>
  );
}
