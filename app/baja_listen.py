"""
Baja's ears: the microphone, listened to on this machine.

Started by app/voice.cjs with the Vosk model folder and the command that
records from the microphone. Reads 16 kHz mono audio from that command and
prints one JSON object per line on stdout:

  {"type": "ready"}                      listening
  {"type": "wake"}                       "Baja" on its own — a question follows
  {"type": "listening"}                  told to listen (someone tapped Baja)
  {"type": "partial", "text": "..."}     the question so far, while it's asked
  {"type": "heard", "text": "..."}       a question or command for Baja
  {"type": "timeout"}                    woken, but nothing followed
  {"type": "utterance", "text": "..."}   anything at all it heard (for Settings)
  {"type": "error", "error": "..."}

and takes one word per line on stdin: listen, mute, unmute.

Why two recognisers. "Baja" is a name, not an English word, and an ordinary
recogniser hears it as "badger", "roger", "larger" or "the job" depending on
who says it. A second recogniser that knows only a handful of words — Baja
and the things it's usually misheard as — reliably picks it out, and is told
to treat everything else as noise. It's only a wake word when it comes first,
after a pause: "pass the butter" can come out as "[noise] badger", but with no
gap between them — nobody runs "Baja" on from the end of another sentence.
"""

import json
import os
import subprocess
import sys
import threading
import time

from vosk import KaldiRecognizer, Model, SetLogLevel

RATE = 16000
CHUNK = 3200  # 0.1 s of 16-bit mono
WAKE = ["baja", "badger", "bajar", "baba", "bahama"]
# How the ordinary recogniser spells the wake word, so it can be trimmed off
# the front of a question.
WAKE_SPELLINGS = set(WAKE) | {"roger", "larger", "ledger", "bodger", "bah", "ba"}
QUESTION_SECONDS = 8
# Silence needed before "Baja" for it to count as being spoken to.
PAUSE = 0.5


def out(**msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def strip_wake(words):
    while words and words[0] in WAKE_SPELLINGS:
        words = words[1:]
    return words


def main():
    model_dir, recorder = sys.argv[1], json.loads(sys.argv[2])
    SetLogLevel(-1)
    model = Model(model_dir)

    state = {"muted": False, "question_until": 0.0, "reset": False}
    lock = threading.Lock()

    def read_commands():
        for line in sys.stdin:
            word = line.strip()
            with lock:
                if word == "listen":
                    state["question_until"] = time.time() + QUESTION_SECONDS
                    out(type="listening")
                elif word == "mute":
                    state["muted"] = True
                elif word == "unmute":
                    # Whatever was heard while Baja was talking is Baja's own
                    # voice; start afresh rather than answer itself.
                    state["muted"] = False
                    state["reset"] = True
        # The server went away; so do we.
        os._exit(0)

    threading.Thread(target=read_commands, daemon=True).start()

    try:
        mic = subprocess.Popen(recorder, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as err:
        out(type="error", error="couldn't start the recorder: %s" % err)
        sys.exit(2)

    def fresh():
        free = KaldiRecognizer(model, RATE)
        free.SetWords(True)
        wake = KaldiRecognizer(model, RATE, json.dumps(WAKE + ["[unk]"]))
        wake.SetWords(True)
        return free, wake

    free, wake = fresh()
    finals = []  # recent utterances from the free recogniser: (start, end, [words])
    pending = None  # a wake word waiting for the rest of its sentence
    last_partial = ""
    last_end = -PAUSE  # when the last word heard (by the wake recogniser) ended
    announced = False

    while True:
        data = mic.stdout.read(CHUNK)
        if not data:
            err = mic.stderr.read().decode("utf-8", "replace").strip()
            out(type="error", error=err.splitlines()[-1] if err else "the microphone stopped")
            sys.exit(2)
        if not announced:
            announced = True
            out(type="ready")

        with lock:
            muted = state["muted"]
            if state["reset"]:
                state["reset"] = False
                free, wake = fresh()
                finals, pending, last_partial, last_end = [], None, "", -PAUSE
            question_until = state["question_until"]
        if muted:
            continue

        now = time.time()

        # The ordinary recogniser: every word, with timings.
        if free.AcceptWaveform(data):
            res = json.loads(free.Result())
            words = res.get("result") or []
            if words:
                finals.append((words[0]["start"], words[-1]["end"], words))
                finals = finals[-6:]
                text = " ".join(w["word"] for w in words)
                out(type="utterance", text=text)
                if pending is None and question_until > now:
                    asked = strip_wake([w["word"] for w in words])
                    if asked:
                        with lock:
                            state["question_until"] = 0.0
                        out(type="heard", text=" ".join(asked))
            last_partial = ""
        elif question_until > now:
            partial = " ".join(strip_wake(json.loads(free.PartialResult()).get("partial", "").split()))
            if partial and partial != last_partial:
                last_partial = partial
                out(type="partial", text=partial)

        # The wake-word recogniser.
        if wake.AcceptWaveform(data):
            words = (json.loads(wake.Result()).get("result")) or []
            for w in words:
                # After a pause — not the tail of someone's sentence, and not
                # the rest of a question that's still being asked ("weather"
                # straight after "Baja" can sound like a second "baba").
                if pending is None and w["word"] in WAKE and w["start"] - last_end >= PAUSE:
                    pending = {"start": w["start"], "end": w["end"], "at": now}
                last_end = w["end"]

        # A wake word, matched up with what the ordinary recogniser heard
        # around it. The two finish an utterance at slightly different moments,
        # so this waits for the ordinary one to catch up (briefly).
        if pending is not None:
            match = next((f for f in finals if f[1] >= pending["end"] - 0.05 and f[0] <= pending["end"] + 0.3), None)
            if match is not None or now - pending["at"] > 3:
                rest = []
                if match is not None:
                    rest = [w["word"] for w in match[2] if w["start"] >= pending["end"] - 0.05]
                    finals = [f for f in finals if f[0] > match[1]]
                rest = strip_wake(rest)
                pending = None
                if rest:
                    out(type="heard", text=" ".join(rest))
                else:
                    with lock:
                        state["question_until"] = now + QUESTION_SECONDS
                    out(type="wake")

        if question_until and 0 < question_until <= now and pending is None:
            with lock:
                if state["question_until"] == question_until:
                    state["question_until"] = 0.0
                    out(type="timeout")


if __name__ == "__main__":
    main()
