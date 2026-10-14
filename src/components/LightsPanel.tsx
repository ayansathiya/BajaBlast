import { useEffect, useRef, useState } from 'react';
import { useLights } from '../hooks/useLights';

/**
 * The lights, by hand: moods along the top, then each bulb with its switch,
 * brightness and warmth. "Save as a mood" keeps how the lights are right
 * now under a name — set them the way you like for TV, save it as "TV", and
 * "Baja, set the TV mood" does that from then on.
 */
const BLOCKED = 'The WiZ app is blocking changes. In the WiZ app: Settings → Security → choose “Allow all controls”. (Or paste your WiZ key below.)';
const BAD_KEY = 'The lights turned down the WiZ key below — check it, or clear it if WiZ is on “Allow all controls”.';

export function LightsPanel({ onClose, signingKey, onSigningKey }: { onClose: () => void; signingKey: string; onSigningKey: (key: string) => void }) {
  const { state, set, scene, scan, saveScene, rename, removeScene, refresh } = useLights(true);
  const [moodName, setMoodName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);

  function say(text: string) {
    setNote(text);
    window.setTimeout(() => setNote(null), 9000);
  }

  // Every change goes through here, so a refusal is explained wherever it came from.
  async function change(target: 'all' | string[], c: Parameters<typeof set>[1]) {
    const r = await set(target, c);
    if (!r.reached) say(r.refused === 'verified-only' ? BLOCKED : r.refused === 'bad-key' ? BAD_KEY : "Couldn't reach the light — is its wall switch on?");
  }

  const bulbs = state?.bulbs ?? [];
  const anyOnline = bulbs.some((b) => b.online);

  return (
    <div className="timer-overlay" onClick={onClose}>
      <div className="timer-panel lights-panel" onClick={(e) => e.stopPropagation()}>
        <div className="timer-panel-head">
          <h2>Lights</h2>
          <button className="timer-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!state && <p className="lights-empty">Looking for lights…</p>}

        {state && bulbs.length === 0 && (
          <div className="lights-empty">
            <p>
              No WiZ lights found{state.scanning ? ' yet — still looking…' : '.'} A bulb has to be switched on at the
              wall to be found, and in the WiZ app <strong>Allow local communication</strong> has to be on (Settings →
              Security).
            </p>
            <button className="lights-btn" onClick={scan} disabled={state.scanning}>
              {state.scanning ? 'Looking…' : 'Find lights'}
            </button>
          </div>
        )}

        {bulbs.length > 0 && (
          <>
            <div className="lights-label">Moods</div>
            <div className="lights-moods">
              {state!.scenes.map((s) => (
                <span key={s.id} className="lights-mood">
                  <button
                    onClick={async () => {
                      const r = await scene(s.name);
                      say(r.reached ? `${s.name} mood` : r.refused === 'verified-only' ? BLOCKED : r.refused === 'bad-key' ? BAD_KEY : "Couldn't reach the lights — is their wall switch on?");
                    }}
                  >
                    {s.name}
                  </button>
                  <button className="lights-mood-x" aria-label={`Delete ${s.name}`} onClick={() => removeScene(s.id).then(refresh)}>
                    ✕
                  </button>
                </span>
              ))}
              <button className="lights-mood all-off" onClick={() => change('all', { on: false })}>
                All off
              </button>
              <button className="lights-mood all-on" onClick={() => change('all', { on: true, dimming: 100 })}>
                All on
              </button>
            </div>
            <form
              className="timer-custom lights-save"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = moodName.trim();
                if (!name) return;
                const r = await saveScene(name);
                if (r.ok) {
                  setMoodName('');
                  say(`Saved. Say “Baja, set the ${name} mood”.`);
                  refresh();
                } else say(r.error || "Couldn't save that");
              }}
            >
              <input placeholder="Save how the lights are now as a mood — e.g. TV" value={moodName} maxLength={30} onChange={(e) => setMoodName(e.target.value)} />
              <button type="submit" disabled={!moodName.trim() || !anyOnline}>
                Save
              </button>
            </form>

            <div className="lights-label">Lights</div>
            <div className="lights-list">
              {bulbs.map((b) => (
                <div key={b.mac} className={`lights-row ${b.online ? '' : 'offline'}`}>
                  <div className="lights-name">
                    {editing === b.mac ? (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (draft.trim()) await rename(b.mac, draft.trim());
                          setEditing(null);
                          refresh();
                        }}
                      >
                        <input autoFocus value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onBlur={() => setEditing(null)} />
                      </form>
                    ) : (
                      <button
                        className="lights-rename"
                        onClick={() => {
                          setEditing(b.mac);
                          setDraft(b.name);
                        }}
                      >
                        {b.name} <span aria-hidden>✎</span>
                      </button>
                    )}
                    <small>{b.online ? (b.on ? `${b.dimming ?? 100}%` : 'off') : 'no power — wall switch off?'}</small>
                  </div>
                  <Slider
                    value={b.on ? b.dimming ?? 100 : 10}
                    min={10}
                    max={100}
                    step={5}
                    disabled={!b.online}
                    label={`${b.name} brightness`}
                    onSend={(v) => change([b.mac], { on: true, dimming: v })}
                  />
                  <Slider
                    className="lights-warmth"
                    value={b.temp ?? 2700}
                    min={2200}
                    max={6500}
                    step={100}
                    disabled={!b.online}
                    label={`${b.name} warmth`}
                    onSend={(v) => change([b.mac], { on: true, temp: v, dimming: b.dimming })}
                  />
                  <button
                    className={`lights-switch ${b.on ? 'on' : ''}`}
                    disabled={!b.online}
                    onClick={() => change([b.mac], { on: !b.on })}
                    aria-label={`${b.name} ${b.on ? 'off' : 'on'}`}
                  >
                    {b.on ? 'On' : 'Off'}
                  </button>
                </div>
              ))}
            </div>
            <button className="lights-btn subtle" onClick={scan} disabled={state!.scanning}>
              {state!.scanning ? 'Looking…' : 'Find new lights'}
            </button>
            <details className="lights-key">
              <summary>WiZ key (only for “Only verified controls”)</summary>
              <p>
                If the WiZ app is set to <strong>Only verified controls</strong>, the lights only take changes signed with
                your home's key. In the WiZ app: Home settings → Integrations → Local integrations, and copy the
                <code> udp_signing_key</code> (32 letters and numbers) here. On “Allow all controls”, leave this empty.
              </p>
              <input
                className="timer-panel-name"
                placeholder="udp_signing_key"
                defaultValue={signingKey}
                maxLength={64}
                onBlur={(e) => onSigningKey(e.target.value.trim())}
              />
            </details>
          </>
        )}
        {note && <div className="lights-note">{note}</div>}
      </div>
    </div>
  );
}

/**
 * A slider that follows the finger at once but tells the bulb only when the
 * finger pauses — a drag is dozens of values, and a bulb sent all of them
 * lags behind and then jumps around catching up.
 */
function Slider(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  label: string;
  className?: string;
  onSend: (v: number) => void;
}) {
  const [local, setLocal] = useState(props.value);
  const timer = useRef<number | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(props.value);
  }, [props.value]);
  return (
    <input
      className={props.className}
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={local}
      disabled={props.disabled}
      aria-label={props.label}
      onChange={(e) => {
        const v = Number(e.target.value);
        dragging.current = true;
        setLocal(v);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          dragging.current = false;
          props.onSend(v);
        }, 200);
      }}
    />
  );
}
