#!/bin/bash
#
# Baja Blast — put the code on GitHub, once.
#
# After this, editing the app and pushing is the whole release process: GitHub
# builds the payload, publishes it, and every stick in the house picks it up
# within half an hour.
#
#   cd ~/Downloads/baja-blast
#   bash setup/github-setup.sh
#
set -u

BOLD=$'\033[1m'; DIM=$'\033[2m'; TEAL=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf "%s\n" "${TEAL}▸${OFF} $*"; }
warn() { printf "%s\n" "${RED}!${OFF} $*"; }
note() { printf "%s\n" "${DIM}  $*${OFF}"; }

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

printf "\n%s\n\n" "${BOLD}Baja Blast — GitHub setup${OFF}"

# ---------------------------------------------------------------------------
# 1. Tools
# ---------------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  warn "git isn't installed."
  note "Run: xcode-select --install"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  warn "The GitHub command-line tool isn't installed."
  note "Install it with:  brew install gh"
  note "If you don't have Homebrew: https://brew.sh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  say "You're not signed in to GitHub yet. Opening that now…"
  note "Pick: GitHub.com → HTTPS → yes, authenticate git → login with a web browser."
  gh auth login || { warn "Sign-in didn't finish."; exit 1; }
fi

GH_USER="$(gh api user --jq .login 2>/dev/null)"
if [ -z "$GH_USER" ]; then
  warn "Signed in, but couldn't read your GitHub username."
  exit 1
fi
say "Signed in as ${BOLD}$GH_USER${OFF}."
printf "\n"

# ---------------------------------------------------------------------------
# 2. Repo name
# ---------------------------------------------------------------------------
read -r -p "Repository name [baja-blast]: " REPO_NAME
REPO_NAME="${REPO_NAME:-baja-blast}"

case "$REPO_NAME" in
  *[!A-Za-z0-9._-]*) warn "GitHub repo names allow letters, numbers, dots, dashes and underscores only."; exit 1 ;;
esac

printf "\n"
note "This will be a PUBLIC repository — that's what lets the sticks download"
note "updates without storing a password on them."
printf "\n"
note "Only code goes up. Your calendar, photos, chore points, grocery list and"
note "Spotify sign-in live in baja-blast-data, which .gitignore keeps out of"
note "the repo. Nothing about your family is published."
printf "\n"
read -r -p "Create github.com/$GH_USER/$REPO_NAME as public? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { note "Nothing done."; exit 0; }
printf "\n"

# ---------------------------------------------------------------------------
# 3. Point the app at the repo
# ---------------------------------------------------------------------------
# The app has to know where to look for updates, and it has to know it from
# inside the .app bundle — so this goes in build.json, which ships with both
# the bundle and every payload.
say "Pointing the updater at $GH_USER/$REPO_NAME…"
node - "$GH_USER" "$REPO_NAME" <<'EOF'
const fs = require('fs');
const [owner, repo] = process.argv.slice(2);
const b = JSON.parse(fs.readFileSync('build.json', 'utf8'));
b.updates = { owner, repo };
fs.writeFileSync('build.json', JSON.stringify(b, null, 2) + '\n');
console.log(`  updates → ${owner}/${repo}`);
EOF
printf "\n"

# ---------------------------------------------------------------------------
# 4. Git
# ---------------------------------------------------------------------------
if [ ! -d .git ]; then
  say "Starting a git repository here…"
  git init -q
  git branch -M main
fi

if [ -z "$(git config user.email || true)" ]; then
  note "git doesn't know who you are yet."
  read -r -p "  Your name: " GIT_NAME
  read -r -p "  Your email: " GIT_EMAIL
  git config user.name "$GIT_NAME"
  git config user.email "$GIT_EMAIL"
fi

# A last look before anything is published. Cheap insurance against a stray
# data folder that predates .gitignore.
if git status --porcelain --ignored 2>/dev/null | grep -q "baja-blast-data"; then
  note "baja-blast-data is present and correctly ignored."
fi

git add -A
if git diff --cached --quiet 2>/dev/null; then
  note "Nothing new to commit."
else
  git commit -q -m "Baja Blast kitchen kiosk"
fi
printf "\n"

# ---------------------------------------------------------------------------
# 5. Create and push
# ---------------------------------------------------------------------------
if gh repo view "$GH_USER/$REPO_NAME" >/dev/null 2>&1; then
  say "That repository already exists — pushing to it."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git"
  git push -u origin main || { warn "Push failed."; exit 1; }
else
  say "Creating the repository and pushing…"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push \
    --description "Baja Blast — an ambient kitchen calendar" || { warn "Couldn't create the repository."; exit 1; }
fi
printf "\n"

# ---------------------------------------------------------------------------
# 6. Wait for the first release
# ---------------------------------------------------------------------------
say "GitHub is building the first release now."
note "It takes about a minute. Watching…"
printf "\n"

for _ in $(seq 1 40); do
  TAG="$(gh release view --repo "$GH_USER/$REPO_NAME" --json tagName --jq .tagName 2>/dev/null || true)"
  if [ -n "$TAG" ]; then
    say "Published ${BOLD}$TAG${OFF}."
    break
  fi
  sleep 5
done

if [ -z "${TAG:-}" ]; then
  printf "\n"
  warn "No release yet."
  note "It may still be building. Check: gh run list --repo $GH_USER/$REPO_NAME"
  note "Nothing is broken — the sticks will pick it up whenever it lands."
fi

printf "\n"
say "Done."
printf "\n"
note "From now on, to update every stick in the house:"
note "    git add -A && git commit -m \"what changed\" && git push"
printf "\n"
note "GitHub builds it, and each stick checks every half hour, downloads the"
note "new code (about 400KB) and restarts itself when nobody is mid-edit."
printf "\n"
note "Repo:     https://github.com/$GH_USER/$REPO_NAME"
note "Releases: https://github.com/$GH_USER/$REPO_NAME/releases"
printf "\n"
note "Rebuild the stick once now, so the app on it knows where to look:"
note "    npm run usb"
printf "\n"
