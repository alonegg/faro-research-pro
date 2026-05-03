"""Pro server — extends OSS make_app with collab endpoint + branded PDF.

Two surface changes vs OSS:

  1. POST /api/sessions/{id}/ask/collab/stream
     Multi-agent (Researcher + Risk Reviewer) version of ask/stream.
     Yields the OSS event stream PLUS phase_start / phase_done / review_verdict
     events so the UI can show distinct researcher / reviewer blocks.

  2. GET /api/sessions/{id}/export.pdf
     Replaces the OSS plain renderer with the branded one (cover + header +
     footer + logo). The .md export still uses OSS plain text (unbranded
     markdown is more useful for downstream copy-paste).

Everything else (auth, session CRUD, health, ask, ask/stream) is delegated
to the OSS app verbatim.

Wire as the deploy entry point:

    uvicorn faro_research_pro.server:app
"""

from __future__ import annotations

import json
import logging
import os
from urllib.parse import quote

from faro_research import __version__ as oss_version
from faro_research.audit import SessionStore
from faro_research.auth import User
from faro_research.export import session_to_markdown
from faro_research.providers import make_provider
from faro_research.server.app import make_app as _oss_make_app
from fastapi import Body, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse

from faro_research_pro import __version__ as pro_version
from faro_research_pro.agents import stream_collab
from faro_research_pro.exports import BrandConfig, branded_markdown_to_pdf

log = logging.getLogger(__name__)


def _brand_from_env() -> BrandConfig:
    """Build BrandConfig from FARO_PRO_BRAND_* env overrides (all optional)."""
    return BrandConfig(
        project_name=os.getenv("FARO_PRO_BRAND_NAME", "Faro Research Pro"),
        tagline=os.getenv("FARO_PRO_BRAND_TAGLINE", "AGPL · 多 agent A 股研究"),
        project_url=os.getenv(
            "FARO_PRO_BRAND_URL",
            "https://github.com/alonegg/faro-research-pro",
        ),
        accent_color=os.getenv("FARO_PRO_BRAND_ACCENT", "#4a6cf7"),
        accent_dark=os.getenv("FARO_PRO_BRAND_ACCENT_DARK", "#7a3cf3"),
        author=os.getenv("FARO_PRO_BRAND_AUTHOR", "Faro Research"),
        confidential=os.getenv("FARO_PRO_CONFIDENTIAL", "").strip()
                     in ("1", "true", "yes"),
    )


def _enable_sqlite_wal() -> None:
    """Force WAL + per-connection busy_timeout on the shared SQLite file.

    OSS' SessionStore and Pro's create separate engines pointing at the
    same file. Without WAL, simultaneous writes (e.g. OSS audit log +
    Pro append_message in the SSE finally block) deadlock with
    "database is locked". WAL is a persistent file-level setting; the
    SQLAlchemy `connect` listener applies busy_timeout to every new
    connection regardless of which engine created it.
    """
    import sqlite3
    from faro_research.config import settings
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    path = settings.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        con = sqlite3.connect(str(path), timeout=10)
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=NORMAL")
        con.commit()
        con.close()
    except Exception as e:
        log.warning("failed to enable SQLite WAL on %s: %s", path, e)

    @event.listens_for(Engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _conn_record):
        if not isinstance(dbapi_conn, sqlite3.Connection):
            return
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()


def make_app():
    """Return a FastAPI app that mounts OSS routes + Pro extensions."""
    _enable_sqlite_wal()
    app = _oss_make_app()
    provider = make_provider()
    store = SessionStore()
    brand = _brand_from_env()

    # ── Reach the OSS dependency (auth) ───────────────────────────────
    # The OSS make_app builds `current_user` as a closure; we re-derive an
    # equivalent one here using the same env-driven rules.
    from faro_research.auth import UserStore
    us = UserStore()

    def _auth_required() -> bool:
        return os.getenv("FARO_AUTH_REQUIRED", "").strip() in ("1", "true", "yes")

    def current_user(authorization: str | None = None):
        # Re-implementing the same dep so we can attach to our routes.
        # (Importing OSS' inner closure is brittle; this is 6 lines.)
        if not _auth_required():
            return us.get_default()
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "missing Bearer token in Authorization header")
        token = authorization.split(None, 1)[1].strip()
        u = us.lookup_by_key(token)
        if u is None:
            raise HTTPException(401, "invalid api key")
        return u

    # FastAPI needs Header default to come via Depends — wrap properly:
    from fastapi import Header

    def _current_user_dep(
        authorization: str | None = Header(default=None),
    ) -> User:
        return current_user(authorization)

    # ── Override health to expose the Pro version too ─────────────────

    @app.get("/api/pro/health")
    def pro_health() -> dict:
        return {
            "status": "ok",
            "pro_version": pro_version,
            "oss_version": oss_version,
            "brand": {
                "project_name": brand.project_name,
                "tagline": brand.tagline,
                "accent_color": brand.accent_color,
            },
            "auth_required": _auth_required(),
        }

    # ── Collab streaming endpoint ─────────────────────────────────────

    @app.post("/api/sessions/{session_id}/ask/collab/stream")
    def ask_collab_stream(
        session_id: str,
        body: dict = Body(...),
        user: User = Depends(_current_user_dep),
    ) -> StreamingResponse:
        query = (body or {}).get("query", "").strip()
        max_rounds = int((body or {}).get("max_rounds", 2))
        if not query:
            raise HTTPException(400, "query is required")
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")

        # Rebuild the agent here using OSS factories — same shape as OSS' own
        # per-user agent cache, just inline. Pro shares memory dir layout
        # with OSS, so a user's notes are reachable from single + collab modes.
        from faro_research.agent import Agent, Message, build_system_prompt
        from faro_research.config import settings
        from faro_research.memory import MemoryStore, make_memory_tools
        from faro_research.skills import make_skill_tool
        from faro_research.tools import ToolRegistry, discover_external_tools
        from faro_research.tools.builtin.tushare import tushare_default_tools

        memory = MemoryStore(root=settings.db_path.parent / "memory" / user.id)
        reg = ToolRegistry()
        reg.register_many(tushare_default_tools(provider))
        skill = make_skill_tool()
        if skill is not None:
            reg.register(skill)
        reg.register_many(make_memory_tools(memory))
        for spec in discover_external_tools():
            if spec.name in reg:
                continue
            reg.register(spec)
        sys_prompt = build_system_prompt(soul=memory.soul(), rules=memory.rules())
        researcher = Agent(provider=provider, tools=reg, system_prompt=sys_prompt)

        # Persist the user query and load full history (same pattern as OSS)
        store.append_message(session_id, "user", query)
        history = []
        for m in store.list_messages(session_id):
            if m.role in ("user", "assistant"):
                history.append(Message(role=m.role, content=m.content))

        def gen():
            final_answer = ""
            tool_calls: list[dict] = []
            rounds = 0
            latency = 0.0
            error: str | None = None
            reviews_summary: list[dict] = []
            try:
                for ev in stream_collab(
                    researcher=researcher, reviewer_provider=provider,
                    history=history, max_rounds=max_rounds,
                    soul=memory.soul(), rules=memory.rules(),
                ):
                    if ev["type"] == "final":
                        final_answer = ev["answer"]
                        rounds = ev.get("rounds", 0)
                        tool_calls = ev.get("tool_calls") or []
                        latency = ev.get("latency_total_ms", 0)
                        reviews_summary = ev.get("reviews") or []
                    elif ev["type"] == "error":
                        error = ev["message"]
                    yield (f"event: {ev['type']}\n"
                           f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n")
            except Exception as e:
                error = f"{type(e).__name__}: {e}"
                yield (
                    "event: error\n"
                    f"data: {json.dumps({'type': 'error', 'message': error}, ensure_ascii=False)}\n\n"
                )
            finally:
                store.append_message(session_id, "assistant",
                    final_answer or (f"agent failed: {error}" if error else ""),
                    meta={
                        "mode": "collab",
                        "rounds": rounds,
                        "tool_calls": tool_calls,
                        "latency_total_ms": latency,
                        "reviews": reviews_summary,
                        "error": error,
                    },
                )
                store.log_audit(
                    "research_collab", session_id=session_id,
                    note=query[:200], user_id=user.id,
                    payload={
                        "query": query, "rounds": rounds,
                        "answer_chars": len(final_answer or ""),
                        "reviews": reviews_summary, "error": error,
                    },
                )
                yield "event: done\ndata: {}\n\n"

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
        )

    # ── Branded PDF export (overrides OSS plain version) ──────────────
    # FastAPI route resolution picks the LAST registered handler for the
    # same path, so re-registering wins.

    @app.get("/api/sessions/{session_id}/export.pdf")
    def export_pdf_branded(
        session_id: str,
        user: User = Depends(_current_user_dep),
    ):
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")
        s = store.get_session(session_id)
        msgs = store.list_messages(session_id)
        md = session_to_markdown(s, msgs)

        title = s.title or "session"
        ascii_safe = "".join(
            c if c.isascii() and (c.isalnum() or c in "-_") else "_"
            for c in title
        )[:40].strip("_") or session_id
        utf8_quoted = quote(title, safe="")
        cd = (f'attachment; filename="{ascii_safe}.pdf"; '
              f"filename*=UTF-8''{utf8_quoted}.pdf")

        try:
            pdf = branded_markdown_to_pdf(md, title=title, brand=brand)
        except RuntimeError as e:
            raise HTTPException(500, str(e)) from e
        return Response(
            content=pdf, media_type="application/pdf",
            headers={"content-disposition": cd},
        )

    return app


# Convenience singleton
app = make_app()
