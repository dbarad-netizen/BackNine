#!/usr/bin/env python3
"""
Generate every iOS app-icon size Apple requires from a single source
image, and drop them into the Xcode Assets.xcassets layout Capacitor
expects.

Usage:
    python3 docs/app-store/generate_icons.py

Reads:
    frontend/public/icon-512.png     (source — must be square)

Writes:
    frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/
        AppIcon-*.png                (every required size)
        Contents.json                (the manifest Xcode reads)

Also writes:
    docs/app-store/generated-icons/  (a copy for review before Xcode)

Notes on the source:
    Apple requires the 1024x1024 marketing icon to have NO alpha channel
    and NO rounded corners. This script strips alpha before saving the
    1024. All smaller PNGs preserve alpha (Apple's own iOS device
    renderer applies the corner mask at runtime).

    If your source is only 512x512 (BackNine's current PWA icon), the
    1024 will be upscaled with Lanczos filtering. It'll look acceptable
    but you should generate a native 1024x1024 asset before v1 launch
    for the sharpest possible marketing icon. Any vector source (SVG,
    Figma export) into a 1024 PNG works.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow --break-system-packages", file=sys.stderr)
    sys.exit(1)


# ── Layout ────────────────────────────────────────────────────────────

REPO_ROOT   = Path(__file__).resolve().parents[2]
SOURCE_ICON = REPO_ROOT / "frontend" / "public" / "icon-512.png"
XCODE_DIR   = REPO_ROOT / "frontend" / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
REVIEW_DIR  = REPO_ROOT / "docs" / "app-store" / "generated-icons"


# ── Sizes ─────────────────────────────────────────────────────────────
# Every iOS app-icon slot as of iOS 17. (size_pt, scale, idiom, purpose)
# Filename follows the Capacitor convention `AppIcon-<pt>@<scale>x.png`
# so xcassets picks them up without hand-editing Contents.json.

ICON_SPECS: list[tuple[float, int, str, str]] = [
    # iPhone Notification (iOS 7-17)
    (20, 2, "iphone", "notification"),
    (20, 3, "iphone", "notification"),
    # iPhone Spotlight (iOS 5+)
    (29, 1, "iphone", "settings"),
    (29, 2, "iphone", "settings"),
    (29, 3, "iphone", "settings"),
    # iPhone Spotlight (iOS 7+)
    (40, 2, "iphone", "spotlight"),
    (40, 3, "iphone", "spotlight"),
    # iPhone App icon
    (60, 2, "iphone", "app"),
    (60, 3, "iphone", "app"),
    # iPad Notification
    (20, 1, "ipad", "notification"),
    (20, 2, "ipad", "notification"),
    # iPad Settings
    (29, 1, "ipad", "settings"),
    (29, 2, "ipad", "settings"),
    # iPad Spotlight
    (40, 1, "ipad", "spotlight"),
    (40, 2, "ipad", "spotlight"),
    # iPad App icon
    (76, 2, "ipad", "app"),
    (83.5, 2, "ipad", "app"),  # Pro
    # App Store Marketing (1024×1024) — no alpha, no rounded corners
    (1024, 1, "ios-marketing", "app"),
]


# ── Helpers ───────────────────────────────────────────────────────────

def px(size_pt: float, scale: int) -> int:
    """Points × scale = physical pixels. iOS rounds .5 up."""
    return int(round(size_pt * scale))


def filename(size_pt: float, scale: int) -> str:
    if size_pt == 1024:
        return "AppIcon-1024.png"
    if size_pt == int(size_pt):
        return f"AppIcon-{int(size_pt)}@{scale}x.png"
    # 83.5 case
    return f"AppIcon-{size_pt}@{scale}x.png".replace(".0", "")


def generate_all(source: Image.Image, out_dir: Path) -> list[dict]:
    """Write every icon size to out_dir. Returns the list of manifest
    entries in the shape Apple's Contents.json expects."""
    out_dir.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for size_pt, scale, idiom, _purpose in ICON_SPECS:
        px_size = px(size_pt, scale)
        fname   = filename(size_pt, scale)
        img     = source.resize((px_size, px_size), Image.LANCZOS)
        # 1024 marketing icon requires no alpha — flatten onto solid bg
        if size_pt == 1024 and img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (15, 26, 21))  # #0f1a15 (theme)
            bg.paste(img, mask=img.split()[3])
            img = bg
        img.save(out_dir / fname, format="PNG", optimize=True)
        entries.append({
            "size":     f"{size_pt}x{size_pt}",
            "idiom":    idiom,
            "filename": fname,
            "scale":    f"{scale}x",
        })
        print(f"  wrote {fname}  ({px_size}×{px_size})")
    return entries


def write_contents_json(entries: list[dict], out_dir: Path) -> None:
    manifest = {
        "images": entries,
        "info": {
            "author":  "xcode",
            "version": 1,
        },
    }
    (out_dir / "Contents.json").write_text(json.dumps(manifest, indent=2))
    print(f"  wrote Contents.json  ({len(entries)} entries)")


# ── Main ──────────────────────────────────────────────────────────────

def main() -> int:
    if not SOURCE_ICON.exists():
        print(f"ERROR: source icon not found at {SOURCE_ICON}", file=sys.stderr)
        return 1

    src = Image.open(SOURCE_ICON)
    if src.size[0] != src.size[1]:
        print(f"ERROR: source icon must be square, got {src.size}", file=sys.stderr)
        return 1
    if src.size[0] < 1024:
        print(f"WARNING: source is only {src.size[0]}×{src.size[0]}. "
              f"1024×1024 marketing icon will be upscaled. Consider "
              f"providing a higher-resolution source before v1 launch.",
              file=sys.stderr)

    # Ensure RGBA — small icons preserve alpha
    if src.mode != "RGBA":
        src = src.convert("RGBA")

    # Always write to the review folder so we can eyeball the sizes
    # before touching the Xcode asset catalog. If Xcode dir exists,
    # write there too.
    print(f"Source: {SOURCE_ICON}  ({src.size[0]}×{src.size[0]})")
    print()
    print(f"Writing review copies to {REVIEW_DIR.relative_to(REPO_ROOT)}/...")
    if REVIEW_DIR.exists():
        shutil.rmtree(REVIEW_DIR)
    entries = generate_all(src, REVIEW_DIR)
    write_contents_json(entries, REVIEW_DIR)

    if XCODE_DIR.parent.exists():
        print()
        print(f"Writing Xcode assets to {XCODE_DIR.relative_to(REPO_ROOT)}/...")
        if XCODE_DIR.exists():
            shutil.rmtree(XCODE_DIR)
        entries = generate_all(src, XCODE_DIR)
        write_contents_json(entries, XCODE_DIR)
    else:
        print()
        print(f"NOTE: {XCODE_DIR.parent.relative_to(REPO_ROOT)} not found — "
              f"run `npx cap add ios` first, then re-run this script to "
              f"populate the Xcode asset catalog.")

    print()
    print("Done. Review generated icons in:")
    print(f"  {REVIEW_DIR.relative_to(REPO_ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
