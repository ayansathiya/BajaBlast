import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { useClock } from './hooks/useClock';
import { useCalendar } from './hooks/useCalendar';
import { useWeather } from './hooks/useWeather';
import { useIdleTimer } from './hooks/useIdleTimer';
import { useNews } from './hooks/useNews';
import { useStocks } from './hooks/useStocks';
import { useGrocery } from './hooks/useGrocery';
import { usePhotos } from './hooks/usePhotos';
import { useMusic } from './hooks/useMusic';
import { useDailyReload } from './hooks/useDailyReload';
import { useChores } from './hooks/useChores';
import { ChoreBoard } from './components/ChoreBoard';
import { AnimatePresence, motion } from 'framer-motion';
import { ViewSwitcher } from './components/ViewSwitcher';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';
import { useKioskRemote } from './hooks/useKioskRemote';
import { ViewMode, addDays, eventsOnDay, monthGridStart, rangeLabel, startOfDay, startOfWeek, stepAnchor } from './engine/calendarRange';
import { expandEvents, nextPerSeries } from './engine/recurrence';
import { bakeEvents } from './engine/bake';
import { useBake } from './hooks/useBake';
import { useBookmarks } from './hooks/useBookmarks';
import { useSettings } from './hooks/useSettings';
import { calendarProvider } from './providers';
import { HttpWeatherProvider } from './providers/HttpWeatherProvider';
import { HttpNewsProvider } from './providers/HttpNewsProvider';
import { HttpStocksProvider } from './providers/HttpStocksProvider';
import { HttpGroceryProvider } from './providers/HttpGroceryProvider';
import { DEFAULT_SETTINGS } from './data/sampleData';
import { CalendarEvent, eventPeople } from './data/models';
import {
  annotateTimeline,
  findConflicts,
  findLargestFreeWindow,
  computeLeaveNow,
  buildWhatsNext,
  isSameDay,
  endOf,
  formatClock,
} from './engine/intelligence';
import { getThemePeriod, getThemeTokens } from './engine/timeOfDay';
import { buildIdleScenes } from './engine/idleEngine';

import { ClockDate } from './components/ClockDate';
import { WhatsNext } from './components/WhatsNext';
import { TodayTimeline } from './components/TodayTimeline';
import { RightRail } from './components/RightRail';
import { HeaderWeather } from './components/HeaderWeather';
import { TickerBar } from './components/TickerBar';
import { Briefing } from './components/Briefing';
import { StatusIndicator } from './components/StatusIndicator';
import { IdleReel } from './components/IdleReel';
import { SettingsPanel } from './components/SettingsPanel';
import { RecipeBrowser } from './components/RecipeBrowser';
import { WebBrowser } from './components/WebBrowser';
import { KioskMenu } from './components/KioskMenu';
import { BajaAssistant } from './components/BajaAssistant';
import { startLive } from './hooks/live';
import { useMeals, useNotes, useTimers } from './hooks/useKitchen';
import { buildReminders } from './engine/kitchen';
import { IdleTimers, RailTimers, TimerAlarm, TimerPanel } from './components/Timers';
import { IdleReminders, NotesBoard, ReminderStrip, TonightCard, WeekAhead } from './components/DayExtras';
import { GoodMorning } from './components/GoodMorning';
import { dayKey, isMorning } from './engine/morning';

// Which day the Good Morning page was last put away, so a tap keeps it away
// until tomorrow — including across the reload at midnight or an update.
const MORNING_KEY = 'baja-morning-dismissed';
function readDismissed(): string | null {
  try {
    return localStorage.getItem(MORNING_KEY);
  } catch {
    return null;
  }
}

// All of these read through the local server, which is the only thing that
// talks to the outside world (see electron/livedata.cjs). Weather, news and
// market data are real and refresh on their own; nothing here is mocked.
// Shared with the settings panel via providers/index — see the note there.
const weatherProvider = new HttpWeatherProvider();
const newsProvider = new HttpNewsProvider();
const stocksProvider = new HttpStocksProvider();
const groceryProvider = new HttpGroceryProvider();

startLive();

export default function App() {
  const now = useClock(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, updateSettings } = useSettings(DEFAULT_SETTINGS, settingsOpen);

  const { events, lastSyncedAt, refresh } = useCalendar(calendarProvider);
  const { snapshot: weather, status: weatherStatus } = useWeather(weatherProvider);
  const { items: news, status: newsStatus, updatedAt: newsUpdatedAt } = useNews(newsProvider);
  const tickersKey = (settings.feeds?.tickers ?? []).join(',');
  const { items: stocks, status: stocksStatus, updatedAt: stocksUpdatedAt } = useStocks(stocksProvider, tickersKey);
  const groceryState = useGrocery(groceryProvider);
  const photos = usePhotos();
  const musicState = useMusic(8, settings.music?.showNowPlaying !== false);
  const choreState = useChores(20, settings.chores?.enabled !== false);
  const [choresOpen, setChoresOpen] = useState(false);
  const [recipesOpen, setRecipesOpen] = useState(false);
  // `null` means the browser is closed; a string (possibly empty) means it's
  // open, at that URL or at the configured home page.
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const recipeSettings = settings.recipes ?? DEFAULT_SETTINGS.recipes;
  const { bake, pick: pickBake } = useBake(recipeSettings.enabled);
  const { bookmarks, addBookmark, removeBookmark } = useBookmarks(recipeSettings.browserEnabled);
  const [menuOpen, setMenuOpen] = useState(false);
  const [timerPanelOpen, setTimerPanelOpen] = useState(false);
  const [morningOpen, setMorningOpen] = useState(false);
  const [morningDismissed, setMorningDismissed] = useState<string | null>(readDismissed);
  const { timers, skewMs, start: startTimer, act: actOnTimer } = useTimers();
  const { week: mealWeek, addToGrocery: mealToGrocery } = useMeals();
  const { notes, removeNote } = useNotes();
  // The kiosk is the server, so this is ~0 here; it's the phones that drift.
  const nowMs = now.getTime() + skewMs;
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));

  // The phone can wake the display, switch views and page through the
  // calendar, since the kitchen screen isn't a touchscreen and the keyboard is
  // in a drawer. Kept in a ref so the command handler always steps by the view
  // that's actually on screen, not the one captured when it was created.
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const remote = useKioskRemote((command) => {
    if (command.view) setViewMode(command.view);

    if (command.nav === 'today') {
      setAnchor(startOfDay(new Date()));
    } else if (command.nav === 'prev' || command.nav === 'next') {
      const mode = command.view ?? viewModeRef.current;
      const direction = command.nav === 'next' ? 1 : -1;
      setAnchor((a) => stepAnchor(a, mode, direction, new Date()));
    } else if (command.wake) {
      // A plain wake means "show me now" — an arrow press shouldn't drag the
      // date back to today underneath itself, so this only runs without nav.
      setAnchor(startOfDay(new Date()));
    }
  });
  // Rolls the display over at midnight and recovers after the Mac wakes.
  // Paused while a panel is open so a reload can't interrupt someone
  // mid-edit, or wipe the board out from under a kid ticking off chores.
  const panelOpen = settingsOpen || choresOpen || recipesOpen || browserUrl !== null || menuOpen || timerPanelOpen || morningOpen;
  useDailyReload(!panelOpen);
  const isIdle = useIdleTimer(settings.ambient.idleTimeoutSeconds, settings.ambient.enabled && !panelOpen, remote);

  /*
    Touching a sleeping screen has to bring it back.

    Blanking the panel doesn't disable the touch digitiser — a tap on a dark
    screen still arrives here as an ordinary touch event, the browser just has
    nowhere to draw the result. So the first touch wakes the panel, and because
    the person couldn't see what they were aiming at, it should do nothing else.

    Throttled, because a single tap fires several of these and each one is a
    round trip to a shell command.
  */
  useEffect(() => {
    let lastPing = 0;
    const wake = () => {
      const now = Date.now();
      if (now - lastPing < 5000) return;
      lastPing = now;
      fetch('/api/display/wake', { method: 'POST' }).catch(() => {
        // Not running on the Pi, or no way to control the panel. The rest of
        // the app doesn't care.
      });
    };
    window.addEventListener('touchstart', wake, { passive: true });
    window.addEventListener('mousedown', wake);
    return () => {
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('mousedown', wake);
    };
  }, []);

  // The Good Morning page comes up by itself when the screen wakes for the
  // day, and goes away at ten or when someone taps it — whichever is first.
  // Checked once a minute; nothing else on screen is disturbed to show it.
  const morningNow = isMorning(now, settings.display.schedule?.on);
  const otherPanelOpen = settingsOpen || choresOpen || recipesOpen || browserUrl !== null || timerPanelOpen;
  const today = dayKey(now);
  useEffect(() => {
    if (morningNow && morningDismissed !== today && !otherPanelOpen) setMorningOpen(true);
    if (!morningNow && morningDismissed !== today) setMorningOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morningNow, today, morningDismissed]);

  function closeMorning() {
    setMorningOpen(false);
    if (!morningNow) return;
    setMorningDismissed(today);
    try {
      localStorage.setItem(MORNING_KEY, today);
    } catch {
      // Private mode or storage off: it just shows again after a reload.
    }
  }

  // Tell the server what's on screen, so the phone's arrows aren't pressed blind.
  useEffect(() => {
    fetch('/api/kiosk/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: viewMode, rangeLabel: rangeLabel(anchor, viewMode, new Date()), idle: isIdle }),
    }).catch(() => {
      // Server not up yet; the next change reports again.
    });
  }, [viewMode, anchor, isIdle]);

  // Feature 14: hidden settings shortcut (Cmd/Ctrl + ,) — full menu is also
  // reachable from a phone now (see /mobile), this stays as the on-kiosk path.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (e.key === 'Escape') {
        // One place, one precedence: whatever is on top closes first. The
        // recipe screen's own detail view claims Escape ahead of this (see
        // RecipeBrowser) and stops the event when it does.
        if (menuOpen) setMenuOpen(false);
        else if (morningOpen) closeMorning();
        else if (timerPanelOpen) setTimerPanelOpen(false);
        else if (browserUrl !== null) setBrowserUrl(null);
        else if (recipesOpen) setRecipesOpen(false);
        else if (choresOpen) setChoresOpen(false);
        else setSettingsOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserUrl, recipesOpen, choresOpen, menuOpen, timerPanelOpen, morningOpen, morningNow, today]);

  // Accessibility settings reflected as body classes (global.css hooks into these).
  useEffect(() => {
    document.body.classList.toggle('reduced-motion', settings.display.reducedMotion);
    document.body.classList.toggle('large-text', settings.display.largeText);
    document.body.classList.toggle('high-contrast', settings.display.highContrast);
  }, [settings.display]);

  const enabledPersonIds = useMemo(
    () => new Set(settings.people.filter((p) => p.enabled).map((p) => p.id)),
    [settings.people]
  );

  // An event with nobody on it is everyone's; one with several people shows
  // as long as at least one of them is switched on.
  const filteredEvents = useMemo(
    () =>
      events.filter((e) => {
        const people = eventPeople(e);
        return people.length === 0 || people.some((id) => enabledPersonIds.has(id));
      }),
    [events, enabledPersonIds]
  );

  // Repeats are stored as one master with a rule; these turn them into the
  // individual occurrences to draw. Two windows, because the view and the
  // rail are asking different questions: "what's in front of me" and "what's
  // coming up regardless of where I've navigated to".
  const viewWindow = useMemo(() => {
    if (viewMode === 'day') return { from: addDays(startOfDay(anchor), -1), to: addDays(startOfDay(anchor), 2) };
    if (viewMode === 'week') return { from: addDays(startOfWeek(anchor), -1), to: addDays(startOfWeek(anchor), 8) };
    return { from: addDays(monthGridStart(anchor), -1), to: addDays(monthGridStart(anchor), 43) };
  }, [viewMode, anchor]);

  // Bake Night is synthesised rather than stored (see engine/bake.ts), so it
  // is merged in after expansion — it has no rule for the expander to read.
  // Changes once a day. Bake Night hides past weeks that were never filled in,
  // so the calendar has to be told when "past" moves.
  const todayKey = startOfDay(now).toDateString();

  const visibleEvents = useMemo(
    () => [
      ...expandEvents(filteredEvents, viewWindow.from, viewWindow.to),
      ...bakeEvents(bake, viewWindow.from, viewWindow.to, new Date()),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredEvents, viewWindow, bake, todayKey]
  );

  const minuteBucketForExpansion = Math.floor(now.getTime() / 60000);

  // Kept free of Bake Night on purpose: this list is what Settings offers for
  // editing, and a synthesised event has nothing behind it to edit or delete.
  const upcomingEvents = useMemo(
    () => expandEvents(filteredEvents, addDays(startOfDay(now), -1), addDays(startOfDay(now), 60)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredEvents, minuteBucketForExpansion]
  );

  const upcomingBakes = useMemo(
    () => bakeEvents(bake, addDays(startOfDay(now), -1), addDays(startOfDay(now), 60), now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bake, minuteBucketForExpansion]
  );

  const upcomingWithBake = useMemo(
    () => [...upcomingEvents, ...upcomingBakes].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [upcomingEvents, upcomingBakes]
  );

  const todayEvents = useMemo(
    () => upcomingWithBake.filter((e) => isSameDay(new Date(e.start), now)),
    [upcomingWithBake, now]
  );

  // Day view follows the anchor, so the arrows work there too. The rail and
  // the "what's next" line always mean the real today, whatever you're browsing.
  const anchorIsToday = isSameDay(anchor, now);
  const dayEvents = useMemo(() => eventsOnDay(visibleEvents, anchor), [visibleEvents, anchor]);
  const timeline = useMemo(() => annotateTimeline(dayEvents, now), [dayEvents, now]);

  // Conflicts and "leave now" are about the day you're actually living — they
  // would be noise on a Tuesday three weeks out.
  const conflicts = settings.intelligence.conflictDetection && anchorIsToday ? findConflicts(dayEvents) : [];
  const freeWindow =
    settings.intelligence.prioritizationEnabled && anchorIsToday
      ? findLargestFreeWindow(dayEvents, now, endOf(now))
      : null;
  const leaveNow =
    settings.intelligence.travelTimeEnabled && anchorIsToday ? computeLeaveNow(timeline, now) : null;

  const whatsNextLines = buildWhatsNext(timeline, weather, now);

  // What the wall should be calling out right now: leave-by times, things
  // starting soon, and — in the evening — chores still not done.
  const reminders = useMemo(
    () => buildReminders(todayEvents, choreState.state, settings.people, now),
    // Minute resolution is plenty; the text is in whole minutes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayEvents, choreState.state, settings.people, minuteBucketForExpansion]
  );

  // The space under today's timeline. Only on the real today — dinner and
  // "the week ahead" are about now, not about a Tuesday you've paged to.
  const showExtras = viewMode === 'day' && anchorIsToday;
  const upcomingToday = timeline.filter((e) => e.status !== 'past').length;
  const showWeekAhead = showExtras && upcomingToday <= 4;
  const tonight = mealWeek.find((d) => d.isToday) ?? null;

  const comingUp = useMemo(() => {
    // Only the nearest bake, not every Saturday between here and Christmas.
    // Each synthesised bake has its own id, so nextPerSeries can't collapse
    // them the way it collapses a real weekly repeat.
    const nextBake = upcomingBakes.filter((e) => new Date(e.start).getTime() > now.getTime()).slice(0, 1);
    const future = [...upcomingEvents, ...nextBake]
      .filter((e) => new Date(e.start).getTime() > now.getTime())
      .filter((e) => e.importance >= 1 || !isSameDay(new Date(e.start), now))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    // One row per series. Without this, a household whose only repeating event
    // is a weekly piano lesson sees "piano, piano, piano" as the next three
    // things coming up, which tells them nothing they didn't know.
    return nextPerSeries(future).slice(0, 3);
  }, [upcomingEvents, upcomingBakes, now]);

  // Feature 18 — theme evolves with time of day / sunrise-sunset.
  const themeInfo = getThemePeriod(now, weather ? new Date(weather.now.sunrise) : undefined, weather ? new Date(weather.now.sunset) : undefined);
  const tokens = getThemeTokens(themeInfo.period);

  // Feature 20 — idle scenes only need to be recomputed roughly once a
  // minute. Keying off a minute bucket instead of `now` keeps the array
  // reference stable between ticks, which IdleReel depends on to let each
  // scene's timer actually run to completion.
  const minuteBucket = Math.floor(now.getTime() / 60000);
  const idleScenes = useMemo(
    () =>
      buildIdleScenes(
        upcomingWithBake,
        weather,
        settings.ambient,
        now,
        news,
        groceryState.items,
        photos,
        musicState.state?.nowPlaying ?? null
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upcomingWithBake, weather, settings.ambient, minuteBucket, news, groceryState.items, photos, musicState.state?.nowPlaying?.title]
  );

  const weatherLine = weather ? `It's ${Math.round(weather.now.tempF)} degrees and ${weather.now.condition.toLowerCase()}.` : undefined;

  // Compact context string for Baja's LLM fallback — today's schedule +
  // grocery list, kept short since it's re-sent on every open-ended question.
  const householdContext = useMemo(() => {
    const lines: string[] = [];
    if (timeline.length === 0) {
      lines.push('Nothing scheduled today.');
    } else {
      lines.push('Today:');
      timeline.forEach((e) => lines.push(`- ${formatClock(new Date(e.start))} ${e.title}${e.location ? ` (${e.location.label})` : ''}`));
    }
    if (weather) lines.push(`Weather: ${Math.round(weather.now.tempF)}°, ${weather.now.condition}.`);
    const pendingGrocery = groceryState.items.filter((g) => !g.done);
    if (pendingGrocery.length > 0) {
      lines.push(`Grocery list: ${pendingGrocery.map((g) => g.label).join(', ')}.`);
    }
    return lines.join('\n');
  }, [timeline, weather, groceryState.items]);

  return (
    <div
      className="kiosk"
      style={{
        // @ts-ignore custom properties
        '--bg': tokens.bg,
        '--bg-elevated': tokens.bgElevated,
        '--text': tokens.text,
        '--text-muted': tokens.textMuted,
        '--accent': tokens.accent,
        '--hairline': tokens.hairline,
        filter: `brightness(${settings.display.brightness})`,
      }}
    >
      <ClockDate now={now} clockStyle={settings.display.clockStyle} />
      <HeaderWeather
        weather={weather}
        status={weatherStatus}
        place={settings.homeLocation.label}
        now={now}
      />
      <WhatsNext lines={whatsNextLines} />

      <div className="main-col">
        <ReminderStrip reminders={reminders} />
        <ViewSwitcher
          mode={viewMode}
          anchor={anchor}
          now={now}
          onMode={setViewMode}
          onStep={(d) => setAnchor((a) => stepAnchor(a, viewMode, d, now))}
          onToday={() => setAnchor(startOfDay(now))}
        />

        {/* Crossfade rather than a hard cut — the switch reads as the same
            calendar rearranging itself, not as a different screen. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${viewMode}-${anchor.toDateString()}`}
            className={`view-body ${showExtras ? 'with-extras' : ''} ${showWeekAhead ? 'with-week' : ''}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: settings.display.reducedMotion ? 0 : 0.28, ease: 'easeOut' }}
          >
            {viewMode === 'day' && (
              <TodayTimeline
                events={timeline}
                people={settings.people}
                conflicts={conflicts}
                freeWindow={freeWindow}
                leaveNow={leaveNow}
                templates={settings.preparationTemplates}
                weather={settings.intelligence.weatherAwareness ? weather : null}
              />
            )}
            {showExtras && (
              <div className="day-extras">
                <div className="extras-top">
                  <TonightCard day={tonight} onAddToGrocery={mealToGrocery} />
                  <NotesBoard notes={notes} people={settings.people} now={now} onRemove={removeNote} max={showWeekAhead ? 3 : 2} />
                </div>
                {showWeekAhead && <WeekAhead events={upcomingWithBake} meals={mealWeek} people={settings.people} now={now} />}
              </div>
            )}
            {viewMode === 'week' && (
              <WeekView events={visibleEvents} people={settings.people} anchor={anchor} now={now} />
            )}
            {viewMode === 'month' && (
              <MonthView events={visibleEvents} people={settings.people} anchor={anchor} now={now} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Under today, dinner and notes take this room and the headlines give way: they're in the
            ticker along the bottom already. */}
        {settings.ambient.showNews && viewMode === 'day' && !showExtras && (
          <Briefing news={news} status={newsStatus} updatedAt={newsUpdatedAt} now={now} />
        )}
      </div>

      <RightRail
        upcoming={comingUp}
        people={settings.people}
        todayEvents={todayEvents}
        now={now}
        showGrocery={settings.ambient.showGrocery}
        grocery={groceryState.items}
        onToggleGrocery={groceryState.toggle}
        photos={photos}
        showPhotoFrame={settings.feeds?.showPhotoFrame ?? true}
        nowPlaying={musicState.state?.nowPlaying ?? null}
        showNowPlaying={settings.music?.showNowPlaying !== false}
        onMusicCommand={musicState.command}
        chores={choreState.state}
        showChores={settings.chores?.enabled !== false}
        onOpenChores={() => setChoresOpen(true)}
        bake={recipeSettings.enabled ? bake : null}
        onOpenRecipes={() => setRecipesOpen(true)}
        timersSlot={
          <RailTimers timers={timers} nowMs={nowMs} onAct={actOnTimer} onOpen={() => setTimerPanelOpen(true)} />
        }
        timersVisible={timers.length > 0}
      />

      <TickerBar
        news={news}
        newsStatus={newsStatus}
        stocks={stocks}
        stocksStatus={stocksStatus}
        showNews={settings.ambient.showNews}
      />

      <StatusIndicator lastSyncedAt={lastSyncedAt} now={now} />

      {choresOpen && choreState.state && (
        <ChoreBoard
          state={choreState.state}
          people={settings.people}
          onToggle={choreState.toggle}
          onClose={() => setChoresOpen(false)}
          reducedMotion={settings.display.reducedMotion}
        />
      )}

      {recipesOpen && (
        <RecipeBrowser
          settings={recipeSettings}
          bake={bake}
          onPickBake={pickBake}
          onAddGrocery={(label) => groceryState.add(label)}
          onOpenBrowser={(url) => setBrowserUrl(url ?? '')}
          onClose={() => setRecipesOpen(false)}
          now={now}
        />
      )}

      {browserUrl !== null && recipeSettings.browserEnabled && (
        <WebBrowser
          home={recipeSettings.browserHome}
          onScreenKeyboard={recipeSettings.onScreenKeyboard}
          startUrl={browserUrl || undefined}
          bake={bake}
          onPickBake={pickBake}
          bookmarks={bookmarks}
          onAddBookmark={addBookmark}
          onRemoveBookmark={removeBookmark}
          onClose={() => setBrowserUrl(null)}
          now={now}
        />
      )}

      {isIdle && settings.ambient.enabled && !panelOpen && <IdleReel scenes={idleScenes} />}
      {isIdle && settings.ambient.enabled && !panelOpen && (
        <div className="idle-kitchen">
          <IdleReminders reminders={reminders} />
          <IdleTimers timers={timers} nowMs={nowMs} />
        </div>
      )}

      {morningOpen && (
        <GoodMorning
          now={now}
          weather={weather}
          todayEvents={todayEvents}
          upcoming={upcomingWithBake}
          tonight={tonight}
          chores={settings.chores?.enabled !== false ? choreState.state : null}
          people={settings.people}
          news={news}
          showNews={settings.ambient.showNews}
          onClose={closeMorning}
        />
      )}

      {timerPanelOpen && (
        <TimerPanel
          timers={timers}
          nowMs={nowMs}
          onStart={(seconds, label) => startTimer(seconds, label)}
          onAct={actOnTimer}
          onClose={() => setTimerPanelOpen(false)}
        />
      )}

      {/* Above everything, idle reel and open panels included: the one thing
          on this screen allowed to interrupt. */}
      <TimerAlarm
        timers={timers}
        nowMs={nowMs}
        sound
        onDismiss={(id) => actOnTimer(id, 'dismiss')}
        onSnooze={(id) => actOnTimer(id, 'add', 60)}
      />

      <BajaAssistant
        enabled={settings.voiceEnabled}
        onAddGrocery={(label) => groceryState.add(label)}
        onStartTimer={(seconds, label) => startTimer(seconds, label)}
        whatsNextLines={whatsNextLines}
        weatherLine={weatherLine}
        householdContext={householdContext}
      />

      {/*
        The way in, without a keyboard.

        Cmd+comma is unreachable on a wall-mounted touchscreen — there is no
        keyboard and there is never going to be one. Without this button the
        app is literally unconfigurable on the hardware it's built for.

        Deliberately understated: bottom corner, low contrast until touched,
        so it doesn't compete with the calendar from across the room. Big
        enough to hit reliably with a thumb, which is the part that matters.
      */}

      {!settingsOpen && !choresOpen && !recipesOpen && browserUrl === null && !timerPanelOpen && !morningOpen && !isIdle && (
        <KioskMenu
          open={menuOpen}
          onToggle={() => setMenuOpen((v) => !v)}
          onClose={() => setMenuOpen(false)}
          entries={[
            { key: 'morning', label: 'Good morning', icon: '☀', onPick: () => setMorningOpen(true) },
            { key: 'timers', label: 'Timers', icon: '⏱', onPick: () => setTimerPanelOpen(true) },
            ...(recipeSettings.enabled
              ? [{ key: 'recipes', label: 'Recipes', icon: '🍴', onPick: () => setRecipesOpen(true) }]
              : []),
            ...(recipeSettings.browserEnabled
              ? [{ key: 'browser', label: 'Browser', icon: '🌐', onPick: () => setBrowserUrl('') }]
              : []),
            ...(settings.chores?.enabled !== false && choreState.state
              ? [{ key: 'chores', label: 'Chores', icon: '✓', onPick: () => setChoresOpen(true) }]
              : []),
            { key: 'settings', label: 'Settings', icon: '⚙', onPick: () => setSettingsOpen(true) },
          ]}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          visibleEvents={upcomingEvents}
          onEventsChanged={refresh}
          grocery={groceryState.items}
          onAddGrocery={groceryState.add}
          onRemoveGrocery={groceryState.remove}
        />
      )}
    </div>
  );
}
