import { useEffect, useMemo, useRef, useState } from 'react';
import { PartyGuest, PartyState, PartyTip, Reveal } from '../../hooks/useParty';
import { qrToSvg } from '../../engine/qr';

interface Props {
  party: PartyState;
  now: Date;
  reducedMotion: boolean;
  onReveal: (guestId: string) => Promise<Reveal>;
  onEveryone: () => Promise<PartyState>;
  onHost: () => void;
  /** Bumped by the host's "Show every team" in setup. */
  showEveryone: number;
}

type Stage =
  | { kind: 'names' }
  | { kind: 'confirm'; guest: PartyGuest }
  | { kind: 'reveal'; result: Reveal; settled: boolean }
  | { kind: 'everyone'; party: PartyState }
  | { kind: 'tip' };

/** "Raj and Meena", "Raj, Meena and Arjun". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Say it out loud through Baja's voice, if the Pi has one. Silent otherwise. */
function announce(text: string) {
  fetch('/api/voice/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch(() => URL.revokeObjectURL(url));
    })
    .catch(() => undefined);
}

/**
 * The wall when guests arrive.
 *
 * Built like the front of a programme, not an app screen: a welcome set big,
 * one line of instruction, and the guest list in the same serif as the
 * headline, alphabetical, nothing around it. The colour is held back for the
 * moment it means something — your team — and then it takes the whole wall.
 *
 * Tapping a name asks "Is this you?" first: a wrong tap would spoil someone
 * else's reveal, and there's no taking it back.
 */
export function PartyWelcome({ party, now, reducedMotion, onReveal, onEveryone, onHost, showEveryone }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'names' });
  const back = () => setStage({ kind: 'names' });
  const tipOn = !!(party.tip?.enabled && (party.tip.mode === 'tap' || party.tip.handle));
  // A finished reveal goes on to the coffee page, if the host set one up.
  const afterReveal = () => (tipOn ? setStage({ kind: 'tip' }) : back());

  // Nothing is left waiting on the wall: an unanswered "Is this you?" or a
  // finished reveal goes back to the names by itself.
  useEffect(() => {
    if (stage.kind === 'confirm') {
      const t = window.setTimeout(back, 12000);
      return () => window.clearTimeout(t);
    }
    if (stage.kind === 'reveal' && stage.settled) {
      const t = window.setTimeout(afterReveal, 14000);
      return () => window.clearTimeout(t);
    }
    if (stage.kind === 'tip') {
      const t = window.setTimeout(back, 30000);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (showEveryone) onEveryone().then((p) => setStage({ kind: 'everyone', party: p }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEveryone]);

  const teamOf = useMemo(() => new Map(party.teams.map((t) => [t.id, t])), [party.teams]);
  const total = party.guests.length;
  const columns = total <= 4 ? 2 : total <= 9 ? 3 : total <= 28 ? 4 : 5;
  const here = party.guests.filter((g) => g.revealed).length;
  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  async function reveal(guest: PartyGuest) {
    const result = await onReveal(guest.id);
    if (!result || !result.team) return back();
    setStage({ kind: 'reveal', result, settled: reducedMotion });
  }

  return (
    <div className="party" role="region" aria-label={`${party.title} — find your team`}>
      <header className="party-top">
        <span>{party.title}</span>
        <span>{dateLine}</span>
        <span className="party-top-count">
          {party.teams.length} teams · {total} guests
        </span>
      </header>

      <div className="party-hello">
        <h1>
          Welcome in<span>.</span>
        </h1>
        <p>Find your name, and meet your team.</p>
      </div>

      {/* Down each column, A to Z, the way a list is read when looking for one name. */}
      <ul
        className={`party-names ${total > 24 ? 'dense' : ''}`}
        style={{ gridTemplateRows: `repeat(${Math.max(1, Math.ceil(total / columns))}, auto)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {party.guests.map((g, i) => {
          const team = g.teamId ? teamOf.get(g.teamId) : null;
          return (
            <li key={g.id} style={{ animationDelay: `${Math.min(i, 30) * 35}ms` }}>
              <button
                className={team ? 'told' : ''}
                style={team ? { ['--team' as string]: team.color } : undefined}
                onClick={() => setStage({ kind: 'confirm', guest: g })}
              >
                <span className="party-name">{g.name}</span>
                {team && <span className="party-name-team">{team.name}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="party-foot">
        <div className="party-standings" aria-label="Teams so far">
          {party.teams.map((t) => (
            <div key={t.id} className="party-standing" style={{ ['--team' as string]: t.color, flexGrow: Math.max(1, t.size) }}>
              <div className="party-bar">
                <i style={{ width: t.size ? `${(t.here / t.size) * 100}%` : 0 }} />
              </div>
              <div className="party-standing-label">
                <b>{t.name}</b>
                <span>
                  {t.here} of {t.size}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="party-host">
          <span>
            {here} of {total} here
          </span>
          <button onClick={onHost}>Host</button>
        </div>
      </footer>

      {stage.kind === 'confirm' && <Confirm guest={stage.guest} onYes={() => reveal(stage.guest)} onNo={back} />}

      {stage.kind === 'reveal' && (
        <TeamReveal
          result={stage.result}
          teams={party.teams}
          settled={stage.settled}
          reducedMotion={reducedMotion}
          onSettled={() => {
            setStage({ ...stage, settled: true });
            const r = stage.result;
            announce(`${r.guest}, you're on team ${r.team.name}!`);
          }}
          onDone={afterReveal}
        />
      )}

      {stage.kind === 'tip' && <Coffee tip={party.tip} title={party.title} onDone={back} />}

      {stage.kind === 'everyone' && <Everyone party={stage.party} onDone={back} />}
    </div>
  );
}

function Confirm({ guest, onYes, onNo }: { guest: PartyGuest; onYes: () => void; onNo: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="party-confirm" onClick={onNo}>
      <div onClick={(e) => e.stopPropagation()}>
        <p>{guest.revealed ? 'Welcome back,' : 'Is this you?'}</p>
        <h2>{guest.name}</h2>
        <div className="party-confirm-actions">
          <button
            className="party-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onYes();
            }}
          >
            {guest.revealed ? 'Show my team again' : 'Yes — show me my team'}
          </button>
          <button className="party-btn quiet" onClick={onNo}>
            Not me
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The reveal. A beat of suspense — the team names turning over, slowing,
 * like a departures board settling — then the wall becomes the team's colour
 * from the middle outwards, with the name set as large as the screen allows.
 */
function TeamReveal({
  result,
  teams,
  settled,
  reducedMotion,
  onSettled,
  onDone,
}: {
  result: Reveal;
  teams: { id: string; name: string; color: string }[];
  settled: boolean;
  reducedMotion: boolean;
  onSettled: () => void;
  onDone: () => void;
}) {
  const [showing, setShowing] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (settled || reducedMotion) {
      if (!done.current) {
        done.current = true;
        if (reducedMotion) onSettled();
      }
      return;
    }
    // Twenty-odd turns, each a little slower, finishing on the real team.
    const steps: number[] = [];
    let wait = 60;
    while (steps.reduce((a, b) => a + b, 0) < 2600) {
      steps.push(wait);
      wait *= 1.13;
    }
    const start = teams.findIndex((t) => t.id === result.team.id);
    let i = 0;
    let timer = 0;
    const tick = () => {
      i += 1;
      // Count so the last step lands on the right team.
      setShowing((((start - (steps.length - i)) % teams.length) + teams.length) % teams.length);
      if (i < steps.length) timer = window.setTimeout(tick, steps[i]);
      else timer = window.setTimeout(() => {
        done.current = true;
        onSettled();
      }, 380);
    };
    timer = window.setTimeout(tick, steps[0]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spinning = teams[showing] ?? result.team;
  const { team } = result;
  const more = result.size - 1 - result.teammates.length;
  const withWho =
    result.teammates.length === 0
      ? `You’re the first one here.${more > 0 ? ` ${more} more to come.` : ''}`
      : `With ${listOf(result.teammates)}.${more > 0 ? ` ${more} more to come.` : ''}`;

  return (
    <div
      className={`party-reveal ${settled ? 'settled' : ''}`}
      style={{ ['--team' as string]: team.color, ['--team-ink' as string]: team.ink }}
      onClick={settled ? onDone : undefined}
    >
      {!settled && (
        <div className="party-spin">
          <p>{result.guest}, you’re on team</p>
          <h2 key={showing} style={{ ['--spin' as string]: spinning.color }}>
            {spinning.name}
          </h2>
        </div>
      )}
      {settled && (
        <div className="party-landed">
          <p>{result.guest}, you’re on team</p>
          <h2>{team.name}</h2>
          <p className="party-with">{withWho}</p>
          <button className="party-done" onClick={onDone}>
            Done
          </button>
        </div>
      )}
      {settled && <div className="party-timer" aria-hidden />}
    </div>
  );
}

/**
 * What a phone's camera should open: Messages, to the maker, with a note
 * filled in. Apple Cash is sent from inside Messages — there's no link that
 * opens Apple Cash itself — so this gets the guest one tap away from it.
 * A ten-digit number is taken as American.
 */
function messagesLink(handle: string, title: string): string {
  const to = /^\d{10}$/.test(handle) ? `+1${handle}` : handle;
  const withNote = `sms:${to}&body=${encodeURIComponent(`A coffee for the ${title} screen!`)}`;
  // The QR encoder tops out around 108 characters.
  return withNote.length <= 100 ? withNote : `sms:${to}`;
}

function safeQr(text: string): string | null {
  try {
    return qrToSvg(text, { size: 260, quiet: 2 });
  } catch {
    return null;
  }
}

/**
 * One more page after the reveal, in the maker's own voice: "I made this
 * whole screen… buy me a coffee!" Set like the rest — big serif,
 * one line of explanation — with the code on a white card because a phone
 * camera needs dark-on-light to read it. Easy to walk past: "Maybe later",
 * or it goes by itself.
 */
function Coffee({ tip, title, onDone }: { tip: PartyTip; title: string; onDone: () => void }) {
  const tap = tip.mode !== 'qr';
  const qr = useMemo(() => (tap ? null : safeQr(messagesLink(tip.handle, title))), [tap, tip.handle, title]);
  return (
    <div className="party-coffee" onClick={onDone}>
      <div className="party-coffee-inner" onClick={(e) => e.stopPropagation()}>
        <div className="party-coffee-words">
          <div className="party-kicker">One more thing</div>
          <h2>
            Liked that<span>?</span>
          </h2>
          <p className="party-coffee-lede">
            {tip.name ? `Hi, I’m ${tip.name}. I made` : 'I made'} this whole screen. If it made you smile, buy me a coffee!
          </p>
          {tap ? (
            <ol className="party-coffee-steps">
              <li>
                <span>Hold your iPhone near my phone, next to this screen</span>
              </li>
              <li>
                <span>Choose an amount, and send</span>
              </li>
            </ol>
          ) : (
            <ol className="party-coffee-steps">
              <li>
                <span>Point your iPhone camera at the code</span>
              </li>
              <li>
                <span>It opens Messages to me</span>
              </li>
              <li>
                <span>
                  Tap <b>Apple Cash</b>, choose an amount, send
                </span>
              </li>
            </ol>
          )}
          <button className="party-btn quiet party-coffee-later" onClick={onDone}>
            Maybe later
          </button>
        </div>
        {qr && <div className="party-coffee-qr" aria-label="QR code for Apple Cash in Messages" dangerouslySetInnerHTML={{ __html: qr }} />}
        {tap && (
          // Two phones meeting, pointing to the side of the screen the phone sits on.
          <svg className="party-coffee-tap" viewBox="0 0 220 200" aria-hidden>
            <rect x="24" y="36" width="72" height="136" rx="14" />
            <rect x="124" y="28" width="72" height="136" rx="14" transform="rotate(8 160 96)" />
            <path className="wave" d="M104 84q6 12 0 24" />
            <path className="wave w2" d="M112 76q11 20 0 40" />
          </svg>
        )}
      </div>
      <div className="party-timer slow" aria-hidden />
    </div>
  );
}

/** Game time: every team and who's on it, side by side. */
function Everyone({ party, onDone }: { party: PartyState; onDone: () => void }) {
  return (
    <div className="party-everyone">
      <header>
        <h2>The teams</h2>
        <button className="party-btn quiet" onClick={onDone}>
          Back
        </button>
      </header>
      <div className="party-everyone-cols" style={{ gridTemplateColumns: `repeat(${party.teams.length}, minmax(0, 1fr))` }}>
        {party.teams.map((t) => (
          <section key={t.id} style={{ ['--team' as string]: t.color }}>
            <h3>{t.name}</h3>
            <ul>
              {(t.members ?? []).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
