import { useEffect, useState } from 'react';
import { qrToSvg } from '../../engine/qr';
import { Icon } from '../Icon';

/**
 * Scan a photo — from a phone, because that's where the camera is.
 *
 * The wall shows a code that opens the phone page's Scan tab. Take a photo
 * of the school newsletter, the invitation, the shopping list on the fridge;
 * the phone shows what it found to tick, and what's ticked appears here.
 */
export function ScanPanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/version')
      .then((r) => r.json())
      .then((v) => setUrl(v.remoteUrl ? `${v.remoteUrl.replace(/\/$/, '')}/mobile#scan` : v.phoneUrl ? `${v.phoneUrl}#scan` : null))
      .catch(() => setUrl(null));
  }, []);

  let qr: string | null = null;
  try {
    qr = url ? qrToSvg(url, { size: 220 }) : null;
  } catch {
    qr = null;
  }

  return (
    <div className="timer-overlay" onClick={onClose}>
      <div className="timer-panel scan-panel" onClick={(e) => e.stopPropagation()}>
        <div className="timer-panel-head">
          <h2>Scan a photo</h2>
          <button className="timer-panel-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="scan-body">
          {qr ? <div className="scan-qr" dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="scan-qr empty" />}
          <div className="scan-text">
            <p>Point your phone's camera at this, then take a photo of anything with dates or a list on it — a school newsletter, an invitation, the shopping list on the fridge.</p>
            <p>It finds the events, groceries and reminders in it. Tick the ones you want and they appear here.</p>
            {url && <p className="scan-url">{url}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
