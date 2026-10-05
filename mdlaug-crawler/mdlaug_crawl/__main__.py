"""CLI: python -m mdlaug_crawl {import,run,export,status}"""
import argparse
import asyncio
import json
import sys

from .config import Config
from .store import Store
from .llm import LLM
from . import sites as S, runner, export


def main(argv=None):
    ap = argparse.ArgumentParser(prog="mdlaug_crawl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("import", help="load the DL spreadsheet into the sites table")
    a.add_argument("sheet")
    r = sub.add_parser("run", help="crawl sites")
    r.add_argument("--sheet", help="spreadsheet (optional if already imported)")
    r.add_argument("--platform", action="append", help="only these platforms (repeatable)")
    r.add_argument("--type", action="append", dest="ltype", help="only these library types")
    r.add_argument("--url", action="append", help="only these collection URLs")
    r.add_argument("--limit", type=int, default=0)
    r.add_argument("--site-id", action="append", type=int, help="only these site ids")
    r.add_argument("--retry-failed", type=int, metavar="RUN", help="only sites that didn't complete in this earlier run")
    r.add_argument("--include-inactive", action="store_true", help="also crawl sites switched off in the site list")
    r.add_argument("--no-llm", action="store_true")
    r.add_argument("--desktop", action="store_true", help="desktop viewport instead of mobile emulation")
    r.add_argument("--note", default="")
    e = sub.add_parser("export", help="export a run to xlsx")
    e.add_argument("--run", type=int, required=True)
    e.add_argument("--out", default="mdlaug_crawl_export.xlsx")
    sub.add_parser("status", help="show runs")
    sa = sub.add_parser("sites", help="list / add / switch sites on or off")
    sa.add_argument("action", choices=["list", "add", "enable", "disable"])
    sa.add_argument("url", nargs="?")
    sa.add_argument("--institution", default="")
    sa.add_argument("--platform", default="")
    sa.add_argument("--type", dest="ltype", default="")
    b = sub.add_parser("bench", help="replay stored LLM prompts against another model, for comparison")
    b.add_argument("--model", required=True)
    b.add_argument("--run", type=int, help="only this run (default: all)")
    b.add_argument("--task", action="append", help="only these tasks (repeatable)")
    b.add_argument("--limit", type=int, default=0)
    c = sub.add_parser("crowd", help="crowdsourced review on Turso (needs TURSO_URL + TURSO_TOKEN)")
    csub = c.add_subparsers(dest="ccmd", required=True)
    csub.add_parser("init", help="create crowd_* tables")
    cp = csub.add_parser("publish", help="publish a local run for crowd review")
    cp.add_argument("--run", type=int, required=True)
    cp.add_argument("--max-width", type=int, default=1000, help="screenshot width (px) after compression")
    cl = csub.add_parser("pull", help="import crowd consensus into the local DB")
    cl.add_argument("--include-single", action="store_true", help="also import findings with only one review")
    cu = csub.add_parser("user", help="manage the allowlist")
    cu.add_argument("action", choices=["add", "remove", "list"])
    cu.add_argument("email", nargs="?")
    cu.add_argument("--role", default="reviewer", choices=["reviewer", "admin"])
    cu.add_argument("--name", default="")
    args = ap.parse_args(argv)

    cfg = Config()
    cfg.ensure_dirs()
    store = Store(cfg.db_path, cfg.logs_dir)

    if args.cmd == "import":
        ss = S.dedupe_sites(S.load_sheet(args.sheet))
        for s in ss:
            store.upsert_site(s)
        print(f"imported {len(ss)} unique sites")
        return 0
    if args.cmd == "sites":
        if args.action == "list":
            for x in S.select(store.query("SELECT * FROM sites"), active_only=False):
                print(("on " if int(x.get("active") if x.get("active") is not None else 1) else "off"),
                      x["id"], x["platform"], "|", x["institution"], "|", x["collection_url"])
            return 0
        if not args.url:
            print("url required", file=sys.stderr); return 2
        if args.action == "add":
            new, bad = S.parse_bulk(args.url, args.platform, args.ltype)
            if bad:
                print(f"not a valid URL: {args.url}", file=sys.stderr); return 2
            if args.institution:
                new[0]["institution"] = args.institution
            store.upsert_site(new[0]); print(f"added {new[0]['collection_url']}"); return 0
        row = store.query("SELECT id FROM sites WHERE collection_url=?", (S.normalize_url(args.url),))
        if not row:
            print("unknown site", file=sys.stderr); return 2
        store.set_site_active(row[0]["id"], args.action == "enable"); print(f"{args.action}d"); return 0
    if args.cmd == "status":
        for r_ in store.query("SELECT id, status, datetime(started,'unixepoch') started, note FROM runs ORDER BY id DESC LIMIT 20"):
            print(r_)
        return 0
    import os as _os
    if "OLLAMA_MODEL" not in _os.environ and store.get_setting("llm:model"):
        cfg.ollama_model = store.get_setting("llm:model")        # the app's saved choice
    if args.cmd == "bench":
        from . import bench
        n = bench.replay(store, cfg, args.model, args.run, args.task, args.limit or None,
                         progress=lambda i, t: print(f"[{i}/{t}] replayed with {args.model}", flush=True))
        print(f"replayed {n} prompt(s) with {args.model}")
        return 0
    if args.cmd == "crowd":
        import os
        from . import crowd
        from .turso import Turso
        url = os.environ.get("TURSO_URL")
        tok = os.environ.get("TURSO_TOKEN") or os.environ.get("TURSO_AUTH_TOKEN")
        if not url or not tok:
            print("set TURSO_URL and TURSO_TOKEN (a write token for your Turso database)", file=sys.stderr)
            return 2
        db = Turso(url, tok)
        if args.ccmd == "init":
            crowd.init(db); print("crowd tables ready")
        elif args.ccmd == "publish":
            res = crowd.publish(store, db, args.run, max_w=args.max_width,
                                progress=lambda i, n: print(f"  images {i}/{n} pages", end="\r", flush=True))
            print("\npublished", res)
        elif args.ccmd == "pull":
            print(f"imported {crowd.pull(store, db, include_single=args.include_single)} crowd decision(s)")
        elif args.ccmd == "user":
            crowd.init(db)
            if args.action == "list":
                for u in db.query("SELECT email, role, active, name FROM crowd_users ORDER BY email"):
                    print(u)
            elif not args.email:
                print("email required", file=sys.stderr); return 2
            elif args.action == "add":
                crowd.add_user(db, args.email, args.role, args.name); print(f"added {args.email} ({args.role})")
            else:
                crowd.deactivate_user(db, args.email); print(f"deactivated {args.email}")
        return 0
    if args.cmd == "export":
        print(export.export_xlsx(store, args.run, args.out, cfg.review_confidence))
        return 0
    if args.cmd == "run":
        if args.no_llm:
            cfg.llm_enabled = False
        if args.desktop:
            cfg.device = ""
        if args.sheet:
            for s in S.dedupe_sites(S.load_sheet(args.sheet)):
                store.upsert_site(s)
        rows = store.query("SELECT * FROM sites")
        for x in rows:
            x["listings"] = json.loads(x.get("listings") or "[]")
        ids = args.site_id
        if args.retry_failed:
            from . import analysis
            cov = analysis.coverage(store, args.retry_failed)
            ids = list(cov[(cov.status != "complete") & (cov.status != "not crawled")].site_id) if not cov.empty else []
            print(f"retrying {len(ids)} site(s) that didn't complete in run {args.retry_failed}")
        rows = S.select(rows, args.platform, args.ltype, args.url, ids, args.limit, active_only=not args.include_inactive)
        if not rows:
            print("no sites selected", file=sys.stderr)
            return 1
        llm = LLM(cfg, store) if cfg.llm_enabled else None
        if llm and not llm.check():
            print(f"warning: Ollama/{cfg.ollama_model} not reachable at {cfg.ollama_url}; "
                  "LLM judgments will be skipped and routed to review", file=sys.stderr)
        rid = asyncio.run(runner.run_crawl(cfg, store, llm, rows, note=args.note,
                                           progress=lambda n, t, u: print(f"[{n}/{t}] {u}", flush=True)))
        print(f"run {rid} complete")
        return 0


if __name__ == "__main__":
    sys.exit(main())
