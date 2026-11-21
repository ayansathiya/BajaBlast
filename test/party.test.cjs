/**
 * Party teams: the draw is fair, the teams are even, and nobody can find out
 * a team before its guest taps their own name.
 */
const path = require('node:path');
const party = require(path.join(__dirname, '..', 'app', 'party.cjs'));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NAMES = ['Ayan', 'Priya', 'Raj', 'Meena', 'Arjun', 'Divya', 'Kiran', 'Lakshmi', 'Vikram', 'Anita', 'Sanjay'];
const sizes = (p) => p.teams.map((t) => p.guests.filter((g) => g.teamId === t.id).length);

console.log('\nThe draw');
{
  const p = party.setup(null, { title: 'Thanksgiving', teams: [{}, {}, {}], guests: NAMES });
  const s = sizes(p);
  check('everyone is on a team', p.guests.every((g) => g.teamId));
  check('11 people in 3 teams: 4, 4 and 3', [...s].sort().join() === '3,4,4', s.join());
  check('names are listed A to Z, for finding your own', p.guests.map((g) => g.name).join() === [...NAMES].sort().join());
  check('the starter teams have harvest names and colours', p.teams.map((t) => t.name).join() === 'Cranberry,Pumpkin,Sage' && /^#/.test(p.teams[0].color));
  check('duplicates and blanks are dropped', party.setup(null, { guests: ['Ayan', ' ayan ', '', 'Raj'] }).guests.length === 2);
}

console.log('\nNothing leaks');
{
  const p = party.setup(null, { teams: [{}, {}], guests: NAMES });
  const view = party.publicView(p);
  check('before anyone taps their name, no team is visible', view.guests.every((g) => g.teamId === null));
  check('…not even in the raw data sent to the screen', !p.guests.some((g) => JSON.stringify(view.guests).includes(g.teamId)));
  const ayan = p.guests.find((g) => g.name === 'Ayan');
  const { party: after, result } = party.reveal(p, ayan.id);
  check('tapping your name tells you your team', result.team.id === ayan.teamId && result.guest === 'Ayan');
  check('and only teammates who have already been told', result.teammates.length === 0);
  const v2 = party.publicView(after);
  check('afterwards your team shows, and only yours', v2.guests.filter((g) => g.teamId).map((g) => g.name).join() === 'Ayan');
  check('the host\'s "show every team" shows them all', party.publicView(after, { all: true }).guests.every((g) => g.teamId));
  const again = party.reveal(after, ayan.id).result;
  check('tapping again shows the same team, never a new one', again.team.id === result.team.id);
}

console.log('\nChanging the setup on the night');
{
  let p = party.setup(null, { teams: [{}, {}, {}], guests: NAMES });
  const told = p.guests.slice(0, 4);
  for (const g of told) p = party.reveal(p, g.id).party;
  const before = new Map(told.map((g) => [g.name, p.guests.find((x) => x.name === g.name).teamId]));
  p = party.setup(p, { guests: [...NAMES, 'Late Larry', 'Sunita'] });
  check('people who have seen their team keep it', told.every((g) => p.guests.find((x) => x.name === g.name).teamId === before.get(g.name)));
  check('latecomers are drawn in, and the teams stay even', p.guests.every((g) => g.teamId) && Math.max(...sizes(p)) - Math.min(...sizes(p)) <= 1, sizes(p).join());
  p = party.setup(p, { teams: [{ name: 'Gravy' }, { name: 'Stuffing' }, {}] });
  check('renaming a team keeps everyone on it', told.every((g) => p.guests.find((x) => x.name === g.name).teamId === before.get(g.name)) && p.teams[0].name === 'Gravy');
  p = party.redraw(p);
  check('a fresh draw forgets every reveal', p.guests.every((g) => !g.revealedAt));
}

console.log('\nFair');
{
  // Over many draws, one guest should land on each of 3 teams about a third
  // of the time — and so should the last name on the list.
  const hits = [0, 0, 0];
  const lastHits = [0, 0, 0];
  const N = 6000;
  for (let i = 0; i < N; i += 1) {
    const p = party.setup(null, { teams: [{}, {}, {}], guests: NAMES });
    hits[p.teams.findIndex((t) => t.id === p.guests[0].teamId)] += 1;
    lastHits[p.teams.findIndex((t) => t.id === p.guests[p.guests.length - 1].teamId)] += 1;
  }
  const fair = (h) => h.every((x) => Math.abs(x / N - 1 / 3) < 0.03);
  check('any one guest is equally likely to be on any team', fair(hits), hits.join());
  check('being last alphabetically makes no difference', fair(lastHits), lastHits.join());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
