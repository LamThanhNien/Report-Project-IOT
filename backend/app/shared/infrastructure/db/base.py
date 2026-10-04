"""Shared database base.

Re-exports from app.db.base for use within the shared/infrastructure layer.
This preserves backward compatibility while establishing the new structure.

In a future phase, app.db.base will be deprecated and this will become
the canonical import path.
"""

from app.db.base import Base

__all__ = ["Base"]
