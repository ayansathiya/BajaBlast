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
  s = await bt.list();
  check('connected speakers come first', s.devices[0].name === 'JBL Flip 5' && s.devices[0].connected);

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
