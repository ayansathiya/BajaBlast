# Baja Blast

A calendar, grocery list, chore board and photo frame for a touchscreen on a
kitchen wall, with a phone app for everyone in the house. Runs on a Raspberry
Pi. Installs as one file, starts on boot, and updates itself.

## Getting it onto the Pi

Build the package (on any machine with Node):

```bash
npm install
npm run pi
```

That produces `dist-pi/baja-blast_<version>_all.deb` — about 230KB. Copy it to
the Pi and install it:

```bash
sudo apt install ./baja-blast_<version>_all.deb
```

That's the whole setup. It prints the address for your phone and starts
serving immediately, and on every boot after. There is nothing else to run,
nothing to configure in a terminal, and no second step.

- The wall display is at `http://localhost:8787/` — point your kiosk browser at it
- Phones are at `http://<pi>:8787/mobile`
- Data lives in `/var/lib/baja-blast`, outside the package, so `apt remove`
  can't touch the family's calendar

Requires Raspberry Pi OS Bookworm or newer (for Node 18+). `apt` pulls Node in
automatically.

### Kiosk mode

Deliberately not handled here — you said you had it. The app is just a web
server; point whatever you use at `http://localhost:8787/`.

## On an Armbian TV box (A95X, S905X, 1GB)

A TV box is a cheaper, smaller Pi with an HDMI port and a case, and with
Armbian on it the calendar runs the same way. This one is set up
**standalone**: the box draws the calendar on its own screen, with no desktop
and no other computer involved, and it starts in **low power mode**.

### 1. Put Armbian on a microSD card

Armbian proper stopped supporting TV boxes; the community builds at
[ophub/amlogic-s9xxx-armbian](https://github.com/ophub/amlogic-s9xxx-armbian/releases)
are the ones that are maintained. From the newest **bookworm** release,
download the file named like

    Armbian_<version>_amlogic_s905x-t95_bookworm_6.12.<n>_server_<date>.img.gz

Pick **bookworm** (or trixie), not noble: Ubuntu's Chromium is a snap, too heavy
for 1GB. Pick the **6.12** kernel, the long-term one. The `s905x-t95` image
uses the same bootloader as the A95X.

Write it to a microSD card with [balenaEtcher](https://etcher.balena.io/). Then,
before ejecting, open the card's `BOOT` partition on the computer and edit
`uEnv.txt`. Change the `FDT=` line to the A95X's own device tree:

    FDT=/dtb/amlogic/meson-gxl-s905x-nexbox-a95x.dtb

(If the box doesn't come up with that one, `meson-gxl-s905x-p212.dtb` is the
generic S905X tree and works on most of them.)

### 2. Boot it from the card

Power off, put the card in, then push a toothpick into the AV socket until
you feel the reset button click. Hold it, plug the power in, and let go
when the Armbian logo appears. This is only needed the first time. After
that, the box boots from the card whenever the card is in.

Log in as `root` with password `1234`. Armbian makes you change it straight
away. Plug in a network cable, or run `armbian-config` to join Wi-Fi.

### 3. One line

```bash
curl -fsSL https://raw.githubusercontent.com/ayansathiya/BajaBlast/main/setup/armbian.sh | bash
```

The script downloads the two packages from the newest GitHub release,
installs them (apt brings in Node, X and Chromium), sets the time zone if the
box is still on UTC, and reboots. The box comes up showing the calendar, and
from then on it updates itself like the Pi does.

Once you're happy with it, `armbian-install` copies the system from the card
to the box's own storage so the card can come out. On a few S905X boxes that
step doesn't work, and they stay on the card permanently, which is fine.

### What the standalone package does

`baja-blast-standalone` is a second, 8KB package on top of the usual one.

- **Logs in on the box's first console with no password** and starts Chromium
  full screen, with no window manager or desktop underneath. If Chromium
  crashes or runs out of memory, it's back in three seconds. SSH and the other
  consoles still ask for a password, so you can always get a normal shell. To
  switch the kiosk off without removing anything, run
  `sudo touch /etc/baja-blast/kiosk-disabled`.
- **Low power mode on from the first start.** That means no animation, no idle
  reel and no rotating photo frame. On a 1GB box drawing in software, those
  are most of the work the processor does. The profile is applied exactly
  once (`/etc/baja-blast/profile.json`, read by `app/profile.cjs`), so if
  somebody turns low power mode off in Settings, it stays off.
- **Turns the TV off overnight.** Blanking the HDMI signal is enough for a
  monitor, but most TVs just sit there lit up saying "No signal". So the box
  also sends the TV to standby over HDMI-CEC at 23:00, and turns it back on
  and switches to its input at 06:00. It's a normal setting
  (Settings → Display → Turn the TV off too), and it's off on every other
  install, because a shared TV shouldn't be switched off by a calendar.
- **Chromium is tuned for 1GB.** It runs one renderer, with GPU drawing off and
  a small cache. The Mali-450's open-source driver is the likeliest thing to
  hang, and a mostly static calendar is cheap to draw in software. If
  you want to try the GPU, put `BAJA_BLAST_GPU=1` in the kiosk user's
  `~/.profile`.
- If the box has no swap at all, it turns on compressed swap in memory
  (zram). Armbian normally has this already.

Removing it (`apt remove baja-blast-standalone`) removes the autologin and
leaves the calendar running as a server.

## Everything is live

Add an event on your phone and the wall screen has it in about 60ms. No
reload, no polling delay, no lag.

This replaced eleven separate polling timers. Those had three problems: a
change made on a phone took up to twenty seconds to appear, every client
re-fetched the whole calendar on a loop whether or not anything had moved, and
the remote had to be checked every 1.2 seconds purely so pressing an arrow felt
like it did something.

Now there's one connection, held open, that the server writes down when
something changes (`/api/stream`). Server-sent events rather than a websocket
because this traffic only goes one way and the browser reconnects by itself —
which, on a display that has to survive the router rebooting at 3am with nobody
awake, matters more than any other difference between the two.

Bursts are coalesced: saving one event touches the store two or three times in
a few milliseconds, and three "something changed" messages would mean three
rounds of every client re-reading the calendar. Remote-control presses are
deliberately *not* coalesced — those are somebody's finger on an arrow, and
merging two presses into one is the exact bug that made the old remote feel
broken.

The polling timers are still there as a fallback, at minutes rather than
seconds, so if the stream can't be held the display goes stale rather than
frozen.

## Update log

Every change is written down in **[CHANGELOG.md](CHANGELOG.md)**, newest
first, and the app reads that same file — Settings → What's new shows the list
on the wall, with the build currently running marked.

One file, three places it appears, no chance of them disagreeing. It ships
inside the `.deb` and inside every over-the-air payload, so a box that updated
itself at 3am can explain what changed.

## Recipes and Bake Night

The chef button in the bottom corner opens a photo grid: Baking, Mocktails,
Cocktails, and every food category TheMealDB publishes — chicken, vegetarian,
pasta and the rest. Tap a photo for the full recipe, ingredients on the left
and numbered steps on the right, both sized to be read from arm's length with
flour on your hands. "Add to grocery list" puts the whole ingredient list on
the shared list, so it's on everyone's phone before anybody leaves the house.

Cocktails have their own switch in Settings → Recipes, for a kiosk at child
height. Turning it off hides the tab *and* refuses the route, so a phone with
the page already open isn't a way around it.

**Bake Night** is one day a week — Saturday unless you change it — that the
family makes something together. Pick a recipe and it lands on that week's
bake day: on the calendar in every view, in the rail with its photo, and on
the phone with its ingredients for whoever is at the shop. An empty week shows
as "pick a recipe", which is the nudge; past empty weeks show nothing, because
nobody needs a month of missed Saturdays staring back at them.

Picks are stored by date rather than as "this week's recipe", which is what
makes the week roll over with no timer, no cron and nothing to reset — and
what lets you choose the next three Saturdays on a Sunday afternoon. Each pick
keeps its own copy of the ingredients and steps, so bake day works with the
recipe site down or the internet off.

Change the day in Settings and every week moves at once, past picks included.

## A browser, inside the app

"Browse the web" opens a browser with a back button that always returns to the
calendar, an on-screen keyboard (the wall has no other one), and a button that
pins whatever page you're looking at as the week's bake — so a recipe from a
blog or a grandmother's site works the same as one from the built-in list.

On the Mac it's Electron's `<webview>`: a real browser tab, sandboxed, with no
access to the household's files. On the Pi it's an iframe, which can only show
sites that allow being embedded — many recipe sites do, most large sites don't.
When one refuses, the panel says so and shows a QR code to finish on a phone.
It would have been easy to strip the header with a proxy; that overrides a
site's explicit instruction not to be framed, which isn't ours to override.

## Electricity

The intuition here is backwards, so it's worth the arithmetic.

A Pi showing a calendar draws about 5W. Left running every hour of the year
that's roughly 44 kWh — about **$13** at New Hampshire's ~29c/kWh. A 24" panel
next to it draws 25–35W, which is **$60–75** for the same year.

So the screen is around 85% of the cost, and switching the *Pi* off overnight
saves about four dollars while costing you a machine that can't turn itself
back on — a halted Pi has no way to wake on a schedule without extra hardware,
which is why every "shut down at 11, boot at 6" guide ends with somebody
pressing a button in the morning.

So: **the Pi stays up, the screen sleeps.** Settings → Display, on by default,
23:00 to 06:00. Roughly $22 a year, and:

- your phone still works overnight, from anywhere
- updates still land at 4am
- touching the screen wakes it (the digitiser stays live when the panel is
  blanked, so a tap on a dark screen still arrives — it wakes the panel and
  deliberately does nothing else, since you couldn't see what you were aiming
  at)
- adding something from your phone at 11:30pm lights it up

Blanking is tried three ways, because Raspberry Pi OS changed compositors and
both are still in the wild: `wlopm` (Wayland), `xset dpms` (X11), then
`vcgencmd` as a last resort. A schedule that spans midnight works — 18:00 to
09:00 is handled, and getting that wrong would mean the screen is dark whenever
anyone is actually in the kitchen.

## Touch

The wall display has no keyboard and never will, so anything that was only
reachable by shortcut needed a target on screen. There's a settings button in
the bottom corner — quiet until you touch it, 56px so a thumb hits it.

On touch hardware every control is at least 44px, inputs are 16px so iOS
doesn't zoom the page into a state with no way back, and long-press selection
is off outside text fields.

## Updating

```bash
npm run github     # once, ever
```

After that, `git push` is the entire release process. GitHub builds it, and
within half an hour the Pi has downloaded the new code and restarted itself.

What's published is the *payload* — `dist/` and `app/`, a few hundred KB — not
the package. `/opt/baja-blast` is owned by apt and left alone; the code that
actually runs can be a newer copy in `/var/lib/baja-blast/app/`, replaceable
without root and without reinstalling anything.

### What happens to a bad release

This is the part that matters, because the failure mode is a kitchen display
that won't come up and nobody in the house who can read a log file.

- **A truncated or tampered download** is rejected on its SHA-256 before `tar`
  is allowed to look at it
- **A half-extracted folder** can't be picked up: staged, checked for
  `build.json`, `dist/index.html` and `app/server.cjs`, then renamed into place
  — one atomic syscall, so there's no moment where the directory is partly
  written
- **A payload that lies about its version** is refused
- **One that installs cleanly and then won't start** gets two attempts. On the
  third launch the launcher blocks that revision, restores the previous one and
  carries on. Nobody is told; it works the next morning
- **One that throws the moment it's loaded** doesn't wait for a restart — it
  falls back in the same launch
- **No network** is a no-op; it tries again in half an hour

`app/launch.cjs` is the one file an update can't replace, since apt owns it. It
is deliberately tiny: pick a payload, run it. `BAJA_BLAST_BOOT_CHECK=1` makes
it print what it would run and exit, which is the first thing to try on a Pi
that's misbehaving.

## The phone app

```bash
bash setup/remote-setup.sh
```

Installs Tailscale, turns on HTTPS, and prints an address. On each phone:
install Tailscale, sign in with the same account, open that address, add to
home screen. After that it's an icon like any other app and it works from
anywhere.

The HTTPS is not for secrecy — the tunnel is already encrypted. Phones refuse
to install a web page as an app unless it arrived over HTTPS. No certificate,
no home-screen icon, no offline support, no matter how correct the manifest is.
That one rule is why `http://192.168.1.x` can never become an app.

Away from home it opens instantly from cache and the last calendar, grocery
list and chore board stay readable, with a coral bar saying so. Changes are
**not** queued offline: two phones editing the same event with no connection is
a conflict-resolution problem, not a caching one, and silently "saving"
something that never arrives is worse than saying no.

## Tests

```bash
npm test                     # 240 checks
```

- **update** — a fake release server driving real tarballs through download,
  checksum rejection, version-lie rejection, atomic swap, pruning, two-strikes
  rollback, block-list, and recovery via a later good release
- **bootstrap** — the launcher itself, making every real decision
- **live** — that a change reaches another device in under a second, that
  bursts coalesce, that arrow presses don't, and the schedule's midnight wrap
- **recipes** — the twenty-numbered-column ingredient format, blank slots,
  missing measures and steps that arrive with their own numbering
- **profile** — that a TV box starts in low power mode exactly once and
  never again after someone turns it off, and the exact HDMI-CEC commands a
  TV receives at night and in the morning
- **bake** — the date maths through a daylight-saving change, that the week
  rolls over with nothing scheduling it, that the server's copy of the maths
  and the browser's agree across 2,800 dates, and the routes end to end

Run by CI before any release is published, on the principle that an
auto-updating app which ships a broken updater has no second chance.

Two more need a browser and are outside `npm test`:

```bash
npx playwright install chromium
node test/phone-app.test.mjs     # 35 checks: install, offline, caching
node test/recipes-ui.test.mjs    # 25 checks: the recipe screen at 1080p and
                                 # on a phone, with the recipe APIs stubbed
python3 test/qr_verify.py        # the QR encoder against a reference
```

## Layout

```
app/          the server, the launcher, the phone page — the payload
src/          the wall display (React + TypeScript)
packaging/    builds the .debs (standalone/ is the TV-box kiosk)
setup/        GitHub, Tailscale and Armbian setup, run once each
test/
```

`app/launch.cjs` starts everything. `app/server.cjs` is the single source of
truth — the wall display and every phone read and write through it.
