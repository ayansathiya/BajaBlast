import { ViewMode, canStep, rangeLabel } from '../engine/calendarRange';

interface Props {
  mode: ViewMode;
  anchor: Date;
  now: Date;
  onMode: (mode: ViewMode) => void;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
}

const MODES: ViewMode[] = ['day', 'week', 'month'];

/**
 * The one piece of chrome on an otherwise chrome-free display.
 *
 * Kept to a single line — the range on the left where the "TODAY" heading
 * used to be, controls on the right — so switching views doesn't cost the
 * calendar any vertical space.
 */
export function ViewSwitcher({ mode, anchor, now, onMode, onStep, onToday }: Props) {
  const atToday =
    anchor.getFullYear() === now.getFullYear() &&
    anchor.getMonth() === now.getMonth() &&
    anchor.getDate() === now.getDate();

  return (
    <div className="view-switcher">
      <div className="view-range">{rangeLabel(anchor, mode, now)}</div>

      <div className="view-controls">
        {!atToday && (
          <button className="view-today" onClick={onToday}>
            Today
          </button>
        )}
        <button
          className="view-arrow"
          onClick={() => onStep(-1)}
          disabled={!canStep(anchor, mode, -1, now)}
          aria-label="Previous"
        >
          ‹
        </button>
        <button
          className="view-arrow"
          onClick={() => onStep(1)}
          disabled={!canStep(anchor, mode, 1, now)}
          aria-label="Next"
        >
          ›
        </button>
        <div className="view-modes">
          {MODES.map((m) => (
            <button
              key={m}
              className={`view-mode ${m === mode ? 'active' : ''}`}
              onClick={() => onMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
