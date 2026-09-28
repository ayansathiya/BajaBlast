import { useEffect, useRef, useState } from 'react';
import { KitchenTimer } from '../data/models';
import { formatCountdown, isRinging, sortTimers, timerProgress, timerRemaining } from '../engine/kitchen';
import { TimerAction } from '../hooks/useKitchen';

/* ------------------------------------------------------------------ *
 * The ring — a thin circle that empties as the time runs out
 * ------------------------------------------------------------------ */

function Ring({ progress, size = 44, ringing }: { progress: number; size?: number; ringing: boolean }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg className="timer-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="timer-ring-track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className={`timer-ring-fill ${ringing ? 'ringing' : ''}`}
        strokeDasharray={c}
        strokeDashoffset={ringing ? 0 : c * progress}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * In the rail
 * ------------------------------------------------------------------ */

interface RailProps {
  timers: KitchenTimer[];
  nowMs: number;
  onAct: (id: string, action: TimerAction, seconds?: number) => void;
  onOpen: () => void;
}

/**
 * First thing in the rail while anything is counting. Big digits: this is
 * read from the stove, sideways, with steam in the way.
 */
export function RailTimers({ timers, nowMs, onAct, onOpen }: RailProps) {
  if (timers.length === 0) return null;
  const sorted = sortTimers(timers, nowMs);

  return (
    <div className="rail-section timers-rail">
      <div className="uppercase-label rail-label">
        Timers
        <button className="rail-count rail-link" onClick={onOpen}>
          + New
        </button>
      </div>
      {sorted.slice(0, 3).map((t) => {
        const left = timerRemaining(t, nowMs);
        const ringing = isRinging(t, nowMs);
        const paused = t.remainingMs != null;
        return (
          <div className={`timer-row ${ringing ? 'ringing' : ''} ${paused ? 'paused' : ''}`} key={t.id}>
            <Ring progress={timerProgress(t, nowMs)} ringing={ringing} />
            <div className="timer-row-text">
              <div className="timer-row-time tabular">{formatCountdown(left)}</div>
              <div className="timer-row-label">{paused ? `${t.label} · paused` : t.label}</div>
            </div>
            <div className="timer-row-actions">
              {ringing ? (
                <button onClick={() => onAct(t.id, 'dismiss')}>Done</button>
              ) : (
                <>
                  <button onClick={() => onAct(t.id, 'add', 60)}>+1</button>
                  <button onClick={() => onAct(t.id, paused ? 'resume' : 'pause')}>{paused ? '▶' : '❙❙'}</button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {sorted.length > 3 && <div className="timer-more">+{sorted.length - 3} more</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Over the idle reel
 * ------------------------------------------------------------------ */

/**
 * The idle reel covers the rail, and a timer that vanishes because nobody
 * touched the screen for two minutes is a burnt dinner. So running timers
 * float over it — small, bottom-left, out of the photos' way.
 */
export function IdleTimers({ timers, nowMs }: { timers: KitchenTimer[]; nowMs: number }) {
  const running = sortTimers(timers, nowMs).filter((t) => !isRinging(t, nowMs));
  if (running.length === 0) return null;
  return (
    <div className="idle-timers">
      {running.slice(0, 4).map((t) => (
        <div className="idle-timer" key={t.id}>
          <span className="idle-timer-time tabular">{formatCountdown(timerRemaining(t, nowMs))}</span>
          <span className="idle-timer-label">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * When one goes off
 * ------------------------------------------------------------------ */

/**
 * A short two-note chime, made on the spot with Web Audio — no sound file to
 * ship, and nothing for the updater to forget.
 *
 * Best effort. The monitor may well have no speakers, and a browser that
 * hasn't been told to allow sound without a tap will stay silent, which is why
 * the banner is what does the real work.
 */
let audio: AudioContext | null = null;
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio = audio ?? new Ctx();
    if (audio.state === 'suspended') audio.resume().catch(() => undefined);
    const t0 = audio.currentTime + 0.02;
    [880, 1318.5, 880, 1318.5].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = t0 + i * 0.22;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 0.22);
    });
  } catch {
    // No audio device, or not allowed. The banner still shows.
  }
}

interface AlarmProps {
  timers: KitchenTimer[];
  nowMs: number;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
  sound: boolean;
}

/**
 * Across the top of everything, over the idle reel and over any open panel:
 * the one thing on this screen allowed to interrupt. Chimes every few seconds
 * for the first two minutes, then every twenty, until someone says done.
 */
export function TimerAlarm({ timers, nowMs, onDismiss, onSnooze, sound }: AlarmProps) {
  const ringing = timers.filter((t) => isRinging(t, nowMs));
  const lastChime = useRef(0);

  const oldestOverdue = ringing.reduce((max, t) => Math.max(max, -timerRemaining(t, nowMs)), 0);
  useEffect(() => {
    if (!sound || ringing.length === 0) return;
    const gap = oldestOverdue < 120_000 ? 4000 : 20_000;
    if (nowMs - lastChime.current >= gap) {
      lastChime.current = nowMs;
      chime();
    }
  }, [sound, ringing.length, nowMs, oldestOverdue]);

  // Any key dismisses the oldest ringing timer — the kitchen has a keyboard
  // in a drawer, and "hit space" is the fastest thing with wet hands.
  useEffect(() => {
    if (ringing.length === 0) return;
    const first = ringing[0].id;
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss(first);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ringing.length, ringing[0]?.id, onDismiss]);

  if (ringing.length === 0) return null;

  return (
    <div className="timer-alarm" role="alert">
      {ringing.map((t) => (
        <div className="timer-alarm-row" key={t.id}>
          <div className="timer-alarm-label">{t.label}</div>
          <div className="timer-alarm-over tabular">done {formatCountdown(timerRemaining(t, nowMs)).slice(1)} ago</div>
          <div className="timer-alarm-actions">
            <button onClick={() => onSnooze(t.id)}>+1 min</button>
            <button className="primary" onClick={() => onDismiss(t.id)}>
              Done
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Starting one on the wall
 * ------------------------------------------------------------------ */

const PRESETS = [1, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60];

interface PanelProps {
  timers: KitchenTimer[];
  nowMs: number;
  onStart: (seconds: number, label?: string) => void;
  onAct: (id: string, action: TimerAction, seconds?: number) => void;
  onClose: () => void;
}

/**
 * Most timers are one of a dozen lengths, so those are single taps. A name is
 * optional — "10 min" is a fine name when there's only one thing on.
 */
export function TimerPanel({ timers, nowMs, onStart, onAct, onClose }: PanelProps) {
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState('');

  function start(minutes: number) {
    if (!(minutes > 0)) return;
    onStart(Math.round(minutes * 60), label.trim() || undefined);
    setLabel('');
    setCustom('');
  }

  return (
    <div className="timer-overlay" onClick={onClose}>
      <div className="timer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="timer-panel-head">
          <h2>Timers</h2>
          <button className="timer-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <input
          className="timer-panel-name"
          placeholder="What's it for? (optional)"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
        />

        <div className="timer-presets">
          {PRESETS.map((m) => (
            <button key={m} onClick={() => start(m)}>
              <span className="tabular">{m}</span>
              <small>min</small>
            </button>
          ))}
        </div>

        <form
          className="timer-custom"
          onSubmit={(e) => {
            e.preventDefault();
            start(Number(custom));
          }}
        >
          <input
            inputMode="decimal"
            placeholder="Other — minutes"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <button type="submit" disabled={!(Number(custom) > 0)}>
            Start
          </button>
        </form>

        {timers.length > 0 && (
          <div className="timer-panel-list">
            {sortTimers(timers, nowMs).map((t) => {
              const paused = t.remainingMs != null;
              const ringing = isRinging(t, nowMs);
              return (
                <div className={`timer-panel-row ${ringing ? 'ringing' : ''}`} key={t.id}>
                  <span className="tabular timer-panel-time">{formatCountdown(timerRemaining(t, nowMs))}</span>
                  <span className="timer-panel-label">{t.label}</span>
                  {!ringing && <button onClick={() => onAct(t.id, 'add', 60)}>+1 min</button>}
                  {!ringing && <button onClick={() => onAct(t.id, paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</button>}
                  <button onClick={() => onAct(t.id, 'dismiss')}>{ringing ? 'Done' : 'Cancel'}</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="timer-panel-note">Timers started here ring on this screen and show on every phone. You can also say “Baja, set a timer for 10 minutes.”</div>
      </div>
    </div>
  );
}
