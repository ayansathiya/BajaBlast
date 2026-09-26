import { HouseholdSettings, PreparationTemplate } from './models';

export const DEFAULT_PREPARATION_TEMPLATES: PreparationTemplate[] = [
  { matchCategory: 'sports', items: ['Cleats', 'Water bottle', 'Jersey'] },
  { matchCategory: 'travel', items: ['Passport', 'Boarding pass', 'Luggage'] },
  { matchKeyword: 'dentist', items: ['Insurance card'] },
  { matchKeyword: 'birthday', items: ['Gift', 'Card'] },
];

export const DEFAULT_SETTINGS: HouseholdSettings = {
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
    schedule: { enabled: true, on: '06:00', off: '23:00', wakeOnTouch: true, hdmiCec: false },
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
    speakerIp: '',
    speakerRoom: '',
    spotifyClientId: '',
    embedUri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    showNowPlaying: true,
  },
  preparationTemplates: DEFAULT_PREPARATION_TEMPLATES,
  // Recipes and the in-app browser. Mirrored in app/defaults.cjs — see the
  // note there about why new settings keys need a default on both sides.
  recipes: {
    enabled: true,
    showCocktails: true,
    onScreenKeyboard: false,
    browserEnabled: true,
    browserHome: 'https://www.allrecipes.com/recipes/276/desserts/cakes/',
    bakeNight: {
      enabled: true,
      weekday: 6, // Saturday
      time: '16:00',
      durationMinutes: 90,
      label: 'Bake Night',
    },
  },
  voiceEnabled: false,
  bajaApiKey: '',
  bajaLocalModel: 'llama3.2',
};
