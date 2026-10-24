"""
Baja's voice: a natural-sounding one, made on this machine with Piper.

Started once by app/voice.cjs and kept running, because loading the voice
takes a second or two and answering shouldn't. Reads one JSON request per line
on stdin — {"id": 1, "text": "...", "out": "/path/to/answer.wav"} — writes the
WAV file and replies {"id": 1, "ok": true} on stdout.

Piper's Python interface changed between versions (1.2 wrote straight into a
wave file; 1.3 calls that synthesize_wav), so both are handled.

Two optional fields shape the voice: "length" (above 1 speaks slower) and
"pitch" (below 1 is deeper — the Warrior voice is a gruff voice taken down
about 15%). Pitch is changed by stretching the finished recording, which
also slows it the same amount; for a deep, heavy voice that's the point.
"radio": true makes it sound like it's coming through a helmet radio — the
Spartan voice.
"""

import json
import sys
import wave


def synthesize(voice, text, wav, length):
    """Piper 1.3 takes a SynthesisConfig; 1.2 took keyword arguments."""
    if hasattr(voice, "synthesize_wav"):
        try:
            from piper import SynthesisConfig
            voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=length))
        except (ImportError, TypeError):
            voice.synthesize_wav(text, wav)
    else:
        try:
            voice.synthesize(text, wav, length_scale=length)
        except TypeError:
            voice.synthesize(text, wav)


def helmet_radio(path):
    """A voice heard over a helmet radio: thin at both ends, a little pressed."""
    import numpy as np

    with wave.open(path, "rb") as w:
        params = w.getparams()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if params.nchannels != 1 or not len(x):
        return
    rate = params.framerate

    def one_pole(signal, cutoff, high):
        a = np.exp(-2.0 * np.pi * cutoff / rate)
        out = np.empty_like(signal)
        prev = 0.0
        for i, v in enumerate(signal):  # short sentences; fast enough on a Pi
            prev = (1 - a) * v + a * prev
            out[i] = prev
        return signal - out if high else out

    y = one_pole(x, 280.0, high=True)  # no boom
    y = one_pole(y, 3200.0, high=False)  # no air
    y = np.tanh(y * 2.2) / np.tanh(2.2)  # a little pressed, like a small speaker
    y *= 0.9 / max(1e-6, float(np.max(np.abs(y))))
    with wave.open(path, "wb") as w:
        w.setparams(params)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


def lower_pitch(path, factor):
    """Deepen a WAV by `factor` (0.85 = 15% lower), in place."""
    import numpy as np

    with wave.open(path, "rb") as w:
        params = w.getparams()
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    if params.nchannels != 1 or not len(samples):
        return
    # Played back at the same rate, a recording stretched by 1/factor sounds
    # lower by factor (and slower by the same).
    n = int(len(samples) / factor)
    stretched = np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples)
    with wave.open(path, "wb") as w:
        w.setparams(params)
        w.writeframes(np.clip(stretched, -32768, 32767).astype(np.int16).tobytes())


def main():
    try:
        from piper import PiperVoice
    except ImportError:
        from piper.voice import PiperVoice
    voice = PiperVoice.load(sys.argv[1])
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        try:
            with wave.open(req["out"], "wb") as wav:
                synthesize(voice, req["text"], wav, float(req.get("length") or 1.0))
            pitch = float(req.get("pitch") or 1.0)
            if 0.5 <= pitch < 0.99:
                lower_pitch(req["out"], pitch)
            if req.get("radio"):
                helmet_radio(req["out"])
            reply = {"id": req.get("id"), "ok": True}
        except Exception as err:  # one bad sentence mustn't silence Baja for good
            reply = {"id": req.get("id"), "ok": False, "error": str(err)}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
