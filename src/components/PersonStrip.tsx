import { Person } from '../data/models';

interface Props {
  people: Person[];
  personIds: string[];
  /** 'bar' for the vertical strip beside an event; 'dots' for inline chips. */
  variant?: 'bar' | 'dots';
}

/**
 * Who an event belongs to, as colour.
 *
 * An event can have several people on it now, so a single coloured border no
 * longer says enough. The bar splits into equal bands — one per person — which
 * still reads as "one event" from across the room while showing at a glance
 * that soccer practice is Emma's *and* Dad's.
 */
export function PersonStrip({ people, personIds, variant = 'bar' }: Props) {
  const matched = personIds.map((id) => people.find((p) => p.id === id)).filter(Boolean) as Person[];
  if (matched.length === 0) return null;

  if (variant === 'dots') {
    return (
      <span className="person-dots">
        {matched.map((p) => (
          <span key={p.id} className="person-dot" style={{ background: p.color }} title={p.name} />
        ))}
      </span>
    );
  }

  return (
    <span className="person-strip" aria-hidden>
      {matched.map((p) => (
        <span key={p.id} className="person-strip-band" style={{ background: p.color }} />
      ))}
    </span>
  );
}
