#!/bin/bash
#
# Build the installable package for a Raspberry Pi.
#
#   npm run pi
#
# Produces  dist-pi/baja-blast_<version>_all.deb
#
# On the Pi that's one file and one install; after that the calendar starts on
# boot, restarts itself if it dies, and updates itself from GitHub. No Node to
# install first, no npm, no terminal ever again.
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BOLD=$'\033[1m'; DIM=$'\033[2m'; TEAL=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf "%s\n" "${TEAL}▸${OFF} $*"; }
note() { printf "%s\n" "${DIM}  $*${OFF}"; }
warn() { printf "%s\n" "${RED}!${OFF} $*"; }

BUILD="$(node -p "require('./build.json').build")"
REV="$(node -p "require('./build.json').rev")"
# Debian versions must start with a digit and sort sensibly. The build stamp is
# already a date, and the revision breaks ties within a day.
VERSION="${BUILD//[^0-9.-]/}"
VERSION="${VERSION#-}"
[ -n "$VERSION" ] || VERSION="0.0.0"
VERSION="${VERSION}+${REV}"

STAGE="$PROJECT_DIR/dist-pi/stage"
OUT="$PROJECT_DIR/dist-pi/baja-blast_${VERSION}_all.deb"

printf "\n%s\n\n" "${BOLD}Baja Blast — building the Pi package${OFF}"
say "Version $VERSION (build $BUILD, rev $REV)"

# ---------------------------------------------------------------------------
# 1. The display has to be built first, or the package ships without a UI
# ---------------------------------------------------------------------------
if [ ! -f "dist/index.html" ] || [ "${SKIP_BUILD:-}" != "1" ]; then
  say "Building the display…"
  npm run build >/dev/null
fi

if [ ! -f "dist/index.html" ]; then
  warn "dist/index.html is missing — the build didn't produce anything."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Lay out the filesystem the package will install
# ---------------------------------------------------------------------------
say "Staging…"
rm -rf "$STAGE"
mkdir -p "$STAGE/opt/baja-blast" "$STAGE/lib/systemd/system" "$STAGE/DEBIAN" "$STAGE/usr/bin"

cp -r app "$STAGE/opt/baja-blast/"
cp -r dist "$STAGE/opt/baja-blast/"
cp build.json "$STAGE/opt/baja-blast/"

# Nothing in the payload needs third-party modules — everything the server
# does is Node built-ins, and the front end is already bundled into dist/.
# That is what keeps this package under a megabyte.
if [ -d "$STAGE/opt/baja-blast/app/node_modules" ]; then
  warn "node_modules found in the payload — that shouldn't happen"
  rm -rf "$STAGE/opt/baja-blast/app/node_modules"
fi

INSTALLED_KB="$(du -sk "$STAGE" | cut -f1)"

# ---------------------------------------------------------------------------
# 3. The launcher on PATH, for anyone who wants to run it by hand
# ---------------------------------------------------------------------------
cat > "$STAGE/usr/bin/baja-blast" <<'SH'
#!/bin/sh
# Baja Blast. Normally started by systemd; this is here so you can run it in a
# terminal and watch what it says.
exec /usr/bin/node /opt/baja-blast/app/launch.cjs "$@"
SH
chmod 755 "$STAGE/usr/bin/baja-blast"

# ---------------------------------------------------------------------------
# 4. The service
# ---------------------------------------------------------------------------
# Runs as the desktop user rather than root, for two reasons. Blanking the
# screen means talking to that user's compositor, which root can't see; and a
# calendar has no business running with root's privileges. postinst fills in
# the user and their runtime directory.
cat > "$STAGE/lib/systemd/system/baja-blast.service" <<'UNIT'
[Unit]
Description=Baja Blast kitchen calendar
Documentation=https://github.com/
# The display has no keyboard, so the first thing it does on a cold boot is
# fetch weather and news. Waiting for the network avoids a screen full of
# dashes for the first thirty seconds after a power cut.
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/baja-blast/app/launch.cjs
Restart=always
# Back off if it's crash-looping rather than hammering a struggling SD card.
RestartSec=5
StartLimitBurst=0

User=__USER__
Group=__GROUP__

Environment=NODE_ENV=production
Environment=BAJA_BLAST_DATA=/var/lib/baja-blast
# So the app can reach the compositor to sleep the screen at night. Harmless
# when they're wrong — the blanking simply reports that it couldn't.
Environment=XDG_RUNTIME_DIR=/run/user/__UID__
Environment=WAYLAND_DISPLAY=wayland-1
Environment=DISPLAY=:0

# The household's data is the only thing it needs to write.
ReadWritePaths=/var/lib/baja-blast
StateDirectory=baja-blast

# Modest hardening. Not a fortress — it's a calendar on a home network — but
# there's no reason for it to be able to write to /usr or see other users.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only

StandardOutput=journal
StandardError=journal
SyslogIdentifier=baja-blast

[Install]
WantedBy=multi-user.target
UNIT

# ---------------------------------------------------------------------------
# 5. Package metadata
# ---------------------------------------------------------------------------
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: baja-blast
Version: $VERSION
Section: utils
Priority: optional
Architecture: all
Depends: nodejs (>= 18)
Recommends: chromium | chromium-browser, wlopm | x11-xserver-utils
Maintainer: Baja Blast <noreply@example.com>
Installed-Size: $INSTALLED_KB
Description: Ambient kitchen calendar
 A calendar, grocery list, chore board and photo frame for a screen on a
 kitchen wall, with a phone app for everyone in the house.
 .
 Starts on boot, restarts itself if it stops, and updates itself from GitHub.
 The household's data lives in /var/lib/baja-blast and is never touched by
 installing, upgrading or removing this package.
CONTROL

# Debian will otherwise prompt about the unit file on upgrade.
cat > "$STAGE/DEBIAN/conffiles" <<'CONF'
CONF

# ---------------------------------------------------------------------------
# 6. Install-time scripts
# ---------------------------------------------------------------------------
cat > "$STAGE/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e

case "$1" in
  configure)
    # Which user owns the screen? On a Pi that's whoever was created during
    # setup — usually uid 1000, rarely still called "pi". Look it up rather
    # than assume, because guessing wrong means the service can't blank the
    # display and nobody can tell why.
    DESKTOP_USER="$(getent passwd 1000 | cut -d: -f1 || true)"
    if [ -z "$DESKTOP_USER" ]; then
      DESKTOP_USER="root"
      echo "baja-blast: no user with uid 1000; running as root." >&2
      echo "baja-blast: the overnight screen schedule may not work." >&2
    fi
    DESKTOP_GROUP="$(id -gn "$DESKTOP_USER" 2>/dev/null || echo "$DESKTOP_USER")"
    DESKTOP_UID="$(id -u "$DESKTOP_USER")"

    UNIT=/lib/systemd/system/baja-blast.service
    sed -i "s|__USER__|$DESKTOP_USER|; s|__GROUP__|$DESKTOP_GROUP|; s|__UID__|$DESKTOP_UID|" "$UNIT"

    # The household's data, kept deliberately outside the package. apt remove
    # must never be able to delete somebody's calendar.
    mkdir -p /var/lib/baja-blast
    chown -R "$DESKTOP_USER:$DESKTOP_GROUP" /var/lib/baja-blast
    chmod 750 /var/lib/baja-blast

    if [ -d /run/systemd/system ]; then
      systemctl daemon-reload || true
      systemctl enable baja-blast.service || true
      systemctl restart baja-blast.service || true
    fi

    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo ""
    echo "  Baja Blast is running."
    echo ""
    echo "  On this screen:  http://localhost:8787/"
    [ -n "$IP" ] && echo "  On your phone:   http://$IP:8787/mobile"
    echo ""
    echo "  It starts on boot and updates itself. Nothing else to do."
    echo ""
    ;;
esac

exit 0
POSTINST

cat > "$STAGE/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
case "$1" in
  remove|deconfigure)
    if [ -d /run/systemd/system ]; then
      systemctl stop baja-blast.service || true
      systemctl disable baja-blast.service || true
    fi
    ;;
esac
exit 0
PRERM

cat > "$STAGE/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
case "$1" in
  remove|purge)
    [ -d /run/systemd/system ] && systemctl daemon-reload || true
    # /var/lib/baja-blast is left alone on purpose, including on purge. It
    # holds the family's calendar and photos, and a package manager should
    # never be the thing that deletes those. Removing it is a deliberate act:
    #   sudo rm -rf /var/lib/baja-blast
    if [ "$1" = "purge" ] && [ -d /var/lib/baja-blast ]; then
      echo "baja-blast: your calendar and photos are still in /var/lib/baja-blast."
    fi
    ;;
esac
exit 0
POSTRM

chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/DEBIAN/postrm"

# ---------------------------------------------------------------------------
# 7. Build it
# ---------------------------------------------------------------------------
say "Packaging…"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# Everything owned by root; the postinst hands the data directory to the
# desktop user at install time, where it can actually look the user up.
if command -v fakeroot >/dev/null 2>&1; then
  fakeroot dpkg-deb --build --root-owner-group "$STAGE" "$OUT" >/dev/null
else
  dpkg-deb --build --root-owner-group "$STAGE" "$OUT" >/dev/null
fi

printf "\n"
say "Built ${BOLD}$(basename "$OUT")${OFF} ($(du -h "$OUT" | cut -f1))"
printf "\n"
note "Copy it to the Pi and install with:"
note "    sudo apt install ./$(basename "$OUT")"
printf "\n"
note "That's the whole setup. It starts now and on every boot after."
printf "\n"
