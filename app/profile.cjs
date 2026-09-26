/**
 * Device profiles: what a particular box should start out with.
 *
 * A 1GB TV box and a Mac mini want different defaults, and the household
 * shouldn't have to find Settings → Display → Low power mode on a slow screen
 * to make the small one usable. So a box can carry a profile —
 * /etc/baja-blast/profile.json, written by the standalone package — and the
 * server applies it to the settings the first time it sees it.
 *
 * Only the first time. A profile is a starting point, not a lock: once it has
 * been applied it's recorded in the store, and if somebody later turns low
 * power mode off, it stays off across restarts and updates. Applying it again
 * on every boot would quietly undo their choice every night.
 *
 *   { "lowPower": true, "hdmiCec": true }
 *
 * $BAJA_BLAST_PROFILE points somewhere else, which is how the tests use it.
 */
const fs = require('node:fs');

const PROFILE_FILE = '/etc/baja-blast/profile.json';

function profilePath() {
  return process.env.BAJA_BLAST_PROFILE || PROFILE_FILE;
}

/** The profile on this machine, or null. A malformed file is ignored, not fatal. */
function readProfile(file = profilePath()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * The same three switches the Settings toggle flips (SettingsPanel.tsx,
 * "Low power mode"). Kept identical on purpose: the toggle reads its state
 * from these three, so a box that starts in low power mode shows the switch
 * as on.
 */
function lowPowerSettings(settings) {
  return {
    ...settings,
    display: { ...settings.display, reducedMotion: true },
    ambient: { ...settings.ambient, enabled: false },
    feeds: { ...settings.feeds, showPhotoFrame: false },
  };
}

/**
 * Apply any not-yet-applied parts of the profile to the store.
 *
 * `withDefaults` fills in whatever the store is missing, so this works on a
 * brand-new box (no settings at all) and on one that has been running for
 * months before the profile arrived. Returns true if it changed anything, so
 * the caller knows to save.
 */
function applyProfile(store, withDefaults, profile = readProfile()) {
  if (!profile || !store) return false;
  const applied = Array.isArray(store.profileApplied) ? store.profileApplied : [];
  let changed = false;

  if (profile.lowPower === true && !applied.includes('lowPower')) {
    store.settings = lowPowerSettings(withDefaults(store.settings));
    applied.push('lowPower');
    changed = true;
  }

  if (profile.hdmiCec === true && !applied.includes('hdmiCec')) {
    const s = withDefaults(store.settings);
    store.settings = { ...s, display: { ...s.display, schedule: { ...s.display.schedule, hdmiCec: true } } };
    applied.push('hdmiCec');
    changed = true;
  }

  if (changed) store.profileApplied = applied;
  return changed;
}

module.exports = { readProfile, applyProfile, lowPowerSettings, PROFILE_FILE };
