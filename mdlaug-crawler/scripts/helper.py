"""Everyday commands for the mDLAUG crawler, the same on Mac, Windows and Linux.

You normally reach this through `bash mdlaug.sh <command>` (Mac/Linux) or
`.\\mdlaug <command>` (Windows), which first make sure Python and the libraries are
installed. Run `help` for the list of commands.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]          # the mdlaug-crawler folder
os.chdir(HERE)
os.environ.setdefault("PYTHONUTF8", "1")          # crawls and the app inherit UTF-8 output on every OS
PY = sys.executable
DB = HERE / "data" / "mdlaug_crawl.db"
SAMPLE = HERE / "sample" / "DLs_for_mDLAUG_Assessment.xlsx"
RELEASE = "https://github.com/alibama/mdlaug/releases/download/data-2026-10/"
DATA_ZIP, SHOTS_ZIP = "mdlaug-october-2026-database.zip", "mdlaug-october-2026-home-screenshots.zip"
MODELS = ["qwen3.5:4b", "gemma3:4b"]               # text judgments, screenshot check
WIN = os.name == "nt"
CMD = ".\\mdlaug" if WIN else "bash mdlaug.sh"

HELP = f"""
mDLAUG crawler — commands

  {CMD} setup        install everything (run once; safe to run again)
  {CMD} app          open the app in your browser (stop it with Ctrl+C)
  {CMD} get-data     download the October 2026 results to explore in the app
  {CMD} trial        crawl 3 sites as a quick test (about 5 minutes)
  {CMD} crawl        crawl every site in the site list (takes hours)
  {CMD} report       make the Vendor Signals report and open it
  {CMD} doctor       check that everything is installed and working
  {CMD} test         run the automated tests

Add --help after crawl to see its options, e.g. {CMD} crawl --help
Step-by-step guide: TRAINING.md
"""


def say(msg):
    print(f"\n== {msg}", flush=True)


def run(args, **kw):
    print("   $ " + " ".join(str(a) for a in args), flush=True)
    return subprocess.call([str(a) for a in args], **kw)


def site_count():
    if not DB.exists():
        return 0
    try:
        return sqlite3.connect(DB).execute("SELECT COUNT(*) FROM sites").fetchone()[0]
    except sqlite3.Error:
        return 0


def ollama_models():
    """Installed Ollama models, or None if Ollama isn't running."""
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as r:
            return [m["name"] for m in json.load(r).get("models", [])]
    except Exception:
        return None


def ollama_advice():
    models = ollama_models()
    if models is None:
        print("   Optional: the crawler can use free local AI models to judge things like alt text.\n"
              "   Install Ollama from https://ollama.com, open it, then run:\n"
              + "".join(f"      ollama pull {m}\n" for m in MODELS) +
              "   Without it everything still works; those judgments just go to the review queue.")
    else:
        missing = [m for m in MODELS if m not in models]
        print("   Ollama is running." + (" To add the recommended models:\n" + "".join(
            f"      ollama pull {m}\n" for m in missing) if missing else " Recommended models are installed."))


def cmd_setup(_):
    say("Installing the browser the crawler drives (Chromium, about 150 MB, only once)")
    extra = ["--with-deps"] if sys.platform.startswith("linux") else []
    if run([PY, "-m", "playwright", "install", "chromium", *extra]) != 0:
        sys.exit("Couldn't install Chromium. Check your internet connection and run setup again.")
    (HERE / "data").mkdir(exist_ok=True)
    if site_count() == 0:
        say("Loading the list of digital-library sites")
        run([PY, "-m", "mdlaug_crawl", "import", SAMPLE])
    else:
        say(f"Site list already loaded ({site_count()} sites)")
    say("Local AI models")
    ollama_advice()
    say("Setup finished")
    print(f"   Next: {CMD} get-data   (download the October results), then {CMD} app")


def cmd_app(args):
    port = "8501"
    url = f"http://localhost:{port}"
    say(f"Starting the app at {url} — your browser should open. Press Ctrl+C here to stop it.")
    threading.Timer(4, lambda: webbrowser.open(url)).start()
    try:
        run([PY, "-m", "streamlit", "run", "app.py", "--server.headless", "true", "--server.port", port,
             "--browser.gatherUsageStats", "false", *args])
    except KeyboardInterrupt:
        pass


def download(name, dest):
    url = RELEASE + name
    say(f"Downloading {name}")
    print(f"   from {url}")
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as fh:
        total, done, last = int(r.headers.get("Content-Length") or 0), 0, 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            if total and (done - last > total / 20 or done == total):
                print(f"   {done / 1e6:.0f} of {total / 1e6:.0f} MB", flush=True)
                last = done
    tmp.replace(dest)
    return dest


def has_october_data():
    try:
        return bool(sqlite3.connect(DB).execute(
            "SELECT 1 FROM runs WHERE note LIKE 'full re-run: overlay pass v2%'").fetchone())
    except sqlite3.Error:
        return False


def cmd_get_data(args):
    (HERE / "data").mkdir(exist_ok=True)
    if DB.exists() and has_october_data():
        say("The October 2026 database is already installed")
    else:
        if DB.exists():
            backup = DB.with_name(f"mdlaug_crawl.backup-{time.strftime('%Y%m%d-%H%M%S')}.db")
            shutil.move(DB, backup)
            print(f"   Your previous database was kept as data/{backup.name}")
        z = download(DATA_ZIP, HERE / "data" / DATA_ZIP)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(HERE / "data")
        z.unlink()
    if "--screenshots" in args:
        z = download(SHOTS_ZIP, HERE / "data" / SHOTS_ZIP)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(HERE)
        z.unlink()
    say("October 2026 results are ready")
    if "--screenshots" not in args and not any((HERE / "data" / "artifacts").glob("r4_*")):
        print("   Screenshots aren't included (they're large). To add the home-page screenshots:\n"
              f"      {CMD} get-data --screenshots")
    print(f"   Next: {CMD} app")


def trial_sites():
    """One site each from three platforms, so a short test shows variety."""
    con = sqlite3.connect(DB)
    ids = []
    for plat in ("CONTENTdm", "DSpace", "Omeka"):
        r = con.execute("SELECT id FROM sites WHERE platform=? AND COALESCE(active,1)=1 ORDER BY id LIMIT 1",
                        (plat,)).fetchone()
        if r:
            ids += ["--site-id", str(r[0])]
    return ids


def cmd_trial(args):
    if site_count() == 0:
        sys.exit(f"No sites loaded yet. Run: {CMD} setup")
    say("Crawling 3 sites as a test. Progress appears below; it takes about 5 minutes.")
    rc = run([PY, "-m", "mdlaug_crawl", "run", *trial_sites(), "--note", "trial", *args])
    if rc == 0:
        print(f"\n   Done. Open the app ({CMD} app) and pick this run in the sidebar.")
    sys.exit(rc)


def cmd_crawl(args):
    if site_count() == 0:
        sys.exit(f"No sites loaded yet. Run: {CMD} setup")
    if "--help" not in args:
        say("Crawling every site that is switched on in the site list. This takes several hours;\n"
            "   keep the computer awake and plugged in. Ctrl+C stops it (finished sites are kept).")
    sys.exit(run([PY, "-m", "mdlaug_crawl", "run", *args]))


def cmd_report(args):
    if not DB.exists():
        sys.exit(f"No results yet. Run {CMD} get-data or {CMD} trial first.")
    say("Running the statistics (a few minutes)")
    if run([PY, "scripts/significance.py", *args]) != 0:
        sys.exit("The statistics step failed; see the message above.")
    say("Writing the report")
    run([PY, "scripts/significance_report.py"])
    page = HERE / "data" / "significance" / "report.html"
    print(f"   Report: {page}")
    webbrowser.open(page.as_uri())


def cmd_site(_):
    """Maintainers: copy the latest report and data into the GitHub Pages site (../docs)."""
    sys.exit(run([PY, "scripts/build_site.py"]))


def cmd_doctor(_):
    ok = True

    def check(label, good, fix=""):
        nonlocal ok
        ok &= bool(good)
        print(f"   [{'ok' if good else '!!'}] {label}" + ("" if good else f"\n        fix: {fix}"))
    say("Checking your setup")
    check(f"Python {sys.version.split()[0]}", sys.version_info >= (3, 10))
    try:
        import pandas, playwright, streamlit, scipy  # noqa: F401,E401
        check("libraries installed", True)
    except ImportError as e:
        check(f"libraries installed ({e.name} missing)", False, f"{CMD} setup")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            b.close()
        check("Chromium can start", True)
    except Exception as e:  # noqa: BLE001
        check(f"Chromium can start ({type(e).__name__})", False, f"{CMD} setup")
    n = site_count()
    check(f"site list loaded ({n} sites)", n > 0, f"{CMD} setup")
    runs = 0
    if DB.exists():
        runs = sqlite3.connect(DB).execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    print(f"   [--] crawl runs in your database: {runs}" + ("" if runs else f"  (try {CMD} get-data or {CMD} trial)"))
    models = ollama_models()
    print("   [--] local AI: " + ("Ollama not running (optional)" if models is None else
                                  f"Ollama running with {', '.join(models) or 'no models'}"))
    say("All good" if ok else "Something needs fixing; see the 'fix' lines above")
    sys.exit(0 if ok else 1)


def cmd_test(args):
    sys.exit(run([PY, "-m", "pytest", "-q", "tests", *args]))


COMMANDS = {"setup": cmd_setup, "app": cmd_app, "get-data": cmd_get_data, "trial": cmd_trial, "crawl": cmd_crawl,
            "report": cmd_report, "site": cmd_site, "doctor": cmd_doctor, "test": cmd_test}

if __name__ == "__main__":
    name, rest = (sys.argv[1] if len(sys.argv) > 1 else "help"), sys.argv[2:]
    if name not in COMMANDS:
        print(HELP)
        sys.exit(0 if name in ("help", "-h", "--help") else 1)
    COMMANDS[name](rest)
