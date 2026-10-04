"""Shared logging configuration.

Re-exports from app.core.logging for use within the shared/infrastructure layer.
"""

from app.core.logging import configure_logging

__all__ = ["configure_logging"]
