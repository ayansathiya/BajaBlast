import { Person, PreparationTemplate, WeatherSnapshot, eventPeople } from '../../data/models';
import {
  Conflict,
  FreeWindow,
  LeaveNowInfo,
  TimelineEvent,
  formatClock,
  isWeatherAtRisk,
  resolvePreparation,
} from '../../engine/intelligence';

interface Props {
  events: TimelineEvent[];
  people: Person[];
  conflicts: Conflict[];
  freeWindow: FreeWindow | null;
  leaveNow: LeaveNowInfo | null;
  templates: PreparationTemplate[];
  weather: WeatherSnapshot | null;
  isToday: boolean;
}

/** "4:00" and "PM" apart, so the times line up down the column. */
function split(d: Date): [string, string] {
  const [hm, half] = formatClock(d).split(' ');
  return [hm, half ?? ''];
}

/**
 * One day, as a list.
 *
 * Time on the left in a column of its own, the event in large type beside
 * it, and anything worth knowing — who, where, what to bring, when to
 * leave — in a quieter line underneath. What's on now is marked; what's
 * over steps back. No boxes: alignment does that work.
 */
export function DayList({ events, people, conflicts, freeWindow, leaveNow, templates, weather, isToday }: Props) {
  if (events.length === 0) {
    return (
      <div className="daylist-empty">
        <div className="daylist-empty-title">{isToday ? 'A free day' : 'Nothing planned'}</div>
        <div className="daylist-empty-sub">Nothing on the calendar{isToday ? ' today' : ''}.</div>
      </div>
    );
  }

  // On today, what's already over folds into one line, so the room goes to
  // what's still ahead. A day that's entirely over shows it all, faded.
  const ahead = events.filter((e) => e.status !== 'past');
  const earlier = isToday && ahead.length > 0 ? events.filter((e) => e.status === 'past') : [];
  const shown = earlier.length ? ahead : events;

  return (
    <div className="daylist">
      {conflicts.length > 0 && (
        <div className="daylist-note urgent">
          {conflicts.map((c, i) => (
            <div key={i}>
              {c.a.title} and {c.b.title} overlap at {formatClock(new Date(c.b.start))}
            </div>
          ))}
        </div>
      )}

      {earlier.length > 0 && (
        <div className="daylist-earlier">
          Earlier · {earlier.map((e) => e.title).join(', ')}
        </div>
      )}

      <ol className="daylist-rows">
        {shown.map((e) => {
          const owners = eventPeople(e)
            .map((id) => people.find((p) => p.id === id))
            .filter(Boolean) as Person[];
          const prep = resolvePreparation(e, templates);
          const rain = isWeatherAtRisk(e, weather);
          const leave = leaveNow?.event.id === e.id ? leaveNow : null;
          const [hm, half] = e.allDay ? ['All day', ''] : split(new Date(e.start));
          const details = [owners.map((p) => p.name).join(', '), e.location?.label, e.description].filter(Boolean);

          return (
            <li className={`daylist-row ${e.status}`} key={`${e.id}-${e.start}`}>
              <div className="daylist-time tabular">
                <span>{hm}</span>
                {half && <span className="daylist-half">{half}</span>}
              </div>
              <div className="daylist-body">
                <div className="daylist-title">
                  {owners.slice(0, 3).map((p) => (
                    <span key={p.id} className="person-dot" style={{ background: p.color }} aria-hidden />
                  ))}
                  {e.title}
                  {e.status === 'now' && <span className="daylist-now">Now</span>}
                </div>
                {details.length > 0 && <div className="daylist-sub">{details.join(' · ')}</div>}
                {(leave || prep || rain) && (
                  <div className="daylist-tags">
                    {leave && (
                      <span className="daylist-tag urgent">
                        Leave in {leave.leaveInMinutes} min · traffic {leave.traffic}
                      </span>
                    )}
                    {prep && <span className="daylist-tag">Bring {prep.join(', ')}</span>}
                    {rain && <span className="daylist-tag">Rain expected</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {freeWindow && (
        <div className="daylist-note">
          Free {formatClock(freeWindow.start)} – {formatClock(freeWindow.end)}
        </div>
      )}
    </div>
  );
}
