"""Shared configuration.

Re-exports from app.core.config for use within the shared/infrastructure layer.
This preserves backward compatibility while establishing the new structure.

In a future phase, app.core.config will be deprecated and this will become
the canonical import path.
"""

from app.core.config import Settings, get_settings, settings

__all__ = ["Settings", "get_settings", "settings"]
