"""Identity infrastructure — adapters.

These adapters implement the port interfaces defined in the application
layer, using the existing app.modules.auth and app.core modules.

This is the ONLY layer in the identity bounded context that imports
SQLAlchemy, bcrypt, jose, or other infrastructure libraries.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.modules.auth.model import User
from app.modules.auth import repository as _legacy_repo
from app.modules.auth import service as _legacy_service

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Repository adapter (wraps existing app.modules.auth.repository)
# ---------------------------------------------------------------------------


class SqlAlchemyUserRepository:
    """SQLAlchemy-backed user repository.

    Wraps the existing app.modules.auth.repository functions
    behind the UserRepository port interface.
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_email(self, email: str) -> User | None:
        from app.db.session import postgres_rls_bypass

        with postgres_rls_bypass(self._db):
            return _legacy_repo.get_user_by_email(self._db, email)

    def get_by_id(self, user_id: uuid.UUID | str) -> User | None:
        from app.db.session import postgres_rls_bypass

        with postgres_rls_bypass(self._db):
            return _legacy_repo.get_user_by_id(self._db, user_id)

    def create_user(
        self,
        email: str,
        hashed_password: str,
        full_name: str | None = None,
        role: str = "viewer",
    ) -> User:
        return _legacy_repo.create_user(self._db, email, hashed_password, full_name, role)


# ---------------------------------------------------------------------------
# Password service adapter (wraps existing app.modules.auth.service)
# ---------------------------------------------------------------------------


class BcryptPasswordService:
    """Bcrypt-based password hashing service."""

    @staticmethod
    def hash_password(password: str) -> str:
        return _legacy_service.hash_password(password)

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        return _legacy_service.verify_password(plain, hashed)


# ---------------------------------------------------------------------------
# Token service adapter (wraps existing app.modules.auth.service)
# ---------------------------------------------------------------------------


class JwtTokenService:
    """JWT-based token service."""

    @staticmethod
    def create_access_token(subject: str, role: str = "") -> str:
        return _legacy_service.create_access_token(subject, role)

    @staticmethod
    def create_refresh_token(subject: str) -> str:
        return _legacy_service.create_refresh_token(subject)

    @staticmethod
    def decode_access_token(token: str) -> str | None:
        return _legacy_service.decode_access_token(token)

    @staticmethod
    def decode_refresh_token(token: str) -> str | None:
        return _legacy_service.decode_refresh_token(token)
