from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.modules.auth.model import User
from app.modules.tenants import repository, service as tenant_service

from app.bounded_contexts.identity.domain.value_objects import TENANT_ROLES


def get_current_tenant_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
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
    # Check that the tenant itself is active
    tenant = repository.get_tenant(db, current_user.tenant_id)
    if tenant is None or not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant is disabled",
        )
    return current_user


def require_tenant_owner(
    current_user: User = Depends(get_current_tenant_user),
) -> User:
    if current_user.role != "tenant_owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant owner role required",
        )
    return current_user


def require_tenant_write(
    current_user: User = Depends(get_current_tenant_user),
) -> User:
    """Deny write operations to viewer role."""
    if current_user.role != "tenant_owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role cannot perform write operations",
        )
    return current_user


def require_feature(feature_name: str):
    """
    Factory that returns a FastAPI dependency checking that the given feature
    is enabled for the current tenant user.
    """

    def _dep(
        current_user: User = Depends(get_current_tenant_user),
        db: Session = Depends(get_db),
    ) -> User:
        effective = tenant_service.get_effective_features(db, current_user.tenant_id)
        if not effective.get(feature_name, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feature '{feature_name}' is not enabled for your service plan.",
            )
        return current_user

    return Depends(_dep)
