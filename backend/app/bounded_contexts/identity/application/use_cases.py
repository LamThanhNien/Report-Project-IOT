"""Identity application — use cases.

Each use case encapsulates a single business operation.
They depend on repository interfaces (ports) and domain services,
not on FastAPI, SQLAlchemy, or any infrastructure detail.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from app.bounded_contexts.identity.domain.value_objects import is_supported_role

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Port interfaces (what the use cases need from infrastructure)
# ---------------------------------------------------------------------------


class UserRepository(Protocol):
    """Port: user persistence."""

    def get_by_email(self, email: str) -> object | None: ...

    def get_by_id(self, user_id: UUID | str) -> object | None: ...


class PasswordService(Protocol):
    """Port: password hashing and verification."""

    def hash_password(self, password: str) -> str: ...

    def verify_password(self, plain: str, hashed: str) -> bool: ...


class TokenService(Protocol):
    """Port: JWT token creation and decoding."""

    def create_access_token(self, subject: str, role: str = "") -> str: ...

    def decode_access_token(self, token: str) -> str | None: ...


class AuditLogger(Protocol):
    """Port: audit event logging."""

    def log_login(self, user_id: UUID, tenant_id: UUID | None, email: str, role: str) -> None: ...


# ---------------------------------------------------------------------------
# Use case: Login
# ---------------------------------------------------------------------------


@dataclass
class LoginResult:
    access_token: str
    user_id: str
    email: str
    role: str


class LoginUseCase:
    """Authenticate a user and return a JWT token."""

    def __init__(
        self,
        user_repo: UserRepository,
        password_svc: PasswordService,
        token_svc: TokenService,
        audit: AuditLogger,
    ) -> None:
        self._user_repo = user_repo
        self._password_svc = password_svc
        self._token_svc = token_svc
        self._audit = audit

    def execute(self, email: str, password: str) -> LoginResult:
        user = self._user_repo.get_by_email(email)

        if user is None or not user.is_active or not is_supported_role(user.role):
            reason = "user not found" if user is None else "inactive"
            logger.warning("[AUTH FAILED] email=%s reason=%s", email, reason)
            raise AuthenticationError("Invalid email or password")

        if not self._password_svc.verify_password(password, user.hashed_password):
            logger.warning("[AUTH FAILED] email=%s reason=%s", email, "wrong password")
            raise AuthenticationError("Invalid email or password")

        token = self._token_svc.create_access_token(str(user.id), user.role)
        logger.info("[AUTH] login email=%s role=%s", user.email, user.role)

        self._audit.log_login(
            user_id=user.id,
            tenant_id=user.tenant_id,
            email=user.email,
            role=user.role,
        )

        return LoginResult(
            access_token=token,
            user_id=str(user.id),
            email=user.email,
            role=user.role,
        )


# ---------------------------------------------------------------------------
# Use case: Get current user
# ---------------------------------------------------------------------------


class GetCurrentUserUseCase:
    """Resolve the current user from a JWT token."""

    def __init__(
        self,
        user_repo: UserRepository,
        token_svc: TokenService,
    ) -> None:
        self._user_repo = user_repo
        self._token_svc = token_svc

    def execute(self, token: str) -> object:
        """Return the User entity or raise AuthenticationError."""
        user_id = self._token_svc.decode_access_token(token)
        if user_id is None:
            raise AuthenticationError("Invalid or expired token")

        user = self._user_repo.get_by_id(user_id)
        if user is None or not user.is_active or not is_supported_role(user.role):
            raise AuthenticationError("User not found or inactive")

        return user


# ---------------------------------------------------------------------------
# Domain-level exceptions (presentation layer maps these to HTTP responses)
# ---------------------------------------------------------------------------


class AuthenticationError(Exception):
    """Raised when authentication fails (bad credentials, expired token, etc.)."""

    def __init__(self, detail: str = "Authentication failed") -> None:
        self.detail = detail
        super().__init__(detail)


class AuthorizationError(Exception):
    """Raised when a user lacks the required role."""

    def __init__(self, detail: str = "Insufficient permissions") -> None:
        self.detail = detail
        super().__init__(detail)
