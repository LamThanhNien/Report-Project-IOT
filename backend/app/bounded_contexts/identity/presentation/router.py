"""Identity presentation — FastAPI router.

This router implements the /api/v1/auth/* endpoints.
It uses the application use cases and infrastructure adapters
rather than directly calling repository/service functions.

The router is functionally equivalent to app.modules.auth.router
but follows the bounded context architecture.
"""

from typing import Optional
import logging
import re
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bounded_contexts.identity.domain.value_objects import is_supported_role
from app.db.session import get_db, postgres_rls_bypass, sync_tenant_context_in_pg
from app.core.auth_cookies import (
    clear_auth_cookies,
    get_access_token_from_request,
    get_refresh_token_from_request,
    set_auth_cookies,
)
from app.core.config import settings
from app.modules.auth.model import User
from app.modules.auth.schema import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserProfileUpdate,
    UserRead,
)
from pydantic import BaseModel
from app.modules.audit import service as audit_service
from app.modules.tenants.model import Tenant
from app.modules.tenants.repository import get_plan_by_name, get_tenant_by_slug, get_tenant
from app.bounded_contexts.identity.infrastructure.adapters import (
    BcryptPasswordService,
    JwtTokenService,
    SqlAlchemyUserRepository,
)
from app.bounded_contexts.identity.application.services import (
    TokenBlacklistUnavailable,
    blacklist_token,
    create_refresh_token,
    decode_refresh_token,
    decode_token_claims,
    is_token_blacklisted,
)
from app.bounded_contexts.identity.presentation.dependencies import get_current_user
from app.core.tenant_context import current_tenant_id_context, current_user_role_context

logger = logging.getLogger(__name__)
router = APIRouter()
_limiter = Limiter(key_func=get_remote_address)


def _token_response(
    request: Request,
    response: Response,
    access_token: str,
    refresh_token: str,
    user: UserRead | None,
) -> TokenResponse:
    if request.headers.get("origin") or request.headers.get("sec-fetch-site"):
        set_auth_cookies(response, access_token, refresh_token)
    return TokenResponse(
        access_token=access_token if settings.auth_legacy_token_response else None,
        refresh_token=refresh_token if settings.auth_legacy_token_response else None,
        user=user,
    )


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "tenant"


def _sync_authenticated_user_context(db: Session, user: User) -> None:
    current_tenant_id_context.set(user.tenant_id)
    current_user_role_context.set(user.role)
    sync_tenant_context_in_pg(db)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@_limiter.limit("3/minute")
def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Create a new tenant workspace and its tenant_owner account.

    Public registration is intentionally limited to tenant_owner users.
    It must never create platform admins or expose tenant/device data.
    """
    repo = SqlAlchemyUserRepository(db)
    password_svc = BcryptPasswordService()
    token_svc = JwtTokenService()

    email = payload.owner_email.lower()
    slug = _slugify(payload.tenant_slug or payload.tenant_name)

    with postgres_rls_bypass(db):
        if repo.get_by_email(email):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already exists")
        if get_tenant_by_slug(db, slug):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Workspace slug already exists")

        trial_plan = get_plan_by_name(db, "trial") or get_plan_by_name(db, "Trial")
        try:
            tenant = Tenant(
                name=payload.tenant_name, slug=slug, plan_id=trial_plan.id if trial_plan else None
            )
            db.add(tenant)
            db.flush()
            owner = User(
                email=email,
                hashed_password=password_svc.hash_password(payload.owner_password),
                full_name=payload.owner_full_name,
                role="tenant_owner",
                tenant_id=tenant.id,
                is_active=True,
            )
            db.add(owner)
            db.flush()

            # Extract IDs and roles before commit to prevent lazy-loading issues due to transaction ending
            tenant_id = tenant.id
            owner_role = owner.role

            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status.HTTP_409_CONFLICT, detail="Workspace or email already exists"
            )

    # Set context variables and sync context in PostgreSQL prior to refreshing objects
    current_tenant_id_context.set(tenant_id)
    current_user_role_context.set(owner_role)
    sync_tenant_context_in_pg(db)

    # Safely refresh objects since the session is now synchronized with the tenant ID
    db.refresh(owner)
    db.refresh(tenant)

    logger.info("[AUTH] register tenant=%s owner=%s", tenant.slug, owner.email)
    try:
        audit_service.log_event_best_effort(
            db,
            action="register_tenant",
            user_id=owner.id,
            tenant_id=tenant.id,
            resource_type="tenant",
            resource_id=str(tenant.id),
            detail={"tenant_slug": tenant.slug, "owner_email": owner.email},
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        logger.warning("[AUTH] Audit logging failed for register (non-fatal)", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
    token = token_svc.create_access_token(str(owner.id), owner.role)
    refresh = create_refresh_token(str(owner.id))
    try:
        user_read = UserRead.model_validate(owner)
    except Exception:
        user_read = None
    return _token_response(request, response, token, refresh, user_read)


@router.post("/login", response_model=TokenResponse)
@_limiter.limit("5/minute")
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Authenticate a user and return a JWT token."""
    repo = SqlAlchemyUserRepository(db)
    password_svc = BcryptPasswordService()
    token_svc = JwtTokenService()

    with postgres_rls_bypass(db):
        user = repo.get_by_email(payload.email)
        # User not found or wrong password -> 401 (indistinguishable to prevent enumeration)
        if (
            user is None
            or not is_supported_role(user.role)
            or not password_svc.verify_password(payload.password, user.hashed_password)
        ):
            reason = "user not found" if user is None else (
                "unsupported role" if not is_supported_role(user.role) else "wrong password"
            )
            logger.warning("[AUTH FAILED] email=%s reason=%s", payload.email, reason)
            audit_service.log_event_best_effort(
                db,
                action="login",
                user_id=user.id if user else None,
                tenant_id=user.tenant_id if user else None,
                resource_type="user",
                resource_id=str(user.id) if user else None,
                detail={"email": payload.email.lower(), "reason": reason},
                ip_address=request.client.host if request.client else None,
                outcome="failure",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        # Account disabled -> 403 (must come after password check to avoid leaking existence)
        if not user.is_active:
            logger.warning("[AUTH FAILED] email=%s reason=account_disabled", payload.email)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled. Contact your administrator.",
            )
        # Block login for users belonging to disabled tenants
        if user.tenant_id is not None:
            tenant = get_tenant(db, user.tenant_id)
            if tenant is None or not tenant.is_active:
                logger.warning("[AUTH FAILED] email=%s reason=tenant_disabled", payload.email)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tenant is disabled. Contact your administrator.",
                )
    _sync_authenticated_user_context(db, user)
    token = token_svc.create_access_token(str(user.id), user.role)
    refresh = create_refresh_token(str(user.id))
    logger.info("[AUTH] login email=%s role=%s", user.email, user.role)
    try:
        audit_service.log_event_best_effort(
            db,
            action="login",
            user_id=user.id,
            tenant_id=user.tenant_id,
            resource_type="user",
            resource_id=str(user.id),
            detail={"email": user.email, "role": user.role},
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        # Audit failure must NEVER block login.  Roll back the session so the
        # connection is clean for the response serialization below.
        logger.warning("[AUTH] Audit logging failed for login (non-fatal)", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
    try:
        user_read = UserRead.model_validate(user)
    except Exception:
        user_read = None
    return _token_response(request, response, token, refresh, user_read)


@router.post("/logout", status_code=status.HTTP_200_OK)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Server-side logout.

    Clears browser auth cookies and blacklists both the access token and the
    refresh token when they can be decoded.  Missing/expired tokens still get
    a clean client logout.
    """
    from datetime import datetime, timezone

    token = get_access_token_from_request(request)
    refresh = get_refresh_token_from_request(request)
    # Always clear cookies first — the client must log out even if the server
    # cannot blacklist the token (e.g. blacklist store is down).
    clear_auth_cookies(response)

    _blacklisted_something = False

    # --- Blacklist access token ---
    if token:
        claims = decode_token_claims(token)
        if claims and claims.get("jti"):
            try:
                exp_ts = claims.get("exp", 0)
                expires_at = (
                    datetime.fromtimestamp(exp_ts, tz=timezone.utc)
                    if exp_ts
                    else datetime.now(timezone.utc)
                )
                blacklist_token(
                    jti=claims["jti"],
                    token_type=claims.get("type", "access"),
                    user_id=str(claims.get("sub") or ""),
                    reason="logout",
                    expires_at=expires_at,
                    db_session=db,
                )
                _blacklisted_something = True
                logger.info("[AUTH] logout — access token blacklisted jti=%s", claims["jti"][:8])
            except TokenBlacklistUnavailable:
                logger.warning(
                    "[AUTH] logout - blacklist unavailable, access token NOT revoked server-side"
                )

    # --- Blacklist refresh token ---
    if refresh:
        rclaims = decode_token_claims(refresh)
        if rclaims and rclaims.get("jti"):
            try:
                exp_ts = rclaims.get("exp", 0)
                expires_at = (
                    datetime.fromtimestamp(exp_ts, tz=timezone.utc)
                    if exp_ts
                    else datetime.now(timezone.utc)
                )
                blacklist_token(
                    jti=rclaims["jti"],
                    token_type=rclaims.get("type", "refresh"),
                    user_id=str(rclaims.get("sub") or ""),
                    reason="logout",
                    expires_at=expires_at,
                    db_session=db,
                )
                _blacklisted_something = True
                logger.info("[AUTH] logout — refresh token blacklisted jti=%s", rclaims["jti"][:8])
            except TokenBlacklistUnavailable:
                logger.warning(
                    "[AUTH] logout - blacklist unavailable, refresh token NOT revoked server-side"
                )

    if not token and not refresh:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    actor_id = None
    for candidate in (token, refresh):
        candidate_claims = decode_token_claims(candidate) if candidate else None
        try:
            actor_id = UUID(str(candidate_claims.get("sub"))) if candidate_claims else None
        except (TypeError, ValueError):
            actor_id = None
        if actor_id:
            break
    audit_service.log_event_best_effort(
        db,
        action="logout",
        user_id=actor_id,
        resource_type="user",
        resource_id=str(actor_id) if actor_id else None,
        detail={"tokens_revoked": _blacklisted_something},
        ip_address=request.client.host if request.client else None,
        outcome="success",
    )

    return {"detail": "logged out"}


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


@router.post("/refresh", response_model=TokenResponse)
@_limiter.limit("10/minute")
def refresh_token(
    request: Request,
    response: Response,
    payload: Optional[RefreshRequest] = Body(default=None),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Exchange a refresh token for a new access + refresh token pair.

    The refresh token must be valid and of type 'refresh'. On success, both
    tokens are rotated and the old refresh token is blacklisted.
    """
    # Decode claims first for blacklist check
    presented_refresh_token = (
        payload.refresh_token
        if payload and payload.refresh_token
        else get_refresh_token_from_request(request)
    )
    if not presented_refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = decode_token_claims(presented_refresh_token)
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = decode_refresh_token(presented_refresh_token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if the refresh token has been blacklisted after signature/type validation.
    jti = claims.get("jti")
    if jti:
        try:
            blacklisted = is_token_blacklisted(jti, db)
        except TokenBlacklistUnavailable as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Token revocation service is unavailable",
            ) from exc
        if blacklisted:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

    repo = SqlAlchemyUserRepository(db)
    with postgres_rls_bypass(db):
        user = repo.get_by_id(user_id)
        if user is None or not user.is_active or not is_supported_role(user.role):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
                headers={"WWW-Authenticate": "Bearer"},
            )
        # Block refresh for users belonging to disabled tenants
        if user.tenant_id is not None:
            tenant = get_tenant(db, user.tenant_id)
            if tenant is None or not tenant.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tenant is disabled. Contact your administrator.",
                )

    _sync_authenticated_user_context(db, user)

    # Blacklist the old refresh token (rotation)
    if jti:
        try:
            from datetime import datetime, timezone

            exp_ts = claims.get("exp", 0)
            expires_at = (
                datetime.fromtimestamp(exp_ts, tz=timezone.utc)
                if exp_ts
                else datetime.now(timezone.utc)
            )
            blacklist_token(
                jti=jti,
                token_type="refresh",
                user_id=str(user.id),
                reason="refresh_rotation",
                expires_at=expires_at,
                db_session=db,
            )
        except TokenBlacklistUnavailable as exc:
            logger.exception("[AUTH] refresh - blacklist old token failed")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Token revocation service is unavailable",
            ) from exc

    token_svc = JwtTokenService()
    new_access = token_svc.create_access_token(str(user.id), user.role)
    new_refresh = create_refresh_token(str(user.id))
    logger.info("[AUTH] token refresh email=%s role=%s", user.email, user.role)
    audit_service.log_event_best_effort(
        db,
        action="token.refresh",
        user_id=user.id,
        tenant_id=user.tenant_id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        outcome="success",
    )
    try:
        user_read = UserRead.model_validate(user)
    except Exception:
        user_read = None
    return _token_response(request, response, new_access, new_refresh, user_read)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> UserRead:
    """Return the currently authenticated user."""
    return UserRead.model_validate(current_user)


@router.patch("/me", response_model=UserRead)
def update_me(
    payload: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    """Update editable profile fields for the currently authenticated user."""
    current_user.full_name = payload.full_name
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    audit_service.log_event_best_effort(
        db,
        action="user.profile_update",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="user",
        resource_id=str(current_user.id),
        changed_fields=["full_name"],
        outcome="success",
    )
    return UserRead.model_validate(current_user)


@router.post("/change-password", status_code=status.HTTP_200_OK)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    password_svc = BcryptPasswordService()
    if not password_svc.verify_password(payload.current_password, current_user.hashed_password):
        audit_service.log_event_best_effort(
            db,
            action="change_password",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            resource_type="user",
            resource_id=str(current_user.id),
            detail={"reason": "current_password_mismatch"},
            outcome="failure",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if password_svc.verify_password(payload.new_password, current_user.hashed_password):
        audit_service.log_event_best_effort(
            db,
            action="change_password",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            resource_type="user",
            resource_id=str(current_user.id),
            detail={"reason": "password_reuse"},
            outcome="failure",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password",
        )
    current_user.hashed_password = password_svc.hash_password(payload.new_password)
    db.add(current_user)
    db.commit()
    audit_service.log_event_best_effort(
        db,
        action="change_password",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="user",
        resource_id=str(current_user.id),
        detail={},
        outcome="success",
    )
    return {"detail": "Password changed successfully"}
