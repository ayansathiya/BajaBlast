import { CalendarEvent, CalendarSource } from '../data/models';

/**
 * Every calendar backend (mock, CalDAV, Google, Apple EventKit-via-bridge)
 * implements this interface. The rest of the app never talks to a specific
 * backend directly — it only ever holds a CalendarProvider.
 *
 * Implementations MUST:
 *  - resolve quickly from cache when offline, never throw for a network blip
 *  - return events already expanded (no raw RRULEs leaking into the UI layer)
 */
export interface CalendarProvider {
  readonly id: string;

  listSources(): Promise<CalendarSource[]>;

  /** Inclusive range, ISO 8601 datetimes. */
  listEvents(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]>;

  createEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent>;

  updateEvent(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent>;

  deleteEvent(id: string): Promise<void>;

  /** ISO timestamp of the last successful sync, or null if never synced. */
  lastSyncedAt(): string | null;
}
