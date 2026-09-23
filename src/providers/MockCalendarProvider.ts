import { CalendarProvider } from './CalendarProvider';
import { CalendarEvent, CalendarSource } from '../data/models';

/** Builds an ISO string for "today at HH:MM" offset by `dayOffset` days. */
function at(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const SOURCES: CalendarSource[] = [
  { id: 'household', name: 'Household', color: '#4A9C90', visible: true, providerType: 'mock' },
  { id: 'mom', name: 'Mom', color: '#8FA3AD', visible: true, providerType: 'mock' },
  { id: 'dad', name: 'Dad', color: '#A88F7D', visible: true, providerType: 'mock' },
  { id: 'emma', name: 'Emma', color: '#B58FA0', visible: true, providerType: 'mock' },
  { id: 'jack', name: 'Jack', color: '#8FA88F', visible: true, providerType: 'mock' },
];

/**
 * No seeded events — the calendar starts empty. The `at()` helper above is
 * kept for anyone who wants to quickly reintroduce sample events during
 * development (see the git history / README for the shape).
 */
function seedEvents(): CalendarEvent[] {
  return [];
}

export class MockCalendarProvider implements CalendarProvider {
  readonly id = 'mock';
  private events: CalendarEvent[] = seedEvents();
  private syncedAt: string = new Date().toISOString();

  async listSources(): Promise<CalendarSource[]> {
    return SOURCES;
  }

  async listEvents(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    const start = new Date(rangeStart).getTime();
    const end = new Date(rangeEnd).getTime();
    this.syncedAt = new Date().toISOString();
    return this.events
      .filter((e) => {
        const s = new Date(e.start).getTime();
        return s >= start && s <= end;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  async createEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const created: CalendarEvent = { ...event, id: `evt-${Date.now()}` };
    this.events.push(created);
    return created;
  }

  async updateEvent(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Event ${id} not found`);
    this.events[idx] = { ...this.events[idx], ...patch };
    return this.events[idx];
  }

  async deleteEvent(id: string): Promise<void> {
    this.events = this.events.filter((e) => e.id !== id);
  }

  lastSyncedAt(): string | null {
    return this.syncedAt;
  }
}
