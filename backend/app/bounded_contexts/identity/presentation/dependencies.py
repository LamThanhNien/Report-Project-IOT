"""Identity presentation - FastAPI dependencies."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.bounded_contexts.identity.application.services import (
    TokenBlacklistUnavailable,
    decode_token_claims,
    is_token_blacklisted,
)
from app.bounded_contexts.identity.domain.value_objects import TENANT_ROLES, is_supported_role
from app.modules.tenants import repository as _tenant_repo
from app.bounded_contexts.identity.infrastructure.adapters import (
    BcryptPasswordService,
    JwtTokenService,
    SqlAlchemyUserRepository,
)
from app.db.session import get_db
from app.modules.auth.model import User
from app.core.auth_cookies import get_access_token_from_request

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current user from the JWT bearer token.

    Checks:
    1. Token signature and expiry
    2. Token type is 'access'
    3. Token is not blacklisted (server-side revocation)
    4. User exists and is active
    """
    token = (
        credentials.credentials
        if credentials is not None
        else get_access_token_from_request(request)
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    repo = SqlAlchemyUserRepository(db)
    token_svc = JwtTokenService()

    user_id = token_svc.decode_access_token(token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check blacklist after signature/type validation so malformed tokens return 401.
    claims = decode_token_claims(token)
    if claims and claims.get("jti"):
        from fastapi.concurrency import run_in_threadpool

        try:
            blacklisted = await run_in_threadpool(is_token_blacklisted, claims["jti"], db)
        except TokenBlacklistUnavailable as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Token revocation service is unavailable",
            ) from exc
        if blacklisted:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

    from app.db.session import postgres_rls_bypass, sync_tenant_context_in_pg

    def _fetch_user():
        with postgres_rls_bypass(db):
            user = repo.get_by_id(user_id)
            if user is None or not user.is_active or not is_supported_role(user.role):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found or inactive",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            if user.tenant_id is not None:
                tenant = _tenant_repo.get_tenant(db, user.tenant_id)
                if tenant is None or not tenant.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Tenant is disabled",
                    )
            return user

    from fastapi.concurrency import run_in_threadpool

    user = await run_in_threadpool(_fetch_user)

    from app.core.tenant_context import current_tenant_id_context, current_user_role_context

    current_tenant_id_context.set(user.tenant_id)
    current_user_role_context.set(user.role)
    await run_in_threadpool(sync_tenant_context_in_pg, db)

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Require the current user to have the admin role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return current_user


def get_current_tenant_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Require the current user to be a tenant user (not admin)."""
    if current_user.role not in TENANT_ROLES or current_user.tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant user access required",
        )
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )
    # Verify the tenant itself is active
    tenant = _tenant_repo.get_tenant(db, current_user.tenant_id)
    if tenant is None or not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant is disabled",
        )
    return current_user


def require_tenant_owner(current_user: User = Depends(get_current_tenant_user)) -> User:
    """Require the current user to be a tenant owner."""
    if current_user.role != "tenant_owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant owner role required",
        )
    return current_user


def require_tenant_write(current_user: User = Depends(get_current_tenant_user)) -> User:
    """Deny write operations to viewer role."""
    if current_user.role != "tenant_owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role cannot perform write operations",
        )
    return current_user


def get_password_service() -> BcryptPasswordService:
    return BcryptPasswordService()


def get_token_service() -> JwtTokenService:
    return JwtTokenService()


def get_user_repository(db: Session = Depends(get_db)) -> SqlAlchemyUserRepository:
    return SqlAlchemyUserRepository(db)
