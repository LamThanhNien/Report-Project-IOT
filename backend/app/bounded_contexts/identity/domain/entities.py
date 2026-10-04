"""Identity domain — User entity.

This is the canonical User entity for the identity bounded context.
It re-uses the existing SQLAlchemy model from app.modules.auth.model
to avoid breaking the ORM metadata or existing migrations.
"""

# Re-export the existing User model as the domain entity.
# In a future phase, this could become a pure domain model with
# the ORM model moved to infrastructure/persistence.
from app.modules.auth.model import User

__all__ = ["User"]
