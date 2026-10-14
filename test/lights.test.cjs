/**
 * The lights: WiZ bulbs on the home Wi-Fi, and what Baja makes of "set the
 * TV mood".
 *
 * Real bulbs aren't needed: a fake one answers the same UDP messages a WiZ
 * bulb does (getPilot, getSystemConfig, setPilot) and remembers what it was
 * told, so the checks are on what a bulb would actually have done.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const dgram = require('node:dgram');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 38000 + Math.floor(Math.random() * 800);
process.env.BAJA_BLAST_WIZ_PORT = String(PORT);
const lights = require(path.join(ROOT, 'app', 'lights.cjs'));

const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-lights-')), 'lights.cjs');
execFileSync('npx', ['esbuild', 'src/engine/lights.ts', '--bundle', '--format=cjs', `--outfile=${OUT}`, '--log-level=warning'], { cwd: ROOT });
const { parseLightCommand } = require(OUT);

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

/** A WiZ bulb, as far as the network can tell. */
function fakeBulb(ip, mac, { silent = false } = {}) {
  const bulb = { mac, pilot: { mac, state: true, dimming: 80, temp: 3000, r: 0, g: 0, b: 0, sceneId: 0 }, told: [] };
  const sock = dgram.createSocket('udp4');
  sock.on('message', (buf, rinfo) => {
    if (bulb.silent) return;
    const msg = JSON.parse(buf.toString());
    let result;
    if (msg.method === 'getPilot') result = { ...bulb.pilot };
    else if (msg.method === 'getSystemConfig') result = { mac, roomId: 7, moduleName: 'ESP01_SHRGB1C_31' };
    else if (msg.method === 'setPilot') {
      bulb.told.push(msg.params);
      const p = msg.params;
      bulb.pilot = { ...bulb.pilot, state: p.state };
      if (p.dimming != null) bulb.pilot.dimming = p.dimming;
      if (p.temp != null) Object.assign(bulb.pilot, { temp: p.temp, r: 0, g: 0, b: 0 });
      if (p.r != null) Object.assign(bulb.pilot, { r: p.r, g: p.g, b: p.b, temp: 0 });
      result = { success: true };
    }
    sock.send(JSON.stringify({ method: msg.method, env: 'pro', result }), rinfo.port, rinfo.address);
  });
  bulb.silent = silent;
  bulb.ready = new Promise((r) => sock.bind(PORT, ip, r));
  bulb.close = () => sock.close();
  return bulb;
}

async function main() {
  console.log('\nTalking to a WiZ bulb');
  const lamp = fakeBulb('127.0.0.1', 'a8bb50aaaaaa');
  await lamp.ready;
  const found = await lights.scan({ hosts: ['127.0.0.1'], listenMs: 300 });
  check('it finds a bulb that is switched on at the wall', found.length === 1 && found[0].mac === 'a8bb50aaaaaa' && found[0].ip === '127.0.0.1', JSON.stringify(found));
  check('and learns its room', found[0] && found[0].roomId === 7);

  check('off means off', (await lights.set('127.0.0.1', { on: false })) && lamp.pilot.state === false);
  await lights.set('127.0.0.1', { on: true, dimming: 40, temp: 2700 });
  check('on, at a brightness and a warmth', lamp.pilot.state === true && lamp.pilot.dimming === 40 && lamp.pilot.temp === 2700);
  await lights.set('127.0.0.1', { on: true, dimming: 3 });
  check('never dimmer than WiZ allows (10%)', lamp.pilot.dimming === 10);
  await lights.set('127.0.0.1', { on: true, color: [255, 0, 0] });
  check('colours', lamp.pilot.r === 255 && lamp.pilot.g === 0);

  const now = lights.changeFrom(await lights.status('127.0.0.1'));
  check('what it is doing now reads back in the same shape, for saving moods', now.on === true && now.color && now.color[0] === 255, JSON.stringify(now));
  check('an off bulb reads back as just off', JSON.stringify(lights.changeFrom({ state: false, dimming: 50 })) === '{"on":false}');

  lamp.silent = true;
  const t0 = Date.now();
  const reached = await lights.set('127.0.0.1', { on: false });
  check('a bulb with no power is a no, quickly — not a hang', reached === false && Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
  lamp.close();

  console.log('\nWhat Baja makes of it');
  const moods = ['TV', 'Bright', 'Dinner', 'Night'];
  const bulbs = ['Couch lamp', 'Ceiling light', 'Kitchen 1'];
  const p = (t) => parseLightCommand(t, moods, bulbs);
  check('"set the tv mood" (as the recogniser writes it)', JSON.stringify(p('set the t v mood')) === '{"kind":"scene","name":"TV"}', JSON.stringify(p('set the t v mood')));
  check('"tv mode"', p('tv mode')?.name === 'TV');
  check('"turn on the dinner scene"', p('turn on the dinner scene')?.name === 'Dinner');
  check('"night mood"', p('night mood')?.name === 'Night');
  check('a mood that doesn\'t exist isn\'t guessed at', p('set the party mood') === null);

  const off = p('turn off the lights');
  check('"turn off the lights" → every light off', off?.kind === 'set' && off.target === 'all' && off.change.on === false);
  check('"turn the lights off"', p('turn the lights off')?.change.on === false);
  const lamp1 = p('turn on the couch lamp');
  check('"turn on the couch lamp" → just that one', lamp1?.kind === 'set' && Array.isArray(lamp1.target) && lamp1.target.join() === 'Couch lamp' && lamp1.change.on === true, JSON.stringify(lamp1));
  check('"all the lights on" → all, even with a name about', p('turn all the kitchen lights on')?.target === 'all');
  check('"dim the lights" → low', p('dim the lights')?.change.dimming === 30);
  check('"dim the lights to twenty percent"', p('dim the lights to twenty percent')?.change.dimming === 20);
  check('"set the lights to 75 percent"', p('set the lights to 75 percent')?.change.dimming === 75);
  check('"make the lights warm"', p('make the lights warm')?.change.temp === 2700);
  check('"turn the lights blue"', p('turn the lights blue')?.change.color?.[2] === 255);
  check('not about the lights: left alone', p('what is the weather') === null && p('set a timer for ten minutes') === null);
  // Exactly as the Pi's speech recogniser wrote these phrases down.
  check('heard as "said the tv mood"', p('said the tv mood')?.name === 'TV');
  check('heard as "the and off the lives"', p('the and off the lives')?.change.on === false);
  check('heard as "turn on the couch lamb"', p('turn on the couch lamb')?.target?.join?.() === 'Couch lamp');
  check('heard as "them the lights to thirty percent"', p('them the lights to thirty percent')?.change.dimming === 30);
  check('"office" is not "off"', p('turn on the office lights')?.change.on === true);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
