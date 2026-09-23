import { useState } from 'react';
import type { CSSProperties } from 'react';
import { CalendarEvent, HouseholdSettings, RecurrenceRule, eventPeople } from '../data/models';
import { parseOccurrenceId } from '../engine/recurrence';

const BUILT_IN = [
  'school', 'work', 'sports', 'meal', 'medical', 'social',
  'travel', 'birthday', 'holiday', 'household', 'entertainment', 'other',
];

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export type SaveScope = 'one' | 'all';

interface Props {
  /** The occurrence being edited, or null for a brand-new event. */
  event: CalendarEvent | null;
  settings: HouseholdSettings;
  inputStyle: CSSProperties;
  onSave: (draft: Partial<CalendarEvent>, scope: SaveScope) => Promise<void>;
  onDelete: (scope: SaveScope) => Promise<void>;
  onCancel: () => void;
}

function toLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * One form for creating and editing, because they're the same shape and two
 * forms would drift apart.
 *
 * The part worth care is the bottom: when the thing you're editing is one
 * occurrence of a repeat, saving has to ask whether you meant this Tuesday or
 * every Tuesday. Getting that wrong in either direction is infuriating — a
 * cancelled lesson that wipes the term, or a permanent time change that only
 * takes for one week — so it's an explicit choice rather than a guess.
 */
export function EventEditor({ event, settings, inputStyle, onSave, onDelete, onCancel }: Props) {
  const isNew = !event;
  const startParts = toLocalInputs(event?.start ?? new Date().toISOString());
  const endParts = toLocalInputs(event?.end ?? new Date(Date.now() + 3600e3).toISOString());

  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(startParts.date);
  const [start, setStart] = useState(startParts.time);
  const [end, setEnd] = useState(endParts.time);
  const [location, setLocation] = useState(event?.location?.label ?? '');
  const [category, setCategory] = useState(event?.category ?? 'other');
  const [personIds, setPersonIds] = useState<string[]>(event ? eventPeople(event) : []);
  const [repeats, setRepeats] = useState(!!event?.recurrence || !!event?.recurrenceParentId);
  const [rule, setRule] = useState<RecurrenceRule>(
    event?.recurrence ?? { freq: 'weekly', interval: 1, byWeekday: [new Date(event?.start ?? Date.now()).getDay()] }
  );
  const [busy, setBusy] = useState(false);

  // Only an occurrence of a repeat needs the this-one-or-all question.
  const partOfSeries = !!event?.recurrenceParentId;
  const [scope, setScope] = useState<SaveScope>('one');

  const categories = [...BUILT_IN, ...settings.customCategories.map((c) => c.id)];

  function togglePerson(id: string) {
    setPersonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function toggleWeekday(day: number) {
    setRule((r) => {
      const days = r.byWeekday ?? [];
      const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
      return { ...r, byWeekday: next.length ? next : [day] };
    });
  }

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const draft: Partial<CalendarEvent> = {
        title: title.trim(),
        start: new Date(`${date}T${start}:00`).toISOString(),
        end: new Date(`${date}T${end}:00`).toISOString(),
        location: location.trim() ? { label: location.trim() } : undefined,
        category,
        personIds,
        // Clear the legacy single field so the two can't disagree later.
        personId: undefined,
        calendarId: 'household',
        importance: event?.importance ?? 2,
        recurrence: repeats ? rule : undefined,
      };
      await onSave(draft, partOfSeries ? scope : 'all');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="event-editor">
      <div className="settings-row" style={{ display: 'block', borderTop: 'none' }}>
        <div className="field-label">Title</div>
        <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Piano lesson" />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <div className="field-label">Date</div>
          <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="field-label">Start</div>
          <input style={inputStyle} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="field-label">End</div>
          <input style={inputStyle} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <div style={{ flex: 2 }}>
          <div className="field-label">Location</div>
          <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="field-label">Category</div>
          <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => {
              const custom = settings.customCategories.find((x) => x.id === c);
              return (
                <option key={c} value={c}>
                  {custom ? custom.label : c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="field-label">Who it's for</div>
        <div className="person-picker">
          {settings.people.map((p) => (
            <button
              key={p.id}
              className={`person-chip ${personIds.includes(p.id) ? 'on' : ''}`}
              style={personIds.includes(p.id) ? { borderColor: p.color, color: p.color } : undefined}
              onClick={() => togglePerson(p.id)}
            >
              <span className="person-chip-dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
        <div className="settings-row-desc" style={{ marginTop: 8 }}>
          Pick as many as apply. None selected means it's everyone's.
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <label className="repeat-toggle">
          <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} />
          <span>Repeats</span>
        </label>

        {repeats && (
          <div className="repeat-fields">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <div className="field-label">How often</div>
                <select
                  style={inputStyle}
                  value={rule.freq}
                  onChange={(e) => setRule({ ...rule, freq: e.target.value as RecurrenceRule['freq'] })}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div style={{ width: 110 }}>
                <div className="field-label">Every</div>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  max={52}
                  value={rule.interval ?? 1}
                  onChange={(e) => setRule({ ...rule, interval: Math.max(1, Number(e.target.value)) })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className="field-label">Until (optional)</div>
                <input
                  style={inputStyle}
                  type="date"
                  value={rule.until ?? ''}
                  onChange={(e) => setRule({ ...rule, until: e.target.value || undefined })}
                />
              </div>
            </div>

            {rule.freq === 'weekly' && (
              <div style={{ marginTop: 14 }}>
                <div className="field-label">On these days</div>
                <div className="weekday-picker">
                  {DOW.map((label, i) => (
                    <button
                      key={i}
                      className={`weekday ${rule.byWeekday?.includes(i) ? 'on' : ''}`}
                      onClick={() => toggleWeekday(i)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {partOfSeries && (
        <div className="scope-picker">
          <div className="field-label">This change applies to</div>
          <div className="scope-options">
            <button className={`scope ${scope === 'one' ? 'on' : ''}`} onClick={() => setScope('one')}>
              Only this one
            </button>
            <button className={`scope ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>
              All of them
            </button>
          </div>
          <div className="settings-row-desc" style={{ marginTop: 8 }}>
            {scope === 'one'
              ? 'Just this date changes. The rest of the series stays as it is.'
              : 'Every occurrence changes, including ones already past.'}
          </div>
        </div>
      )}

      <div className="editor-actions">
        <button className="btn-primary" onClick={save} disabled={busy || !title.trim()}>
          {isNew ? 'Add event' : 'Save changes'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {!isNew && (
          <button
            className="btn-delete"
            style={{ marginLeft: 'auto' }}
            onClick={() => onDelete(partOfSeries ? scope : 'all')}
          >
            {partOfSeries ? (scope === 'one' ? 'Delete this one' : 'Delete all') : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

export { parseOccurrenceId };
