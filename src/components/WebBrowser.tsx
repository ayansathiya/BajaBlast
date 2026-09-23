import { useEffect, useRef, useState } from 'react';
import { BakePick } from '../data/models';
import { BakeState, bakeWhen, bakeWhenPhrase } from '../engine/bake';
import { qrToSvg } from '../engine/qr';
import { normalizeUrl } from '../engine/websearch';
import { TouchKeyboard } from './TouchKeyboard';

interface Props {
  home: string;
  /** Wall panels with no keyboard get the on-screen one; nothing else does. */
  onScreenKeyboard: boolean;
  startUrl?: string;
  bake: BakeState | null;
  onPickBake: (recipe: Partial<BakePick> & { title: string }, date?: string) => Promise<boolean>;
  onClose: () => void;
  now: Date;
}

/**
 * A browser, inside the calendar.
 *
 * Two engines, because the two machines this runs on can't do the same thing:
 *
 *   • In the Mac app, Electron's <webview> is a real browser tab. Any site
 *     loads, JavaScript runs, links work, and nothing can escape the frame.
 *
 *   • Anywhere else — the Pi, a phone, a laptop pointed at the kiosk — it's an
 *     iframe, and an iframe is only allowed to show sites that permit it.
 *     Plenty of recipe sites do. Plenty (and most big ones) send
 *     X-Frame-Options and appear as a blank rectangle instead.
 *
 * That second case is handled honestly rather than hidden: after a couple of
 * seconds with nothing loaded, the panel says so and offers a QR code, so
 * whoever is standing there can finish on their phone. Stripping the header
 * with a proxy would "fix" it by overriding a site's explicit instruction not
 * to be framed, which isn't ours to override.
 */

/** Electron puts its name in the UA string; no preload bridge needed. */
const HAS_WEBVIEW = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

/**
 * The bundled encoder tops out at version 5 — about 106 bytes — which a long
 * recipe URL with tracking parameters blows straight past. A missing QR is a
 * small disappointment; an exception thrown during render takes the whole
 * calendar down, so this one is caught.
 */
function safeQr(url: string): string | null {
  try {
    return qrToSvg(url, { size: 150 });
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function WebBrowser({ home, onScreenKeyboard, startUrl, bake, onPickBake, onClose, now }: Props) {
  const first = startUrl || home;
  const [url, setUrl] = useState(first);
  // null when nobody is editing: the box then mirrors the live URL.
  const [typed, setTyped] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [title, setTitle] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Our own history. The iframe's is unreadable cross-origin, and the
  // webview's is one call away but this keeps both paths on one code path.
  const [stack, setStack] = useState<string[]>([first]);
  const [at, setAt] = useState(0);

  const frame = useRef<HTMLIFrameElement | null>(null);
  const view = useRef<any>(null);
  const qr = blocked ? safeQr(url) : null;

  function go(next: string) {
    const target = normalizeUrl(next);
    if (!target) return;
    setUrl(target);
    setTitle('');
    setBlocked(false);
    setStack((s) => [...s.slice(0, at + 1), target]);
    setAt((n) => n + 1);
    setKeyboard(false);
    setTyped(null);
  }

  function step(direction: -1 | 1) {
    const index = at + direction;
    if (index < 0 || index >= stack.length) return;
    setAt(index);
    setUrl(stack[index]);
    setBlocked(false);
  }

  // Follow the webview as the person clicks around, so the address bar and
  // "use this page" mean the page actually on screen.
  useEffect(() => {
    const el = view.current;
    if (!HAS_WEBVIEW || !el) return;
    const onNavigate = (e: any) => {
      if (e.url) setUrl(e.url);
      setBlocked(false);
    };
    const onTitle = (e: any) => setTitle(e.title || '');
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    el.addEventListener('page-title-updated', onTitle);
    return () => {
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
      el.removeEventListener('page-title-updated', onTitle);
    };
  }, []);

  /*
    Spotting a refusal to be framed.

    A blocked iframe fires no error event — the browser drops the response and
    leaves the element blank, which is indistinguishable from a slow page for
    as long as you're willing to wait. So: start a timer on each navigation,
    cancel it if `load` fires, and if it expires say plainly what happened.
  */
  useEffect(() => {
    if (HAS_WEBVIEW) return;
    setBlocked(false);
    const timer = setTimeout(() => setBlocked(true), 6000);
    const el = frame.current;
    const done = () => clearTimeout(timer);
    el?.addEventListener('load', done);
    return () => {
      clearTimeout(timer);
      el?.removeEventListener('load', done);
    };
  }, [url]);

  async function useThisPage() {
    const ok = await onPickBake({
      title: title || hostOf(url),
      url,
      kind: 'web',
    });
    setToast(
      ok
        ? `Saved for ${bake?.next ? bakeWhen(bake.next.date, bake.dayName, now) : 'this week'}`
        : 'Could not save that page.'
    );
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="web-overlay">
      <div className="web-bar">
        <button className="web-btn" onClick={() => step(-1)} disabled={at === 0} aria-label="Back">
          ‹
        </button>
        <button className="web-btn" onClick={() => step(1)} disabled={at >= stack.length - 1} aria-label="Forward">
          ›
        </button>
        <button className="web-btn" onClick={() => go(home)} aria-label="Home">
          ⌂
        </button>

        {/*
          A real address bar. Click it and type, or press Enter on anything
          that isn't a web address and it becomes a Google search — which is
          what "search all the recipes" comes down to from in here.

          `typed` is only set while someone is editing; the rest of the time
          the box shows wherever the page has navigated to on its own.
        */}
        <input
          className="web-address"
          value={typed === null ? url : typed}
          onChange={(e) => setTyped(e.target.value)}
          onFocus={(e) => {
            setTyped(url);
            // Select it all, so typing replaces the address rather than
            // landing in the middle of it.
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(typed ?? url);
            if (e.key === 'Escape') {
              // Cancel the edit, and stop here: the app's global Escape would
              // otherwise close the whole browser, which is not what someone
              // half-way through typing an address meant.
              e.stopPropagation();
              setTyped(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search Google, or type an address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Address"
        />
        {title && <span className="web-title" title={title}>{title}</span>}

        {onScreenKeyboard && (
          <button className="web-btn" onClick={() => setKeyboard((v) => !v)} aria-label="On-screen keyboard">
            ⌨
          </button>
        )}

        {bake?.enabled && (
          <button className="btn-accent" onClick={useThisPage}>
            Bake this{bake.next ? ` ${bakeWhenPhrase(bake.next.date, bake.dayName, now)}` : ''}
          </button>
        )}
        <button className="btn-secondary" onClick={onClose}>
          Back to calendar
        </button>
      </div>

      {keyboard && onScreenKeyboard && (
        <div className="web-kb">
          <div className="web-kb-field">{typed || 'Type an address, or something to search for'}</div>
          <TouchKeyboard
            value={typed ?? ''}
            onChange={setTyped}
            onSubmit={() => go(typed ?? '')}
            onClose={() => setKeyboard(false)}
            urlMode
            submitLabel="Go"
          />
        </div>
      )}

      <div className="web-stage">
        {HAS_WEBVIEW ? (
          // <webview> is Electron's, not HTML's. React's DOM types already
          // declare it, so no local shim is needed.
          <webview ref={view} className="web-frame" src={url} />
        ) : (
          <iframe
            ref={frame}
            className="web-frame"
            src={url}
            title="Browser"
            // No same-origin: a framed page should not be able to reach into
            // this one. Scripts and forms are what makes a recipe site usable.
            sandbox="allow-scripts allow-forms allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        )}

        {blocked && !HAS_WEBVIEW && (
          <div className="web-blocked" key={url}>
            <div className="uppercase-label">This site won’t open inside another page</div>
            <p>
              {hostOf(url)} asks browsers not to display it in a frame, so the kiosk can’t show it here.
              {qr ? ' Scan this to pick it up on your phone' : ' Open it on your phone'} — or use the Recipes
              screen, which fetches recipes directly and always works.
            </p>
            {qr && <div className="web-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
            <div className="web-blocked-url">{url}</div>
            {bake?.enabled && (
              <button className="btn-accent" onClick={useThisPage}>
                Use it for {bake.label} anyway
              </button>
            )}
          </div>
        )}
      </div>

      {toast && <div className="recipe-toast">{toast}</div>}
    </div>
  );
}

