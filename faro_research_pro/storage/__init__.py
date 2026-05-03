"""Pro-only persistence layer.

OSS' `session` table has only id/user_id/title/created_at/updated_at.
Pro adds a side-table keyed by `session_id` with extra metadata
(pinned, tags, soft-delete tombstone, auto-title flag) so we don't
have to fork the OSS schema.
"""

from .metadata import (
    SessionMetadata,
    SessionMetadataStore,
    metadata_store,
)
from .settings import (
    DEFAULTS as SETTINGS_DEFAULTS,
    ProSetting,
    ProSettingsStore,
    settings_store,
)

__all__ = [
    "SessionMetadata", "SessionMetadataStore", "metadata_store",
    "ProSetting", "ProSettingsStore", "settings_store",
    "SETTINGS_DEFAULTS",
]
