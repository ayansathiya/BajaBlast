import { GroceryItem } from '../data/models';

export interface GroceryProvider {
  list(): Promise<GroceryItem[]>;
  add(label: string, addedBy?: string): Promise<GroceryItem>;
  toggle(id: string): Promise<GroceryItem>;
  remove(id: string): Promise<void>;
}

/**
 * In-memory shared list — every household member adds to the same list via
 * the hidden settings panel (or voice, see VoiceAssistant). Persistence is
 * intentionally out of scope for the mock: swap this for a small local file
 * or a real sync backend when that matters.
 */
export class MockGroceryProvider implements GroceryProvider {
  private items: GroceryItem[] = [];

  async list(): Promise<GroceryItem[]> {
    return [...this.items].sort((a, b) => Number(a.done) - Number(b.done));
  }

  async add(label: string, addedBy?: string): Promise<GroceryItem> {
    const item: GroceryItem = {
      id: `grc-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      label,
      addedBy,
      done: false,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    return item;
  }

  async toggle(id: string): Promise<GroceryItem> {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error(`Grocery item ${id} not found`);
    item.done = !item.done;
    return item;
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
  }
}
