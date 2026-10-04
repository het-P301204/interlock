"""Pack apps/web/public/favicon.ico from the 16/32/48 PNGs rendered by render-assets.ts.

    python scripts/make-ico.py

Each size is embedded from its own hand-rendered PNG (Pillow's append_images),
not downscaled from the largest one, so the 16px glyph keeps its simplified
geometry.
"""
from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "apps" / "web" / "public"


def main() -> None:
    sizes = [16, 32, 48]
    images = [Image.open(PUBLIC / f"favicon-{s}.png").convert("RGBA") for s in sizes]
    largest = images[-1]
    largest.save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[:-1],
    )
    check = Image.open(PUBLIC / "favicon.ico")
    print(f"wrote favicon.ico with sizes {sorted(check.info.get('sizes', []))}")


if __name__ == "__main__":
    main()
