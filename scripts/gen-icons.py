#!/usr/bin/env python3
"""Generate raster app icons from the MSP Beacon brand mark.

Draws a gradient-filled bookmark (brand green #1D9E75 -> #0F6E56) on a dark
tile, matching public/favicon.svg, and writes the PNG/ICO assets used for
legacy favicons and home-screen (PWA / apple-touch) icons.

Run once after changing the brand mark:  python scripts/gen-icons.py
Requires Pillow (already used elsewhere in the toolchain).
"""
import os
from PIL import Image, ImageDraw

PUBLIC = os.path.join(os.path.dirname(__file__), "..", "public")

BG = (13, 17, 23)          # #0d1117
BORDER = (48, 54, 61)      # #30363d
G_TOP = (29, 158, 117)     # #1D9E75
G_BOT = (15, 110, 86)      # #0F6E56

SS = 4  # supersample factor for crisp downscaling


def _gradient(size):
    """Vertical brand gradient as an RGBA image."""
    g = Image.new("RGBA", (size, size))
    px = g.load()
    for y in range(size):
        t = y / max(1, size - 1)
        r = round(G_TOP[0] + (G_BOT[0] - G_TOP[0]) * t)
        gr = round(G_TOP[1] + (G_BOT[1] - G_TOP[1]) * t)
        b = round(G_TOP[2] + (G_BOT[2] - G_TOP[2]) * t)
        for x in range(size):
            px[x, y] = (r, gr, b, 255)
    return g


def _bookmark_mask(size):
    """White (filled) bookmark glyph on a transparent mask."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    bw = round(size * 0.46)
    bh = round(size * 0.60)
    left = (size - bw) // 2
    right = left + bw
    top = (size - bh) // 2
    bottom = top + bh
    radius = round(bw * 0.18)
    notch = round(bh * 0.16)
    d.rounded_rectangle([left, top, right, bottom], radius=radius, fill=255)
    # Carve the V-notch out of the bottom edge.
    d.polygon([(left, bottom), (size // 2, bottom - notch), (right, bottom)], fill=0)
    return m


def _tile(size, rounded):
    """Dark background tile, optionally rounded with a border (favicon look)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        r = round(size * 0.22)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)
        d.rounded_rectangle([1, 1, size - 2, size - 2], radius=r - 1,
                            outline=BORDER, width=max(1, size // 32))
    else:
        d.rectangle([0, 0, size, size], fill=BG)
    return img


def render(size, rounded):
    s = size * SS
    img = _tile(s, rounded)
    img.alpha_composite(_gradient(s), (0, 0))  # tint full canvas...
    # ...then keep gradient only inside the bookmark mask.
    grad = Image.new("RGBA", (s, s))
    grad.alpha_composite(_gradient(s), (0, 0))
    base = _tile(s, rounded)
    base.paste(grad, (0, 0), _bookmark_mask(s))
    return base.resize((size, size), Image.LANCZOS)


def main():
    out = os.path.normpath(PUBLIC)
    render(180, rounded=False).save(os.path.join(out, "apple-touch-icon.png"))
    render(192, rounded=False).save(os.path.join(out, "icon-192.png"))
    render(512, rounded=False).save(os.path.join(out, "icon-512.png"))
    ico = render(256, rounded=True)
    ico.save(os.path.join(out, "favicon.ico"),
             sizes=[(16, 16), (32, 32), (48, 48)])
    print("Wrote apple-touch-icon.png, icon-192.png, icon-512.png, favicon.ico")


if __name__ == "__main__":
    main()
