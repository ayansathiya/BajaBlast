/**
 * Party teams: who's on which side, drawn at random, revealed one guest at
 * a time on the wall as they arrive.
 *
 * The draw happens here, on the Pi, when the host opens the doors: every
 * guest is shuffled and dealt round the teams like cards, so the teams come
 * out even (sizes differ by one at most) and the order people arrive in
 * changes nothing. Until a guest taps their own name, nobody — the host's
 * setup screen included — can find out where they landed: the public view
 * leaves unrevealed assignments out.
 *
 * Changing the setup after people have seen their team keeps those people
 * where they are and re-deals everyone else around them. A late guest added
 * on the night goes to one of the smallest teams, picked at random.
 *
 * store.party = {
 *   title, open, drawnAt,
 *   teams:  [{ id, name, color, ink }],
 *   guests: [{ id, name, teamId, revealedAt }],
 * }
 */
const crypto = require('node:crypto');

// Warm, deep, and distinct from one another at a glance across a room;
// `ink` is the text drawn on top of each.
const PALETTE = [
  { name: 'Cranberry', color: '#9E2F35', ink: '#FBF4EA' },
  { name: 'Pumpkin', color: '#C2652A', ink: '#FFF6EC' },
  { name: 'Sage', color: '#5F7A55', ink: '#F7F6EE' },
  { name: 'Harvest', color: '#C99A3B', ink: '#1E1810' },
  { name: 'Plum', color: '#5C3B5E', ink: '#F8F0F4' },
  { name: 'Slate', color: '#46606F', ink: '#F2F5F6' },
  { name: 'Chestnut', color: '#6E4127', ink: '#FAF1E8' },
  { name: 'Olive', color: '#7C7A3A', ink: '#FBFAEE' },
];
const MAX_TEAMS = PALETTE.length;
const MAX_GUESTS = 80;

const id = () => crypto.randomBytes(6).toString('hex');

function empty() {
  return { title: 'Thanksgiving', open: false, drawnAt: null, teams: defaultTeams(3), guests: [], tip: emptyTip() };
}

/*
 * The tip jar: a "buy the maker a coffee" page after each reveal. Either a
 * phone left beside the screen that guests tap their iPhone against (Tap to
 * Cash), or a QR code that opens Messages to `handle` — the phone number or
 * email their Apple Cash is on — to send from there (no link can open Apple
 * Cash itself).
 */
function emptyTip() {
  return { enabled: false, mode: 'tap', name: '', handle: '' };
}

function normaliseTip(t) {
  const tip = t && typeof t === 'object' ? t : {};
  const handle = String(tip.handle || '').trim().slice(0, 60);
  return {
    enabled: !!tip.enabled,
    // 'tap': a phone left beside the screen, paid with Tap to Cash (iPhones
    // held together) — no number on the wall. 'qr': a code that opens
    // Messages to `handle`.
    mode: tip.mode === 'qr' ? 'qr' : 'tap',
    name: String(tip.name || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    // A phone number keeps only what Messages understands; an email is kept as typed.
    handle: handle.includes('@') ? handle : handle.replace(/[^\d+]/g, '').slice(0, 16),
  };
}

function defaultTeams(n) {
  return PALETTE.slice(0, n).map((p) => ({ id: id(), name: p.name, color: p.color, ink: p.ink }));
}

function normalise(party) {
  const p = party && typeof party === 'object' ? party : empty();
  return {
    title: typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 40) : 'Thanksgiving',
    open: !!p.open,
    drawnAt: p.drawnAt || null,
    teams: Array.isArray(p.teams) && p.teams.length >= 2 ? p.teams.slice(0, MAX_TEAMS) : defaultTeams(3),
    guests: Array.isArray(p.guests) ? p.guests.slice(0, MAX_GUESTS) : [],
    tip: normaliseTip(p.tip),
  };
}

/** Fisher–Yates with the system's cryptographic randomness, not Math.random. */
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deal everyone not yet revealed round the teams. Revealed guests stay put
 * and count towards their team's size, so the result is as even as it can
 * be given who's already been told.
 */
function deal(party) {
  const counts = new Map(party.teams.map((t) => [t.id, 0]));
  for (const g of party.guests) {
    if (g.revealedAt && counts.has(g.teamId)) counts.set(g.teamId, counts.get(g.teamId) + 1);
    else {
      g.teamId = null;
      g.revealedAt = null;
    }
  }
  for (const g of shuffle(party.guests.filter((x) => !x.teamId))) {
    const smallest = Math.min(...counts.values());
    const candidates = [...counts.keys()].filter((t) => counts.get(t) === smallest);
    const team = candidates[crypto.randomInt(candidates.length)];
    g.teamId = team;
    counts.set(team, counts.get(team) + 1);
  }
  party.drawnAt = new Date().toISOString();
  return party;
}

/**
 * The host's setup: { title, teams: [{ name }], guests: [name] }. Names are
 * matched to existing guests (so a guest who's seen their team keeps it);
 * anyone new is drawn in.
 */
function setup(current, body) {
  const party = normalise(current);
  if (typeof body.title === 'string') party.title = body.title.trim().slice(0, 40) || 'Thanksgiving';
  if (body.tip && typeof body.tip === 'object') party.tip = normaliseTip(body.tip);

  if (Array.isArray(body.teams)) {
    const wanted = body.teams.slice(0, MAX_TEAMS);
    if (wanted.length >= 2) {
      party.teams = wanted.map((t, i) => {
        const existing = party.teams[i];
        const look = PALETTE[i];
        const name = String((t && t.name) || look.name).trim().slice(0, 24) || look.name;
        return { id: existing ? existing.id : id(), name, color: look.color, ink: look.ink };
      });
    }
  }

  if (Array.isArray(body.guests)) {
    const seen = new Set();
    const names = [];
    for (const raw of body.guests) {
      const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 32);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    const byName = new Map(party.guests.map((g) => [g.name.toLowerCase(), g]));
    party.guests = names.slice(0, MAX_GUESTS).map((name) => byName.get(name.toLowerCase()) || { id: id(), name, teamId: null, revealedAt: null });
  }

  // Sorted A–Z, so a guest at the door finds their name by reading, not hunting.
  party.guests.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return deal(party);
}

/** Tap your name: your team, and who's been revealed alongside you so far. */
function reveal(current, guestId) {
  const party = normalise(current);
  const guest = party.guests.find((g) => g.id === guestId);
  if (!guest) return { party, result: null };
  if (!guest.teamId || !party.teams.some((t) => t.id === guest.teamId)) deal(party);
  if (!guest.revealedAt) guest.revealedAt = new Date().toISOString();
  const team = party.teams.find((t) => t.id === guest.teamId);
  const teammates = party.guests.filter((g) => g.teamId === team.id && g.id !== guest.id && g.revealedAt).map((g) => g.name);
  const size = party.guests.filter((g) => g.teamId === team.id).length;
  return { party, result: { guest: guest.name, team, teammates, size } };
}

/** Everyone unrevealed again, and a fresh draw. */
function redraw(current) {
  const party = normalise(current);
  for (const g of party.guests) {
    g.teamId = null;
    g.revealedAt = null;
  }
  return deal(party);
}

/**
 * What any screen may see. An unrevealed guest's team is left out entirely;
 * team sizes are fine to show (they follow from the numbers anyway).
 * `all: true` — the host's "show every team", for game time — includes them.
 */
function publicView(current, { all = false } = {}) {
  const party = normalise(current);
  return {
    title: party.title,
    open: party.open,
    drawnAt: party.drawnAt,
    palette: PALETTE.map(({ name, color, ink }) => ({ name, color, ink })),
    tip: party.tip,
    teams: party.teams.map((t) => ({
      ...t,
      size: party.guests.filter((g) => g.teamId === t.id).length,
      here: party.guests.filter((g) => g.teamId === t.id && g.revealedAt).length,
      members: all ? party.guests.filter((g) => g.teamId === t.id).map((g) => g.name) : undefined,
    })),
    guests: party.guests.map((g) => ({
      id: g.id,
      name: g.name,
      teamId: g.revealedAt || all ? g.teamId : null,
      revealed: !!g.revealedAt,
    })),
  };
}

module.exports = { empty, normalise, setup, reveal, redraw, publicView, deal, PALETTE, MAX_TEAMS };
