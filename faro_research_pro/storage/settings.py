"""Pro settings — runtime-configurable values stored in SQLite.

Two layers of config:

  1. .env / process env  — secrets + base infrastructure (LLM keys, DB
     path, listening port). Set at deploy time, edit needs restart.
  2. pro_settings table  — UI-editable values (brand customization,
     default toggles, auto-title prefs, retention days, theme). Edit
     takes effect immediately on next request.

Layout: simple key/value table. Values are JSON-encoded so booleans,
numbers, lists all work without a typed-column-per-key zoo.
"""

from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from typing import Any

from faro_research.config import settings as faro_settings
from sqlalchemy import event
from sqlmodel import Field, Session, SQLModel, create_engine, select


def _utcnow() -> datetime:
    return datetime.utcnow()


# Defaults — what the UI shows when no override is stored.
DEFAULTS: dict[str, Any] = {
    # Section 3 — Agent behavior
    "agent.default_collab": False,
    "agent.collab_max_rounds": 2,
    "agent.skills_enabled": True,
    "agent.memory_enabled": True,
    # Section 4 — Session defaults
    "session.auto_title_enabled": True,
    "session.auto_title_use_small_model": True,
    "session.trash_retention_days": 30,
    # Section 5 — Brand / PDF
    "brand.project_name": "Faro Research Pro",
    "brand.tagline": "AGPL · 多 agent A 股研究",
    "brand.project_url": "https://github.com/alonegg/faro-research-pro",
    "brand.accent_color": "#7a3cf3",
    "brand.accent_dark": "#6028d9",
    "brand.author": "Faro Research",
    "brand.confidential": False,
    # Section 8 — Audit
    "audit.record_query_text": True,
    # Section 10 — Appearance (also stored client-side as fallback)
    "ui.theme": "light",
    "ui.font_size": 0,  # -1 / 0 / +1
    "ui.sidebar_width": 260,
    "ui.language": "zh-CN",
}


class ProSetting(SQLModel, table=True):
    __tablename__ = "pro_settings"

    key: str = Field(primary_key=True, max_length=64)
    value: str  # JSON-encoded
    updated_at: datetime = Field(default_factory=_utcnow)


class ProSettingsStore:
    """Key/value store with JSON marshaling on top of SQLite."""

    def __init__(self, db_path=None) -> None:
        path = db_path or faro_settings.db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            f"sqlite:///{path}",
            echo=False,
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(self.engine, "connect")
        def _set_pragma(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA busy_timeout=5000")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        SQLModel.metadata.create_all(self.engine, tables=[ProSetting.__table__])

    def get(self, key: str, default: Any = None) -> Any:
        with Session(self.engine) as db:
            row = db.get(ProSetting, key)
            if row is None:
                return DEFAULTS.get(key, default)
            try:
                return json.loads(row.value)
            except Exception:
                return DEFAULTS.get(key, default)

    def set(self, key: str, value: Any) -> None:
        with Session(self.engine) as db:
            row = db.get(ProSetting, key)
            payload = json.dumps(value, ensure_ascii=False)
            if row is None:
                row = ProSetting(key=key, value=payload, updated_at=_utcnow())
            else:
                row.value = payload
                row.updated_at = _utcnow()
            db.add(row)
            db.commit()

    def all(self) -> dict[str, Any]:
        """Return defaults merged with stored overrides."""
        out = dict(DEFAULTS)
        with Session(self.engine) as db:
            rows = db.exec(select(ProSetting)).all()
            for r in rows:
                try:
                    out[r.key] = json.loads(r.value)
                except Exception:
                    pass
        return out

    def patch(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Apply many at once; returns the new merged state."""
        with Session(self.engine) as db:
            for key, value in updates.items():
                row = db.get(ProSetting, key)
                payload = json.dumps(value, ensure_ascii=False)
                if row is None:
                    row = ProSetting(key=key, value=payload, updated_at=_utcnow())
                else:
                    row.value = payload
                    row.updated_at = _utcnow()
                db.add(row)
            db.commit()
        return self.all()


@lru_cache(maxsize=1)
def settings_store() -> ProSettingsStore:
    return ProSettingsStore()
