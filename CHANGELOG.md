# Update log

Every change that reached the kitchen, newest first.

This file is the only copy. The app reads it and shows it under Settings →
What's new, and the README points at it — so there is one list, not three that
disagree. Each entry is a date, a title, and what actually changed.

The format matters, because `app/changelog.cjs` parses it: a heading of
`## YYYY-MM-DD — Title`, then bullets. Anything else is ignored.

## 2026-09-28 — Updates in about a minute

- **The screen checks for updates every ten seconds** instead of every
  forty-five, so a change reaches the wall about a minute after it's sent:
  roughly forty seconds for GitHub to build and test it, then a few seconds
  to arrive. Checks that find nothing new cost nothing, however often.
- Fixed: the previous update (the Good Morning page and the rest below)
  never reached the kitchen. One of its new checks only failed on GitHub,
  where the real release number is filled in, so GitHub refused to publish
  it. It goes out with this one.

## 2026-09-28 — Good morning, lights out at 11, and updates in seconds

- **A Good Morning page.** When the screen wakes for the day it opens on
  one page with everything needed before leaving the house: the weather
  and **what to wear** (coat, layers, umbrella), today's events with
  **when to leave** for each, dinner tonight, who has which chores left,
  birthdays this week, and a few headlines. Tap "Start the day" and it's
  the calendar until tomorrow; it goes away by itself at 10am. It's also
  in the corner menu, any time.
- **The Pi switches itself off at night.** On a Raspberry Pi 5, at the
  screen's off time (11pm to start with, Settings → Display) the whole Pi
  powers down, and it switches itself back on at the morning time — no
  button, no plug. It won't do it in the first 15 minutes after someone
  turns it on, so switching it on late at night sticks. Other Pis keep the
  old behaviour: the screen sleeps and the Pi stays up. Phones can't reach
  the calendar while it's off; `NIGHT_POWER_OFF=0` in
  `/etc/default/baja-blast` keeps it on all night.
- **No password when the Pi starts.** It logs in to the desktop by itself,
  so after the night or a power cut it goes straight back to the calendar.
- **Updates show up on the wall straight away.** Before, the Pi installed
  an update but the screen kept showing the old version until midnight,
  because nothing told the page to reload. Now it reloads itself the moment
  the new version is running.
- **Updates can come straight from the Mac, in seconds.** Once the Mac and
  the Pi are linked (`bash setup/pi-link.sh`, once), `npm run deploy` sends
  a change over the home Wi-Fi without waiting a minute for
  GitHub to build it. GitHub still gets every change, and the Pi still
  updates itself from there.
- **The iPhone app, from the Pi in one line.** The "reach it from anywhere"
  setup now works on the Pi as a single pasted line: it installs Tailscale,
  signs in, and turns on the HTTPS a phone needs before it will add the page
  to the home screen as an app.

## 2026-09-28 — Full screen on its own, and no more typing on the Pi

- **The Pi now shows the calendar full screen by itself** when its desktop
  starts — no address bar, no tabs, and Chromium comes straight back if it
  closes. It waits for the calendar before opening, so a cold boot doesn't
  show "This site can't be reached", and switching off at the wall no longer
  leaves a "Restore pages?" bar across the calendar.
- Pinch-zoom and swipe-back are off on the wall: both are things an elbow
  does to a touch panel, with no way back.
- **Text size is one setting**: `KIOSK_SCALE` in `/etc/default/baja-blast`,
  1.25 to start with for a 21.5" panel. It scales the whole layout, and an
  edit survives upgrades.
- **The Pi installs new packages on its own.** Until now only the calendar's
  code updated itself; anything in the package still meant typing wget and apt
  at the Pi. Now it checks GitHub every ten minutes and installs a newer
  release itself. This is the last update that has to be installed by hand.

## 2026-09-28 — Dinner, timers, notes, and no more empty screen

- **A quiet day isn't an empty screen any more.** Under today's events the
  day view now shows tonight's dinner, any notes the family has left, and
  **the week ahead** — the next six days side by side, each with its dinner
  and what's on. It used to be one line saying "Nothing scheduled" above a
  screen's worth of black. On a busy day the week strip steps aside so
  today's list keeps its room. The headlines that used to sit under today
  give way to all this — they're in the ticker along the bottom already.
- **Kitchen timers.** Start them from the phone (Timers tab), from the
  corner menu on the wall, or by saying "Baja, set a timer for 10 minutes
  for the pasta". Several at once, each with a name, counting down large at
  the top of the rail. Pause, +1 minute, cancel — from the wall or any
  phone.
- When one goes off, a coral banner goes across the top of everything —
  over the idle reel and over any open screen — until someone presses Done
  (or Space/Enter on the keyboard). It chimes if the screen can make sound,
  buzzes a phone that has the page open, and wakes the screen even if it's
  asleep for the night. A timer nobody answers stops after fifteen minutes.
- Timers live on the server and store when they end, not how long is left,
  so an overnight update or a screen reload doesn't lose or restart one.
  Timers keep running while the idle reel is up, shown small in the corner.
- **Dinner this week.** A Meals tab on the phone plans each night: type a
  name, or search the recipe list and its ingredients come with it.
  Tonight's dinner sits under today on the wall; "Add ingredients to the
  list" skips anything already on the grocery list, so pressing it twice, or
  for two dinners that both need onions, doesn't double anything up.
- **Reminders that speak up.** A line above the calendar says "Jack: leave
  for RSM in 15 min" from half an hour before you need to go, turning coral
  in the last five minutes. Events without a travel time get "Piano starts
  in 20 min". After 6pm it also names whoever still has chores left. The
  urgent ones show over the idle reel too.
- Leave-by times now count the same rush-hour allowance everywhere, so the
  reminder and the timeline never disagree by five minutes.
- **Notes on the wall.** The phone's Notes tab posts a note to the kitchen
  screen — from whoever you pick, for a day, three days, a week, or until
  cleared. Posting one wakes the screen. Tap ✓ on the wall to clear it.
- Meals and notes are in backups and come back on restore. Timers aren't,
  on purpose — a backup's "pasta, 3 minutes" is from some other evening.
- Fixed: the times in today's list had their left edge clipped off.

## 2026-09-26 — An Android app

- **Baja Blast for Android**: the phone page as a real app, with its own icon,
  on the ordinary home-Wi-Fi address. No Tailscale or HTTPS is needed just
  to get it onto the home screen.
- It finds the kitchen on the Wi-Fi by itself. Open it and it's usually on the
  calendar within a few seconds, with no address to type.
- Photos can be added several at once, and links to recipe sites open in the
  browser instead of trapping you inside the app.
- Long-press the icon for the grocery list, a new event, or chores.
- Fixed: the phone page's own home-screen shortcuts (grocery, event, chores)
  opened the calendar every time. They now open the tab they name.
- GitHub builds the app and keeps it at one link that never changes.

## 2026-09-26 — Runs on a TV box, on its own

- **Armbian TV boxes**, starting with an A95X (S905X, 1GB). One line on the
  box downloads the packages from GitHub, installs them and reboots into the
  calendar. README → On an Armbian TV box has the steps, from the SD card up.
- A second, optional package makes the box **standalone**: it logs itself in,
  shows the calendar full screen with no desktop underneath, and brings the
  browser back within seconds if it ever closes.
- A box like that **starts in low power mode**, so nobody has to find the
  switch on a slow screen. It's applied once. Turn it off in Settings and it
  stays off.
- **Turn the TV off too**, in Settings → Display. Most TVs ignore a blank
  signal and stay lit up saying "No signal", so this sends the TV to standby
  over HDMI at night and switches it back on in the morning. It's on for the
  TV box and off everywhere else.
- Every release now includes the installable packages as well, so setting up
  a new box no longer needs a computer with Node on it.

## 2026-09-26 — The corner buttons line up

- The settings and recipes buttons in the bottom-right corner now sit on the
  same margin as the rest of the page, instead of past it.
- The news ticker stops before those buttons rather than scrolling underneath
  them.

## 2026-09-23 — Type with a real keyboard, search the whole web

- The recipe search is a real text box again. Open Recipes and start typing —
  the cursor is already there, nothing to click first.
- The on-screen keyboard is off by default. It was in the way on every machine
  that has a keyboard of its own. Settings → Recipes turns it back on for a
  wall panel that genuinely has none.
- The browser's address bar is a real input too. Type an address, or type
  words and press Enter to search.
- **Search Google** next to the recipe search: the built-in list is a few
  hundred recipes, Google is all of them. Results open in the in-app browser,
  where "Bake this on Saturday" still works — so a recipe from a stranger's
  blog lands on the calendar exactly like one from the list.
- Escape closes whatever is on top: an open recipe, then the browser, then the
  screen behind it. One rule, one place.
- Fixed: `localhost:8787` in the address bar was being treated as a web search
  rather than as the kiosk's own address.
- **This update log**, in Settings → What's new as well as here. The display
  updates itself overnight, so the screen can change without anyone having
  asked it to — you should be able to walk up the next morning and find out
  what happened. The build running right now is marked.
- **Low power mode**, in Settings → Display. One switch that turns off the
  animation, the idle reel and the rotating photo frame, for a small box where
  those are most of the work the processor does.
- **The browser is its own screen now**, not something you reach through
  Recipes. It opens straight from the menu, and everything it could do before
  — pinning a page as the week's bake, searching Google — it still does.
- **Bookmarks.** Save any page with the star in the browser bar; the saved
  list sits under the address bar, one tap from anywhere. The list lives on
  the server rather than in a browser, so it's the same list on the kitchen
  screen and on every phone — save the school lunch menu from the sofa and
  it's on the wall a second later.
- Bookmarks have their own **Links** tab on the phone: see them, add them,
  remove them, and tap one to open it in your own browser.
- Only `http` and `https` addresses can be saved. Anyone on the house Wi-Fi
  can add a bookmark from the phone page, and a kiosk that will open whatever
  it is handed would open `file:///` and read its own disk.
- **One button in the corner instead of two.** It opens a short menu —
  Recipes, Browser, Chores, Settings — because a third circle was about to
  arrive with the browser and three controls beside a calendar is too many.
- **Updates arrive in about three minutes instead of up to thirty.** The
  screen now checks GitHub every forty-five seconds rather than every half
  hour. That's affordable because it asks conditionally — an unchanged
  release comes back "304 Not Modified", and those don't count against
  GitHub's hourly limit, so the usual answer costs nothing however often you
  ask. A run of failures backs the interval off to fifteen minutes rather
  than hammering a network that isn't there.
- Fixed: the two round buttons in the bottom-right corner hung past the page
  margin, and the news ticker ran underneath them. They now line up with
  everything else on screen, and the ticker stops before it reaches them.
- Fixed: the first attempt at this update log shipped a test that could never
  pass on GitHub's builder, which quietly blocked the release. The release
  stamps the build with the date it runs, and the test insisted the log had an
  entry for that exact date. It now checks the thing actually worth checking —
  that no entry is dated in the future.

## 2026-09-21 — Recipes, Bake Night, and a browser inside the app

- **Recipes.** A photo grid of baking, mocktails, cocktails and every food
  category the recipe API publishes. Tap a photo for the full recipe:
  ingredients one side, numbered steps the other, sized to read at arm's
  length with flour on your hands.
- "Add to grocery list" puts a whole ingredient list on the shared list, so
  it's on everyone's phone before anybody leaves the house.
- Cocktails have their own switch in Settings → Recipes, for a screen at child
  height. Turning it off hides the tab and refuses the route, so a phone with
  the page already open isn't a way around it.
- **Bake Night.** One day a week — Saturday unless you change it — that the
  family makes something together. Pick a recipe and it lands on that week's
  bake day: on the calendar in every view, in the rail with its photo, and on
  the phone with its ingredients for whoever is at the shop.
- Picks are stored by date, so the week rolls over on its own with no timer and
  nothing to reset, and you can choose the next three Saturdays in one sitting.
  Each pick keeps its own copy of the ingredients, so bake day works with the
  recipe site down.
- Change the bake day in Settings and every week moves at once, past picks
  included.
- **A browser inside the app**, with a back button that always returns to the
  calendar and a button that pins whatever page you're looking at as the
  week's bake. Real browsing in the Mac app; on Linux it can only show sites
  that allow being embedded, and says so plainly when one doesn't.
- The phone gained a Bake tab: this week's recipe, its ingredients, and a
  search box for picking next week's from the sofa.
- Fixed: restoring a backup silently dropped every chore point the kids had
  earned. It now restores those too.

## 2026-09-19 — Repeats stop shouting

- A weekly piano lesson is one row in a list, not eighteen. Lists collapse to
  one entry per series — "Wednesdays · 7 more coming up" — while the week and
  month grids still show every occurrence, because that's what a calendar is.
- "Coming up" shows the next occurrence of each different thing, instead of
  the same lesson three times.

## 2026-09-18 — The display is live

- A change made on a phone reaches the wall screen in about 60 milliseconds.
  Eleven polling timers became one connection the server writes down when
  something changes.
- Arrow presses on the phone remote are never merged together — that was the
  bug that made the old remote feel broken.
- The screen sleeps at 11pm and wakes at 6am, and a touch wakes it early. The
  machine behind it stays up, so phones keep working overnight and updates
  still land.

## 2026-09-14 — It installs, updates and repairs itself

- Ships as a `.deb`: one command installs it, it starts on boot, and it
  restarts itself if it ever stops.
- Updates arrive from GitHub on their own. A new release is downloaded,
  checksummed, and swapped in during a quiet moment.
- A bad release gets two chances to start and stay up. Fail twice and it is
  blocked, the previous version comes back, and nobody has to do anything.
- The household's calendar, photos and chore points live outside the app, so
  updating — or even uninstalling — never touches them.

## Earlier

The calendar itself, and everything around it: day, week and month views,
weather, news, market ticker, the grocery list, the chore board with points
and rewards, family photos, music, the idle reel, the voice assistant, and the
phone app with its QR code and offline support.
