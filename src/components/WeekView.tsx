import { CalendarEvent, Person, eventPeople } from '../data/models';
import { PersonStrip } from './PersonStrip';
import { formatClock } from '../engine/intelligence';
import { addDays, eventsOnDay, isSameDate, startOfWeek } from '../engine/calendarRange';

interface Props {
  events: CalendarEvent[];
  people: Person[];
  anchor: Date;
  now: Date;
}

/**
 * Seven columns, one per day.
 *
 * Deliberately a list per day rather than a time grid with hour rows: a
 * household calendar is read from across a room, and at that distance
 * "Thursday has three things on it" matters far more than whether one of them
 * starts at 3:15 or 3:30. A time grid would spend most of its pixels on empty
 * early mornings.
 */
export function WeekView({ events, people, anchor, now }: Props) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="week-grid">
      {days.map((day) => {
        const dayEvents = eventsOnDay(events, day);
        const today = isSameDate(day, now);
        return (
          <div className={`week-col ${today ? 'today' : ''}`} key={day.toISOString()}>
            <div className="week-col-head">
              <span className="week-dow">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="week-date tabular">{day.getDate()}</span>
            </div>
            <div className="week-col-body">
              {dayEvents.length === 0 ? (
                <div className="week-empty">—</div>
              ) : (
                dayEvents.map((e) => {
                  const past = new Date(e.end).getTime() < now.getTime();
                  return (
                    <div className={`week-event ${past ? 'past' : ''}`} key={e.id}>
                      <PersonStrip people={people} personIds={eventPeople(e)} />
                      <div className="week-event-time tabular">
                        {e.allDay ? 'All day' : formatClock(new Date(e.start))}
                        {e.recurrenceParentId && <span className="repeat-mark" title="Repeats">↻</span>}
                      </div>
                      <div className="week-event-title">{e.title}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
