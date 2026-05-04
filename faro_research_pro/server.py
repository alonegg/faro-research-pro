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
from faro_research.providers.base import Message
from faro_research.server.app import make_app as _oss_make_app
from fastapi import Body, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from faro_research_pro import __version__ as pro_version
from faro_research_pro.agents import stream_collab
from faro_research_pro.exports import BrandConfig, branded_markdown_to_pdf
from faro_research_pro.storage import (
    SETTINGS_DEFAULTS, metadata_store, settings_store,
)

log = logging.getLogger(__name__)


def _make_small_provider():
    """Build a separate, cheap provider for meta tasks (auto-title, etc.).

    Falls back to the main provider if FARO_PRO_SMALL_LLM_* env not set.
    Using the main reasoning model (MiniMax-M2.7 / DeepSeek-R1) for an
    8-character title burns 5K reasoning tokens and takes 30s — wrong
    tool for the job.
    """
    base = os.getenv("FARO_PRO_SMALL_LLM_BASE_URL", "").strip()
    key = os.getenv("FARO_PRO_SMALL_LLM_API_KEY", "").strip()
    model = os.getenv("FARO_PRO_SMALL_LLM_MODEL", "").strip()
    if not (base and key and model):
        return None
    # Reuse OSS' OpenAI-compat provider with overridden settings.
    from faro_research.providers.openai_compat import OpenAICompatibleProvider
    return OpenAICompatibleProvider(
        base_url=base, api_key=key, model=model,
        timeout=30.0,
    )


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
    small_provider = _make_small_provider()  # None → fall back to main
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
        # ── Pro: US stocks (FD.ai) + cross-market peer lookup ────────
        try:
            from faro_research_pro.tools.us_stocks import US_TOOLS
            reg.register_many(US_TOOLS)
        except Exception as e:
            log.warning("us_stocks tools failed to load: %s", e)
        try:
            from faro_research_pro.tools.cross_market import CROSS_MARKET_TOOLS
            reg.register_many(CROSS_MARKET_TOOLS)
        except Exception as e:
            log.warning("cross_market tools failed to load: %s", e)
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

    # ── Session metadata: pinned / tags / soft-delete / auto-title ────
    # All under /api/pro/sessions/* — Pro frontend uses these instead of
    # the OSS list/delete endpoints. OSS endpoints still work for
    # backward compat (single-agent CLI etc.).
    meta = metadata_store()

    def _serialize(s, m) -> dict:
        return {
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at.isoformat() if hasattr(s.created_at, "isoformat") else s.created_at,
            "updated_at": s.updated_at.isoformat() if hasattr(s.updated_at, "isoformat") else s.updated_at,
            "pinned": (m.pinned if m else False),
            "pinned_at": (m.pinned_at.isoformat() if (m and m.pinned_at) else None),
            "tags": (m.tags if m else []),
            "deleted_at": (m.deleted_at.isoformat() if (m and m.deleted_at) else None),
            "auto_titled": (m.auto_titled if m else False),
        }

    @app.get("/api/pro/sessions")
    def list_sessions_pro(
        include_deleted: bool = Query(False),
        only_deleted: bool = Query(False),
        user: User = Depends(_current_user_dep),
    ) -> list[dict]:
        """List sessions joined with Pro metadata (pinned/tags/deleted)."""
        rows = store.list_sessions(limit=500, user_id=user.id)
        meta_map = meta.list_by_session_ids([r.id for r in rows])
        out = []
        for s in rows:
            m = meta_map.get(s.id)
            is_deleted = bool(m and m.deleted_at)
            if only_deleted and not is_deleted:
                continue
            if not only_deleted and not include_deleted and is_deleted:
                continue
            out.append(_serialize(s, m))
        return out

    @app.patch("/api/pro/sessions/{session_id}/metadata")
    def patch_metadata(
        session_id: str,
        body: dict = Body(...),
        user: User = Depends(_current_user_dep),
    ) -> dict:
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")
        if "pinned" in body:
            meta.set_pinned(session_id, bool(body["pinned"]))
        if "tags" in body:
            tags = body["tags"]
            if not isinstance(tags, list):
                raise HTTPException(400, "tags must be a list of strings")
            meta.set_tags(session_id, [str(t) for t in tags])
        m = meta.get(session_id)
        s = store.get_session(session_id)
        return _serialize(s, m)

    @app.delete("/api/pro/sessions/{session_id}")
    def soft_delete_pro(
        session_id: str,
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Soft-delete: tombstone in pro_session_metadata; OSS row stays."""
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")
        m = meta.soft_delete(session_id)
        return {"soft_deleted": session_id, "deleted_at": m.deleted_at.isoformat()}

    @app.post("/api/pro/sessions/{session_id}/restore")
    def restore_pro(
        session_id: str,
        user: User = Depends(_current_user_dep),
    ) -> dict:
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")
        m = meta.restore(session_id)
        if m is None:
            raise HTTPException(404, "no metadata for that session")
        return _serialize(store.get_session(session_id), m)

    @app.delete("/api/pro/sessions/{session_id}/purge")
    def purge_pro(
        session_id: str,
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Actually drop the session (OSS row + Pro metadata)."""
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")
        meta.purge(session_id)
        store.delete_session(session_id)
        return {"purged": session_id}

    @app.post("/api/pro/sessions/{session_id}/auto-title")
    def auto_title_pro(
        session_id: str,
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Generate a 6-10 char title from the first user message via LLM.
        Idempotent — if already auto-titled, returns the current title."""
        if not store.get_session(session_id, user_id=user.id):
            raise HTTPException(404, f"session {session_id} not found")
        m = meta.get(session_id)
        if m and m.auto_titled:
            return {"title": store.get_session(session_id).title, "skipped": "already-titled"}
        msgs = store.list_messages(session_id)
        first_user = next((x for x in msgs if x.role == "user"), None)
        if first_user is None:
            raise HTTPException(400, "no user messages yet")
        few_shot = (
            "Examples:\n"
            "Q: 帮我分析下宁德时代的最新季报和未来增长点\n"
            "A: 宁德时代季报与增长分析\n\n"
            "Q: 比亚迪 2024 vs 2025 的营收同比怎么样\n"
            "A: 比亚迪营收同比对比\n\n"
            "Q: 给我写一份茅台的 DCF 估值报告\n"
            "A: 茅台 DCF 估值报告\n\n"
            f"Q: {first_user.content[:300]}\n"
            "A:"
        )
        # Use the small/fast provider when configured — main reasoning
        # model burns 5K thinking tokens for an 8-char title.
        title_provider = small_provider or provider
        try:
            # Big budget tolerates reasoning models; small models barely use it.
            resp = title_provider.chat(
                [Message(role="user", content=few_shot)],
                temperature=0.2, max_tokens=1024,
            )
            raw = (resp.content or "").strip()
            # Reasoning models sometimes still echo trailing trace —
            # take the LAST non-empty line, which is usually the final answer.
            lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            raw = lines[-1] if lines else ""
            for prefix in ("A:", "A：", "标题:", "标题：", "Title:", "title:",
                           "答:", "答：", "**A:**", "**Title:**"):
                if raw.startswith(prefix):
                    raw = raw[len(prefix):].lstrip()
            title = raw.strip("\"'`「」《》【】 ").rstrip("。.!?")[:40] or "新会话"
        except Exception as e:
            log.warning("auto_title failed for %s: %s", session_id, e)
            raise HTTPException(500, f"LLM auto-title failed: {e}") from e
        store.rename_session(session_id, title)
        meta.mark_auto_titled(session_id)
        s = store.get_session(session_id)
        return _serialize(s, meta.get(session_id))

    # ── Settings: runtime-configurable values (UI editable) ──────────
    psettings = settings_store()

    @app.get("/api/pro/settings")
    def get_settings(
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """All runtime settings (defaults merged with stored overrides)."""
        return psettings.all()

    @app.patch("/api/pro/settings")
    def patch_settings(
        body: dict = Body(...),
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Apply many key/value updates atomically. Returns the new state."""
        # Filter to known keys to prevent garbage in DB.
        known = set(SETTINGS_DEFAULTS.keys())
        clean = {k: v for k, v in (body or {}).items() if k in known}
        if not clean:
            raise HTTPException(400, "no valid settings keys in body")
        return psettings.patch(clean)

    @app.get("/api/pro/settings/status")
    def settings_status(
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Read-only snapshot for the Settings UI: env-driven config + counts.
        Mask secrets — return only the last 4 chars."""
        def mask(v: str) -> str:
            if not v: return ""
            return ("•" * max(0, len(v) - 4)) + v[-4:] if len(v) > 4 else "•" * len(v)
        # Memory + skills counts (best-effort)
        try:
            from faro_research.memory import MemoryStore
            mem = MemoryStore(root=faro_settings_module().db_path.parent / "memory" / user.id)
            soul = mem.soul() or ""
            rules = mem.rules() or ""
            mem_count = len(mem.list_recent(limit=200) or [])
        except Exception:
            soul, rules, mem_count = "", "", 0
        # Skills count
        try:
            from faro_research.skills import list_skills
            skills = list_skills() or []
        except Exception:
            skills = []
        # Tool count
        from faro_research.tools.builtin.tushare import tushare_default_tools
        tushare_count = len(tushare_default_tools(provider))
        return {
            "llm_main": {
                "provider": os.getenv("FARO_PROVIDER", "openai_compat"),
                "base_url": os.getenv("FARO_OPENAI_BASE_URL", ""),
                "api_key_masked": mask(os.getenv("FARO_OPENAI_API_KEY", "")),
                "model": os.getenv("FARO_OPENAI_MODEL", ""),
                "timeout_sec": int(os.getenv("FARO_LLM_TIMEOUT_SEC", "180")),
            },
            "llm_small": {
                "configured": small_provider is not None,
                "base_url": os.getenv("FARO_PRO_SMALL_LLM_BASE_URL", ""),
                "api_key_masked": mask(os.getenv("FARO_PRO_SMALL_LLM_API_KEY", "")),
                "model": os.getenv("FARO_PRO_SMALL_LLM_MODEL", ""),
            },
            "data_sources": {
                "tushare": {
                    "token_masked": mask(os.getenv("TUSHARE_TOKEN", "")),
                    "tools_loaded": tushare_count,
                },
                "fd_ai": {
                    "key_masked": mask(os.getenv("FINANCIAL_DATASETS_API_KEY", "")),
                    "configured": bool(os.getenv("FINANCIAL_DATASETS_API_KEY", "")),
                },
                "akshare": {
                    "available": _check_akshare(),
                },
            },
            "agent": {
                "max_tool_turns": int(os.getenv("FARO_MAX_TOOL_TURNS", "8")),
                "tool_result_max_chars": int(os.getenv("FARO_TOOL_RESULT_MAX_CHARS", "3500")),
            },
            "auth": {
                "required": _auth_required(),
                "current_user": {"id": user.id, "email": user.email, "role": user.role},
            },
            "audit": {
                "db_path": str(faro_settings_module().db_path),
            },
            "memory": {
                "soul": soul,
                "rules": rules,
                "count": mem_count,
            },
            "skills": [{"name": s.name, "description": s.description[:120]} for s in skills],
            "version": {"pro": pro_version, "oss": oss_version},
        }

    @app.put("/api/pro/settings/memory")
    def update_memory(
        body: dict = Body(...),
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Update memory soul/rules text."""
        from faro_research.memory import MemoryStore
        mem = MemoryStore(root=faro_settings_module().db_path.parent / "memory" / user.id)
        if "soul" in body:
            mem.set_soul(str(body["soul"] or ""))
        if "rules" in body:
            mem.set_rules(str(body["rules"] or ""))
        return {"soul": mem.soul() or "", "rules": mem.rules() or ""}

    @app.post("/api/pro/settings/test/{kind}")
    def test_connection(
        kind: str,
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Quick connectivity test. Kind: llm_main / llm_small / tushare / fd_ai."""
        import time
        t0 = time.perf_counter()
        try:
            if kind == "llm_main":
                resp = provider.chat(
                    [Message(role="user", content="reply with 'ok' only")],
                    temperature=0.0, max_tokens=8,
                )
                ok = bool(resp.content)
                detail = (resp.content or "")[:80]
            elif kind == "llm_small":
                if small_provider is None:
                    return {"ok": False, "detail": "small LLM not configured (FARO_PRO_SMALL_LLM_* env)"}
                resp = small_provider.chat(
                    [Message(role="user", content="reply with 'ok' only")],
                    temperature=0.0, max_tokens=8,
                )
                ok = bool(resp.content)
                detail = (resp.content or "")[:80]
            elif kind == "tushare":
                from faro_research.tools.builtin.tushare import client as ts
                rows = ts.stock_basic(force_refresh=False)
                ok = isinstance(rows, list) and len(rows) > 100
                detail = f"loaded {len(rows)} A-share rows"
            elif kind == "fd_ai":
                import httpx
                key = os.getenv("FINANCIAL_DATASETS_API_KEY", "")
                if not key:
                    return {"ok": False, "detail": "FINANCIAL_DATASETS_API_KEY not set"}
                r = httpx.get(
                    "https://api.financialdatasets.ai/prices/snapshot/",
                    params={"ticker": "AAPL"},
                    headers={"X-API-KEY": key},
                    timeout=10.0,
                )
                ok = r.status_code == 200
                detail = f"HTTP {r.status_code}; body[:120]={r.text[:120]}"
            else:
                raise HTTPException(400, f"unknown test kind: {kind}")
            return {"ok": ok, "detail": detail, "latency_ms": (time.perf_counter() - t0) * 1000}
        except Exception as e:
            return {"ok": False, "detail": f"{type(e).__name__}: {str(e)[:200]}",
                    "latency_ms": (time.perf_counter() - t0) * 1000}

    @app.post("/api/pro/settings/purge_all_sessions")
    def purge_all(
        user: User = Depends(_current_user_dep),
    ) -> dict:
        """Hard delete every session belonging to the current user.
        Frontend MUST double-confirm before calling this."""
        sessions = store.list_sessions(limit=10000, user_id=user.id)
        purged = 0
        for s in sessions:
            try:
                meta.purge(s.id)
                store.delete_session(s.id)
                purged += 1
            except Exception:
                pass
        return {"purged": purged}

    # ── Multi-user management (admin only) ───────────────────────────
    def _admin_required(user: User = Depends(_current_user_dep)) -> User:
        if user.role != "admin":
            raise HTTPException(403, "admin role required")
        return user

    def _user_summary(u: User) -> dict:
        sessions_count = len(store.list_sessions(limit=10000, user_id=u.id))
        return {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
            "sessions_count": sessions_count,
        }

    @app.get("/api/pro/users")
    def list_users_admin(
        admin: User = Depends(_admin_required),
    ) -> list[dict]:
        return [_user_summary(u) for u in us.list_users()]

    @app.post("/api/pro/users")
    def create_user_admin(
        body: dict = Body(...),
        admin: User = Depends(_admin_required),
    ) -> dict:
        email = (body or {}).get("email", "").strip()
        role = (body or {}).get("role", "user")
        if not email:
            raise HTTPException(400, "email is required")
        if role not in ("user", "admin"):
            raise HTTPException(400, "role must be 'user' or 'admin'")
        try:
            new_user, plain_key = us.create_user(email=email, role=role)
        except Exception as e:
            raise HTTPException(400, f"create_user failed: {e}") from e
        return {**_user_summary(new_user), "plain_key": plain_key}

    @app.delete("/api/pro/users/{user_id}")
    def delete_user_admin(
        user_id: str,
        admin: User = Depends(_admin_required),
    ) -> dict:
        if user_id == admin.id:
            raise HTTPException(400, "you can't delete yourself")
        if user_id == "default":
            raise HTTPException(400, "the default user can't be deleted")
        target = us.get(user_id)
        if target is None:
            raise HTTPException(404, "user not found")
        # Delete the user's sessions + Pro metadata + memory dir
        for s in store.list_sessions(limit=10000, user_id=user_id):
            try:
                meta.purge(s.id)
                store.delete_session(s.id)
            except Exception as e:
                log.warning("failed to purge session %s during user delete: %s", s.id, e)
        # Memory dir
        try:
            import shutil
            mem_dir = faro_settings_module().db_path.parent / "memory" / user_id
            if mem_dir.exists():
                shutil.rmtree(mem_dir)
        except Exception as e:
            log.warning("failed to remove memory dir for user %s: %s", user_id, e)
        # The user row itself
        from sqlmodel import Session
        with Session(us.engine) as db:
            row = db.get(User, user_id)
            if row is not None:
                db.delete(row)
                db.commit()
        return {"deleted": user_id}

    @app.post("/api/pro/users/{user_id}/regenerate_key")
    def regenerate_user_key(
        user_id: str,
        admin: User = Depends(_admin_required),
    ) -> dict:
        target = us.get(user_id)
        if target is None:
            raise HTTPException(404, "user not found")
        if user_id == "default":
            raise HTTPException(400, "the default user has no usable key")
        # Make a fresh random key + update hash in place.
        from faro_research.auth import hash_api_key
        import secrets
        plain = "fr-" + secrets.token_urlsafe(28)
        new_hash = hash_api_key(plain)
        from sqlmodel import Session
        with Session(us.engine) as db:
            row = db.get(User, user_id)
            row.api_key_hash = new_hash
            db.add(row)
            db.commit()
            db.refresh(row)
        return {**_user_summary(row), "plain_key": plain}

    return app


def _check_akshare() -> bool:
    try:
        import akshare  # noqa: F401
        return True
    except ImportError:
        return False


def faro_settings_module():
    """Lazy import to avoid circular at module load."""
    from faro_research.config import settings as s
    return s


# Convenience singleton
app = make_app()
