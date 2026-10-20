import { useState } from 'react';
import { ReminderItem } from '../../hooks/useReminders';
import { parseWhen, showWhen } from '../../engine/when';
import { Icon } from '../Icon';

interface Props {
  items: ReminderItem[];
  now: Date;
  onAdd: (text: string, due: string | null) => Promise<void>;
  onToggle: (item: ReminderItem) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/**
 * Reminders, from the wall.
 *
 * What, and — if it has one — when, in two boxes you can fill with the
 * on-screen keyboard: "Bins out" / "tonight 8pm". A reminder with a time
 * lights the screen and goes to the top of the calendar when it's due; one
 * without just waits here until someone ticks it.
 */
export function RemindersPanel({ items, now, onAdd, onToggle, onRemove, onClose }: Props) {
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const parsed = parseWhen(when, now);

  async function add() {
    if (!text.trim() || !parsed) return;
    const due = parsed.date ? new Date(`${parsed.date}T${parsed.time ?? '09:00'}:00`).toISOString() : null;
    await onAdd(text.trim(), due);
    setText('');
    setWhen('');
  }

  const open = items.filter((r) => !r.done);
  const due = open.filter((r) => r.due && Date.parse(r.due) <= now.getTime());
  const later = open.filter((r) => r.due && Date.parse(r.due) > now.getTime());
  const anytime = open.filter((r) => !r.due);
  const done = items.filter((r) => r.done).slice(0, 6);

  const row = (r: ReminderItem) => (
    <li className={`rem-row ${r.done ? 'done' : ''}`} key={r.id}>
      <button className="rem-check" onClick={() => onToggle(r)} aria-label={r.done ? 'Not done' : 'Done'}>
        {r.done && <Icon name="check" size={16} />}
      </button>
      <span className="rem-text">
        {r.text}
        {r.due && <span className="rem-when">{showWhen(r.due, now)}</span>}
      </span>
      <button className="rem-x" onClick={() => onRemove(r.id)} aria-label={`Delete ${r.text}`}>
        <Icon name="close" size={14} />
      </button>
    </li>
  );

  return (
    <div className="timer-overlay" onClick={onClose}>
      <div className="timer-panel rem-panel" onClick={(e) => e.stopPropagation()}>
        <div className="timer-panel-head">
          <h2>Reminders</h2>
          <button className="timer-panel-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="rem-add">
          <input
            className="timer-panel-name"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Remind us to…"
          />
          <div className="rem-add-row">
            <input
              className="timer-panel-name"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="When? (tonight 8pm, fri, or leave empty)"
            />
            <button className="btn-primary" onClick={add} disabled={!text.trim() || !parsed}>
              Add
            </button>
          </div>
          <div className={`when-hint ${parsed ? '' : 'bad'}`}>
            {!when.trim()
              ? 'No time — it waits here until it’s ticked off'
              : parsed && parsed.date
                ? `→ ${showWhen(new Date(`${parsed.date}T${parsed.time ?? '09:00'}:00`).toISOString(), now)}${parsed.time ? '' : ', 9:00 AM'}`
                : 'Try "tomorrow 5pm", "fri 8am" or "oct 25"'}
          </div>
        </div>

        <div className="rem-lists">
          {due.length > 0 && (
            <>
              <div className="rem-label urgent">Now</div>
              <ul>{due.map(row)}</ul>
            </>
          )}
          {later.length > 0 && (
            <>
              <div className="rem-label">Coming up</div>
              <ul>{later.map(row)}</ul>
            </>
          )}
          {anytime.length > 0 && (
            <>
              <div className="rem-label">Anytime</div>
              <ul>{anytime.map(row)}</ul>
            </>
          )}
          {open.length === 0 && <div className="rem-empty">Nothing to remember. Add one above, or from a phone.</div>}
          {done.length > 0 && (
            <>
              <div className="rem-label">Done</div>
              <ul>{done.map(row)}</ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
