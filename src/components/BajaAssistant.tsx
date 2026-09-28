import { useEffect, useRef, useState } from 'react';
import { parseTimerRequest } from '../engine/kitchen';

interface Props {
  enabled: boolean;
  onAddGrocery: (label: string) => void;
  onStartTimer?: (seconds: number, label?: string) => void;
  whatsNextLines: string[];
  weatherLine?: string;
  householdContext: string; // compact text summary of today's schedule + grocery, for LLM fallback
}

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

const API_BASE = '';

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel(); // don't stack overlapping answers
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

type BajaState = 'idle' | 'listening-for-question' | 'thinking' | 'speaking';

/**
 * Baja listens continuously in the background for its own name. Say "Baja"
 * followed by a question or command in the same breath ("Baja, what's
 * next?") or just say "Baja" and pause — it'll prompt and listen for the
 * follow-up.
 *
 * A small fixed set of commands (grocery add, what's next, weather) are
 * handled instantly without any network call. Anything else is sent to
 * Claude through the local server's /api/ask proxy (which holds the API
 * key — see Settings → Voice) along with a compact summary of today's
 * schedule and the grocery list, so Baja can actually answer questions
 * about the household, not just fixed phrases.
 *
 * Like the original push-to-talk version, this is honestly NOT Siri — it's
 * built on the browser's own continuous speech recognition, which
 * typically round-trips through the OS/browser's speech service rather
 * than running fully on-device, so it needs an internet connection.
 */
export function BajaAssistant({ enabled, onAddGrocery, onStartTimer, whatsNextLines, weatherLine, householdContext }: Props) {
  const [state, setState] = useState<BajaState>('idle');
  const [caption, setCaption] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const awaitingQuestionRef = useRef(false);
  const stoppedIntentionallyRef = useRef(false);

  // A ref, not a dependency: the parent passes a fresh arrow every render,
  // and restarting speech recognition once a second would deafen it.
  const startTimerRef = useRef(onStartTimer);
  startTimerRef.current = onStartTimer;

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!enabled || !SpeechRecognition) {
      recognitionRef.current?.stop();
      return;
    }

    async function handleQuery(question: string) {
      const q = question.trim();
      if (!q) return;

      // Timers first: "set a timer for 10 minutes" is the most-said sentence
      // in any kitchen with a voice assistant in it.
      const timerAsk = parseTimerRequest(q);
      if (timerAsk && startTimerRef.current) {
        startTimerRef.current(timerAsk.seconds, timerAsk.label);
        setState('speaking');
        speak(`Timer set${timerAsk.label ? ` for ${timerAsk.label}` : ''}.`);
        setState('idle');
        return;
      }

      const addMatch = q.match(/add (.+?) to (the )?(grocery|shopping) list/);
      if (addMatch) {
        onAddGrocery(addMatch[1].trim());
        setState('speaking');
        speak(`Added ${addMatch[1].trim()} to the list.`);
        setState('idle');
        return;
      }
      if (/what'?s next|what is next/.test(q)) {
        setState('speaking');
        speak(whatsNextLines[0] || "There's nothing pressing right now.");
        setState('idle');
        return;
      }
      if (/weather/.test(q) && weatherLine) {
        setState('speaking');
        speak(weatherLine);
        setState('idle');
        return;
      }

      // Open-ended question — ask Claude via the local server proxy.
      setState('thinking');
      setCaption(q);
      try {
        const res = await fetch(`${API_BASE}/api/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, context: householdContext }),
        });
        const data = await res.json();
        setState('speaking');
        if (data.answer) {
          speak(data.answer);
          setCaption(data.answer);
        } else if (data.error === 'no-assistant') {
          speak("I don't have a way to answer that yet. Add an API key or set up a free local model in settings under Baja.");
        } else {
          speak("Sorry, I couldn't reach my brain just now.");
        }
      } catch {
        setState('speaking');
        speak("Sorry, I couldn't reach my brain just now.");
      }
      setTimeout(() => {
        setState('idle');
        setCaption(null);
      }, 4000);
    }

    function startRecognition() {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal) continue;
          const transcript: string = result[0].transcript.toLowerCase().trim();

          if (awaitingQuestionRef.current) {
            awaitingQuestionRef.current = false;
            setState('thinking');
            handleQuery(transcript);
            continue;
          }

          const bajaIndex = transcript.indexOf('baja');
          if (bajaIndex === -1) continue;

          const rest = transcript.slice(bajaIndex + 4).replace(/^[,.\s]+/, '');
          if (rest) {
            handleQuery(rest);
          } else {
            awaitingQuestionRef.current = true;
            setState('listening-for-question');
            setCaption('Yes?');
            setTimeout(() => {
              // If nothing followed within a few seconds, give up gracefully.
              if (awaitingQuestionRef.current) {
                awaitingQuestionRef.current = false;
                setState('idle');
                setCaption(null);
              }
            }, 6000);
          }
        }
      };

      recognition.onerror = (e: any) => {
        // "no-speech" and "aborted" are routine in always-listening mode —
        // just let onend restart it. Anything else, back off briefly.
      };

      recognition.onend = () => {
        if (!stoppedIntentionallyRef.current && enabled) {
          // Browsers stop continuous recognition after a while regardless —
          // this is what makes it "always listening" in practice.
          recognitionRef.current = startRecognition();
        }
      };

      recognition.start();
      return recognition;
    }

    stoppedIntentionallyRef.current = false;
    recognitionRef.current = startRecognition();

    return () => {
      stoppedIntentionallyRef.current = true;
      recognitionRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, householdContext, whatsNextLines, weatherLine]);

  if (!enabled) return null;

  return (
    <div className={`baja-indicator ${state}`}>
      <span className="baja-dot" />
      <span className="baja-label">
        {state === 'idle' && 'Baja'}
        {state === 'listening-for-question' && (caption || 'Yes?')}
        {state === 'thinking' && 'Thinking…'}
        {state === 'speaking' && (caption ? caption.slice(0, 60) : 'Baja')}
      </span>
    </div>
  );
}
