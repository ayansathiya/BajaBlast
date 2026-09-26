# Baja Blast standalone: start the calendar full-screen on the box's own
# display. Sourced by login shells; only acts for the kiosk user, only on the
# first console (where autologin puts them), and only when nothing graphical
# is running yet. An SSH login, or any other console, is left completely
# alone — that's how you get a normal shell on the box when you need one.
#
# -noreset: X throws away its settings whenever its last client disconnects.
# The kiosk sets "never blank" with a few quick xset calls before Chromium
# has connected, so without this those settings vanish the moment the last
# xset exits and the screen goes dark after ten idle minutes.
if [ -r /etc/baja-blast/kiosk-user ] \
   && [ "$(id -un)" = "$(cat /etc/baja-blast/kiosk-user)" ] \
   && [ "$(tty)" = "/dev/tty1" ] \
   && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] \
   && [ ! -e /etc/baja-blast/kiosk-disabled ]; then
  exec startx /usr/lib/baja-blast/kiosk-session -- -noreset >"${HOME}/.baja-blast-kiosk.log" 2>&1
fi
