import { Person, PreparationTemplate, WeatherSnapshot, eventPeople } from '../data/models';
import { PersonStrip } from './PersonStrip';
import {
  TimelineEvent,
  Conflict,
  FreeWindow,
  LeaveNowInfo,
  formatClock,
  isWeatherAtRisk,
  resolvePreparation,
} from '../engine/intelligence';

interface Props {
  events: TimelineEvent[];
  people: Person[];
  conflicts: Conflict[];
  freeWindow: FreeWindow | null;
  leaveNow: LeaveNowInfo | null;
  templates: PreparationTemplate[];
  weather: WeatherSnapshot | null;
}

function personFor(people: Person[], id?: string): Person | undefined {
  return people.find((p) => p.id === id);
}

export function TodayTimeline({ events, people, conflicts, freeWindow, leaveNow, templates, weather }: Props) {
  if (events.length === 0) {
    return (
      <div className="timeline-col">
          <div className="info-banner" style={{ borderTop: 'none' }}>
          <div className="label">QUIET DAY</div>
          <div className="body">Nothing scheduled today.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-col">

      {conflicts.length > 0 && (
        <div className="info-banner">
          <div className="label">SCHEDULE CONFLICT</div>
          <div className="body">
            {conflicts.map((c, i) => (
              <div key={i}>
                {c.a.title} · {formatClock(new Date(c.a.start))} overlaps {c.b.title} ·{' '}
                {formatClock(new Date(c.b.start))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="timeline">
        {events.map((e) => {
          const ownerIds = eventPeople(e);
          const owners = ownerIds.map((id: string) => personFor(people, id)).filter(Boolean) as Person[];
          const prep = resolvePreparation(e, templates);
          const atRisk = isWeatherAtRisk(e, weather);
          const isLeaveNowTarget = leaveNow?.event.id === e.id;

          return (
            <div
              className={`timeline-row ${e.status === 'past' ? 'past' : e.status === 'now' ? 'now' : 'future'}`}
              key={e.id}
              style={{ paddingLeft: 14, marginLeft: -17, position: 'relative' }}
            >
              <PersonStrip people={people} personIds={ownerIds} />
              <div className="timeline-time tabular">{formatClock(new Date(e.start))}</div>
              <div className="timeline-rule" />
              <div className="timeline-body">
                <div className="timeline-title-row">
                  {owners.map((p) => (
                    <span key={p.id} className="person-dot" style={{ background: p.color }} title={p.name} />
                  ))}
                  <span className="timeline-title">{e.title}</span>
                </div>
                {(e.description || e.location) && (
                  <div className="timeline-sub">
                    {[e.description, e.location?.label].filter(Boolean).join(' · ')}
                  </div>
                )}

                {(prep || atRisk || isLeaveNowTarget) && (
                  <div className="timeline-meta-row">
                    {isLeaveNowTarget && leaveNow && (
                      <div className="meta-pill leave-now">
                        Leave in {leaveNow.leaveInMinutes} min · Traffic: {leaveNow.traffic}
                      </div>
                    )}
                    {prep && <div className="meta-pill">Bring: {prep.join(' · ')}</div>}
                    {atRisk && <div className="meta-pill rain-flag">⚠ Rain expected</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {freeWindow && (
        <div className="info-banner">
          <div className="label">OPEN {freeWindow.start.getHours() < 12 ? 'MORNING' : 'AFTERNOON'}</div>
          <div className="body">
            {formatClock(freeWindow.start)} → {formatClock(freeWindow.end)} · No scheduled events.
          </div>
        </div>
      )}
    </div>
  );
}
