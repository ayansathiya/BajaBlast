#!/bin/bash
#
# Baja Blast on a Raspberry Pi — the whole install, in one line.
#
# In the Pi's Terminal (copy it from the top of the README on GitHub):
#
#   curl -fsSL https://raw.githubusercontent.com/ayansathiya/BajaBlast/main/setup/pi.sh | bash
#
# Downloads the newest package GitHub built, installs it, and restarts the Pi
# into the calendar full screen. Run it once: after that the Pi installs new
# versions by itself (baja-blast-upgrade.timer). Safe to run again.
#
set -euo pipefail

REPO="${BAJA_BLAST_REPO:-ayansathiya/BajaBlast}"
URL="https://github.com/$REPO/releases/latest/download/baja-blast_latest_all.deb"

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK"   # apt's sandbox user has to be able to read the file

echo "▸ Downloading the newest Baja Blast…"
curl -fL --retry 3 -o "$WORK/baja-blast.deb" "$URL"

echo "▸ Installing (your calendar, photos and chores are kept)…"
$SUDO apt-get install -y "$WORK/baja-blast.deb"

echo ""
echo "▸ Done. Restarting in 10 seconds to open the calendar full screen."
echo "  (Press Ctrl+C to restart later instead.)"
sleep 10
$SUDO reboot
