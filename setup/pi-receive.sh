#!/bin/sh
#
# The Pi's half of `npm run deploy`. Not run by hand: setup/deploy-pi.sh sends
# this over SSH along with the payload.
#
#   sh pi-receive.sh <folder name> <payload.tgz>
#
# Unpacks next to the other builds, checks it's complete, points active.json
# at it (the same file the GitHub updater writes, so the launcher's rollback
# still applies), and restarts the calendar into it.
#
set -eu

DEST="$1"
TARBALL="$2"
U="${BAJA_BLAST_UPDATES:-/var/lib/baja-blast/app}"

case "$DEST" in mac-*) ;; *) echo "pi-receive: unexpected folder name '$DEST'" >&2; exit 1 ;; esac

mkdir -p "$U"
S="$U/.deploy"
rm -rf "$S"
mkdir -p "$S"
tar -xzf "$TARBALL" -C "$S"
rm -f "$TARBALL"
for f in build.json dist/index.html app/server.cjs; do
  [ -f "$S/$f" ] || { echo "pi-receive: the payload is missing $f; nothing changed" >&2; rm -rf "$S"; exit 1; }
done

rm -rf "${U:?}/$DEST"
mv "$S" "$U/$DEST"

PREV="$(node -e '
  try { console.log(require(process.argv[1] + "/active.json").dir || ""); } catch { console.log(""); }
' "$U")"

node -e '
  const fs = require("fs");
  const [U, dest, prev] = process.argv.slice(1);
  const b = JSON.parse(fs.readFileSync(`${U}/${dest}/build.json`, "utf8"));
  let a = {};
  try { a = JSON.parse(fs.readFileSync(`${U}/active.json`, "utf8")); } catch {}
  const next = { ...a, dir: dest, build: b.build, rev: b.rev, previous: prev && prev !== dest ? prev : null, installedAt: new Date().toISOString(), from: "mac" };
  fs.writeFileSync(`${U}/active.json.tmp`, JSON.stringify(next, null, 2));
  fs.renameSync(`${U}/active.json.tmp`, `${U}/active.json`);
' "$U" "$DEST" "$PREV"

# Keep this build and the one before it.
for d in "$U"/mac-*; do
  [ -d "$d" ] || continue
  n="$(basename "$d")"
  [ "$n" = "$DEST" ] || [ "$n" = "$PREV" ] || rm -rf "$d"
done

# systemd (Restart=always) starts it straight back up, into the new build.
pkill -f "baja-blast/app/launch.cjs" || true
