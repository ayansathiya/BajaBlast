import { useEffect, useRef, useState } from 'react';
import { Bookmark } from '../../data/models';
import { normalizeUrl } from '../../engine/websearch';
import { Icon } from '../Icon';

interface Props {
  home: string;
  bookmarks: Bookmark[];
  onRemoveBookmark: (id: string) => void;
  onClose: () => void;
}

/** Is the wall's add-on here, to give websites a way back? See packaging/pi/extension. */
export function wallBrowserReady(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.bajaWall === '1';
}

/** Send the wall to a website, in this same window. */
export function openOnWall(url: string) {
  window.location.href = url;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Where Browser starts, on the wall.
 *
 * A box to search or type an address (the on-screen keyboard comes up with
 * it), and the places the house goes most. Choosing one sends this same
 * full-screen window there — every site works, because nothing is framed —
 * and the wall's add-on puts back, keyboard and Calendar on top of it.
 */
export function BrowserStart({ home, bookmarks, onRemoveBookmark, onClose }: Props) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const go = (value: string) => {
    const target = normalizeUrl(value);
    if (target) openOnWall(target);
  };

  const places = [
    { title: 'Google', url: 'https://www.google.com/' },
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: hostOf(home), url: home },
  ];

  return (
    <div className="browser-start">
      <div className="browser-start-head">
        <h2>Browser</h2>
        <button className="timer-panel-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="browser-start-search">
        <Icon name="globe" size={26} />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go(text)}
          placeholder="Search, or type an address"
          data-kb="url"
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn-primary" onClick={() => go(text)} disabled={!text.trim()}>
          Go
        </button>
      </div>

      <div className="browser-start-label">Go to</div>
      <div className="browser-start-grid">
        {places.map((p) => (
          <button className="browser-tile" key={p.url} onClick={() => openOnWall(p.url)}>
            <span className="browser-tile-title">{p.title}</span>
            <span className="browser-tile-host">{hostOf(p.url)}</span>
          </button>
        ))}
        {bookmarks.map((b) => (
          <div className="browser-tile" key={b.id}>
            <button className="browser-tile-open" onClick={() => openOnWall(b.url)}>
              <span className="browser-tile-title">{b.title}</span>
              <span className="browser-tile-host">{hostOf(b.url)}</span>
            </button>
            <button className="browser-tile-x" onClick={() => onRemoveBookmark(b.id)} aria-label={`Remove ${b.title}`}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>

      <p className="browser-start-note">
        On any website, the bar along the bottom has Back, a keyboard, and Calendar to come home. It comes home by
        itself after ten quiet minutes, or when a timer goes off.
      </p>
    </div>
  );
}
