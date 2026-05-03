"""Faro Research Pro — multi-agent + branded exports on top of Faro Research.

Quick start::

    from faro_research_pro import run_collab, BrandConfig
    from faro_research_pro.exports import branded_markdown_to_pdf
    from faro_research import Agent, Message, ToolRegistry, make_provider
    from faro_research.tools.builtin.tushare import tushare_default_tools

    p = make_provider()
    reg = ToolRegistry(); reg.register_many(tushare_default_tools(p))
    researcher = Agent(provider=p, tools=reg)

    trace = run_collab(
        researcher=researcher, reviewer_provider=p,
        history=[Message(role="user", content="贵州茅台研报")],
    )
    pdf = branded_markdown_to_pdf(trace.final_answer, brand=BrandConfig(
        author="Your Name", confidential=True,
    ))

License: AGPL-3.0-or-later. See LICENSE.
"""

# Load .env from the user's CWD BEFORE faro_research.config imports —
# faro_research's config defaults to the .env next to its own source dir
# (which is in site-packages when Pro is installed normally), so without
# this hook the user's project-local creds wouldn't be picked up.
import os as _os
from pathlib import Path as _Path

try:
    from dotenv import load_dotenv as _load_dotenv
    for _candidate in (_Path.cwd() / ".env", _Path.cwd().parent / ".env"):
        if _candidate.is_file():
            _load_dotenv(_candidate, override=False)
            _os.environ.setdefault("_FARO_PRO_ENV_LOADED", str(_candidate))
            break
except ImportError:
    pass

from faro_research_pro.agents import (
    CollabTrace,
    Review,
    ReviewIssue,
    review_draft,
    run_collab,
    stream_collab,
)
from faro_research_pro.exports import (
    BrandConfig,
    branded_markdown,
    branded_markdown_to_pdf,
)

__version__ = "0.5.0"

__all__ = [
    "stream_collab", "run_collab", "CollabTrace",
    "Review", "ReviewIssue", "review_draft",
    "BrandConfig", "branded_markdown_to_pdf", "branded_markdown",
    "__version__",
]
