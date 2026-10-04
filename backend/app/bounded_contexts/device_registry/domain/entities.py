"""Device Registry domain entities.

The Device entity is defined as a SQLAlchemy ORM model in
infrastructure/persistence/models.py.  This module re-exports it for
convenience so that application and presentation layers can import from
the domain layer without reaching into infrastructure.

Design note: In a strict Clean Architecture implementation, the domain
entity would be a plain Python class separate from the ORM model.  For
this graduation project, we use the ORM model directly as the domain
entity to avoid mapping overhead.  The trade-off is documented here.

See: app/bounded_contexts/README.md — "Domain Entity Strategy"
"""

from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

__all__ = ["Device"]
