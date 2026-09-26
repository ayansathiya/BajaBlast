# Update log

Every change that reached the kitchen, newest first.

This file is the only copy. The app reads it and shows it under Settings →
What's new, and the README points at it — so there is one list, not three that
disagree. Each entry is a date, a title, and what actually changed.

The format matters, because `app/changelog.cjs` parses it: a heading of
`## YYYY-MM-DD — Title`, then bullets. Anything else is ignored.

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
- Fixed: the first attempt at this update log shipped a test that could never
  pass on GitHub's builder, which quietly blocked the release. It now checks
  that no entry is dated in the future instead.

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
