import { useState } from 'react';
import { CalendarEvent, MealDay, Person, WallNote, eventPeople } from '../data/models';
import { formatClock, isSameDay } from '../engine/intelligence';
import { KitchenReminder } from '../engine/kitchen';

/*
 * What fills the day view once today's events have been listed.
 *
 * A quiet Monday used to be one line — "Nothing scheduled today" — above
 * seven hundred pixels of black. On a screen whose whole job is to be glanced
 * at, empty space is a missed answer: the next question anyone asks at a
 * kitchen counter is "what's for dinner?" and the one after is "what's
 * happening this week?". So the space below the timeline now answers both,
 * plus whatever notes the family has left.
 */

/* ------------------------------------------------------------------ *
 * Reminders — the line across the top of the calendar
 * ------------------------------------------------------------------ */

export function ReminderStrip({ reminders }: { reminders: KitchenReminder[] }) {
  if (reminders.length === 0) return null;
  const shown = reminders.slice(0, 3);
  return (
    <div className="reminder-strip" role="status">
      {shown.map((r) => (
        <div className={`reminder ${r.level}`} key={r.key}>
          <span className="reminder-dot" style={r.color ? { background: r.color } : undefined} />
          <span className="reminder-text">{r.text}</span>
        </div>
      ))}
      {reminders.length > shown.length && <div className="reminder more">+{reminders.length - shown.length}</div>}
    </div>
  );
}

/** Over the idle reel: only the ones that can't wait. */
export function IdleReminders({ reminders }: { reminders: KitchenReminder[] }) {
  const urgent = reminders.filter((r) => r.level === 'now').slice(0, 2);
  if (urgent.length === 0) return null;
  return (
    <div className="idle-reminders">
      {urgent.map((r) => (
        <div className="idle-reminder" key={r.key}>
          {r.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tonight
 * ------------------------------------------------------------------ */

interface TonightProps {
  day: MealDay | null;
  onAddToGrocery: (date: string) => Promise<string[]>;
}

export function TonightCard({ day, onAddToGrocery }: TonightProps) {
  const [added, setAdded] = useState<string | null>(null);
  const meal = day?.meal ?? null;

  return (
    <div className={`tonight-card ${meal ? '' : 'empty'}`}>
      <div className="extras-label">Dinner tonight</div>
      {meal ? (
        <div className="tonight-body">
          {meal.image && <img className="tonight-img" src={meal.image} alt="" />}
          <div className="tonight-text">
            <div className="tonight-title">{meal.title}</div>
            <div className="tonight-sub">
              {[meal.cook && `${meal.cook} is cooking`, meal.note].filter(Boolean).join(' · ') ||
                (meal.ingredients.length ? `${meal.ingredients.length} ingredients` : '')}
            </div>
            {meal.ingredients.length > 0 && day && (
              <button
                className="tonight-grocery"
                onClick={async () => {
                  const list = await onAddToGrocery(day.date);
                  setAdded(list.length ? `Added ${list.length} to the list` : 'Already on the list');
                  window.setTimeout(() => setAdded(null), 4000);
                }}
              >
                {added ?? 'Add ingredients to the list'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="tonight-empty">Not planned yet — pick one from a phone, under Meals.</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Notes — the fridge door
 * ------------------------------------------------------------------ */

function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

interface NotesProps {
  notes: WallNote[];
  people: Person[];
  now: Date;
  onRemove: (id: string) => void;
  max: number;
}

export function NotesBoard({ notes, people, now, onRemove, max }: NotesProps) {
  if (notes.length === 0) return null;
  const shown = notes.slice(0, max);
  return (
    <div className="notes-board">
      <div className="extras-label">
        Notes<span className="extras-count">{notes.length > shown.length ? `${shown.length} of ${notes.length}` : ''}</span>
      </div>
      <div className="notes-row">
        {shown.map((n) => {
          const person = people.find((p) => p.id === n.personId);
          return (
            <div className="note-card" key={n.id} style={person ? { borderTopColor: person.color } : undefined}>
              <div className="note-text">{n.text}</div>
              <div className="note-meta">
                <span>
                  {n.from || person?.name || 'Someone'} · {ago(n.createdAt, now)}
                </span>
                <button className="note-clear" onClick={() => onRemove(n.id)} aria-label="Clear note">
                  ✓
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The week ahead
 * ------------------------------------------------------------------ */

interface WeekProps {
  events: CalendarEvent[];
  meals: MealDay[];
  people: Person[];
  now: Date;
}

/**
 * The next six days, side by side: dinner on top, then what's on.
 *
 * Tomorrow onwards — today is already the timeline right above it, and
 * repeating it here would make the eye check two places for one answer.
 */
export function WeekAhead({ events, meals, people, now }: WeekProps) {
  const days = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1);
    return d;
  });

  return (
    <div className="week-ahead">
      <div className="extras-label">The week ahead</div>
      <div className="week-ahead-grid">
        {days.map((d, i) => {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const meal = meals.find((m) => m.date === key)?.meal ?? null;
          const dayEvents = events
            .filter((e) => isSameDay(new Date(e.start), d))
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div className={`wa-day ${weekend ? 'weekend' : ''}`} key={key}>
              <div className="wa-head">
                <span className="wa-dow">{i === 0 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="wa-date tabular">{d.getDate()}</span>
              </div>
              <div className={`wa-meal ${meal ? '' : 'empty'}`} title={meal?.title}>
                {meal ? meal.title : 'Dinner?'}
              </div>
              <div className="wa-events">
                {dayEvents.slice(0, 4).map((e) => {
                  const ids = eventPeople(e);
                  const color = people.find((p) => p.id === ids[0])?.color;
                  return (
                    <div className="wa-event" key={`${e.id}-${e.start}`} style={color ? { borderLeftColor: color } : undefined}>
                      <span className="wa-time tabular">{e.allDay ? 'All day' : formatClock(new Date(e.start)).replace(':00', '').replace(' ', '').toLowerCase()}</span>
                      <span className="wa-title">{e.title}</span>
                    </div>
                  );
                })}
                {dayEvents.length > 4 && <div className="wa-more">+{dayEvents.length - 4} more</div>}
                {dayEvents.length === 0 && <div className="wa-free">Free</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
