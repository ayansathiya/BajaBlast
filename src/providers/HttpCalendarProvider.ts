import { CalendarProvider } from './CalendarProvider';
import { CalendarEvent, CalendarSource } from '../data/models';

const API_BASE = '';

const SOURCES: CalendarSource[] = [
  { id: 'household', name: 'Household', color: '#4A9C90', visible: true, providerType: 'mock' },
  { id: 'mom', name: 'Mom', color: '#8FA3AD', visible: true, providerType: 'mock' },
  { id: 'dad', name: 'Dad', color: '#A88F7D', visible: true, providerType: 'mock' },
  { id: 'emma', name: 'Emma', color: '#B58FA0', visible: true, providerType: 'mock' },
  { id: 'jack', name: 'Jack', color: '#8FA88F', visible: true, providerType: 'mock' },
];

/**
 * Talks to the local server started by app/server.cjs, which is the
 * same store a phone reaches at /mobile. This is what makes "add an event
 * from your phone" and "see it on the kitchen display" the same list.
 *
 * If the server isn't reachable (e.g. testing the web build outside
 * the browser with no server running), calls fail and the existing
 * offline-first handling in useCalendar keeps whatever was last loaded —
 * consistent with how a real network calendar outage is already handled.
 */
export class HttpCalendarProvider implements CalendarProvider {
  readonly id = 'http-local';
  private syncedAt: string | null = null;

  async listSources(): Promise<CalendarSource[]> {
    return SOURCES;
  }

  async listEvents(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    const res = await fetch(`${API_BASE}/api/events`);
    if (!res.ok) throw new Error('Failed to load events');
    const all: CalendarEvent[] = await res.json();
    const start = new Date(rangeStart).getTime();
    const end = new Date(rangeEnd).getTime();
    this.syncedAt = new Date().toISOString();
    return all
      .filter((e) => {
        // A repeating master and its per-occurrence overrides always come
        // through, whatever their own start date says. A weekly class that
        // began last March still produces occurrences this week, and
        // filtering it out here would make the whole series vanish.
        if (e.recurrence || e.recurrenceParentId) return true;
        const s = new Date(e.start).getTime();
        return s >= start && s <= end;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  async createEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const res = await fetch(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error('Failed to create event');
    return res.json();
  }

  async updateEvent(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const res = await fetch(`${API_BASE}/api/events/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Failed to update event');
    return res.json();
  }

  /**
   * Change or remove a single occurrence of a repeating event.
   *
   * Pass a patch to move/rename just that one; pass null to delete just that
   * one. Either way the master gains an exception for that date, so the
   * generated occurrence stops appearing.
   */
  async updateOccurrence(
    masterId: string,
    occurrenceDate: string,
    patch: Partial<CalendarEvent> | null
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/api/events/occurrence`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterId, occurrenceDate, patch }),
    });
    if (!res.ok) throw new Error('Failed to update this occurrence');
  }

  async deleteEvent(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/events/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete event');
  }

  lastSyncedAt(): string | null {
    return this.syncedAt;
  }
}
