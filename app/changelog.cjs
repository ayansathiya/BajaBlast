/**
 * The update log, read out of CHANGELOG.md.
 *
 * One source of truth. The file at the repo root is what a person edits and
 * what GitHub shows; this parses it so the app can show the same list under
 * Settings → What's new. Keeping a second copy in JSON would mean two lists
 * that drift, and the one nobody edits would be the one on the wall.
 *
 * The format is deliberately narrow — `## YYYY-MM-DD — Title`, then bullets —
 * so that parsing is a dozen lines rather than a Markdown library, and so a
 * malformed entry is skipped rather than crashing the settings screen.
 */
const fs = require('node:fs');
const path = require('node:path');

/** `## 2026-09-23 — Type with a real keyboard`, with an em dash or a hyphen. */
const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/;
/** `## Earlier` — a dateless section, kept at the bottom. */
const PLAIN_HEADING = /^##\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.+?)\s*$/;

/**
 * Turn the file's text into entries.
 *
 * Exported separately from the file reading so the tests can drive it with a
 * string, including the shapes that should be ignored.
 */
function parse(text) {
  const entries = [];
  let current = null;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trimEnd();

    const dated = HEADING.exec(line);
    const plain = dated ? null : PLAIN_HEADING.exec(line);

    if (dated || plain) {
      if (current) entries.push(current);
      current = {
        date: dated ? dated[1] : null,
        title: dated ? dated[2] : plain[1],
        changes: [],
      };
      continue;
    }

    if (!current) continue; // preamble before the first heading

    const bullet = BULLET.exec(line);
    if (bullet) {
      // Markdown emphasis reads as noise once it's out of Markdown, and the
      // settings panel renders plain text rather than HTML on purpose — the
      // changelog is a file anyone can edit, and an edit shouldn't be able to
      // put markup on the kitchen wall.
      current.changes.push(bullet[1].replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1'));
    } else if (line && current.changes.length > 0) {
      // A wrapped continuation line belongs to the bullet above it.
      current.changes[current.changes.length - 1] += ` ${line.trim()}`;
    }
  }

  if (current) entries.push(current);
  return entries.filter((e) => e.changes.length > 0);
}

// Where the file lives depends on how the app was installed: beside the app
// in a checkout, one level up inside the package. Both are checked rather
// than guessed, so a missing changelog is an empty list and not an exception.
function findFile() {
  const candidates = [
    path.resolve(__dirname, '..', 'CHANGELOG.md'),
    path.resolve(__dirname, 'CHANGELOG.md'),
  ];
  return candidates.find((f) => fs.existsSync(f)) || null;
}

let cache = null;

function entries() {
  const file = findFile();
  if (!file) return [];

  try {
    const stat = fs.statSync(file);
    // Re-read only when it changes. It's a small file, but this is called
    // every time someone opens the settings panel.
    if (cache && cache.at === stat.mtimeMs) return cache.entries;
    const parsed = parse(fs.readFileSync(file, 'utf8'));
    cache = { at: stat.mtimeMs, entries: parsed };
    return parsed;
  } catch {
    return [];
  }
}

module.exports = { entries, parse };
