// Server-side mirror of src/data/sampleData.ts DEFAULT_SETTINGS.
//
// Why this exists: settings are persisted to disk. When a new feature adds a
// new setting (say `ambient.showPhotos`), an existing store.json written
// before that feature has no such key — it reads back as `undefined`, which
// is falsy, so the feature silently stays off forever and looks broken.
// Every read deep-merges the stored settings over these defaults, so new
// keys appear automatically without anyone resetting anything.

const DEFAULT_SETTINGS = {
  householdName: 'The Household',
  homeLocation: { lat: 42.7654, lon: -71.4676, label: 'Nashua, NH' },
  people: [
    { id: 'mom', name: 'Mom', color: '#00F5D4', initials: 'M', enabled: true },
    { id: 'dad', name: 'Dad', color: '#FF5C72', initials: 'D', enabled: true },
    { id: 'emma', name: 'Emma', color: '#F5F5F5', initials: 'E', enabled: true },
    { id: 'jack', name: 'Jack', color: '#7DE8DC', initials: 'J', enabled: true },
    { id: 'household', name: 'Household', color: '#9A9A9A', initials: 'H', enabled: true },
  ],
  calendarSources: [],
  display: {
    brightness: 1,
    theme: 'auto',
    reducedMotion: false,
    largeText: false,
    highContrast: false,
    clockStyle: 'digital',
    // The panel sleeps overnight; the machine behind it does not. The screen
    // is five or six times the power draw, and unlike the computer it can be
    // woken by touching it.
    schedule: {
      enabled: true,
      on: '06:00',
      off: '23:00',
      // A touch, a tap or a phone waking the kiosk brings the screen back
      // before its scheduled hour. Off means the schedule is absolute, which
      // is what you want if the display is somewhere a cat can reach.
      wakeOnTouch: true,
    },
  },
  ambient: {
    idleTimeoutSeconds: 150,
    enabled: true,
    volume: 0,
    videoSource: 'generated',
    maxReelDurationSeconds: 60,
    showWeather: true,
    showUpcoming: true,
    showFamily: false,
    showBirthdays: true,
    showReminders: false,
    showNews: true,
    showGrocery: true,
    showPhotos: true,
  },
  intelligence: {
    prioritizationEnabled: true,
    weatherAwareness: true,
    travelTimeEnabled: true,
    preparationReminders: true,
    conflictDetection: true,
  },
  feeds: {
    tickers: ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'SPY'],
    showPhotoFrame: true,
  },
  chores: {
    enabled: true,
    // A starting set so the board isn't empty on day one — edit or delete
    // these in Settings → Chores. personId '' means anyone can claim it.
    items: [
      { id: 'chore-bed', label: 'Make your bed', personId: '', points: 10, active: true },
      { id: 'chore-dishes', label: 'Clear your plate', personId: '', points: 10, active: true },
      { id: 'chore-homework', label: 'Homework done', personId: '', points: 20, active: true },
      { id: 'chore-read', label: 'Read for 20 minutes', personId: '', points: 15, active: true },
      { id: 'chore-tidy', label: 'Tidy your room', personId: '', points: 15, active: true },
    ],
    goal: { label: 'Movie night', targetPoints: 500 },
    // The menu of rewards people choose from — add as many as you like.
    rewards: [
      { id: 'reward-icecream', label: 'Ice cream trip', points: 100 },
      { id: 'reward-screen', label: 'Extra hour of screen time', points: 150 },
      { id: 'reward-friend', label: 'Friend over for a sleepover', points: 250 },
      { id: 'reward-choose', label: 'Pick Friday dinner', points: 300 },
      { id: 'reward-outing', label: 'Day out of your choosing', points: 600 },
    ],
    // personId -> reward id. Everyone starts unassigned; pick in Settings.
    personGoals: {},
  },
  // Categories the household added themselves, alongside the built-in list.
  customCategories: [],
  music: {
    // Which Sonos speaker commands go to (its LAN address; re-discovered on demand).
    speakerIp: '',
    speakerRoom: '',
    // The household's own Spotify app client id. Public by design — the
    // PKCE flow means there is no client secret to leak. Access/refresh
    // tokens live outside settings and are never sent to the phone.
    spotifyClientId: '',
    // Spotify URI (playlist/album/track) shown in the embed player.
    embedUri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    showNowPlaying: true,
  },
  preparationTemplates: [
    { matchCategory: 'sports', items: ['Cleats', 'Water bottle', 'Jersey'] },
    { matchCategory: 'travel', items: ['Passport', 'Boarding pass', 'Luggage'] },
    { matchKeyword: 'dentist', items: ['Insurance card'] },
    { matchKeyword: 'birthday', items: ['Gift', 'Card'] },
  ],
  // Recipes and the in-app browser.
  recipes: {
    enabled: true,
    // On by default because the household asked for cocktails; the toggle is
    // there for the version of this screen a six-year-old can reach.
    showCocktails: true,
    // Off: type with the keyboard you have. On only for a wall panel that
    // genuinely has none.
    onScreenKeyboard: false,
    browserEnabled: true,
    browserHome: 'https://www.allrecipes.com/recipes/276/desserts/cakes/',
    bakeNight: {
      enabled: true,
      weekday: 6, // Saturday
      // The day view draws every event against a clock, so the bake needs a
      // time even though nobody sets a timer for it. Mid-afternoon: late
      // enough that the morning is free, early enough to eat it the same day.
      time: '16:00',
      durationMinutes: 90,
      label: 'Bake Night',
    },
  },
  voiceEnabled: false,
  bajaApiKey: '',
  bajaLocalModel: 'llama3.2',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `stored` over `base`. Arrays are replaced wholesale, not merged. */
function withDefaults(stored, base = DEFAULT_SETTINGS) {
  if (!isPlainObject(stored)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(stored)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = withDefaults(value, out[key]);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { DEFAULT_SETTINGS, withDefaults };
