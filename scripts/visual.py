"""Visual regression (FE-S2-06).

Compares the deterministic screenshots written by capture.py (01–14, r1–r4, fresh seed, fixed "today")
against committed baselines in tests/visual/baseline/.

  SHOT_DIR=/tmp/shots python3 capture.py && SHOT_DIR=/tmp/shots python3 visual.py
  SHOT_DIR=/tmp/shots python3 visual.py --update      # accept the current screens as the new baseline

A screen fails when more than MAX_PIXELS pixels differ by more than CHANNEL_TOL in any channel
(fonts are self-hosted and Chromium is pinned via scripts/requirements.txt, so identical builds diff at 0 %; the
per-channel tolerance only absorbs sub-pixel anti-aliasing). Diff images go to <SHOT_DIR>/diff/.
"""
import os, shutil, sys
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "tests" / "visual" / "baseline"
SHOTS = Path(os.environ.get("SHOT_DIR", "/home/user/RBS_VAT_Frontend_Plan/screenshots"))
CHANNEL_TOL = 40      # 0–255 per channel
MAX_PIXELS = 20       # absolute cap: one changed 12 px glyph is ~40–80 px, so any content change fails
NAMES = [f"{n:02d}_" for n in range(1, 15)] + [f"v{n}_" for n in range(1, 7)] + [f"r{n}_" for n in range(1, 5)]  # + R2 screens  # + dark, mobile, bn (Sprint 3)


def current() -> list[Path]:
    return sorted(p for p in SHOTS.glob("*.png") if any(p.name.startswith(n) for n in NAMES))


def compare(a: Path, b: Path, diff_dir: Path) -> tuple[bool, str]:
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if ia.size != ib.size:
        return False, f"size {ib.size} → {ia.size}"
    # per-pixel max channel difference, thresholded to a 0/255 mask
    r, g, bl = ImageChops.difference(ia, ib).split()
    mask = ImageChops.lighter(ImageChops.lighter(r, g), bl).point(lambda v: 255 if v > CHANNEL_TOL else 0)
    changed = mask.histogram()[255]
    ratio = changed / (ia.width * ia.height)
    ok = changed <= MAX_PIXELS
    if not ok:  # baseline with changed pixels painted magenta
        diff_dir.mkdir(parents=True, exist_ok=True)
        overlay = ib.copy()
        overlay.paste((255, 0, 80), mask=mask)
        overlay.save(diff_dir / a.name)
    return ok, f"{changed} px changed ({ratio:.3%})"


def main() -> None:
    shots = current()
    if not shots:
        sys.exit(f"no screenshots in {SHOTS} — run capture.py first")
    if "--update" in sys.argv:
        BASELINE.mkdir(parents=True, exist_ok=True)
        for p in shots:
            shutil.copy2(p, BASELINE / p.name)
        print(f"baseline updated: {len(shots)} screens → {BASELINE.relative_to(ROOT)}")
        return
    failed = []
    for p in shots:
        base = BASELINE / p.name
        if not base.exists():
            print(f"NEW  {p.name} (no baseline — run with --update)"); failed.append(p.name); continue
        ok, msg = compare(p, base, SHOTS / "diff")
        print(f"{'PASS' if ok else 'FAIL'} {p.name}: {msg}")
        if not ok:
            failed.append(p.name)
    if failed:
        sys.exit(f"visual regression: {len(failed)} screen(s) differ — see {SHOTS / 'diff'}")
    print(f"visual: {len(shots)} screens match baseline")


if __name__ == "__main__":
    main()
