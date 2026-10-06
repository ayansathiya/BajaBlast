import { useEffect, useRef, useState } from 'react';
import { parseTimerRequest } from '../engine/kitchen';
import { VoiceStatus, onVoice } from '../hooks/live';

interface Props {
  enabled: boolean;
  onAddGrocery: (label: string) => void;
  onStartTimer?: (seconds: number, label?: string) => void;
  whatsNextLines: string[];
  weatherLine?: string;
  /** Today's Thirukkural, in English, for "Baja, what's today's kural?" */
  kuralLine?: string;
  householdContext: string; // compact text summary of today's schedule + grocery, for LLM fallback
}

type BajaState = 'idle' | 'listening-for-question' | 'thinking' | 'speaking';

/**
 * Only the screen in the kitchen answers. The microphone is on that machine,
 * and a laptop with the calendar open in a tab would otherwise answer every
 * question a second time from the next room.
 */
const IS_WALL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function post(path: string, body?: unknown) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

const mic = (word: 'listen' | 'mute' | 'unmute') => post('/api/voice/command', { word }).catch(() => undefined);

/**
 * Say it out loud, and resolve when it's finished.
 *
 * The Pi's voice first (Piper, or espeak — see app/voice.cjs), because
 * Chromium on a Pi has no voices of its own and speechSynthesis there is
 * silent. The browser's voices are the fallback, for a Mac. The microphone is
 * muted while Baja talks, or it would hear itself and answer.
 */
async function speak(text: string): Promise<void> {
  await mic('mute');
  try {
    const res = await post('/api/voice/say', { text }).catch(() => null);
    if (res && res.ok) {
      const url = URL.createObjectURL(await res.blob());
      try {
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      return;
    }
    if ('speechSynthesis' in window && window.speechSynthesis.getVoices().length > 0) {
      window.speechSynthesis.cancel(); // don't stack overlapping answers
      await new Promise<void>((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    }
  } finally {
    await mic('unmute');
  }
}

/**
 * Baja listens for its own name. Say "Baja" and a question in the same
 * breath ("Baja, what's next?"), or "Baja", a pause, and then the question —
 * or tap the microphone button and just ask.
 *
 * The listening happens on the Pi itself (app/voice.cjs): an offline speech
 * recogniser reading the microphone, which tells this page what it heard
 * over the live stream. The browser's built-in recogniser can't do it —
 * on a Pi it needs a Google key only Chrome has, and failed silently.
 *
 * A small fixed set of commands (timers, the grocery list, what's next, the
 * weather, today's kural) are answered instantly here. Anything else goes to
 * Claude through the local server's /api/ask proxy, with a compact summary
 * of today's schedule and the grocery list so it can answer about the house.
 */
export function BajaAssistant({ enabled, onAddGrocery, onStartTimer, whatsNextLines, weatherLine, kuralLine, householdContext }: Props) {
  const [state, setState] = useState<BajaState>('idle');
  const [caption, setCaption] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const clearTimer = useRef<number | null>(null);

  // Refs, not dependencies: the parent passes fresh values every second, and
  // the subscription below should live as long as Baja is switched on.
  const latest = useRef({ onAddGrocery, onStartTimer, whatsNextLines, weatherLine, kuralLine, householdContext });
  latest.current = { onAddGrocery, onStartTimer, whatsNextLines, weatherLine, kuralLine, householdContext };

  function settle(afterMs: number) {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => {
      setState('idle');
      setCaption(null);
    }, afterMs);
  }

  async function answer(text: string) {
    setState('speaking');
    setCaption(text);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    await speak(text);
    settle(4000);
  }

  async function handleQuery(question: string) {
    const q = question.trim().toLowerCase();
    if (!q) return;
    const { onAddGrocery, onStartTimer, whatsNextLines, weatherLine, kuralLine, householdContext } = latest.current;

    // Timers first: "set a timer for 10 minutes" is the most-said sentence
    // in any kitchen with a voice assistant in it.
    const timerAsk = parseTimerRequest(q);
    if (timerAsk && onStartTimer) {
      onStartTimer(timerAsk.seconds, timerAsk.label);
      return answer(`Timer set${timerAsk.label ? ` for ${timerAsk.label}` : ''}.`);
    }

    const addMatch = q.match(/add (.+?) to (the )?(grocery|shopping) list/);
    if (addMatch) {
      onAddGrocery(addMatch[1].trim());
      return answer(`Added ${addMatch[1].trim()} to the list.`);
    }
    if (/what'?s next|what is next/.test(q)) return answer(whatsNextLines[0] || "There's nothing pressing right now.");
    if (/weather/.test(q) && weatherLine) return answer(weatherLine);
    if (/\b(kural|kurl|couplet|thiru)/.test(q) && kuralLine) return answer(kuralLine);

    // Open-ended question — ask Claude via the local server proxy.
    setState('thinking');
    setCaption(q);
    try {
      const res = await post('/api/ask', { question: q, context: householdContext });
      const data = await res.json();
      if (data.answer) return answer(data.answer);
      if (data.error === 'no-assistant') {
        return answer("I don't have a way to answer that yet. Add an API key or set up a free local model in settings under Baja.");
      }
      return answer("Sorry, I couldn't reach my brain just now.");
    } catch {
      return answer("Sorry, I couldn't reach my brain just now.");
    }
  }

  useEffect(() => {
    if (!enabled || !IS_WALL) return;
    fetch('/api/voice/status')
      .then((r) => r.json())
      .then(setVoice)
      .catch(() => undefined);

    return onVoice((msg) => {
      if (msg.type === 'status' && msg.status) {
        setVoice(msg.status);
      } else if (msg.type === 'wake' || msg.type === 'listening') {
        if (clearTimer.current) window.clearTimeout(clearTimer.current);
        setState('listening-for-question');
        setCaption('Yes?');
      } else if (msg.type === 'partial' && msg.text) {
        setCaption(msg.text);
      } else if (msg.type === 'heard' && msg.text) {
        handleQuery(msg.text);
      } else if (msg.type === 'timeout') {
        setState('idle');
        setCaption(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || !IS_WALL) return null;

  const ready = voice?.state === 'listening';
  const busy = state !== 'idle';

  function tap() {
    if (busy) return;
    if (!ready) {
      setShowStatus(true);
      window.setTimeout(() => setShowStatus(false), 8000);
      return;
    }
    mic('listen');
  }

  let bubble: string | null = null;
  if (busy) {
    bubble = state === 'thinking' ? `“${caption}” — thinking…` : caption;
  } else if (showStatus && voice) {
    bubble =
      voice.state === 'installing'
        ? `Baja is getting ready: ${voice.step ?? 'setting up'} This happens once.`
        : voice.state === 'error'
          ? `Baja can't listen: ${voice.error}`
          : voice.state === 'starting'
            ? 'Baja is starting up…'
            : 'Baja is off.';
  }

  return (
    <>
      {bubble && (
        <div className={`baja-bubble ${state}`} role="status" onClick={() => setShowStatus(false)}>
          <span className="baja-bubble-name">Baja</span>
          {bubble}
        </div>
      )}
      <button
        className={`baja-mic ${state} ${ready ? 'ready' : voice?.state ?? 'starting'}`}
        onClick={tap}
        aria-label={ready ? 'Ask Baja' : 'Baja status'}
        title={ready ? 'Say “Baja…”, or tap and ask' : voice?.step ?? voice?.error ?? 'Baja'}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}
