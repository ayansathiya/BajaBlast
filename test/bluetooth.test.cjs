/**
 * Bluetooth speakers (app/bluetooth.cjs), against a stand-in bluetoothctl.
 *
 * The stand-in keeps a little state file — which devices exist, which are
 * paired and connected — and answers the commands the way BlueZ's does, so
 * this checks the whole round: scan, pair, trust, connect, disconnect,
 * forget, and the refusals.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bt-'));
const stateFile = path.join(dir, 'state.json');
const log = path.join(dir, 'calls');
fs.writeFileSync(log, '');
// A speaker in pairing mode, found only once someone scans; and a phone.
fs.writeFileSync(
  stateFile,
  JSON.stringify({
    scanned: false,
    devices: {
      'AA:BB:CC:00:11:22': { name: 'JBL Flip 5', icon: 'audio-card', paired: false, trusted: false, connected: false, needsScan: true },
      '11:22:33:44:55:66': { name: "Ayan's iPhone", icon: 'phone', paired: true, trusted: true, connected: false },
      '77:88:99:AA:BB:CC': { name: '77-88-99-AA-BB-CC', icon: '', paired: false, trusted: false, connected: false },
    },
  })
);
const fake = path.join(dir, 'bluetoothctl');
fs.writeFileSync(
  fake,
  `#!/usr/bin/env node
const fs = require('fs');
const S = ${JSON.stringify(stateFile)};
const st = JSON.parse(fs.readFileSync(S, 'utf8'));
let args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');
if (args[0] === '--timeout') args = args.slice(2);
const save = () => fs.writeFileSync(S, JSON.stringify(st));
const visible = Object.entries(st.devices).filter(([, d]) => !d.needsScan || st.scanned || d.paired);
const [cmd, mac] = args;
const d = st.devices[mac];
if (cmd === 'devices') for (const [m, x] of visible) console.log('Device ' + m + ' ' + x.name);
else if (cmd === 'show') console.log('Controller 00:00:00:00:00:01\\n\\tPowered: yes');
else if (cmd === 'power') console.log('Changing power on succeeded');
else if (cmd === 'scan') { st.scanned = true; save(); console.log('Discovery started'); }
else if (cmd === 'info') {
  if (!d || (d.needsScan && !st.scanned && !d.paired)) { console.log('Device ' + mac + ' not available'); process.exit(1); }
  console.log('Device ' + mac + '\\n\\tName: ' + d.name + '\\n\\tIcon: ' + d.icon + '\\n\\tPaired: ' + (d.paired ? 'yes' : 'no') + '\\n\\tTrusted: ' + (d.trusted ? 'yes' : 'no') + '\\n\\tConnected: ' + (d.connected ? 'yes' : 'no'));
}
else if (cmd === 'pair') { if (!d) { console.log('Device ' + mac + ' not available'); process.exit(1); } d.paired = true; save(); console.log('Pairing successful'); }
else if (cmd === 'trust') { d.trusted = true; save(); console.log('Changing ' + mac + ' trust succeeded'); }
else if (cmd === 'connect') { if (!d || !d.paired) { console.log('Failed to connect'); process.exit(1); } d.connected = true; save(); console.log('Connection successful'); }
else if (cmd === 'disconnect') { d.connected = false; save(); console.log('Successful disconnected'); }
else if (cmd === 'remove') { delete st.devices[mac]; save(); console.log('Device has been removed'); }
`
);
fs.chmodSync(fake, 0o755);

// The Pi's sound system: playing to HDMI, with the calendar's stream on it.
// The speaker's output appears only once it's in music mode (A2DP) — the
// trap a speaker connected in phone-call mode falls into.
const soundFile = path.join(dir, 'sound.json');
fs.writeFileSync(soundFile, JSON.stringify({ default: 'alsa_output.hdmi', a2dp: false, inputs: { 42: 'alsa_output.hdmi' } }));
const pactl = path.join(dir, 'pactl');
fs.writeFileSync(
  pactl,
  `#!/usr/bin/env node
const fs = require('fs');
const S = ${JSON.stringify(soundFile)};
const st = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, 'pactl ' + a.join(' ') + '\\n');
const save = () => fs.writeFileSync(S, JSON.stringify(st));
const sinks = [['alsa_output.hdmi', 'HDMI (the screen)']];
if (st.a2dp) sinks.push(['bluez_output.AA_BB_CC_00_11_22.1', 'Sony SRS']);
if (a[0] === 'get-default-sink') console.log(st.default);
else if (a[0] === 'list' && a[1] === 'sinks') sinks.forEach(([n, d], i) => console.log('Sink #' + i + '\\n\tState: RUNNING\\n\tName: ' + n + '\\n\tDescription: ' + d));
else if (a[0] === 'set-card-profile') { if (a[1] === 'bluez_card.AA_BB_CC_00_11_22' && a[2] === 'a2dp-sink') { st.a2dp = true; save(); } else process.exit(1); }
else if (a[0] === 'set-default-sink') { if (!sinks.some(([n]) => n === a[1])) process.exit(1); st.default = a[1]; save(); }
else if (a[0] === 'list' && a[1] === 'short' && a[2] === 'sink-inputs') Object.entries(st.inputs).forEach(([id, sink]) => console.log(id + '\t' + sink + '\tprotocol-native.c\tfloat32le 2ch 48000Hz'));
else if (a[0] === 'move-sink-input') { st.inputs[a[1]] = a[2]; save(); }
`
);
fs.chmodSync(pactl, 0o755);
process.env.PATH = `${dir}:${process.env.PATH}`;

const bt = require(path.join(ROOT, 'app', 'bluetooth.cjs'));

async function main() {
  console.log('\nBluetooth speakers');
  let s = await bt.list();
  check('Bluetooth is there', s.available && s.powered);
  check('a paired phone is listed', s.devices.some((d) => d.name === "Ayan's iPhone" && d.paired));
  check('nameless devices are left out — nobody can pick those', !s.devices.some((d) => /77/.test(d.name)));
  check('the speaker isn\'t there before a scan', !s.devices.some((d) => d.name === 'JBL Flip 5'));

  s = await bt.scan(1);
  const jbl = s.devices.find((d) => d.name === 'JBL Flip 5');
  check('a scan finds the speaker in pairing mode', !!jbl && !jbl.paired);
  check('…and knows it plays sound', jbl && jbl.audio);

  const r = await bt.connect('AA:BB:CC:00:11:22');
  const calls = fs.readFileSync(log, 'utf8');
  check('connecting it works', r.ok, JSON.stringify(r));
  check('…pairs it, trusts it (so it comes back by itself), and connects', /pair AA:BB:CC:00:11:22/.test(calls) && /trust AA:BB:CC:00:11:22/.test(calls) && /connect AA:BB:CC:00:11:22/.test(calls));
  const sound = JSON.parse(fs.readFileSync(soundFile, 'utf8'));
  check('…puts the speaker in music mode, not phone-call mode', sound.a2dp);
  check('…and the sound now goes to the speaker, not the screen', sound.default === 'bluez_output.AA_BB_CC_00_11_22.1');
  check('…including the calendar\'s own stream that was already playing', sound.inputs['42'] === 'bluez_output.AA_BB_CC_00_11_22.1');
  check('…and says where sound is going', r.output === 'Sony SRS');
  s = await bt.list();
  check('connected speakers come first', s.devices[0].name === 'JBL Flip 5' && s.devices[0].connected);
  check('the panel is told where sound is playing', s.output && s.output.description === 'Sony SRS' && s.output.bluetooth);

  // Connected some other way, still playing to the screen: Use for sound.
  fs.writeFileSync(soundFile, JSON.stringify({ default: 'alsa_output.hdmi', a2dp: false, inputs: { 42: 'alsa_output.hdmi' } }));
  const use = await bt.useForSound('AA:BB:CC:00:11:22');
  const after = JSON.parse(fs.readFileSync(soundFile, 'utf8'));
  check('"Use for sound" moves it to a speaker that\'s already connected', use.ok && after.default.startsWith('bluez_output') && after.inputs['42'].startsWith('bluez_output'));

  fs.writeFileSync(log, '');
  await bt.connect('11:22:33:44:55:66');
  check('something already paired isn\'t paired again', !/^pair /m.test(fs.readFileSync(log, 'utf8')));

  check('disconnecting', (await bt.disconnect('AA:BB:CC:00:11:22')).ok && !(await bt.list()).devices.find((d) => d.name === 'JBL Flip 5').connected);
  check('forgetting', (await bt.forget('AA:BB:CC:00:11:22')).ok);

  const bad = await bt.connect('AA:BB:CC:00:11:22; rm -rf /');
  check('anything that isn\'t an address is refused before it reaches a command', !bad.ok && /address/.test(bad.error));
  const gone = await bt.connect('DE:AD:BE:EF:00:01');
  check('a speaker that went out of range says so', !gone.ok && /range|pairing mode/.test(gone.error), JSON.stringify(gone));

  process.env.PATH = '/nonexistent';
  const none = await bt.list();
  check('a machine without Bluetooth tools says so plainly', none.available === false && /bluetoothctl/.test(none.error));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
