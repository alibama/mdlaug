"""Runtime configuration (env vars override defaults)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]          # repo root (…/mdlaug-a11y)
CRAWLER = Path(__file__).resolve().parents[1]       # …/crawler
ENGINE_DIR = REPO / "extension"


def _env(name, default):
    return lambda: os.environ.get(name, default)


def _flag(name, default="1"):
    return lambda: os.environ.get(name, default) not in ("0", "false", "no")


@dataclass
class Config:
    """All defaults are read from the environment when a Config is CREATED (not when this
    module is imported), so changing an env var always takes effect for new configs."""
    db_path: str = field(default_factory=_env("MDLAUG_DB", str(CRAWLER / "data" / "mdlaug_crawl.db")))
    artifacts_dir: str = field(default_factory=_env("MDLAUG_ARTIFACTS", str(CRAWLER / "data" / "artifacts")))
    logs_dir: str = field(default_factory=_env("MDLAUG_LOGS", str(CRAWLER / "data" / "logs")))
    # LLM (local, via Ollama)
    llm_enabled: bool = field(default_factory=_flag("MDLAUG_LLM"))
    ollama_url: str = field(default_factory=_env("OLLAMA_URL", "http://localhost:11434"))
    ollama_model: str = field(default_factory=_env("OLLAMA_MODEL", "qwen2.5:7b"))
    # optional second model: every judgment also goes to it, recorded for comparison only
    shadow_model: str = field(default_factory=_env("MDLAUG_SHADOW_MODEL", ""))
    llm_timeout: int = field(default_factory=lambda: int(os.environ.get("MDLAUG_LLM_TIMEOUT", "120")))
    review_confidence: float = field(default_factory=lambda: float(os.environ.get("MDLAUG_REVIEW_CONF", "0.7")))
    # crawling — mDLAUG is mobile-first; MDLAUG_DEVICE="" means desktop
    device: str = field(default_factory=_env("MDLAUG_DEVICE", "iPhone 13"))
    max_pages_per_site: int = field(default_factory=lambda: int(os.environ.get("MDLAUG_MAX_PAGES", "6")))
    concurrency: int = field(default_factory=lambda: int(os.environ.get("MDLAUG_CONCURRENCY", "2")))
    nav_timeout_ms: int = field(default_factory=lambda: int(os.environ.get("MDLAUG_NAV_TIMEOUT", "30000")))
    polite_delay_s: float = field(default_factory=lambda: float(os.environ.get("MDLAUG_DELAY", "2.0")))
    respect_robots: bool = field(default_factory=_flag("MDLAUG_ROBOTS"))
    search_query: str = field(default_factory=_env("MDLAUG_QUERY", "history"))
    user_agent_suffix: str = field(default_factory=_env(
        "MDLAUG_UA", "mDLAUG-accessibility-research (+https://github.com/alibama/mdlaug)"))
    run_axe: bool = field(default_factory=_flag("MDLAUG_AXE"))
    screenshots: bool = True
    extra: dict = field(default_factory=dict)

    def ensure_dirs(self):
        for d in (Path(self.db_path).parent, Path(self.artifacts_dir), Path(self.logs_dir)):
            d.mkdir(parents=True, exist_ok=True)
