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
import { BajaAssistant } from './components/BajaAssistant';
import { startLive } from './hooks/live';

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
  const panelOpen = settingsOpen || choresOpen || recipesOpen || browserUrl !== null;
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
        if (browserUrl !== null) setBrowserUrl(null);
        else if (recipesOpen) setRecipesOpen(false);
        else if (choresOpen) setChoresOpen(false);
        else setSettingsOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [browserUrl, recipesOpen, choresOpen]);

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
            className="view-body"
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
            {viewMode === 'week' && (
              <WeekView events={visibleEvents} people={settings.people} anchor={anchor} now={now} />
            )}
            {viewMode === 'month' && (
              <MonthView events={visibleEvents} people={settings.people} anchor={anchor} now={now} />
            )}
          </motion.div>
        </AnimatePresence>

        {settings.ambient.showNews && viewMode === 'day' && (
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
          onClose={() => setBrowserUrl(null)}
          now={now}
        />
      )}

      {isIdle && settings.ambient.enabled && !panelOpen && <IdleReel scenes={idleScenes} />}

      <BajaAssistant
        enabled={settings.voiceEnabled}
        onAddGrocery={(label) => groceryState.add(label)}
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
      {/* Same corner, same reasoning as the gear below: on a wall panel a
          feature you can't reach with a thumb may as well not exist. */}
      {!panelOpen && !isIdle && recipeSettings.enabled && (
        <button className="touch-recipes" onClick={() => setRecipesOpen(true)} aria-label="Recipes">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8.1 2v7.2a2.9 2.9 0 0 0 2 2.75V22h1.8v-10.05a2.9 2.9 0 0 0 2-2.75V2h-1.5v6.2h-1V2h-1.4v6.2h-1V2Zm9.05 0c-1.5 1-2.35 3.2-2.35 6.2 0 2.1.65 3.6 1.9 4.15V22h1.8V2Z"
            />
          </svg>
        </button>
      )}

      {!panelOpen && !isIdle && (
        <button
          className="touch-settings"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Zm7.43-2.53a7.66 7.66 0 0 0 0-1.94l2.05-1.58a.5.5 0 0 0 .12-.64l-1.94-3.36a.5.5 0 0 0-.61-.22l-2.42.97a7.3 7.3 0 0 0-1.68-.97l-.36-2.57a.5.5 0 0 0-.5-.42h-3.88a.5.5 0 0 0-.49.42l-.37 2.57a7.6 7.6 0 0 0-1.67.97l-2.42-.97a.5.5 0 0 0-.61.22L2.4 8.81a.5.5 0 0 0 .12.64l2.05 1.58a7.93 7.93 0 0 0 0 1.94L2.52 14.6a.5.5 0 0 0-.12.64l1.94 3.36a.5.5 0 0 0 .61.22l2.42-.98a7.3 7.3 0 0 0 1.67.98l.37 2.56a.5.5 0 0 0 .49.42h3.88a.5.5 0 0 0 .5-.42l.36-2.56a7.6 7.6 0 0 0 1.68-.98l2.42.98a.5.5 0 0 0 .61-.22l1.94-3.36a.5.5 0 0 0-.12-.64Z"
            />
          </svg>
        </button>
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
