"""
Generate the app icons for the phone's home screen.

Drawn rather than drawn-by-hand so the set can never drift out of sync: one
mark, rendered at every size iOS and Android ask for, from the same three
brand colours the rest of the app uses.

    python3 setup/make-icons.py

The mark is a teal disc with a coral one eclipsing it — legible at 32px on a
home screen, which rules out anything with text in it.
"""
import pathlib

from PIL import Image, ImageDraw

BLACK = (0, 0, 0, 255)
TEAL = (0, 245, 212, 255)
CORAL = (255, 92, 114, 255)

OUT = pathlib.Path(__file__).resolve().parent.parent / "electron" / "icons"

# Rendered large and downsampled: circles drawn directly at 32px are visibly
# jagged, and every phone shows this at small sizes.
SUPERSAMPLE = 8


def draw_mark(size, safe=1.0):
    """
    One icon. `safe` shrinks the mark inside the canvas — Android's maskable
    icons get cropped to whatever shape the launcher feels like, and anything
    outside the middle 80% can be cut off.
    """
    s = size * SUPERSAMPLE
    img = Image.new("RGBA", (s, s), BLACK)
    d = ImageDraw.Draw(img)

    # Teal disc, slightly up and left of centre so the coral has somewhere to go.
    r = s * 0.30 * safe
    cx, cy = s * 0.455, s * 0.455
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=TEAL)

    # Coral disc eclipsing the lower right.
    r2 = s * 0.175 * safe
    cx2, cy2 = s * 0.635, s * 0.635
    d.ellipse([cx2 - r2, cy2 - r2, cx2 + r2, cy2 + r2], fill=CORAL)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    made = []

    # Android / web app manifest.
    for size in (192, 512):
        p = OUT / f"icon-{size}.png"
        draw_mark(size).save(p)
        made.append(p)

    # Maskable: same mark, pulled inside the safe zone so a launcher that
    # crops it to a circle or a squircle doesn't clip the coral off.
    for size in (192, 512):
        p = OUT / f"icon-maskable-{size}.png"
        draw_mark(size, safe=0.72).save(p)
        made.append(p)

    # iOS home screen. 180 is the one that matters on current hardware; the
    # smaller two are for older iPads that still ask for them by name.
    for size in (120, 152, 167, 180):
        p = OUT / f"apple-touch-icon-{size}.png"
        draw_mark(size).save(p)
        made.append(p)

    # Browser tab.
    for size in (32, 16):
        p = OUT / f"favicon-{size}.png"
        draw_mark(size).save(p)
        made.append(p)

    for p in made:
        print(f"  {p.name:28s} {p.stat().st_size:>7,d} bytes")
    print(f"\n{len(made)} icons written to {OUT}")


if __name__ == "__main__":
    main()
