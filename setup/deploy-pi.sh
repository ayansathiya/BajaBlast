#!/bin/bash
#
# Send this checkout straight to the kitchen Pi, in seconds.
#
#   npm run deploy
#
# GitHub still gets every change (push as usual) and the Pi still updates
# itself from there — that path takes two or three minutes, because GitHub
# builds and tests everything first. This one goes over the home network
# instead: build here, copy the payload across, restart, and the wall reloads
# itself onto the new version.
#
# Only the app's code travels this way. Anything in the package itself (the
# kiosk launcher, the timers) still arrives through the package upgrader.
#
# Link the Pi first, once:  bash setup/pi-link.sh
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BOLD=$'\033[1m'; TEAL=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'
say() { printf "%s\n" "${TEAL}▸${OFF} $*"; }
die() { printf "%s\n" "${RED}!${OFF} $*" >&2; exit 1; }

HOST="${BAJA_PI:-$(cat setup/pi-host.local 2>/dev/null || true)}"
[ -n "$HOST" ] || die "No Pi linked yet. Run once: bash setup/pi-link.sh"
ADDR="${HOST#*@}"

T0=$(date +%s)

# The revision has to be above what GitHub has released, or the Pi would
# prefer its own copy; one above is enough, and when GitHub publishes that
# same commit as the next release the Pi sees nothing newer and stays put.
REPO="$(node -p "const u = require('./build.json').updates || {}; (u.owner || '') + '/' + (u.repo || '')")"
LATEST="$(curl -fsSI --max-time 5 "https://github.com/$REPO/releases/latest" 2>/dev/null | tr -d '\r' | sed -n 's|^[Ll]ocation: .*/releases/tag/v\([0-9][0-9]*\)$|\1|p' | tail -n 1)"
REV=$(( ${LATEST:-0} + 1 ))
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
git diff --quiet HEAD 2>/dev/null || SHA="$SHA+$(date +%H%M%S)"
STAMP="$(date +%Y-%m-%d)-mac-$SHA"

say "Building $STAMP (rev $REV)…"
cp build.json build.json.deploy-bak
trap 'mv -f build.json.deploy-bak build.json' EXIT
node -e "
  const fs = require('fs');
  const b = JSON.parse(fs.readFileSync('build.json', 'utf8'));
  b.build = '$STAMP'; b.rev = $REV;
  fs.writeFileSync('build.json', JSON.stringify(b, null, 2) + '\n');
"
npm run build >/dev/null

say "Sending it to $HOST…"
# One connection for both steps, so the second doesn't pay for a new login.
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=5 -o ControlMaster=auto -o "ControlPath=$HOME/.ssh/bb-%C" -o ControlPersist=60 "$HOST")
# The folder name is the stamp, not vN: the updater tidies vN folders on its
# own terms, and this one mustn't be mistaken for a GitHub release.
tar -czf - build.json CHANGELOG.md dist app | "${SSH[@]}" 'cat > /tmp/baja-blast-deploy.tgz'
"${SSH[@]}" "sh -s -- 'mac-$STAMP' /tmp/baja-blast-deploy.tgz" < setup/pi-receive.sh

say "Restarting…"
for _ in $(seq 1 40); do
  got="$(curl -fsS --max-time 1 "http://$ADDR:8787/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).build)}catch{}})' || true)"
  if [ "$got" = "$STAMP" ]; then
    say "${BOLD}On the wall${OFF} in $(( $(date +%s) - T0 ))s — the screen reloads itself onto it."
    exit 0
  fi
  sleep 0.5
done
die "Sent, but the Pi hasn't come back on the new build yet. Check it with:  ssh $HOST journalctl -u baja-blast -n 30"
