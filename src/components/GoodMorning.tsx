import { CalendarEvent, ChoreState, MealDay, NewsHeadline, Person, WeatherSnapshot, eventPeople } from '../data/models';
import { formatClock } from '../engine/intelligence';
import { greeting, morningWeather, upcomingBirthdays, whenLabel } from '../engine/morning';

interface Props {
  now: Date;
  weather: WeatherSnapshot | null;
  todayEvents: CalendarEvent[];
  /** The next week or so, for birthdays. */
  upcoming: CalendarEvent[];
  tonight: MealDay | null;
  chores: ChoreState | null;
  people: Person[];
  news: NewsHeadline[];
  showNews: boolean;
  onClose: () => void;
}

const ICON: Record<WeatherSnapshot['now']['icon'], string> = {
  sun: '☀️',
  partly: '⛅',
  cloud: '☁️',
  rain: '🌧️',
  snow: '❄️',
  storm: '⛈️',
};

/**
 * The first thing on the wall each morning: the day in one screen.
 *
 * Everything someone needs before leaving the house, readable from the
 * doorway with a coat half on — the weather and what to wear, what's on and
 * when to leave for it, who has which chores, and whose birthday is coming.
 * One tap anywhere and it's the ordinary calendar.
 */
export function GoodMorning({ now, weather, todayEvents, upcoming, tonight, chores, people, news, showNews, onClose }: Props) {
  const w = morningWeather(weather, now);
  const events = todayEvents
    .filter((e) => Date.parse(e.end) > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const birthdays = upcomingBirthdays(upcoming, now);
  const colorOf = (e: CalendarEvent) => people.find((p) => p.id === eventPeople(e)[0])?.color;

  const doneIds = new Set((chores?.completions ?? []).map((c) => `${c.personId}:${c.choreId}`));
  const chorePeople = chores
    ? people
        .filter((p) => p.enabled)
        .map((p) => {
          const mine = chores.items.filter((c) => c.active !== false && (!c.personId || c.personId === p.id));
          const left = mine.filter((c) => !doneIds.has(`${p.id}:${c.id}`));
          return { person: p, left, total: mine.length };
        })
        .filter((row) => row.total > 0)
    : [];

  return (
    <div className="morning-overlay" onClick={onClose}>
      <div className="morning" onClick={(e) => e.stopPropagation()}>
        <header className="morning-head">
          <div>
            <h1 className="morning-hello">{greeting(now)}</h1>
            <div className="morning-date">
              {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {formatClock(now)}
            </div>
          </div>
          <button className="morning-go" onClick={onClose}>
            Start the day →
          </button>
        </header>

        <div className="morning-grid">
          <section className="morning-card morning-weather">
            <div className="morning-label">Weather</div>
            {w ? (
              <>
                <div className="mw-now">
                  <span className="mw-icon">{ICON[w.icon]}</span>
                  <span className="mw-temp tabular">{w.nowF}°</span>
                  <span className="mw-cond">
                    {w.condition}
                    <span className="mw-range tabular">
                      High {w.highF}° · Low {w.lowF}°{w.rainChance >= 0.2 ? ` · ${Math.round(w.rainChance * 100)}% rain` : ''}
                    </span>
                  </span>
                </div>
                <div className="mw-wear">
                  <span className="morning-label">What to wear</span>
                  {w.wear}
                </div>
              </>
            ) : (
              <div className="morning-empty">Weather isn't in yet.</div>
            )}
          </section>

          <section className="morning-card morning-today">
            <div className="morning-label">Today</div>
            {events.length === 0 ? (
              <div className="morning-empty">Nothing on the calendar. A free day.</div>
            ) : (
              <ul className="morning-events">
                {events.slice(0, 6).map((e) => {
                  const start = new Date(e.start);
                  const travel = e.location?.travelMinutes;
                  const leave = travel && !e.allDay ? new Date(start.getTime() - travel * 60_000) : null;
                  return (
                    <li key={`${e.id}-${e.start}`} style={{ borderLeftColor: colorOf(e) }}>
                      <span className="me-time tabular">{e.allDay ? 'All day' : formatClock(start)}</span>
                      <span className="me-title">
                        {e.title}
                        {leave && leave.getTime() > now.getTime() && <span className="me-leave">Leave by {formatClock(leave)}</span>}
                      </span>
                    </li>
                  );
                })}
                {events.length > 6 && <li className="me-more">+{events.length - 6} more</li>}
              </ul>
            )}
            <div className="morning-dinner">
              <span className="morning-label">Dinner tonight</span>
              {tonight?.meal ? tonight.meal.title : 'Not planned yet'}
            </div>
          </section>

          {chorePeople.length > 0 && (
            <section className="morning-card morning-chores">
              <div className="morning-label">Chores</div>
              <ul>
                {chorePeople.map(({ person, left, total }) => (
                  <li key={person.id}>
                    <span className="mc-name" style={{ color: person.color }}>
                      {person.name}
                    </span>
                    <span className="mc-list">
                      {left.length === 0 ? 'All done ✓' : left.map((c) => c.label).join(', ')}
                    </span>
                    <span className="mc-count tabular">
                      {total - left.length}/{total}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {birthdays.length > 0 && (
            <section className="morning-card morning-birthdays">
              <div className="morning-label">Birthdays</div>
              <ul>
                {birthdays.slice(0, 3).map((b) => (
                  <li key={`${b.id}-${b.start}`}>
                    🎂 {b.title} <span className="mb-when">{whenLabel(new Date(b.start), now)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {showNews && news.length > 0 && (
            <section className="morning-card morning-news">
              <div className="morning-label">Headlines</div>
              <ul>
                {news.slice(0, 3).map((n) => (
                  <li key={n.id}>
                    {n.headline} <span className="mn-source">{n.source}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
