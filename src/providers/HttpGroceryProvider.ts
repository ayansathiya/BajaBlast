import { GroceryProvider } from './GroceryProvider';
import { GroceryItem } from '../data/models';

const API_BASE = '';

/**
 * Same store the /mobile page on your phone reads and writes. This is what
 * makes "add milk from your phone" show up on the kitchen display within a
 * few seconds (the kiosk polls this on the same cadence as the calendar).
 */
export class HttpGroceryProvider implements GroceryProvider {
  async list(): Promise<GroceryItem[]> {
    const res = await fetch(`${API_BASE}/api/grocery`);
    if (!res.ok) throw new Error('Failed to load grocery list');
    const items: GroceryItem[] = await res.json();
    return items.sort((a, b) => Number(a.done) - Number(b.done));
  }

  async add(label: string, addedBy?: string): Promise<GroceryItem> {
    const res = await fetch(`${API_BASE}/api/grocery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, addedBy }),
    });
    if (!res.ok) throw new Error('Failed to add grocery item');
    return res.json();
  }

  async toggle(id: string): Promise<GroceryItem> {
    const res = await fetch(`${API_BASE}/api/grocery/${id}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to toggle grocery item');
    return res.json();
  }

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/grocery/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove grocery item');
  }
}
