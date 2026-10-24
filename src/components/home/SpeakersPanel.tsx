import { useEffect, useState } from 'react';
import { Icon } from '../Icon';

interface Device {
  mac: string;
  name: string;
  paired: boolean;
  connected: boolean;
  audio: boolean;
}

interface State {
  available: boolean;
  powered?: boolean;
  devices?: Device[];
  error?: string;
  /** Where the wall's sound is going now. */
  output?: { available: boolean; description?: string; bluetooth?: boolean; error?: string };
}

/**
 * A short two-note chime, played the way everything on the wall plays — so
 * if it comes out of the speaker, Baja and the timers will too.
 */
function testSound() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  [660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.35;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
  window.setTimeout(() => ctx.close(), 1500);
}

function post(path: string, body: unknown = {}) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
}

/**
 * Bluetooth speakers, by touch.
 *
 * Put the speaker in pairing mode, tap Find speakers, tap its name. Once
 * it's connected, everything the wall plays — Baja, the timer chime, music —
 * comes out of it, and it reconnects by itself next time it's switched on.
 */
export function SpeakersPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/bluetooth')
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState({ available: false, error: "Couldn't reach the calendar." }));
  }, []);

  async function act(kind: 'scan' | 'connect' | 'disconnect' | 'forget' | 'useForSound', mac?: string) {
    setBusy(mac ?? kind);
    setMessage(kind === 'scan' ? 'Looking for nearby speakers… (about 12 seconds)' : null);
    const result = await (kind === 'scan' ? post('/api/bluetooth/scan') : post(`/api/bluetooth/${kind}`, { mac })).catch(() => null);
    setBusy(null);
    if (!result) {
      setMessage("Couldn't reach the calendar.");
      return;
    }
    setState(result);
    if (kind === 'connect' || kind === 'useForSound') {
      setMessage(result.ok ? 'Sound comes out of it now — tap Play a test sound to check.' : result.error);
      if (result.ok) window.setTimeout(testSound, 400);
    }
    else if (kind === 'scan') setMessage(result.devices?.length ? null : 'Nothing found. Is the speaker in pairing mode (usually a flashing light)?');
    else setMessage(null);
  }

  const devices = state?.devices ?? [];
  const mine = devices.filter((d) => d.paired);
  const nearby = devices.filter((d) => !d.paired);

  const row = (d: Device) => (
    <li className={`bt-row ${d.connected ? 'on' : ''}`} key={d.mac}>
      <span className="bt-name">
        {d.name}
        <span className="bt-state">{d.connected ? 'Connected' : d.paired ? 'Paired' : d.audio ? 'Speaker' : 'Device'}</span>
      </span>
      {d.connected ? (
        <>
          {!(state?.output?.bluetooth && state.output.description?.includes(d.name)) && (
            <button className="btn-primary" onClick={() => act('useForSound', d.mac)} disabled={!!busy}>
              {busy === d.mac ? '…' : 'Use for sound'}
            </button>
          )}
          <button className="btn-secondary" onClick={() => act('disconnect', d.mac)} disabled={!!busy}>
            Disconnect
          </button>
        </>
      ) : (
        <button className="btn-primary" onClick={() => act('connect', d.mac)} disabled={!!busy}>
          {busy === d.mac ? 'Connecting…' : 'Connect'}
        </button>
      )}
      {d.paired && !d.connected && (
        <button className="bt-forget" onClick={() => act('forget', d.mac)} disabled={!!busy} aria-label={`Forget ${d.name}`}>
          <Icon name="close" size={14} />
        </button>
      )}
    </li>
  );

  return (
    <div className="timer-overlay" onClick={onClose}>
      <div className="timer-panel bt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="timer-panel-head">
          <h2>Speakers</h2>
          <button className="timer-panel-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        {state && !state.available ? (
          <p className="bt-note">{state.error}</p>
        ) : (
          <>
            <button className="btn-secondary bt-scan" onClick={() => act('scan')} disabled={!!busy}>
              {busy === 'scan' ? 'Looking…' : 'Find speakers'}
            </button>
            {state?.output?.available && (
              <div className="bt-output">
                <span>
                  Sound is playing on <strong>{state.output.description}</strong>
                </span>
                <button className="btn-secondary" onClick={testSound}>
                  Play a test sound
                </button>
              </div>
            )}
            {message && <p className="bt-note">{message}</p>}
            {!state && <p className="bt-note">Checking Bluetooth…</p>}
            {mine.length > 0 && (
              <>
                <div className="rem-label">Yours</div>
                <ul className="bt-list">{mine.map(row)}</ul>
              </>
            )}
            {nearby.length > 0 && (
              <>
                <div className="rem-label">Nearby</div>
                <ul className="bt-list">{nearby.map(row)}</ul>
              </>
            )}
            {state && devices.length === 0 && !message && (
              <p className="bt-note">Put the speaker in pairing mode — usually holding its Bluetooth button until a light flashes — then tap Find speakers.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
