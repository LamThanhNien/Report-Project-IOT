from app.bounded_contexts.identity.domain.value_objects import is_supported_role

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.bounded_contexts.identity.application.services import (
    TokenBlacklistUnavailable,
    decode_token_claims,
    is_token_blacklisted,
)
from app.core.auth_cookies import get_access_token_from_request
from app.db.session import get_db
from app.modules.auth import repository
from app.modules.auth.model import User
from app.modules.auth.service import decode_access_token

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
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
    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
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

    from app.core.tenant_context import current_tenant_id_context, current_user_role_context
    from app.db.session import postgres_rls_bypass, sync_tenant_context_in_pg

    if claims:
        token_tenant_id = claims.get("tenant_id")
        token_role = claims.get("role")
        if token_tenant_id is not None or token_role is not None:
            current_tenant_id_context.set(token_tenant_id)
            current_user_role_context.set(token_role)
            await run_in_threadpool(sync_tenant_context_in_pg, db)

    def _fetch_user():
        with postgres_rls_bypass(db):
            user = repository.get_user_by_id(db, user_id)
            if user is None or not user.is_active or not is_supported_role(user.role):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found or inactive",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            # For tenant users, verify the tenant itself is active
            if user.tenant_id is not None:
                from app.modules.tenants import repository as tenant_repo

                tenant = tenant_repo.get_tenant(db, user.tenant_id)
                if tenant is None or not tenant.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Tenant is disabled",
                    )
            return user

    from fastapi.concurrency import run_in_threadpool

    user = await run_in_threadpool(_fetch_user)

    current_tenant_id_context.set(user.tenant_id)
    current_user_role_context.set(user.role)
    await run_in_threadpool(sync_tenant_context_in_pg, db)

    return user


def get_current_user_from_token(token: str, db: Session) -> User:
    """Authenticate a user from a raw JWT token string.

    Used by legacy non-browser paths that have already extracted a token.
    Browser SSE now uses cookie authentication through get_current_user().
    """
    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    # Check token blacklist to respect server-side revocation (logout)
    claims = decode_token_claims(token)
    if claims and claims.get("jti"):
        try:
            blacklisted = is_token_blacklisted(claims["jti"], db)
        except TokenBlacklistUnavailable as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Token revocation service is unavailable",
            ) from exc
        if blacklisted:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
            )
    from app.db.session import postgres_rls_bypass, sync_tenant_context_in_pg

    with postgres_rls_bypass(db):
        user = repository.get_user_by_id(db, user_id)
        if user is None or not user.is_active or not is_supported_role(user.role):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )
        # For tenant users, verify the tenant itself is active
        if user.tenant_id is not None:
            from app.modules.tenants import repository as tenant_repo

            tenant = tenant_repo.get_tenant(db, user.tenant_id)
            if tenant is None or not tenant.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tenant is disabled",
                )

    from app.core.tenant_context import current_tenant_id_context, current_user_role_context

    current_tenant_id_context.set(user.tenant_id)
    current_user_role_context.set(user.role)
    sync_tenant_context_in_pg(db)
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return current_user
