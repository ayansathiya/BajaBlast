"""
Baja's voice: a natural-sounding one, made on this machine with Piper.

Started once by app/voice.cjs and kept running, because loading the voice
takes a second or two and answering shouldn't. Reads one JSON request per line
on stdin — {"id": 1, "text": "...", "out": "/path/to/answer.wav"} — writes the
WAV file and replies {"id": 1, "ok": true} on stdout.

Piper's Python interface changed between versions (1.2 wrote straight into a
wave file; 1.3 calls that synthesize_wav), so both are handled.
"""

import json
import sys
import wave


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
                if hasattr(voice, "synthesize_wav"):
                    voice.synthesize_wav(req["text"], wav)
                else:
                    voice.synthesize(req["text"], wav)
            reply = {"id": req.get("id"), "ok": True}
        except Exception as err:  # one bad sentence mustn't silence Baja for good
            reply = {"id": req.get("id"), "ok": False, "error": str(err)}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
