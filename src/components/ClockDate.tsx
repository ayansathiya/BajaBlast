import { DisplaySettings } from '../data/models';

interface Props {
  now: Date;
  clockStyle: DisplaySettings['clockStyle'];
}

function formatHM(d: Date): { hm: string; ampm: string } {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { hm: `${h}:${m}`, ampm };
}

export function ClockDate({ now, clockStyle }: Props) {
  const { hm, ampm } = formatHM(now);
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="clock-block">
      <div className="clock tabular">
        {hm}
        {clockStyle === 'digital-seconds' && <span className="seconds">:{seconds}</span>}
        <span style={{ fontSize: '0.28em', marginLeft: '0.2em', color: 'var(--text-muted)' }}>{ampm}</span>
      </div>
      <div className="date-block">
        <div className="date-line">{dateLine}</div>
      </div>
    </div>
  );
}
