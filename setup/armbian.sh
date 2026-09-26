#!/bin/bash
#
# Baja Blast on an Armbian TV box — the whole install, in one line.
#
# On the box (over SSH, or with a keyboard plugged in), as root:
#
#   curl -fsSL https://raw.githubusercontent.com/ayansathiya/BajaBlast/main/setup/armbian.sh | bash
#
# It downloads the two packages GitHub built for the newest release, installs
# them, sets the clock's time zone if it's still on UTC, and reboots into the
# calendar. Nothing to build and no Node to install by hand — apt brings
# everything, and after this the box updates itself like any other.
#
# Written for an A95X (Amlogic S905X, 1GB) but nothing here is specific to
# it: any Debian-based Armbian box with a screen works the same way.
#
set -euo pipefail

REPO="${BAJA_BLAST_REPO:-ayansathiya/BajaBlast}"
BASE="https://github.com/$REPO/releases/latest/download"

BOLD=$'\033[1m'; DIM=$'\033[2m'; TEAL=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf "%s\n" "${TEAL}▸${OFF} $*"; }
note() { printf "%s\n" "${DIM}  $*${OFF}"; }
die()  { printf "%s\n" "${RED}!${OFF} $*" >&2; exit 1; }

printf "\n%s\n\n" "${BOLD}Baja Blast — setting up this box${OFF}"

[ "$(id -u)" -eq 0 ] || die "Run this as root (log in as root, or put sudo in front of bash)."

# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  debian) ;;
  ubuntu)
    # Ubuntu only ships Chromium as a snap, which on 1GB of memory is the
    # difference between a calendar and a swap storm. Not worth fighting.
    die "This is an Ubuntu image. Use a Debian one (the file name says bookworm or trixie) — Ubuntu's Chromium is a snap and won't fit comfortably in 1GB." ;;
  *) note "Not Debian (${PRETTY_NAME:-unknown}); carrying on, but this is untested." ;;
esac

MEM_MB=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
say "${PRETTY_NAME:-Linux} on $(uname -m), ${MEM_MB}MB of memory"

# ---------------------------------------------------------------------------
# The time zone. A calendar on UTC shows every event at the wrong hour, and a
# fresh Armbian image is on UTC until somebody says otherwise.
# ---------------------------------------------------------------------------
TZ_NOW="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)"
if [ -n "${BAJA_BLAST_TZ:-}" ]; then
  timedatectl set-timezone "$BAJA_BLAST_TZ" && say "Time zone set to $BAJA_BLAST_TZ"
elif [ "$TZ_NOW" = "UTC" ] || [ "$TZ_NOW" = "Etc/UTC" ]; then
  GUESS="$(curl -fsS --max-time 8 https://ipapi.co/timezone 2>/dev/null || true)"
  if [ -n "$GUESS" ] && [ -e "/usr/share/zoneinfo/$GUESS" ]; then
    timedatectl set-timezone "$GUESS" && say "Time zone set to $GUESS (from this network's location)"
    note "Wrong? Run again with BAJA_BLAST_TZ=America/New_York (or yours) in front."
  else
    note "Couldn't work out the time zone; still on UTC. Fix with: timedatectl set-timezone America/New_York"
  fi
else
  say "Time zone: $TZ_NOW"
fi

# ---------------------------------------------------------------------------
# The packages
# ---------------------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK"   # apt's sandbox user has to be able to read the files

say "Downloading the newest release…"
curl -fL --retry 3 -o "$WORK/baja-blast_all.deb" "$BASE/baja-blast_latest_all.deb" \
  || die "Couldn't download the package from $BASE. Is the box online, and has the repo published a release?"
curl -fL --retry 3 -o "$WORK/baja-blast-standalone_all.deb" "$BASE/baja-blast-standalone_latest_all.deb" \
  || die "Couldn't download the standalone package from $BASE."

say "Installing (this pulls in Node, X and Chromium — a few minutes on a TV box)…"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q \
  "$WORK/baja-blast_all.deb" "$WORK/baja-blast-standalone_all.deb"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
printf "\n"
say "${BOLD}Done.${OFF} Rebooting into the calendar in 10 seconds (Ctrl-C to stay here)."
[ -n "$IP" ] && note "Phones: http://$IP:8787/mobile"
note "Low power mode is on, and the TV goes to standby 23:00–06:00. Both are in Settings → Display."
printf "\n"
sleep 10
systemctl reboot
