"""Pro-side session metadata: pinned / tags / deleted_at / auto_titled.

Reuses the same SQLite file as OSS (`settings.db_path`) so JOINs by
session_id work and there's only one DB to back up. Schema is owned
entirely by Pro — adding a column here doesn't touch OSS.
"""

from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from typing import Optional

from faro_research.config import settings
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Field, Session, SQLModel, create_engine, select


def _utcnow() -> datetime:
    return datetime.utcnow()


class SessionMetadata(SQLModel, table=True):
    """Side-table keyed by `session.id` (OSS table). One row per session."""

    __tablename__ = "pro_session_metadata"

    session_id: str = Field(primary_key=True, max_length=32)
    pinned: bool = Field(default=False, index=True)
    pinned_at: Optional[datetime] = Field(default=None)
    # JSON-encoded list[str]; we serialize manually to keep SQLite simple.
    tags_json: str = Field(default="[]")
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    auto_titled: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @property
    def tags(self) -> list[str]:
        try:
            v = json.loads(self.tags_json or "[]")
            return [str(t) for t in v if isinstance(t, str)]
        except Exception:
            return []

    def set_tags(self, tags: list[str]) -> None:
        # Dedup + strip + drop empties, preserve order.
        seen: set[str] = set()
        cleaned: list[str] = []
        for t in tags:
            t = (t or "").strip()
            if not t or t in seen:
                continue
            seen.add(t)
            cleaned.append(t)
        self.tags_json = json.dumps(cleaned, ensure_ascii=False)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "pinned": self.pinned,
            "pinned_at": self.pinned_at.isoformat() if self.pinned_at else None,
            "tags": self.tags,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
            "auto_titled": self.auto_titled,
        }


class SessionMetadataStore:
    """Thin CRUD layer with WAL-friendly engine setup."""

    def __init__(self, db_path=None) -> None:
        path = db_path or settings.db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            f"sqlite:///{path}",
            echo=False,
            connect_args={"check_same_thread": False},
        )
        # Apply per-connection PRAGMAs (mirrors server.py listener so the
        # store works even if Pro server.py isn't loaded — e.g. tests).
        @event.listens_for(self.engine, "connect")
        def _set_pragma(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA busy_timeout=5000")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        SQLModel.metadata.create_all(self.engine, tables=[
            SessionMetadata.__table__,
        ])

    # ── read ─────────────────────────────────────────────────────────────

    def get(self, session_id: str) -> SessionMetadata | None:
        with Session(self.engine) as db:
            return db.get(SessionMetadata, session_id)

    def get_or_create(self, session_id: str) -> SessionMetadata:
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id)
            if row is None:
                row = SessionMetadata(session_id=session_id)
                db.add(row)
                db.commit()
                db.refresh(row)
            return row

    def list_by_session_ids(self, ids: list[str]) -> dict[str, SessionMetadata]:
        if not ids:
            return {}
        with Session(self.engine) as db:
            stmt = select(SessionMetadata).where(SessionMetadata.session_id.in_(ids))
            rows = db.exec(stmt).all()
            return {r.session_id: r for r in rows}

    def list_deleted_ids(self) -> list[str]:
        with Session(self.engine) as db:
            stmt = (
                select(SessionMetadata.session_id)
                .where(SessionMetadata.deleted_at.is_not(None))
            )
            return list(db.exec(stmt).all())

    # ── write ────────────────────────────────────────────────────────────

    def set_pinned(self, session_id: str, pinned: bool) -> SessionMetadata:
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id) or SessionMetadata(session_id=session_id)
            row.pinned = pinned
            row.pinned_at = _utcnow() if pinned else None
            row.updated_at = _utcnow()
            db.add(row)
            db.commit()
            db.refresh(row)
            return row

    def set_tags(self, session_id: str, tags: list[str]) -> SessionMetadata:
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id) or SessionMetadata(session_id=session_id)
            row.set_tags(tags)
            row.updated_at = _utcnow()
            db.add(row)
            db.commit()
            db.refresh(row)
            return row

    def soft_delete(self, session_id: str) -> SessionMetadata:
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id) or SessionMetadata(session_id=session_id)
            row.deleted_at = _utcnow()
            row.pinned = False  # un-pin on delete to keep Pinned section clean
            row.pinned_at = None
            row.updated_at = _utcnow()
            db.add(row)
            db.commit()
            db.refresh(row)
            return row

    def restore(self, session_id: str) -> SessionMetadata | None:
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id)
            if row is None:
                return None
            row.deleted_at = None
            row.updated_at = _utcnow()
            db.add(row)
            db.commit()
            db.refresh(row)
            return row

    def purge(self, session_id: str) -> bool:
        """Drop the metadata row entirely (caller is responsible for OSS row)."""
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id)
            if row is None:
                return False
            db.delete(row)
            db.commit()
            return True

    def mark_auto_titled(self, session_id: str) -> SessionMetadata:
        with Session(self.engine) as db:
            row = db.get(SessionMetadata, session_id) or SessionMetadata(session_id=session_id)
            row.auto_titled = True
            row.updated_at = _utcnow()
            db.add(row)
            db.commit()
            db.refresh(row)
            return row


@lru_cache(maxsize=1)
def metadata_store() -> SessionMetadataStore:
    """Module-level singleton — one engine per process."""
    return SessionMetadataStore()
