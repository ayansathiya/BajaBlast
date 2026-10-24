import { ReminderItem } from '../../hooks/useReminders';
import { showWhen } from '../../engine/when';
import { Icon } from '../Icon';

interface Props {
  items: ReminderItem[];
  now: Date;
  onToggle: (item: ReminderItem) => void;
  onOpen: () => void;
  max?: number;
}

/**
 * The reminders themselves, on the home screen — not a count of them.
 *
 * Due ones first (in coral), then the next ones coming, then the ones with
 * no time. Tick one off right here; "+3 more" opens the full list.
 */
export function HomeReminders({ items, now, onToggle, onOpen, max = 4 }: Props) {
  const open = items.filter((r) => !r.done);
  if (open.length === 0) return null;
  const isDue = (r: ReminderItem) => !!r.due && Date.parse(r.due) <= now.getTime();
  const shown = open.slice(0, max);

  return (
    <section className="home-reminders">
      <button className="home-reminders-head" onClick={onOpen}>
        <span className="extras-label">Reminders</span>
      </button>
      <ul>
        {shown.map((r) => (
          <li key={r.id} className={isDue(r) ? 'due' : ''}>
            <button className="home-rem-check" onClick={() => onToggle(r)} aria-label={`Done: ${r.text}`}>
              <Icon name="check" size={14} />
            </button>
            <span className="home-rem-text">{r.text}</span>
            <span className="home-rem-when">{isDue(r) ? 'Now' : r.due ? showWhen(r.due, now) : ''}</span>
          </li>
        ))}
      </ul>
      {open.length > shown.length && (
        <button className="home-rem-more" onClick={onOpen}>
          +{open.length - shown.length} more
        </button>
      )}
    </section>
  );
}
