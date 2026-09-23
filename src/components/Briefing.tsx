import { NewsHeadline } from '../data/models';
import { FeedStatus } from '../hooks/useWeather';

interface Props {
  news: NewsHeadline[];
  status: FeedStatus;
  updatedAt: number | null;
  now: Date;
}

function ago(ms: number | null, now: Date): string {
  if (!ms) return '';
  const mins = Math.max(0, Math.round((now.getTime() - ms) / 60000));
  if (mins < 1) return 'Updated just now';
  if (mins === 1) return 'Updated 1 min ago';
  if (mins < 60) return `Updated ${mins} min ago`;
  return `Updated ${Math.round(mins / 60)}h ago`;
}

/**
 * Three headlines pinned under the timeline.
 *
 * The bottom ticker rotates one at a time, which is good for glancing but
 * bad for actually reading — this fills the space under a short day's
 * schedule with something worth looking at, and skips the first headline
 * so the two aren't showing the same story at the same moment.
 */
export function Briefing({ news, status, updatedAt, now }: Props) {
  return (
    <div className="briefing">
      <div className="uppercase-label briefing-label">Briefing</div>
      {news.length > 1 ? (
        <>
          <div className="briefing-grid">
            {news.slice(1, 4).map((n) => (
              <div className="briefing-item" key={n.id}>
                <div className="briefing-source">{n.source}</div>
                <div className="briefing-headline">{n.headline}</div>
              </div>
            ))}
          </div>
          <div className="briefing-stamp">{ago(updatedAt, now)}</div>
        </>
      ) : (
        <div className="briefing-muted">
          {status === 'loading' ? 'Loading headlines…' : 'Headlines unavailable — no connection.'}
        </div>
      )}
    </div>
  );
}
