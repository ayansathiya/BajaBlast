import { NowPlaying as NowPlayingModel } from '../data/models';

interface Props {
  nowPlaying: NowPlayingModel | null;
  onCommand: (action: 'play' | 'pause' | 'next' | 'previous') => void;
}

/**
 * A quiet strip at the top of the rail showing what the speakers are doing.
 *
 * Renders nothing at all when nothing is playing — an empty "Now Playing"
 * box on a kitchen display is just clutter, and the rail is tight enough
 * that the space is better given to the grocery list.
 */
export function NowPlaying({ nowPlaying, onCommand }: Props) {
  if (!nowPlaying || !nowPlaying.title) return null;

  return (
    <div className="rail-section now-playing">
      <div className="uppercase-label rail-label np-label">
        <span>
          Now Playing
          <span className="rail-count">{nowPlaying.deviceName || (nowPlaying.playing ? 'Playing' : 'Paused')}</span>
        </span>
        {/* Transport sits on the label line rather than its own row — the rail
            is tight, and three glyphs don't need a band of their own. */}
        <span className="np-transport">
          <button onClick={() => onCommand('previous')} aria-label="Previous">◀◀</button>
          <button onClick={() => onCommand(nowPlaying.playing ? 'pause' : 'play')} aria-label="Play or pause">
            {nowPlaying.playing ? '❚❚' : '▶'}
          </button>
          <button onClick={() => onCommand('next')} aria-label="Next">▶▶</button>
        </span>
      </div>
      <div className="np-row">
        {nowPlaying.artwork && <img className="np-art" src={nowPlaying.artwork} alt="" />}
        <div className="np-text">
          <div className="np-title">{nowPlaying.title}</div>
          {nowPlaying.artist && <div className="np-artist">{nowPlaying.artist}</div>}
        </div>
      </div>
    </div>
  );
}
