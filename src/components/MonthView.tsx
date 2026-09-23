import { CalendarEvent, Person, eventPeople } from '../data/models';
import { PersonStrip } from './PersonStrip';
import { formatClock } from '../engine/intelligence';
import { addDays, eventsOnDay, isSameDate, monthGridStart } from '../engine/calendarRange';

interface Props {
  events: CalendarEvent[];
  people: Person[];
  anchor: Date;
  now: Date;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A whole month at a glance.
 *
 * Six rows always, rather than five-or-six depending on the month: a grid that
 * changes height as you page through the year makes everything below it jump
 * around, which reads as a glitch on a display that's otherwise still.
 *
 * Each cell shows up to three events and then "+N more" — enough to see that
 * a day is busy without turning the grid into unreadable mouse type.
 */
export function MonthView({ events, people, anchor, now }: Props) {
  const gridStart = monthGridStart(anchor);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const month = anchor.getMonth();

  return (
    <div className="month-view">
      <div className="month-dow">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="month-grid">
        {cells.map((day) => {
          const dayEvents = eventsOnDay(events, day);
          const outside = day.getMonth() !== month;
          const today = isSameDate(day, now);
          return (
            <div
              className={`month-cell ${outside ? 'outside' : ''} ${today ? 'today' : ''}`}
              key={day.toISOString()}
            >
              <div className="month-cell-date tabular">{day.getDate()}</div>
              {dayEvents.slice(0, 3).map((e) => (
                <div className="month-event" key={e.id}>
                  <PersonStrip people={people} personIds={eventPeople(e)} variant="dots" />
                  <span className="month-event-time tabular">
                    {e.allDay ? '' : formatClock(new Date(e.start)).replace(':00', '')}
                  </span>
                  <span className="month-event-title">{e.title}</span>
                </div>
              ))}
              {dayEvents.length > 3 && <div className="month-more">+{dayEvents.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
