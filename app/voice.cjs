/**
 * Baja's ears and voice, on this machine.
 *
 * Baja used to listen through the browser's own speech recognition. On the
 * Pi that does nothing at all: Chromium's recogniser sends audio to Google,
 * and only Google's own Chrome builds carry the key it needs — so on a Pi it
 * fails silently, every time, with a microphone plugged in or not. Baja was
 * a label on the screen and nothing more.
 *
 * Now the server listens instead, with Vosk: a speech recogniser that runs
 * entirely on the Pi, no account, no key, no audio leaving the house. It
 * records from the microphone itself (arecord), so there's no browser
 * permission prompt to get stuck behind on a screen with no keyboard. What
 * it hears goes to the wall over the live stream, and the wall does the rest
 * as before — timers, the grocery list, questions for Claude.
 *
 * Answers are spoken with Piper, a natural-sounding voice that also runs on
 * the Pi, or with espeak-ng when Piper isn't there. The browser's own voices
 * are used where they exist (a Mac); Chromium on a Pi has none.
 *
 * Setting up is automatic the first time Baja is switched on: a Python
 * environment in the data folder, Vosk into it, and the English model
 * (~40MB) and voice (~60MB) downloaded once. It takes a few minutes on a Pi
 * and then never again. Everything lives in <data>/voice, outside the app,
 * so updates don't repeat it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { dataDir } = require('./paths.cjs');

const MODEL_NAME = 'vosk-model-small-en-us-0.15';
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;
const VOICE_NAME = 'en_US-lessac-medium';
const VOICE_URL = `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${VOICE_NAME}.onnx`;

const dir = () => path.join(dataDir(), 'voice');
const venvPython = () => path.join(dir(), 'venv', 'bin', 'python');
const modelDir = () => path.join(dir(), MODEL_NAME);
const voiceFile = () => path.join(dir(), `${VOICE_NAME}.onnx`);

let wanted = { enabled: false, device: 'default' };
let status = { state: 'off', step: null, error: null, lastHeard: null, lastHeardAt: null, tts: null };
let listener = null;
let speaker = null;
let settingUp = null;
let restartTimer = null;
let restartDelay = 2000;
let onEvent = () => {};

function setStatus(patch) {
  status = { ...status, ...patch };
  onEvent({ type: 'status', status });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const last = String(stderr || err.message).trim().split('\n').slice(-1)[0];
        reject(new Error(last || err.message));
      } else resolve(String(stdout));
    });
  });
}

const which = (cmd) => run('sh', ['-c', `command -v ${cmd}`]).then((p) => p.trim(), () => '');

/** The command that records 16kHz mono from the microphone, or null. */
async function recorder(device) {
  if (await which('arecord')) {
    return ['arecord', '-q', '-D', device || 'default', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw'];
  }
  // A Mac with SoX installed (brew install sox).
  if (await which('rec')) return ['rec', '-q', '-t', 'raw', '-r', '16000', '-e', 'signed', '-b', '16', '-c', '1', '-'];
  return null;
}

async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (${res.status}) from ${new URL(url).host}`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, file);
}

// pip and Python want somewhere to write; on the Pi the service's home folder
// is read-only, so they get the voice folder instead.
const pyEnv = () => ({ ...process.env, HOME: dir(), PIP_NO_CACHE_DIR: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' });

const canImport = (mod) => run(venvPython(), ['-c', `import ${mod}`], { env: pyEnv() }).then(() => true, () => false);

async function setup() {
  fs.mkdirSync(dir(), { recursive: true });

  if (!(await recorder(wanted.device))) {
    throw new Error(
      process.platform === 'linux'
        ? 'arecord is missing (sudo apt install alsa-utils)'
        : 'no way to record here — Baja listens on the Pi (or a Mac with SoX: brew install sox)'
    );
  }

  if (!fs.existsSync(venvPython())) {
    setStatus({ step: 'Making a place for the speech software…' });
    const python = (await which('python3')) || 'python3';
    await run(python, ['-m', 'venv', path.join(dir(), 'venv')], { env: pyEnv() }).catch((err) => {
      throw new Error(`couldn't set up Python (${err.message}) — sudo apt install python3-venv`);
    });
  }

  if (!(await canImport('vosk'))) {
    setStatus({ step: 'Installing speech recognition (a minute or two)…' });
    await run(venvPython(), ['-m', 'pip', 'install', '-q', 'vosk'], { env: pyEnv() });
  }

  if (!fs.existsSync(path.join(modelDir(), 'am'))) {
    setStatus({ step: 'Downloading the English speech model (40MB)…' });
    const zip = path.join(dir(), `${MODEL_NAME}.zip`);
    await download(MODEL_URL, zip);
    setStatus({ step: 'Unpacking the speech model…' });
    await run(venvPython(), ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir()]);
    fs.rmSync(zip, { force: true });
  }

  // The voice is a nicety: without it Baja still speaks, in espeak's robot
  // voice, so a failure here doesn't stop the rest.
  try {
    if (!(await canImport('piper'))) {
      setStatus({ step: 'Installing a natural voice…' });
      await run(venvPython(), ['-m', 'pip', 'install', '-q', 'piper-tts'], { env: pyEnv() });
    }
    if (!fs.existsSync(voiceFile())) {
      setStatus({ step: 'Downloading the voice (60MB)…' });
      await download(`${VOICE_URL}.json`, `${voiceFile()}.json`);
      await download(VOICE_URL, voiceFile());
    }
  } catch (err) {
    console.warn('[baja-blast] Baja: natural voice not installed (not fatal):', err.message);
  }
}

function startListener() {
  if (listener || !wanted.enabled) return;
  recorder(wanted.device).then((rec) => {
    if (listener || !wanted.enabled || !rec) return;
    const child = spawn(venvPython(), [path.join(__dirname, 'baja_listen.py'), modelDir(), JSON.stringify(rec)], {
      env: pyEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    listener = child;
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      let nl;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'ready') {
          restartDelay = 2000;
          setStatus({ state: 'listening', step: null, error: null });
        } else if (msg.type === 'error') {
          setStatus({ state: 'error', error: `Microphone: ${msg.error}` });
        } else if (msg.type === 'utterance') {
          // Kept for Settings, so "is it hearing anything?" has an answer.
          status = { ...status, lastHeard: msg.text, lastHeardAt: new Date().toISOString() };
        } else {
          onEvent(msg);
        }
      }
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.stdin.on('error', () => {});
    child.on('exit', (code) => {
      if (listener === child) listener = null;
      if (!wanted.enabled) return;
      if (status.state !== 'error') {
        const why = stderr.trim().split('\n').slice(-1)[0];
        setStatus({ state: 'error', error: why ? `Listener stopped: ${why}` : `Listener stopped (${code})` });
      }
      // A microphone unplugged and plugged back in, mostly. Keep trying, but
      // not in a tight loop.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startListener, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 60_000);
    });
  });
}

function stopListener() {
  clearTimeout(restartTimer);
  if (listener) {
    const child = listener;
    listener = null;
    child.kill();
  }
  if (speaker) {
    speaker.child.kill();
    speaker = null;
  }
}

async function bringUp() {
  if (settingUp) return settingUp;
  settingUp = (async () => {
    try {
      setStatus({ state: 'installing', error: null, step: 'Getting Baja ready…' });
      await setup();
      status.tts = (await piperWorks()) ? 'piper' : (await espeak()) ? 'espeak' : null;
      if (!wanted.enabled) return setStatus({ state: 'off', step: null });
      setStatus({ state: 'starting', step: null });
      startListener();
    } catch (err) {
      console.warn('[baja-blast] Baja setup failed:', err.message);
      setStatus({ state: 'error', step: null, error: err.message });
      // A dropped download on a flaky connection shouldn't need anybody to
      // notice. Try again in a while.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => wanted.enabled && bringUp(), 10 * 60_000);
    } finally {
      settingUp = null;
    }
  })();
  return settingUp;
}

/** Called whenever settings change. Cheap when nothing relevant did. */
function configure(settings) {
  const next = { enabled: !!(settings && settings.voiceEnabled), device: (settings && settings.bajaMicDevice) || 'default' };
  const changed = next.enabled !== wanted.enabled || next.device !== wanted.device;
  wanted = next;
  if (!changed) return;
  stopListener();
  if (wanted.enabled) bringUp();
  else setStatus({ state: 'off', step: null, error: null });
}

/** listen | mute | unmute */
function command(word) {
  if (listener && ['listen', 'mute', 'unmute'].includes(word)) listener.stdin.write(`${word}\n`);
  return !!listener;
}

const espeak = async () => (await which('espeak-ng')) || (await which('espeak'));

let speakSeq = 0;

/** Installed is not the same as working: say one word and see. */
async function piperWorks() {
  if (!fs.existsSync(voiceFile()) || !(await canImport('piper'))) return false;
  const out = path.join(dir(), 'say-check.wav');
  try {
    await piperSay('Ready.', out);
    return fs.statSync(out).size > 1000;
  } catch (err) {
    console.warn('[baja-blast] Baja: natural voice installed but not working (not fatal):', err.message);
    if (speaker) speaker.child.kill();
    return false;
  } finally {
    fs.rmSync(out, { force: true });
  }
}
function piperSay(text, out) {
  if (!speaker) {
    const child = spawn(venvPython(), [path.join(__dirname, 'baja_speak.py'), voiceFile()], { env: pyEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
    const waiting = new Map();
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      let nl;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          const done = waiting.get(msg.id);
          if (done) {
            waiting.delete(msg.id);
            done(msg);
          }
        } catch {
          /* not ours */
        }
      }
    });
    child.stdin.on('error', () => {});
    child.on('exit', () => {
      if (speaker && speaker.child === child) speaker = null;
      for (const done of waiting.values()) done({ ok: false, error: 'voice stopped' });
    });
    speaker = { child, waiting };
  }
  const id = ++speakSeq;
  const { child, waiting } = speaker;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('voice took too long'));
    }, 30_000);
    waiting.set(id, (msg) => {
      clearTimeout(timer);
      msg.ok ? resolve() : reject(new Error(msg.error || 'voice failed'));
    });
    child.stdin.write(JSON.stringify({ id, text, out }) + '\n');
  });
}

/** Speak `text` to a WAV file; resolves with its bytes, or null if there's no voice here. */
async function say(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!clean) return null;
  fs.mkdirSync(dir(), { recursive: true });
  const out = path.join(dir(), `say-${process.pid}-${++speakSeq}.wav`);
  try {
    if (status.tts === 'piper') {
      await piperSay(clean, out).catch(async () => {
        const bin = await espeak();
        if (!bin) throw new Error('no voice');
        await run(bin, ['-w', out, clean]);
      });
    } else {
      const bin = await espeak();
      if (!bin) return null;
      await run(bin, ['-s', '160', '-w', out, clean]);
    }
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

module.exports = {
  configure,
  command,
  say,
  status: () => status,
  /** Retry setup from Settings, after fixing whatever it complained about. */
  retry: () => {
    stopListener();
    if (wanted.enabled) bringUp();
  },
  onEvent: (fn) => {
    onEvent = fn;
  },
};
