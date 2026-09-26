import { useEffect, useRef } from 'react';

interface Entry {
  key: string;
  label: string;
  icon: string;
  onPick: () => void;
}

interface Props {
  open: boolean;
  entries: Entry[];
  onToggle: () => void;
  onClose: () => void;
}

/**
 * One button in the corner, instead of a row of them.
 *
 * Every screen worth opening — recipes, the browser, settings — used to want
 * its own circle down there, and three circles competing for attention in the
 * corner of a calendar is three too many. So there's one, and it opens a
 * short list.
 *
 * The list is deliberately short. If it ever needs scrolling, the answer is
 * fewer entries, not a smaller font: this is meant to be used with a thumb,
 * from a step back, by someone holding a mixing bowl.
 */
export function KioskMenu({ open, entries, onToggle, onClose }: Props) {
  const root = useRef<HTMLDivElement | null>(null);

  // Tapping anywhere else puts it away. Without this the menu sits open over
  // the calendar until someone thinks to press the button again.
  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent | TouchEvent) {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    }
    // Deferred: the click that opened the menu is still travelling, and
    // without the delay it closes it again in the same gesture.
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', away);
      window.addEventListener('touchstart', away);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', away);
      window.removeEventListener('touchstart', away);
    };
  }, [open, onClose]);

  return (
    <div className="kiosk-menu" ref={root}>
      {open && (
        <div className="kiosk-menu-list" role="menu">
          {entries.map((entry) => (
            <button
              key={entry.key}
              className="kiosk-menu-item"
              role="menuitem"
              onClick={() => {
                onClose();
                entry.onPick();
              }}
            >
              <span className="kiosk-menu-icon" aria-hidden="true">
                {entry.icon}
              </span>
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <button
        className={`touch-menu ${open ? 'open' : ''}`}
        onClick={onToggle}
        aria-label="Menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <circle cx="5" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
