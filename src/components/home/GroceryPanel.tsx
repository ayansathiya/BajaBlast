import { useState } from 'react';
import { GroceryItem } from '../../data/models';
import { Icon } from '../Icon';

interface Props {
  items: GroceryItem[];
  onToggle: (id: string) => void;
  onAdd: (label: string) => void;
  onClose: () => void;
}

/**
 * The shopping list, from the wall: tick things off as they go in the bag,
 * add one with the on-screen keyboard. The same list every phone sees.
 */
export function GroceryPanel({ items, onToggle, onAdd, onClose }: Props) {
  const [text, setText] = useState('');
  const pending = items.filter((g) => !g.done);
  const done = items.filter((g) => g.done);

  function add() {
    const label = text.trim();
    if (!label) return;
    onAdd(label);
    setText('');
  }

  return (
    <div className="timer-overlay" onClick={onClose}>
      <div className="timer-panel grocery-panel" onClick={(e) => e.stopPropagation()}>
        <div className="timer-panel-head">
          <h2>Groceries</h2>
          <button className="timer-panel-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="grocery-add">
          <input
            className="timer-panel-name"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Add something"
          />
          <button className="btn-primary" onClick={add} disabled={!text.trim()}>
            Add
          </button>
        </div>

        <ul className="grocery-list">
          {pending.length === 0 && <li className="grocery-list-empty">Nothing to buy.</li>}
          {[...pending, ...done].map((g) => (
            <li key={g.id}>
              <button className={`grocery-item ${g.done ? 'done' : ''}`} onClick={() => onToggle(g.id)}>
                <span className="grocery-box">{g.done && <Icon name="check" size={16} />}</span>
                {g.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
