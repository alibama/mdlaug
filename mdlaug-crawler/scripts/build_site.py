"""Copy the latest Vendor Signals report and its data into the GitHub Pages site.

Usage:  python scripts/build_site.py [--from data/significance] [--out ../docs]

The site lives in the repository's top-level docs/ folder (GitHub Pages serves it). This
writes docs/signals/index.html (the report as a standalone page) and docs/signals/data/
(the CSV and JSON files behind it). docs/index.html, the landing page, is written by hand.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
DATA_FILES = ["tests.csv", "platform_labels.csv", "manual_review_candidates.csv", "results.json"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", default=str(HERE / "data" / "significance"))
    default_out = HERE.parent / "docs" if (HERE.parent / ".git").exists() else HERE / "site"
    ap.add_argument("--out", default=str(default_out))
    a = ap.parse_args()
    src, out = Path(a.src), Path(a.out)
    if not (src / "results.json").exists():
        sys.exit(f"No results in {src}. Make the report first (report command).")
    sig = out / "signals"
    (sig / "data").mkdir(parents=True, exist_ok=True)
    (out / ".nojekyll").touch()                  # serve files as they are; no Jekyll processing
    subprocess.check_call([sys.executable, str(HERE / "scripts" / "significance_report.py"),
                           "--dir", str(src), "--out", str(sig / "index.html")])
    copied = []
    for f in DATA_FILES + sorted(p.name for p in src.glob("site_metrics_run*.csv")):
        if (src / f).exists():
            shutil.copy2(src / f, sig / "data" / f)
            copied.append(f)
    print(f"site updated: {sig / 'index.html'} and {len(copied)} data files in {sig / 'data'}")


if __name__ == "__main__":
    main()
