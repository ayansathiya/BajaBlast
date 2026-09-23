interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose?: () => void;
  /** Shows the .com / .org / slash row. Off for plain text like a recipe search. */
  urlMode?: boolean;
  submitLabel?: string;
}

/**
 * A keyboard, because the wall has none.
 *
 * The whole point of this display is that it hangs in the kitchen with
 * nothing plugged into it. Every other screen is read-only or a set of
 * buttons, but searching for a recipe and typing a web address both need
 * letters, and "go and fetch the keyboard from the drawer" is not a feature.
 *
 * Deliberately not the OS keyboard: Electron on a Mac has no on-screen one to
 * summon, and Chromium's touch keyboard on the Pi needs a compositor flag and
 * then covers half the screen at a size nobody chose. Thirty buttons in a
 * component is less machinery than either.
 *
 * Lowercase only. Recipe searches and URLs are both case-insensitive, and a
 * shift key would be one more thing to miss with a thumb.
 */
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export function TouchKeyboard({ value, onChange, onSubmit, onClose, urlMode = false, submitLabel = 'Search' }: Props) {
  const type = (ch: string) => onChange(value + ch);

  return (
    <div className="tkb">
      {ROWS.map((row, i) => (
        <div className="tkb-row" key={i}>
          {i === 2 && (
            <button className="tkb-key tkb-wide" onClick={() => onChange(value.slice(0, -1))} aria-label="Backspace">
              ⌫
            </button>
          )}
          {row.split('').map((ch) => (
            <button className="tkb-key" key={ch} onClick={() => type(ch)}>
              {ch}
            </button>
          ))}
          {i === 2 && (
            <button className="tkb-key tkb-wide tkb-go" onClick={onSubmit}>
              {submitLabel}
            </button>
          )}
        </div>
      ))}

      <div className="tkb-row">
        {urlMode ? (
          <>
            <button className="tkb-key" onClick={() => type('.')}>
              .
            </button>
            <button className="tkb-key" onClick={() => type('/')}>
              /
            </button>
            <button className="tkb-key" onClick={() => type('-')}>
              -
            </button>
            <button className="tkb-key tkb-space" onClick={() => type(' ')}>
              space
            </button>
            <button className="tkb-key tkb-wide" onClick={() => type('.com')}>
              .com
            </button>
          </>
        ) : (
          <>
            {'0123456789'.split('').map((ch) => (
              <button className="tkb-key" key={ch} onClick={() => type(ch)}>
                {ch}
              </button>
            ))}
            <button className="tkb-key tkb-space" onClick={() => type(' ')}>
              space
            </button>
          </>
        )}
        <button className="tkb-key tkb-wide" onClick={() => onChange('')}>
          clear
        </button>
        {onClose && (
          <button className="tkb-key tkb-wide" onClick={onClose}>
            hide
          </button>
        )}
      </div>
    </div>
  );
}
