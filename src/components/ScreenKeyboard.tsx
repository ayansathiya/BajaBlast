import { useEffect, useRef, useState } from 'react';

/**
 * A keyboard for the wall, for every text box on it.
 *
 * The display hangs in the kitchen with nothing plugged into it, and settings,
 * events, timers, recipe searches and web addresses all need letters. So one
 * keyboard, owned by the app rather than by each screen: tap any text box and
 * it comes up along the bottom; tap anything else and it goes away.
 *
 * It types into whatever box has focus, the same way a real keyboard does —
 * through the element's own value and an `input` event, so every React form
 * on the wall works with it unchanged. Enter is a real Enter keypress, so
 * "press Enter to search" works too. Keys never take focus themselves
 * (pointerdown is cancelled), which is what keeps the cursor in the box.
 *
 * Deliberately not the OS keyboard: Chromium on the Pi needs compositor
 * flags for one and then it covers half the screen at a size nobody chose,
 * and Electron on a Mac has none to summon.
 */

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'number', 'password', '']);

function isTextField(el: Element | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return false;
}

const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const NUMBERS = '1234567890';
const SYMBOLS = ['@#$%&*()-+', "'\":;!?/=_", ',.'];

/** Types into a field the way a keyboard would, so React sees an ordinary edit. */
function insert(el: Field, text: string) {
  let start = el.value.length;
  let end = start;
  try {
    // Number and email inputs have no selection API; they just append.
    if (el.selectionStart !== null && el.selectionEnd !== null) {
      start = el.selectionStart;
      end = el.selectionEnd;
    }
  } catch {
    /* no selection on this input type */
  }
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setValue(el, next);
  try {
    el.setSelectionRange(start + text.length, start + text.length);
  } catch {
    /* see above */
  }
}

function backspace(el: Field) {
  let start = el.value.length;
  let end = start;
  try {
    if (el.selectionStart !== null && el.selectionEnd !== null) {
      start = el.selectionStart;
      end = el.selectionEnd;
    }
  } catch {
    /* no selection on this input type */
  }
  if (start === end && start === 0) return;
  const from = start === end ? start - 1 : start;
  setValue(el, el.value.slice(0, from) + el.value.slice(end));
  try {
    el.setSelectionRange(from, from);
  } catch {
    /* see above */
  }
}

function setValue(el: Field, value: string) {
  // React tracks the last value it set; going through the prototype's setter
  // is what makes it notice this change and fire onChange.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(el: Field) {
  if (el instanceof HTMLTextAreaElement) {
    insert(el, '\n');
    return;
  }
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  // A plain form with a submit button expects Enter to submit it.
  if (notCancelled && el.form) el.form.requestSubmit?.();
}

interface Props {
  /** Show it even on a screen with no touch — Settings → On-screen keyboard. */
  always: boolean;
}

export function ScreenKeyboard({ always }: Props) {
  const [field, setField] = useState<Field | null>(null);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const hideTimer = useRef<number | null>(null);
  // Someone typing on a real keyboard doesn't want this one in the way.
  const physical = useRef(false);

  useEffect(() => {
    const touchScreen = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
    let lastTouch = 0;

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        lastTouch = Date.now();
        physical.current = false;
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (!isTextField(el)) return;
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      const wanted = always || touchScreen || Date.now() - lastTouch < 1500;
      if (!wanted || physical.current) return;
      setField(el);
      setShift(false);
      setSymbols(el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'tel'));
      // Keep the box in sight above the keyboard.
      window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    };
    const onFocusOut = () => {
      // Focus often hops straight to the next box; only hide if it doesn't.
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (!isTextField(document.activeElement)) setField(null);
      }, 120);
    };
    const onKey = (e: KeyboardEvent) => {
      // Our own Enter is synthetic; a real key means there's a real keyboard.
      if (e.isTrusted && e.key.length === 1) {
        physical.current = true;
        setField(null);
      }
    };

    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [always]);

  // A box that's been removed from the page (its panel closed) takes the
  // keyboard with it.
  useEffect(() => {
    if (!field) return;
    const t = window.setInterval(() => {
      if (!field.isConnected) setField(null);
    }, 500);
    return () => window.clearInterval(t);
  }, [field]);

  if (!field) return null;

  const urlish = field instanceof HTMLInputElement && (field.type === 'url' || field.type === 'email' || field.dataset.kb === 'url');

  // Every key acts on pointerdown and cancels it, so the text box keeps focus
  // and the cursor stays where it was.
  const key = (label: string, action: () => void, className = '') => (
    <button
      type="button"
      key={label}
      className={`skb-key ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        action();
      }}
      tabIndex={-1}
    >
      {label}
    </button>
  );

  const typeChar = (ch: string) => {
    insert(field, shift ? ch.toUpperCase() : ch);
    if (shift) setShift(false);
  };

  return (
    <div className="skb" role="group" aria-label="On-screen keyboard">
      <div className="skb-row">{NUMBERS.split('').map((ch) => key(ch, () => insert(field, ch)))}</div>
      {(symbols ? SYMBOLS : LETTERS).map((row, i) => (
        <div className="skb-row" key={i}>
          {i === 2 && !symbols && key(shift ? '⬆︎' : '⇧', () => setShift((v) => !v), `skb-wide ${shift ? 'on' : ''}`)}
          {row.split('').map((ch) => key(shift && !symbols ? ch.toUpperCase() : ch, () => (symbols ? insert(field, ch) : typeChar(ch))))}
          {i === 2 && key('⌫', () => backspace(field), 'skb-wide')}
        </div>
      ))}
      <div className="skb-row">
        {key(symbols ? 'abc' : '#+=', () => setSymbols((v) => !v), 'skb-wide')}
        {urlish ? (
          <>
            {key('@', () => insert(field, '@'))}
            {key('/', () => insert(field, '/'))}
            {key('.com', () => insert(field, '.com'), 'skb-wide')}
          </>
        ) : (
          key(',', () => insert(field, ','))
        )}
        {key('space', () => insert(field, ' '), 'skb-space')}
        {key('.', () => insert(field, '.'))}
        {key(field instanceof HTMLTextAreaElement ? 'return' : 'enter', () => pressEnter(field), 'skb-wide skb-go')}
        {key('hide', () => {
          field.blur();
          setField(null);
        }, 'skb-wide')}
      </div>
    </div>
  );
}
