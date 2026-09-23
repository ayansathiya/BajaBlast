#!/bin/bash
#
# Baja Blast — reach the kitchen from anywhere.
#
# Puts this machine on a private network of your own devices, so your phone
# can open the calendar from work, from a hotel, from the car. Nothing is
# exposed to the public internet: there is no address for a stranger to find,
# because there is no public address at all.
#
#   cd ~/Downloads/baja-blast
#   bash setup/remote-setup.sh
#
# Free. Tailscale's Personal plan covers six people, which is more than most
# households have phones for.
#
set -u

BOLD=$'\033[1m'; DIM=$'\033[2m'; TEAL=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf "%s\n" "${TEAL}▸${OFF} $*"; }
warn() { printf "%s\n" "${RED}!${OFF} $*"; }
note() { printf "%s\n" "${DIM}  $*${OFF}"; }

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

printf "\n%s\n\n" "${BOLD}Baja Blast — access from anywhere${OFF}"

# ---------------------------------------------------------------------------
# Find the CLI. On macOS it's buried inside the app bundle and is not on PATH
# by default, which is the single most common reason this appears "not
# installed" when it plainly is.
# ---------------------------------------------------------------------------
TS=""
for candidate in \
  "$(command -v tailscale 2>/dev/null)" \
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale" \
  "/usr/local/bin/tailscale" \
  "/opt/homebrew/bin/tailscale" \
  "/usr/bin/tailscale"
do
  [ -n "$candidate" ] && [ -x "$candidate" ] && { TS="$candidate"; break; }
done

if [ -z "$TS" ]; then
  warn "Tailscale isn't installed yet."
  printf "\n"
  if [ "$(uname)" = "Darwin" ]; then
    note "On a Mac, install it from the App Store (search \"Tailscale\"), or:"
    note "    brew install --cask tailscale"
  else
    note "On a Raspberry Pi or other Linux:"
    note "    curl -fsSL https://tailscale.com/install.sh | sh"
  fi
  printf "\n"
  note "Then run this script again."
  exit 1
fi

say "Found Tailscale: $TS"
printf "\n"

# ---------------------------------------------------------------------------
# Sign in
# ---------------------------------------------------------------------------
if ! "$TS" status >/dev/null 2>&1; then
  say "Signing this machine in…"
  note "A browser window opens. Use the same account on every device you want"
  note "to reach the calendar from — your phone, and anyone else's in the house."
  printf "\n"
  "$TS" up || { warn "Sign-in didn't finish."; exit 1; }
  printf "\n"
fi

DNS_NAME="$("$TS" status --json 2>/dev/null | node -e "
  let s='';
  process.stdin.on('data', d => s += d);
  process.stdin.on('end', () => {
    try { console.log((JSON.parse(s).Self.DNSName || '').replace(/\.$/, '')); }
    catch { console.log(''); }
  });
" 2>/dev/null)"

if [ -z "$DNS_NAME" ]; then
  warn "Signed in, but couldn't read this machine's name."
  note "Check with: $TS status"
  exit 1
fi

say "This machine is ${BOLD}$DNS_NAME${OFF}"
printf "\n"

# ---------------------------------------------------------------------------
# HTTPS
# ---------------------------------------------------------------------------
# This is not belt-and-braces. A phone will only install a web page as a real
# app — icon, full screen, works offline — if it was served over HTTPS. Plain
# http://192.168.x.x can't ever become an app icon, no matter what else we do.
say "Turning on HTTPS…"
note "Not for secrecy — the tunnel is already encrypted. A phone refuses to"
note "install a page as an app unless it arrived over HTTPS, so this is what"
note "turns the phone page into something with an icon on your home screen."
printf "\n"

if "$TS" serve --bg --https=443 http://127.0.0.1:8787 >/dev/null 2>&1; then
  say "Done."
else
  warn "Couldn't set that up automatically."
  note "Usually this means HTTPS certificates aren't enabled for your account."
  note "Open https://login.tailscale.com/admin/dns, switch on HTTPS Certificates,"
  note "then run:"
  note "    $TS serve --bg --https=443 http://127.0.0.1:8787"
  printf "\n"
fi
printf "\n"

# ---------------------------------------------------------------------------
# Remember it, so the kiosk can show the right address
# ---------------------------------------------------------------------------
# Written to the data folder rather than the code folder: it describes this
# machine, not this version of the app, and it must survive every update.
DATA_DIR="${BAJA_BLAST_DATA:-/var/lib/baja-blast}"
[ -d "$DATA_DIR" ] || DATA_DIR="$HOME/.baja-blast-kiosk-data"
mkdir -p "$DATA_DIR"
printf '{\n  "dnsName": "%s",\n  "url": "https://%s",\n  "setUpAt": "%s"\n}\n' \
  "$DNS_NAME" "$DNS_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DATA_DIR/remote.json"
note "Remembered in $DATA_DIR/remote.json"
printf "\n"

# ---------------------------------------------------------------------------
# What to do on the phone
# ---------------------------------------------------------------------------
printf "%s\n" "${BOLD}On each phone, once:${OFF}"
printf "\n"
printf "  1. Install Tailscale from the App Store or Play Store\n"
printf "  2. Sign in with the same account\n"
printf "  3. Open  ${BOLD}https://%s${OFF}\n" "$DNS_NAME"
printf "  4. iPhone: Share → Add to Home Screen\n"
printf "     Android: menu → Install app\n"
printf "\n"
note "After that it's an icon like any other app, and it works from anywhere —"
note "no Wi-Fi at home required, nothing typed, no address to remember."
printf "\n"
note "The kiosk now shows this address, and a QR code for it, under ⌘, → System."
printf "\n"
