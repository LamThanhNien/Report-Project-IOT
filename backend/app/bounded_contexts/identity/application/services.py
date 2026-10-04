import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.bounded_contexts.identity.domain.value_objects import is_supported_role
from app.core.config import settings
from app.core.metrics import LEGACY_REFRESH_TOKEN_ACCEPTED

logger = logging.getLogger(__name__)


class TokenBlacklistUnavailable(RuntimeError):
    """Raised when token revocation storage cannot be queried or updated."""


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(subject: str, role: str = "") -> str:
    if role and not is_supported_role(role):
        raise ValueError("Unsupported user role")
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    jti = uuid.uuid4().hex
    payload: dict = {
        "sub": subject,
        "exp": expire,
        "type": "access",
        "jti": jti,
        "iat": now,
        "nbf": now,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    if role:
        payload["role"] = role
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(subject: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.auth_refresh_cookie_days)
    jti = uuid.uuid4().hex
    payload: dict = {
        "sub": subject,
        "exp": expire,
        "type": "refresh",
        "jti": jti,
        "iat": now,
        "nbf": now,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    return jwt.encode(payload, settings.jwt_refresh_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    """Decode and validate an access token. Returns user_id or None."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={
                "require_exp": True,
                "require_iat": True,
                "require_nbf": True,
                "require_iss": True,
                "require_aud": True,
                "require_sub": True,
            },
        )
        # Reject tokens without explicit type or with wrong type
        if payload.get("type") != "access":
            return None
        if not payload.get("jti"):
            return None
        if payload.get("role") is not None and not is_supported_role(payload["role"]):
            return None
        return payload.get("sub")
    except JWTError:
        return None


def decode_refresh_token(token: str) -> str | None:
    """Decode and validate a refresh token. Returns user_id or None."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_refresh_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={
                "require_exp": True,
                "require_iat": True,
                "require_nbf": True,
                "require_iss": True,
                "require_aud": True,
                "require_sub": True,
            },
        )
    except JWTError:
        # The keys are required to be distinct. A valid new-key token never reaches
        # this branch; legacy decode still verifies signature, expiry, subject and type.
        deadline = settings.jwt_migration_deadline
        if deadline is None or datetime.now(timezone.utc) > deadline:
            return None

        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
                options={
                    "verify_iss": False,
                    "verify_aud": False,
                    "require_exp": True,
                    "require_sub": True,
                },
            )
            if payload.get("type") == "refresh" and payload.get("jti"):
                LEGACY_REFRESH_TOKEN_ACCEPTED.inc()
                fingerprint = hashlib.sha256(str(payload["jti"]).encode("utf-8")).hexdigest()[:12]
                logger.warning(
                    "legacy_refresh_token_accepted token_fingerprint=%s migration_deadline=%s",
                    fingerprint,
                    deadline.isoformat(),
                )
                return payload.get("sub")
            return None
        except JWTError:
            return None

    if payload.get("type") != "refresh":
        return None
    if not payload.get("jti"):
        return None
    return payload.get("sub")


def decode_token_claims(token: str) -> dict | None:
    """Decode token without verification and return all claims (for blacklist lookup)."""
    try:
        # Decode without verification to get jti for blacklist check
        parts = token.split(".")
        if len(parts) != 3:
            return None
        import base64
        import json

        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return None


def is_token_blacklisted(jti: str, db_session) -> bool:
    """Check if a token jti is in the blacklist."""
    if not jti:
        return False
    try:
        from app.bounded_contexts.identity.infrastructure.persistence.token_blacklist import (
            BlacklistedToken,
        )
        from sqlalchemy import select

        stmt = select(BlacklistedToken).where(BlacklistedToken.jti == jti)
        result = db_session.scalar(stmt)
        # Verify the result is actually a BlacklistedToken instance
        # (test mocks may return arbitrary objects for all scalar queries)
        return isinstance(result, BlacklistedToken)
    except Exception as exc:
        # Roll back so a failed blacklist query does not poison later DB work.
        try:
            db_session.rollback()
        except Exception:
            pass
        raise TokenBlacklistUnavailable("Token blacklist storage is unavailable") from exc


def blacklist_token(
    jti: str,
    token_type: str,
    user_id: str,
    reason: str,
    expires_at: datetime,
    db_session,
) -> None:
    """Add a token to the blacklist."""
    if not jti:
        return
    try:
        from app.bounded_contexts.identity.infrastructure.persistence.token_blacklist import (
            BlacklistedToken,
        )

        entry = BlacklistedToken(
            jti=jti,
            token_type=token_type,
            user_id=user_id,
            reason=reason,
            expires_at=expires_at,
        )
        db_session.add(entry)
        db_session.commit()
    except Exception as exc:
        try:
            db_session.rollback()
        except Exception:
            pass
        raise TokenBlacklistUnavailable("Token blacklist storage is unavailable") from exc
