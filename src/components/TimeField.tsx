import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { parseTime, showTime } from '../engine/when';

interface Props {
  /** HH:MM, as stored. */
  value: string;
  onChange: (hhmm: string) => void;
  style?: CSSProperties;
}

/**
 * A time you type — "6am", "11pm", "7:30" — instead of the browser's time
 * picker, which on the wall's touch screen is a cramped wheel you can't type
 * into. Saved the moment what's typed makes sense; until then, a hint says
 * what it's waiting for.
 */
export function TimeField({ value, onChange, style }: Props) {
  const [text, setText] = useState(showTime(value || '00:00'));
  const parsed = parseTime(text);

  // Follow changes made elsewhere (another screen, a phone).
  useEffect(() => {
    if (parseTime(text) !== value) setText(showTime(value || '00:00'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="time-field">
      <input
        style={style}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const next = parseTime(e.target.value);
          if (next && next !== value) onChange(next);
        }}
        onBlur={() => parsed && setText(showTime(parsed))}
        placeholder="7am"
      />
      {!parsed && <div className="when-hint bad">Try "7am" or "22:30"</div>}
    </div>
  );
}
