/**
 * The app's icons, drawn rather than typed.
 *
 * They used to be emoji — 💡 🍴 🌐 ⏱ — and a Raspberry Pi has no emoji font,
 * so on the wall they came out as empty boxes with a cross through them.
 * Lines drawn here look the same on every screen, take the text colour, and
 * sit quieter beside a calendar than a row of colourful pictures does.
 *
 * One style throughout: a 24-unit square, round 1.75 strokes, no fills
 * except where a shape needs one to read at a glance.
 */

export type IconName =
  | 'sun'
  | 'partly'
  | 'cloud'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'timer'
  | 'bulb'
  | 'utensils'
  | 'globe'
  | 'check'
  | 'gear'
  | 'cake'
  | 'home'
  | 'star'
  | 'starFilled'
  | 'close'
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'history'
  | 'bell'
  | 'camera'
  | 'power'
  | 'speaker';

const PATHS: Record<IconName, JSX.Element> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  partly: (
    <>
      <path d="M8 3.5v1.5M3.5 8H5M4.8 4.8l1 1M12.2 4.8l-1 1" />
      <path d="M5.6 10.4a3.5 3.5 0 0 1 6.1-2.7" />
      <path d="M8 19.5h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 8 19.5z" />
    </>
  ),
  cloud: <path d="M7 18.5h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 18.5z" />,
  rain: (
    <>
      <path d="M7 15h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 15z" />
      <path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5" />
    </>
  ),
  snow: (
    <>
      <path d="M7 14.5h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 14.5z" />
      <path d="M8 18h.01M12 19.5h.01M16 18h.01M10 21.5h.01M14 21.5h.01" strokeWidth="2.6" />
    </>
  ),
  storm: (
    <>
      <path d="M7 14.5h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 14.5z" />
      <path d="M12.5 14.5 10 18.5h3.5L11 22" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18.5h6M10 21.5h4" />
      <path d="M8.6 15.5A6.5 6.5 0 1 1 15.4 15.5c-.5.5-.9 1.2-.9 2v1h-5v-1c0-.8-.4-1.5-.9-2z" />
    </>
  ),
  utensils: (
    <>
      <path d="M6 2.5v7a2 2 0 0 0 2 2v10M10 2.5v7a2 2 0 0 1-2 2M8 2.5v6" />
      <path d="M17.5 21.5v-19c-2 1-3.5 3.5-3.5 7v4h3.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5c2.6 2.7 4 6 4 9.5s-1.4 6.8-4 9.5c-2.6-2.7-4-6-4-9.5s1.4-6.8 4-9.5z" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  cake: (
    <>
      <path d="M4 21.5v-7.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7.5M2.5 21.5h19" />
      <path d="M4 16.5c1.3 0 1.3 1 2.7 1s1.3-1 2.6-1 1.4 1 2.7 1 1.3-1 2.7-1 1.3 1 2.6 1 1.4-1 2.7-1" />
      <path d="M8 12V9M12 12V9M16 12V9M8 6.5v-.5M12 6.5v-.5M16 6.5v-.5" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11.5h13V9" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />,
  starFilled: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" fill="currentColor" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth="3" />,
  prev: <path d="M18 5v14L8 12zM6 5v14" fill="currentColor" />,
  next: <path d="M6 5v14l10-7zM18 5v14" fill="currentColor" />,
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  camera: (
    <>
      <path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.6-2h5.4l1.6 2h2.2a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.8" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 3.5v5h5M12 7.5V12l3 2" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  /** Read out by screen readers; without it the icon is decoration. */
  label?: string;
}

export function Icon({ name, size = 22, className, label }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className ?? ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
