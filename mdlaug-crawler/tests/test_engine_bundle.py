import sys
from pathlib import Path
import pytest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "scripts"))


def test_bundle_present_and_loadable():
    from mdlaug_crawl import runner
    js = runner._engine_js()
    assert "mDLAUG.remediator" in js and "mDLAUG.assessment" in js


def test_bundle_matches_extension_sources():
    import sync_engine
    if not (sync_engine.EXT / sync_engine.FILES[0]).exists():
        pytest.skip("standalone crawler (no ../extension) — nothing to compare")
    assert sync_engine.OUT.read_text(encoding="utf-8") == sync_engine.build(), \
        "engine.bundle.js is stale — run: python crawler/scripts/sync_engine.py"
