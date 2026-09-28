#!/bin/bash
#
# Link this Mac to the kitchen Pi, once, so updates can go straight there.
#
#   bash setup/pi-link.sh                     # finds raspberrypi.local
#   bash setup/pi-link.sh ayan@192.168.1.40   # or say where it is
#
# Needs SSH switched on on the Pi (Raspberry menu → Preferences → Raspberry
# Pi Configuration → Interfaces → SSH). Asks for the Pi's password once; after
# that `npm run deploy` sends a change to the wall in a few seconds, with no
# password and no GitHub build to wait for.
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_FILE="$PROJECT_DIR/setup/pi-host.local"

BOLD=$'\033[1m'; TEAL=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'
say() { printf "%s\n" "${TEAL}▸${OFF} $*"; }
die() { printf "%s\n" "${RED}!${OFF} $*" >&2; exit 1; }

printf "\n%s\n\n" "${BOLD}Baja Blast — linking this Mac to the Pi${OFF}"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  read -r -p "Your username on the Pi (the one you log in with): " PI_USER
  read -r -p "The Pi's address [raspberrypi.local]: " PI_ADDR
  TARGET="${PI_USER}@${PI_ADDR:-raspberrypi.local}"
fi
case "$TARGET" in *@*) ;; *) die "Give it as username@address, e.g. ayan@raspberrypi.local" ;; esac

KEY="$HOME/.ssh/id_ed25519"
if [ ! -f "$KEY" ]; then
  say "Making this Mac a key to log in with (no passphrase, stays on this Mac)…"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -N "" -f "$KEY" -C "baja-blast deploy from $(hostname -s)" >/dev/null
fi

say "Giving the Pi this Mac's key. Type the Pi's password when asked (it won't show as you type)."
ssh-copy-id -i "$KEY.pub" -o StrictHostKeyChecking=accept-new "$TARGET" \
  || die "Couldn't reach $TARGET. Is SSH switched on on the Pi, and is the address right? The Pi's screen shows its address under 'On your phone'."

say "Checking it works without a password…"
ssh -o BatchMode=yes "$TARGET" 'test -d /var/lib/baja-blast && test -w /var/lib/baja-blast' \
  || die "Logged in, but this user can't write to /var/lib/baja-blast. Use the Pi's main user (the one the desktop logs in as)."

echo "$TARGET" > "$HOST_FILE"
say "Linked to ${BOLD}$TARGET${OFF}. From now on:  npm run deploy"
