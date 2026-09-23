import { HttpCalendarProvider } from './HttpCalendarProvider';

/**
 * The one calendar provider instance the app uses.
 *
 * Shared from here rather than constructed in App, because the settings panel
 * needs it too — editing a single occurrence of a repeat is three different
 * calls depending on scope, and threading all of them down as props would be
 * worse than importing the thing that makes them.
 */
export const calendarProvider = new HttpCalendarProvider();
