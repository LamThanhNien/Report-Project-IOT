"""Shared database session.

Re-exports from app.db.session for use within the shared/infrastructure layer.
This preserves backward compatibility while establishing the new structure.

In a future phase, app.db.session will be deprecated and this will become
the canonical import path.
"""

from app.db.session import SessionLocal, engine, get_db

__all__ = ["SessionLocal", "engine", "get_db"]
