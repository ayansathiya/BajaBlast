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
# Only "Baja", "Hey Baja" and "Hi Baja" wake it.
#
# The wake recogniser knows just these words. It used to know a handful of
# Baja's soundalikes too ("baba", "bahama", "badger"), and a recogniser told
# that the only words in the world are those will hear one of them in almost
# anything — so ordinary kitchen talk kept waking Baja, and it answered
# conversations nobody had with it. Now a wake needs:
#
#   1. the wake recogniser hearing "baja" with confidence, after a pause or
#      straight after "hey"/"hi";
#   2. the ordinary recogniser agreeing that what was said starts with Baja
#      (or "hey/hi" and then Baja) — however it spells it;
#
# and if the ordinary recogniser never agrees, nothing happens.
WAKE = ["baja", "bajar"]
GREETINGS = ["hey", "hi"]
# How the ordinary (English) recogniser spells "Baja": it isn't an English
# word, so it comes out as one of these.
# Some accents make it two words ("the her" in Australian English).
WAKE_SPELLINGS = {"baja", "bajar", "badger", "roger", "larger", "ledger", "bodger", "bah", "ba", "baha", "bahar", "baca", "bajo", "better", "bother"}
WAKE_PAIRS = {("the", "her"), ("the", "ha"), ("the", "job"), ("by", "her"), ("but", "ha")}
GREETING_SPELLINGS = {"hey", "hi", "hay", "high", "a", "ah", "okay", "ok"}
# The wake recogniser's confidence below which "baja" is taken to be noise.
MIN_CONF = 0.6
# How long to wait for the ordinary recogniser to confirm. It only finishes
# an utterance when the speaker stops, so this has to cover a whole
# question ("Baja, add milk and eggs to the grocery list") — too short and
# long questions were dropped. Waiting never wakes anything by itself.
CONFIRM_SECONDS = 8
QUESTION_SECONDS = 8
# Silence needed before "Baja" for it to count as being spoken to.
PAUSE = 0.5


def out(**msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def wake_length(words):
    """How many words at the front are "Baja" — 0 if it doesn't start with it."""
    if words and words[0] in WAKE_SPELLINGS:
        return 1
    if len(words) > 1 and (words[0], words[1]) in WAKE_PAIRS:
        return 2
    return 0


def strip_wake(words):
    """The question without "hey Baja" on the front of it."""
    if len(words) > 1 and words[0] in GREETING_SPELLINGS and wake_length(words[1:]):
        words = words[1:]
    while wake_length(words):
        words = words[wake_length(words):]
    return words


def starts_with_wake(words):
    """Does this utterance open with Baja, or hey/hi and then Baja?"""
    if wake_length(words):
        return True
    return len(words) > 1 and words[0] in GREETING_SPELLINGS and wake_length(words[1:]) > 0


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
        wake = KaldiRecognizer(model, RATE, json.dumps(WAKE + GREETINGS + ["[unk]"]))
        wake.SetWords(True)
        return free, wake

    free, wake = fresh()
    finals = []  # recent utterances from the free recogniser: (start, end, [words])
    pending = None  # a wake word waiting for the rest of its sentence
    last_partial = ""
    last_end = -PAUSE  # when the last word heard (by the wake recogniser) ended
    greeted = None  # end time of a "hey"/"hi" that itself came after a pause
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
                finals, pending, last_partial, last_end, greeted = [], None, "", -PAUSE, None
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
                after_pause = w["start"] - last_end >= PAUSE
                if w["word"] in GREETINGS:
                    greeted = w["end"] if after_pause else None
                elif (
                    pending is None
                    and w["word"] in WAKE
                    and w.get("conf", 1.0) >= MIN_CONF
                    # After a pause — not the tail of someone's sentence — or
                    # straight after a "hey"/"hi" that was itself after one.
                    and (after_pause or (greeted is not None and w["start"] - greeted < 0.6))
                ):
                    pending = {"start": w["start"], "end": w["end"], "at": now}
                    greeted = None
                else:
                    greeted = None
                last_end = w["end"]

        # A wake word, matched up with what the ordinary recogniser heard
        # around it. The two finish an utterance at slightly different moments,
        # so this waits for the ordinary one to catch up (briefly).
        if pending is not None:
            match = next((f for f in finals if f[1] >= pending["end"] - 0.05 and f[0] <= pending["end"] + 0.3), None)
            if match is not None:
                finals = [f for f in finals if f[0] > match[1]]
                # The ordinary recogniser has to agree: what was said starts
                # with Baja (or hey/hi Baja), at the moment the wake word was
                # heard. Otherwise it was just someone talking.
                spoken = [w for w in match[2] if w["end"] >= pending["start"] - 0.8]
                said = [w["word"] for w in spoken]
                if starts_with_wake(said):
                    rest = strip_wake(said)
                    if rest:
                        out(type="heard", text=" ".join(rest))
                    else:
                        with lock:
                            state["question_until"] = now + QUESTION_SECONDS
                        out(type="wake")
                pending = None
            elif now - pending["at"] > CONFIRM_SECONDS:
                # Never confirmed: not a wake. (It used to wake anyway.)
                pending = None

        if question_until and 0 < question_until <= now and pending is None:
            with lock:
                if state["question_until"] == question_until:
                    state["question_until"] = 0.0
                    out(type="timeout")


if __name__ == "__main__":
    main()
