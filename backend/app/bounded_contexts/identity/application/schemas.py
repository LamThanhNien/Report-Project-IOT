"""Identity application — Pydantic schemas for auth requests/responses.

These are the presentation-layer DTOs.  They are kept here in the
application layer because they define the public contract of the
identity bounded context.
"""

from app.modules.auth.schema import LoginRequest, RegisterRequest, TokenResponse, UserRead

__all__ = ["LoginRequest", "RegisterRequest", "TokenResponse", "UserRead"]
