// ---------------------------------------------------------------------------
// Core domain models. Kept framework-agnostic on purpose: these types are
// consumed by providers, the intelligence engine, and every UI component,
// but they don't import React or anything view-related.
// ---------------------------------------------------------------------------

export type EventCategory =
  | 'school'
  | 'work'
  | 'sports'
  | 'meal'
  | 'medical'
  | 'social'
  | 'travel'
  | 'birthday'
  | 'holiday'
  | 'household'
  | 'entertainment'
  | 'other';

export interface Person {
  id: string;
  name: string;
  /** Muted, desaturated accent — never a raw saturated hue. */
  color: string;
  initials: string;
  enabled: boolean;
}

export interface Location {
  label: string;
  address?: string;
  /** Minutes of typical travel time from home, used by the Leave Now feature. */
  travelMinutes?: number;
}

export interface PreparationTemplate {
  /** Matches against event category or title keywords. */
  matchCategory?: EventCategory;
  matchKeyword?: string;
  items: string[];
}

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N days/weeks/months. 1 or absent means every one. */
  interval?: number;
  /** Weekly only: 0 = Sunday. Lets one rule cover "Tuesdays and Thursdays". */
  byWeekday?: number[];
  /** Local YYYY-MM-DD. Absent means it runs forever. */
  until?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  allDay?: boolean;
  location?: Location;
  description?: string;
  calendarId: string;
  /** Kept for events created before multi-person support; read via eventPeople(). */
  personId?: string;
  /** Everyone this event belongs to. One event, several people. */
  personIds?: string[];
  /** A built-in category, or the id of one the household made up. */
  category: string;
  /** 0 (routine) – 3 (critical). Drives idle-reel and spotlight selection. */
  importance: 0 | 1 | 2 | 3;
  recurrence?: RecurrenceRule;
  /** Local YYYY-MM-DD dates this repeat skips — a deleted or moved occurrence. */
  exceptions?: string[];
  /** Set on an override event: the master it replaces one occurrence of. */
  recurrenceParentId?: string;
  /** Which occurrence (local YYYY-MM-DD) this override stands in for. */
  occurrenceDate?: string;
  /** True on events produced by expanding a rule — never stored. */
  isOccurrence?: boolean;
  preparationItems?: string[];
  isSpecialDay?: boolean;
}

/** A category the household invented, alongside the built-in ones. */
export interface CustomCategory {
  id: string;
  label: string;
}

/** Everyone an event belongs to, across the old and new fields. */
export function eventPeople(event: CalendarEvent): string[] {
  if (event.personIds?.length) return event.personIds;
  return event.personId ? [event.personId] : [];
}

export interface CalendarSource {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  providerType: 'mock' | 'caldav' | 'google' | 'apple';
}

export interface WeatherNow {
  tempF: number;
  condition: string;
  icon: 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'partly';
  sunrise: string; // ISO
  sunset: string; // ISO
}

export interface WeatherHourPoint {
  time: string; // ISO
  tempF: number;
  precipChance: number; // 0-1
  icon: WeatherNow['icon'];
}

export interface WeatherSnapshot {
  now: WeatherNow;
  hourly: WeatherHourPoint[];
  fetchedAt: string; // ISO, used for the offline "Updated N min ago" indicator
}

export interface Reminder {
  id: string;
  text: string;
  due?: string;
  done: boolean;
}

export interface NewsHeadline {
  id: string;
  source: string;
  headline: string;
  category: 'world' | 'business' | 'tech' | 'local';
  publishedAt: string; // ISO
}

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  changePct: number; // e.g. 1.24 or -0.8
}

export interface GroceryItem {
  id: string;
  label: string;
  addedBy?: string; // personId
  done: boolean;
  createdAt: string; // ISO
}

export interface FamilyPhoto {
  id: string;
  url: string; // served from the local server, e.g. /photos/abc123.jpg
  caption?: string;
  uploadedAt: string; // ISO
}

export type ThemePeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export interface DisplaySchedule {
  enabled: boolean;
  /** HH:MM, local time. The screen comes on at this hour. */
  on: string;
  /** HH:MM, local time. The screen sleeps at this hour. */
  off: string;
  /** Touching the screen (or waking it from a phone) overrides the schedule. */
  wakeOnTouch: boolean;
}

export interface DisplaySettings {
  brightness: number; // 0-1
  theme: 'auto' | 'dark' | 'light';
  reducedMotion: boolean;
  largeText: boolean;
  highContrast: boolean;
  clockStyle: 'digital' | 'digital-seconds';
  /**
   * When the panel sleeps. Not when the machine sleeps — the Pi stays up so
   * phones keep working overnight and updates still land, and it draws about
   * a sixth of what the screen does.
   */
  schedule: DisplaySchedule;
}

export interface AmbientSettings {
  idleTimeoutSeconds: number; // default 150
  enabled: boolean;
  volume: number; // 0-1
  videoSource: 'local' | 'generated' | 'off';
  maxReelDurationSeconds: number;
  showWeather: boolean;
  showUpcoming: boolean;
  showFamily: boolean;
  showBirthdays: boolean;
  showReminders: boolean;
  showNews: boolean;
  showGrocery: boolean;
  showPhotos: boolean;
}

export interface IntelligenceSettings {
  prioritizationEnabled: boolean;
  weatherAwareness: boolean;
  travelTimeEnabled: boolean;
  preparationReminders: boolean;
  conflictDetection: boolean;
}

export interface FeedSettings {
  /** Symbols shown under "Trending" in the rail. Max 8. */
  tickers: string[];
  /** Show a persistent family-photo tile on the main (non-idle) screen. */
  showPhotoFrame: boolean;
}

/** One recurring daily job. `personId` empty means anyone can claim it. */
export interface Chore {
  id: string;
  label: string;
  personId: string;
  points: number;
  active: boolean;
}

/** What the household is working towards together. */
export interface RewardGoal {
  label: string;
  targetPoints: number;
}

/** One thing worth saving up for. The menu everyone picks from. */
export interface Reward {
  id: string;
  label: string;
  points: number;
}

export interface ChoreSettings {
  items: Chore[];
  /** The household goal — everyone's points push this one bar. */
  goal: RewardGoal;
  /** The list of rewards people can choose to work towards. */
  rewards: Reward[];
  /** personId → reward id. Each person picks their own from the list above. */
  personGoals: Record<string, string>;
  /** Show the chore board and leaderboard on the kiosk. */
  enabled: boolean;
}

/** A chore ticked off on a given local date. The date is the reset boundary. */
export interface ChoreCompletion {
  id: string;
  choreId: string;
  personId: string;
  /** Local YYYY-MM-DD — not UTC, or the list resets at 8pm. */
  date: string;
  points: number;
  at: string;
}

export interface ChoreTotals {
  todayDone: number;
  todayTotal: number;
  todayPoints: number;
  weekPoints: number;
  totalPoints: number;
  /** This person's own reward, if they've picked one. */
  goalLabel: string | null;
  goalPoints: number;
  goalPct: number;
  goalReached: boolean;
}

export interface ChoreState {
  date: string;
  items: Chore[];
  completions: ChoreCompletion[];
  totals: Record<string, ChoreTotals>;
  goal: RewardGoal;
  goalPoints: number;
  rewards: Reward[];
  /** True when every enabled person with a goal has reached it. */
  everyoneReached: boolean;
}

export interface MusicSettings {
  /** LAN address of the Sonos speaker commands are sent to. */
  speakerIp: string;
  speakerRoom: string;
  /** The household's own Spotify app client id. Public by design (PKCE). */
  spotifyClientId: string;
  /** Playlist/album/track shown in the embedded player. */
  embedUri: string;
  showNowPlaying: boolean;
}

/** What the speakers are playing, normalized across Sonos and Spotify. */
export interface NowPlaying {
  source: 'sonos' | 'spotify';
  playing: boolean;
  state?: string;
  title: string | null;
  artist?: string | null;
  album?: string | null;
  artwork?: string | null;
  volume?: number | null;
  deviceName?: string | null;
  progressMs?: number;
  durationMs?: number;
}

export interface SonosSpeaker {
  ip: string;
  id: string;
  room: string;
  model: string;
}

export interface MusicState {
  speakers: SonosSpeaker[];
  selected: string | null;
  nowPlaying: NowPlaying | null;
  spotify: { clientIdSet: boolean; connected: boolean };
  error?: string | null;
}

export interface RecipeSettings {
  /** Whether the Recipes screen is reachable from the calendar at all. */
  enabled: boolean;
  /**
   * Cocktails are the one section that isn't for everybody. A kitchen screen
   * at child height should be able to lose that tab without losing mocktails,
   * which are the fun half anyway.
   */
  showCocktails: boolean;
  /**
   * The on-screen keyboard. Off by default: every machine this runs on except
   * a bare wall panel has a real keyboard, and a fake one in the way of it is
   * just an obstacle. Turn it on for the kiosk that has no keyboard at all.
   */
  onScreenKeyboard: boolean;
  /** The in-app browser. Off means the calendar has no way out to the web. */
  browserEnabled: boolean;
  /** Where the in-app browser starts, and what Home returns to. */
  browserHome: string;
  bakeNight: {
    enabled: boolean;
    /** 0 = Sunday … 6 = Saturday. */
    weekday: number;
    /** Local HH:MM. The day view draws everything against a clock. */
    time: string;
    durationMinutes: number;
    /** Shown on the calendar when nobody has picked anything yet. */
    label: string;
  };
}

/** A saved link, shared by the whole household. */
export interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedBy: string;
  addedAt: string;
}

/** One week's baking pick — from the recipe API, or a page off the web. */
export interface BakePick {
  id: string;
  title: string;
  image: string | null;
  url: string | null;
  kind: string;
  ingredients: string[];
  steps: string[];
  note: string;
  pickedBy: string;
  pickedAt: string;
}

export interface BakeWeek {
  /** Local YYYY-MM-DD of that week's bake day. */
  date: string;
  weekday: number;
  dayName: string;
  isToday: boolean;
  pick: BakePick | null;
}

export interface BakeSummary {
  weekday: number;
  dayName: string;
  next: BakeWeek;
  upcoming: BakeWeek[];
}

/** A card in the recipe grid: enough to show a photo and a name. */
export interface RecipeCard {
  id: string;
  kind: string;
  title: string;
  image: string | null;
  category: string | null;
}

/** A full recipe, once someone opens one. */
export interface Recipe extends RecipeCard {
  area?: string | null;
  glass?: string | null;
  alcoholic?: string | null;
  tags?: string[];
  ingredients: string[];
  steps: string[];
  source?: string | null;
  video?: string | null;
}

/** One tab in the recipe browser. */
export interface RecipeSection {
  key: string;
  title: string;
  subtitle?: string;
}

/** A food category the API publishes — Chicken, Vegetarian, Dessert… */
export interface RecipeCategory {
  id: string;
  title: string;
  image: string | null;
  description: string;
}

export interface HouseholdSettings {
  householdName: string;
  homeLocation: { lat: number; lon: number; label: string };
  people: Person[];
  calendarSources: CalendarSource[];
  display: DisplaySettings;
  ambient: AmbientSettings;
  intelligence: IntelligenceSettings;
  feeds: FeedSettings;
  music: MusicSettings;
  chores: ChoreSettings;
  /** Categories the household added themselves. */
  customCategories: CustomCategory[];
  preparationTemplates: PreparationTemplate[];
  recipes: RecipeSettings;
  voiceEnabled: boolean;
  bajaApiKey?: string;
  bajaLocalModel?: string;
}

/** A single beat within the idle "Today Reel." */
export interface IdleScene {
  id: string;
  kind: 'today' | 'next' | 'tomorrow' | 'week' | 'birthday' | 'weather' | 'quiet' | 'news' | 'grocery' | 'photo' | 'music';
  title: string;
  subtitle?: string;
  detailLines?: string[];
  background: 'gradient-warm' | 'gradient-cool' | 'gradient-night' | 'gradient-celebration' | 'video' | 'photo';
  imageUrl?: string;
  durationMs: number;
}
