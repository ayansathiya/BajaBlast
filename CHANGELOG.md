# Update log

Every change that reached the kitchen, newest first.

This file is the only copy. The app reads it and shows it under Settings →
What's new, and the README points at it — so there is one list, not three that
disagree. Each entry is a date, a title, and what actually changed.

The format matters, because `app/changelog.cjs` parses it: a heading of
`## YYYY-MM-DD — Title`, then bullets. Anything else is ignored.

## 2026-10-24 — Scan a photo you already have

- **Scan a photo: take one *or* choose one.** The phone's Scan tab has two
  buttons now — **Take a photo** opens the camera, **Choose a photo** opens
  your photo library, for a screenshot or a newsletter someone sent you.
  It used to open the camera only.
- **Reading photos keeps working when Groq changes its models.** Groq
  retires its image-reading models from time to time, and when the one Baja
  asked for was gone, every scan failed. Now it uses whichever image-reading
  model your Groq key has. If a scan still fails, the phone says why.
- Behind the scenes: a check that could fail by chance on GitHub's busy
  machines (changes arriving a few milliseconds too far apart) held the
  last update back; changes are now grouped over 150ms instead of 60 —
  still instant — and the check passes reliably.

## 2026-10-24 — "Who are you?" on the phone, and an iPhone app

- **The phone page knows whose phone it is.** The first time it opens it
  asks "Who are you?" — pick yourself once and from then on it opens on
  your own tab: "Good afternoon, Jack", the weather and what to wear, your
  events today and tomorrow (with leave-by times), your chores to tick off
  right there with your points, reminders, dinner, timers, groceries and
  the notes on the wall. Every other tab is still there. "Not you? Switch
  person" changes it.
- **A real iPhone app** (the `ios` folder). It finds the kitchen on the home
  Wi-Fi by itself — no address to type — and opens on that welcome. Away
  from home it uses the kitchen's Tailscale address once that's set up. It
  goes onto each phone from the Mac mini with Xcode; see ios/README.md.

## 2026-10-24 — A connected speaker actually plays

- **Fixed: a speaker said "Connected" but no sound came out of it.**
  Connecting a Bluetooth speaker doesn't by itself move the Pi's sound
  there — it kept playing through the screen. Now, the moment a speaker
  connects, the calendar puts it in music mode (some speakers connect in
  phone-call mode, which can be silent), makes it the Pi's output, and
  moves whatever's already playing onto it.
- **Already connected?** Open Speakers and tap **Use for sound** next to
  it. The panel now says where sound is playing ("Sound is playing on
  Sony SRS…"), and **Play a test sound** checks it — if the chime comes
  out of the speaker, Baja and the timers will too.

## 2026-10-24 — Bluetooth speakers, reminders you can read, and Baja's new voices

- **Connect a Bluetooth speaker from the wall.** Corner menu → Speakers.
  Put the speaker in pairing mode, tap Find speakers, tap Connect. It's
  paired and trusted, so it reconnects by itself next time it's switched
  on, and everything the wall plays — Baja, the timer chime, music — comes
  out of it. Disconnect and Forget are there too.
- **Reminders on the home screen are the reminders themselves.** Under
  today's events there's now a Reminders list — each one with a circle to
  tick it off, what's due now in coral, and when the others are. The strip
  along the bottom shows the first two by name instead of a count.
- **Two new voices for Baja** (Settings → Baja → Voice):
  - **Warrior** — deep, slow and gravelly, and stern and few-worded.
  - **Spartan** — deep and calm, as if through a helmet radio, and
    clipped: "Affirmative."
  They're styles, built from Piper's own voices — not copies of any real
  person's voice. Choosing one downloads it once (about 60MB).

## 2026-10-20 — Baja only answers when you say its name

- **Baja listens for "Baja", "Hey Baja" and "Hi Baja" — and nothing else.**
  It used to wake on ordinary kitchen talk and answer conversations nobody
  was having with it. Two things caused that: its name-spotter only knew a
  few words, so it heard "Baja" in almost any sound; and when the rest of
  its hearing couldn't confirm the name, it woke up anyway. Now both have
  to agree that someone *started* talking with Baja's name, after a pause,
  and if they don't agree, nothing happens.
- "Hey Baja, what's next?" and "Baja… what's for dinner?" both work, and
  Baja no longer hears "hey" or "Baja" as part of the question.
- Checked with the same speech recognition the Pi uses, on spoken audio in
  five voices and four accents: all ten "Baja" requests were answered,
  including a long grocery list; none of ten ordinary conversations — a TV
  weather forecast, "Roger that", "Hey, bring the bag in", "the Bahamas
  trip", "Papa, can I have a snack?", "Better hurry up" — woke it. The old
  listener, on the same audio, answered four of those conversations and
  missed every real "Baja".
- Australian and Irish "Baja" (heard as "the her" and "better") now count;
  long questions no longer get dropped while Baja waits to be sure.

## 2026-10-20 — Reminders, reading photos, and the lights on the home screen

- **Reminders.** A new Reminders panel (corner menu, or the strip along the
  bottom) and a Reminders tab on the phone. Give one a time ("tonight 8pm",
  "fri 8am") or none. When its time comes the screen lights up and it sits
  at the top of the calendar in coral until it's ticked off.
- **Scan a photo.** On the phone's new Scan tab, photograph a school
  newsletter, an invitation or a shopping list: the events, groceries and
  reminders in it come up as a list to tick, and only what you tick is
  added. On the wall, Scan a photo shows a code to open it. Needs the free
  Groq key (or an Anthropic key) in Settings → Baja.
- **The lights are on the home screen.** One tap in the strip along the
  bottom turns them all off (or on); "Moods & dimming" opens the rest.

## 2026-10-20 — The browser lives inside the calendar now

- **Browser never leaves the app.** Before, it closed the calendar and
  opened a separate Chromium window — with nothing to type with and no way
  back. Now Browser opens a page inside the calendar: a big search box
  (the on-screen keyboard comes up with it), Google, YouTube, your recipe
  site and your bookmarks. Pick one and the calendar's own screen goes
  there — every site works, because nothing is squeezed into a frame.
- **On every website, a bar along the bottom:** Back, Forward, a keyboard,
  Search (back to the start page) and **Calendar** to come home. Tap any
  text box on the site — Google's search, YouTube's — and the calendar's
  keyboard comes up and types into it. Links that would open a new window
  open in place instead.
- **It comes home by itself** after ten minutes nobody touches it, and the
  moment a kitchen timer goes off.
- After this update the Pi restarts the calendar once by itself to switch
  this on — a few seconds of blank screen, no reboot.
- Tested in a real Chromium: typing on a site with the on-screen keyboard,
  searching, Back, Calendar, and a timer bringing it home.

## 2026-10-20 — The wall, rebuilt

- **A completely new home screen.** Not a restyle — a different layout:
  - **On the left, the moment.** A very large time, the day and date, the
    weather with the high and low, and what's next with a countdown ("in
    42 min"). The Thirukkural sits quietly at the foot of the column when
    there's room for it.
  - **On the right, the calendar, with room to breathe.** Today is a list:
    the time in its own column, each event in large type, who and where
    underneath, and "Now" beside whatever's happening. Things that are
    already over fold into a single "Earlier" line, so the space goes to
    what's still ahead. On a quiet day the week ahead appears underneath.
  - **Along the bottom, everything else, in one line.** Dinner, chores
    (a ring per person that fills as they tick things off), groceries,
    bake night — and a running timer or what's playing, only while there
    is one. Tap any of them to open it. Groceries now open a list you can
    tick off and add to from the wall.
  - **Headlines** are one quiet line under that.
- **Black is just black.** No cards, no boxes, no outlines anywhere on
  the home screen or the Good Morning page — just type on black, lined up.
  Beige is the same layout on warm paper.
- **Even spacing.** Every gap now comes from one small set of sizes, and
  the layout was checked at the Pi's own size (a 1080p panel at its 1.25
  zoom) as well as plain 1080p, which is where things used to crowd.
- **The week and month views match:** seven clean columns with today
  underlined; a month with today circled and no grey boxes.
- The chores reminders at the top of the calendar are gone — they're in
  the strip along the bottom now; the top is kept for "leave by" and
  "starting soon".

## 2026-10-20 — A new look, in black or beige, and a browser that really opens

- **A whole new look.** The calendar has been redrawn: the time and date
  in a light serif, everything else in one clean sans, the calendar and
  the side panels on soft rounded cards instead of outlined boxes, and a
  single warm sand accent in place of the neon teal and coral. Day, week
  and month are one rounded switch. Coral is kept only for things that
  need you now — a timer going off, time to leave.
- **Black or beige.** Settings → Display → Look: **Black** (true black,
  warm white text — the wall as it's been, dimming a little at night),
  **Beige** (a warm paper background, white cards, dark text), or
  **Beige by day** (beige while it's light out, black after sunset). The
  Good Morning page, the menus, Settings and the on-screen keyboard all
  follow it.
- **The browser really opens now.** Last time the calendar disappeared
  and came straight back: the Pi was still running the old screen
  launcher from before the update, which didn't know how to step aside.
  Now the new one notices an old launcher, replaces it on the spot, and
  then opens the browser — no restart needed. From now on the launcher
  also updates itself between screens, and keeps a short log of what it
  did, so if it ever misbehaves again the reason is written down.
- Wake-up and sleep times for the screen, and the bake-night time, are
  typed too ("6am", "11pm"), like event times.
- A person whose colour is white or pale no longer disappears on beige.

## 2026-10-20 — Type a time, go back a version, and a quieter wall

- **Type the time of an event.** The date and time boxes used the
  browser's own pickers, which on a touch screen are a cramped wheel with
  only some times on it. Now they're ordinary boxes for the on-screen
  keyboard, and they understand how people write: "3pm", "3:30", "330p",
  "noon"; "tomorrow", "fri", "oct 25", "10/25". Underneath each box it
  shows what it understood ("→ 3:30 PM", "→ Fri, Oct 23"), and Save waits
  until all three make sense. A bare "4" means four in the afternoon.
- **No more empty boxes for icons.** The corner menu's icons were emoji,
  and the Pi has no emoji font, so they came out as boxes with a cross.
  Every icon — menu, weather, play and pause, close, bookmark — is now
  drawn instead, and the Pi gets the emoji font as well for emoji inside
  recipes and messages.
- **The browser opens.** Browser used to open as a second window behind
  the full-screen calendar, where nothing could be seen. Now the calendar
  steps aside and the browser takes the whole screen, with tabs, an
  address bar, back and close; close it and the calendar is straight back.
  It closes by itself after 45 minutes (`BROWSER_MINUTES` in
  `/etc/default/baja-blast`), and at once when a kitchen timer goes off,
  so an alarm is never hidden behind a web page.
- **Go back to an older version.** Settings → What's new → "Go back to an
  older version" lists every release. Pick one and the wall switches to it
  in a few seconds and stays there — automatic updates wait — until you
  press "Back to the newest". Calendar, lists and photos aren't touched.
- **A quieter wall.** Labels are plain words in one muted colour instead
  of tiny coloured capitals; nothing is smaller than 14px, so it reads
  from across the kitchen; the week ahead is columns instead of a grid of
  boxes, and stops writing "Dinner?" and "Free" six times over. The
  accent colour is kept for what's happening now.

## 2026-10-14 — Lights that can be seen but not switched

- **Why the lights said "couldn't reach".** Newer WiZ bulbs have a security
  setting in the WiZ app (Settings → Security): on "Only verified controls"
  they answer the calendar but turn down every change. Baja and the Lights
  panel now say exactly that, and how to fix it, instead of blaming the
  wall switch.
- Two ways to fix it: choose **Allow all controls** in the WiZ app, or keep
  the stricter setting and paste the home's WiZ key (WiZ app → Home
  settings → Integrations → Local integrations → `udp_signing_key`) into
  the box at the bottom of the Lights panel. With the key, every change is
  signed and goes through either way.

## 2026-10-14 — The lights, and "Baja, set the TV mood"

- **The WiZ lights are on the wall now.** Menu → Lights shows every WiZ
  bulb in the house with a switch, brightness and warmth for each, and
  moods along the top: TV (all off), Bright, Dinner and Night to start
  with. Tap a light's name to rename it ("Couch lamp").
- **Your own moods.** Set the lights how you want them — in the panel or the
  WiZ app — type a name like "TV" and press Save. Saving under a name that
  already exists replaces it, which is how to change what TV does.
- **Baja does it by voice.** "Baja, set the TV mood", "Baja, turn off the
  lights", "turn on the couch lamp", "dim the lights to 30 percent", "make
  the lights warm", "turn the lights blue".
- The Pi talks to the bulbs directly over the Wi-Fi: no account, and it
  works with the internet down. Two things it needs: the wall switch for
  the bulbs left on (a bulb with no power can't hear anyone), and "Allow
  local communication" switched on in the WiZ app.

## 2026-10-14 — Baja can answer anything, for free, with Groq

- **A free way for Baja to answer questions.** Timers, the grocery list,
  what's next and the weather never needed anything, but other questions
  ("how long do I boil an egg?") needed a paid Anthropic key or a model
  installed on the Pi. Now there's a third choice: a free key from Groq
  (console.groq.com — no card). Paste it in Settings → Baja, or more easily
  from a phone, in the phone app under Baja. If both keys are set, the
  Anthropic one is used.
- If a key is set but turned down (mistyped, or deleted on the website),
  Baja now says so, instead of asking for a key that's already there.
- Fixed: with a good Groq key Baja still said it had no key. Groq had
  retired the models Baja asked for. It now asks Groq which ones the key
  can use and picks the best, so the next retirement won't break it.

## 2026-10-06 — Share prices along the bottom again

- **"Trending" shows prices again.** Yahoo, where the prices come from,
  started turning the calendar away as "too many requests" because of how
  it introduced itself, and the backup source had shut down, so the ticker
  said "Market data unavailable" even with a working connection. Both are
  fixed: the main source answers again, and if it ever refuses, a second
  way of asking fetches every price in one go.
- If weather, headlines and prices all say unavailable at once, the Pi
  itself isn't reaching the internet — no update can fix that from here,
  because updates need the internet too.

## 2026-10-05 — Baja listens for real, a Thirukkural a day, and a YouTube button

- **Baja actually works now.** It used to listen through the browser's own
  speech recognition, which on the Pi does nothing at all — Chromium sends
  the sound to Google, and only Google's own Chrome has the key for that —
  so Baja was a label on the screen, microphone or not. Now the Pi listens
  itself, with speech software that runs on the Pi: nothing recorded,
  nothing sent anywhere. Say "Baja, what's next?", or "Baja", a pause, and
  your question — or tap the new microphone button in the corner and just
  ask. It answers out loud in a natural voice. The first time it's switched
  on (Settings → Baja) it downloads about 100MB and sets itself up, which
  takes a few minutes; Settings → Baja shows how far along it is, and the
  last thing it heard, so you can tell whether the microphone is working.
- **A Thirukkural every day.** Beside the date, small: today's kural in
  Tamil, transliterated, and what it means in English. One a day, in order,
  starting from Kural 1 today. It's on the Good Morning page too, larger,
  and "Baja, what's today's kural?" reads the meaning aloud. Settings →
  Display turns it off.
- **A YouTube button.** Bottom right, next to the menu: one tap opens
  YouTube in the full browser window.
- **Baja no longer sits on top of the menu button.** The corner is now three
  separate buttons side by side: Baja's microphone, YouTube, and the menu.
- **Browser works straight after an update.** The full browser window is
  opened by a small helper on the Pi's desktop that only started when the
  Pi did, so after the update that added it nothing was listening until the
  Pi next restarted — and Browser fell back to the in-page one that YouTube
  and most big sites refuse to load in. Updates now start the helper
  themselves, and it keeps itself up to date. If it still isn't running,
  tapping Browser says so instead of failing quietly. (This part arrives
  with the Pi's next package update, within about ten minutes.)

## 2026-09-30 — A keyboard on the screen, a browser that works, and a smoother reel

- **An on-screen keyboard for every text box.** Tap any box on the wall —
  a timer's name, an event, a setting, a recipe search, a web address — and
  a keyboard comes up along the bottom, with capitals, numbers and
  punctuation. Tap elsewhere or press Hide and it goes away. It comes up by
  itself on a touch screen and stays out of the way when a real keyboard is
  plugged in. Settings → Recipes → "On-screen keyboard, always" shows it
  even with a mouse.
- **The browser opens every site now.** It used to say "refused to connect"
  for most big sites — Google, Allrecipes, YouTube — because they won't be
  shown inside another page. On the Pi, Browser now opens a real Chromium
  window over the calendar, with tabs, an address bar and a back button;
  close it and you're back on the calendar. The Pi's own on-screen keyboard
  is allowed in it. (This part arrives with the Pi's next package update,
  within about ten minutes of this one.)
- **Ambient mode doesn't glitch.** The slideshow's moving background,
  heavy blur and see-through boxes were more than the Pi's graphics could
  redraw smoothly, and the brightness setting made the whole screen redraw
  with every frame. They're lighter now and look the same.
- Behind the scenes: when an update fails GitHub's checks and can't be
  sent to the kitchen, the reason is now shown on GitHub's public page, so
  it can be fixed straight away instead of guessed at. And one check that
  could fail by chance on a busy GitHub machine — holding an update back
  for no real reason — now waits properly instead.

## 2026-09-28 — Updates in about a minute

- **The screen checks for updates every ten seconds** instead of every
  forty-five, so a change reaches the wall about a minute after it's sent:
  roughly forty seconds for GitHub to build and test it, then a few seconds
  to arrive. Checks that find nothing new cost nothing, however often.
- Fixed: the previous update (the Good Morning page and the rest below)
  never reached the kitchen. Two of its new checks only failed on GitHub's
  Linux machines, not on the Mac, so GitHub refused to publish it. Both are
  fixed, the checks now also run on Linux before anything is sent, and it
  all goes out with this one.

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
