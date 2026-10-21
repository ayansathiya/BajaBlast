"""
Baja's ears, on real speech: does it answer its name, and only its name?

Spoken test sentences (macOS `say`, several voices and accents) go through
app/baja_listen.py exactly as a microphone would feed it, with the same
Vosk model the Pi downloads. Not part of `npm test` — it needs a Mac, Vosk
and the model:

  python3 -m venv /tmp/v && /tmp/v/bin/pip install vosk
  curl -LO https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip && unzip vosk-model-small-en-us-0.15.zip
  /tmp/v/bin/python test/baja-voices.py /path/to/vosk-model-small-en-us-0.15

Takes about ten minutes: the audio plays at real speed, because the
listener's timing rules (a pause before "Baja") are about real time.
"""
import json, os, subprocess, sys, wave, struct
S = os.path.join(__import__('tempfile').gettempdir(), 'baja-voices')
os.makedirs(S, exist_ok=True)
MODEL = sys.argv[1]
PY = sys.executable

def clip(text, voice='Samantha'):
    name = os.path.join(S, 'c_%d_%s.wav' % (abs(hash(text + voice)) % 10**8, voice))
    if not os.path.exists(name):
        aiff = name + '.aiff'
        subprocess.run(['say', '-v', voice, '-o', aiff, text], check=True)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, name], check=True)
    with wave.open(name) as w:
        return w.readframes(w.getnframes())

def silence(sec):
    return b'\x00\x00' * int(16000 * sec)

def run(listener, parts):
    raw = silence(1.0)
    for p in parts:
        if isinstance(p, float):
            raw += silence(p)
        elif isinstance(p, tuple):
            raw += clip(p[0], p[1])
        else:
            raw += clip(p)
    raw += silence(5.0)
    path = os.path.join(S, 'stream.raw')
    open(path, 'wb').write(raw)
    # Feed the audio at real speed so the listener's own clock behaves.
    rec = json.dumps(['sh', '-c', 'cat "%s" | %s -c "import sys,time\nwhile True:\n d=sys.stdin.buffer.read(3200)\n if not d: break\n sys.stdout.buffer.write(d); sys.stdout.flush(); time.sleep(0.1)"' % (path, sys.executable)])
    # stdin stays open: the listener quits when it closes (the server's gone).
    proc = subprocess.Popen([PY, listener, MODEL, rec], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    out = proc.stdout.read()
    proc.wait()
    if os.environ.get('SHOW'): print('   heard:', [json.loads(l).get('text') for l in out.splitlines() if l.strip() and json.loads(l)['type'] == 'utterance'])
    ev = [json.loads(l) for l in out.splitlines() if l.strip()]
    return [(e['type'], e.get('text', '')) for e in ev if e['type'] in ('wake', 'heard')]

V = ['Daniel', 'Fred', 'Karen', 'Moira', 'Rishi']
CASES = [
    ('wake', [('Hey Baja, what is next?', 'Daniel')]),
    ('wake', [('Baja, add milk, eggs, bread and two lemons to the grocery list please.', 'Samantha')]),
    ('wake', [('Baja, what time is it?', 'Karen')]),
    ('wake', [('Hi Baja, turn off the lights.', 'Rishi')]),
    ('wake', [('Baja.', 'Moira'), 1.5, ('Whats for dinner?', 'Moira')]),
    ('quiet', [('And now the weather. A cold front moves in tonight with rain along the coast, clearing by the weekend. Back to you in the studio. Thanks, coming up after the break, the best tacos in town.', 'Daniel')]),
    ('quiet', [('Did you see the bajillion messages in the group chat?', 'Karen'), 1.0, ('Ba ba black sheep, have you any wool.', 'Fred')]),
    ('quiet', [('Hey, bring the bag in from the car.', 'Rishi'), 1.0, ('Hi, I am back. Larger box goes on the top shelf.', 'Moira')]),
    ('quiet', [('Badger, badger, mushroom.', 'Fred'), 1.0, ('Bodega on the corner sells bread.', 'Daniel')]),
    ('quiet', [('Better hurry up, we are late for school.', 'Moira'), 1.0, ('The hair dryer is broken again.', 'Karen')]),
    ('quiet', [('Bother, I forgot my keys.', 'Moira'), 1.0, ('The job interview went well.', 'Karen')]),
    ('wake', ['Baja.', 1.5, 'What is on today?']),
    ('wake', ['Hey Baja, what is the weather tomorrow?']),
    ('wake', ['Hi Baja, set a timer for ten minutes.']),
    ('wake', ['Baja, add milk to the grocery list.']),
    ('quiet', ['Can you pass the butter please?', 1.0, 'I think we should go to the park tomorrow.']),
    ('quiet', ['Bob had a really long day at work.', 0.8, 'Hey, did you finish your homework?']),
    ('quiet', ['The Bahamas trip was fun.', 1.0, 'Grandma is coming over for dinner on Saturday.']),
    ('quiet', ['Roger that, I will be there at five.', 1.0, 'Hi, how was school today?']),
    ('quiet', ['Papa, can I have a snack?', 1.0, 'Ha ha, that is so funny.']),
]

which = 'baja_listen'
if len(sys.argv) > 2: CASES = [c for c in CASES if sys.argv[2] in ' '.join(x if isinstance(x, str) else (x[0] if isinstance(x, tuple) else '') for x in c[1])]
listener = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'baja_listen.py')
good = 0
for want, parts in CASES:
    got = run(listener, parts)
    woke = len(got) > 0
    ok = woke == (want == 'wake')
    good += ok
    print('%s %-5s %-60s -> %s' % ('ok  ' if ok else 'MISS', want, ' / '.join((p if isinstance(p, str) else p[0] + ' [' + p[1] + ']') for p in parts if not isinstance(p, float))[:60], got))
print("%d of %d right" % (good, len(CASES)))
sys.exit(0 if good == len(CASES) else 1)
