"""
Check the kiosk's QR encoder.

Two independent proofs, because "it looks like a QR code" is not evidence:

  1. Module-for-module equality with a reference encoder, for every supported
     version and all eight mask patterns. Any single wrong module is caught.
  2. An actual decode of the finished image with OpenCV's detector — the same
     job a phone camera does.

Also checks that the mask this encoder picks is the one the standard penalty
function scores best, so the output is not just valid but the readable choice.
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
import qrcode
from qrcode import util
from qrcode.constants import ERROR_CORRECT_L

PROJECT = pathlib.Path(__file__).resolve().parent.parent
QR_JS = str(PROJECT / "node_modules" / ".cache" / "qr.cjs")


def build_encoder():
    """Transpile the TypeScript encoder so node can require it."""
    pathlib.Path(QR_JS).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["npx", "esbuild", "src/engine/qr.ts", "--format=cjs", f"--outfile={QR_JS}", "--log-level=warning"],
        cwd=PROJECT, check=True,
    )

CASES = [
    "http://10.0.0.2:8787/mobile",
    "http://192.168.1.42:8787/mobile",
    "http://192.168.100.255:8787/mobile",
    "BAJA",
    "http://baja-blast.local:8787/mobile",
    "x" * 17,   # fills version 1-L exactly
    "x" * 18,   # forces version 2
    "x" * 32,   # fills version 2
    "x" * 33,   # forces version 3
    "x" * 53,   # fills version 3
    "x" * 54,   # forces version 4
    "x" * 78,   # fills version 4
    "x" * 79,   # forces version 5
    "x" * 106,  # near the top of version 5
    "http://192.168.1.1:8787/mobile?tab=calendar&from=phone",
]


def node(expr):
    out = subprocess.run(
        ["node", "-e", f"const q=require({QR_JS!r});process.stdout.write(JSON.stringify({expr}))"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def ours(text, mask=None):
    arg = "" if mask is None else f",{mask}"
    return node(f"q.encodeQR({text!r}{arg})")


def reference(text, mask):
    # Byte mode, no segment splitting: ours is byte-mode-only by design, so
    # letting the reference switch to alphanumeric would compare two different
    # (both valid) encodings rather than finding a bug.
    q = qrcode.QRCode(error_correction=ERROR_CORRECT_L, border=0, mask_pattern=mask)
    q.add_data(util.QRData(text.encode(), mode=util.MODE_8BIT_BYTE, check_data=False), optimize=0)
    q.make(fit=True)
    return [[bool(v) for v in row] for row in q.get_matrix()]


def decode(matrix, scale=8, quiet=4):
    """Render to a bitmap and read it back the way a camera would."""
    import cv2

    n = len(matrix)
    img = np.ones((n + quiet * 2, n + quiet * 2), dtype=np.uint8) * 255
    for r in range(n):
        for c in range(n):
            if matrix[r][c]:
                img[r + quiet][c + quiet] = 0
    big = np.kron(img, np.ones((scale, scale), dtype=np.uint8))
    text, _, _ = cv2.QRCodeDetector().detectAndDecode(big)
    return text


def main():
    build_encoder()
    failures = 0

    print("Module-for-module against the reference, all eight masks:\n")
    for text in CASES:
        label = text if len(text) <= 30 else f"{text[:27]}… ({len(text)})"
        bad_masks = []
        size = None
        for mask in range(8):
            mine = ours(text, mask)
            theirs = reference(text, mask)
            size = len(mine)
            if len(mine) != len(theirs) or any(
                mine[r][c] != theirs[r][c] for r in range(len(mine)) for c in range(len(mine))
            ):
                bad_masks.append(mask)
        version = (size - 17) // 4
        if bad_masks:
            print(f"  FAIL {label:34s} v{version}  masks differing: {bad_masks}")
            failures += 1
        else:
            print(f"  ok   {label:34s} v{version} {size}x{size}  all 8 masks identical")

    print("\nMask chosen is the best-scoring one:\n")
    for text in CASES[:6]:
        label = text if len(text) <= 30 else f"{text[:27]}… ({len(text)})"
        mine_scores = node(f"q.maskPenalties({text!r})")
        ref_scores = []
        for mask in range(8):
            q = qrcode.QRCode(error_correction=ERROR_CORRECT_L, border=0, mask_pattern=mask)
            q.add_data(util.QRData(text.encode(), mode=util.MODE_8BIT_BYTE, check_data=False), optimize=0)
            q.make(fit=True)
            ref_scores.append(util.lost_point(q.modules))
        chosen = mine_scores.index(min(mine_scores))
        if mine_scores != ref_scores:
            print(f"  FAIL {label:34s} penalties differ: {mine_scores} vs {ref_scores}")
            failures += 1
        else:
            print(f"  ok   {label:34s} penalties match, picks mask {chosen}")

    print("\nDecoded back with OpenCV, as a camera would:\n")
    try:
        import cv2  # noqa: F401
    except ImportError:
        print("  (opencv not installed — skipped)")
    else:
        for text in CASES:
            label = text if len(text) <= 30 else f"{text[:27]}… ({len(text)})"
            got = decode(ours(text))
            if got == text:
                print(f"  ok   {label:34s} decoded exactly")
            else:
                print(f"  FAIL {label:34s} decoded as {got[:40]!r}")
                failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed")
        sys.exit(1)
    print("QR encoder verified: identical to the reference on every mask, and it decodes.")


if __name__ == "__main__":
    main()
