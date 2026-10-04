import uuid
from typing import Callable
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.bounded_contexts.identity.domain.value_objects import is_supported_role
from app.db.session import get_db
from app.bounded_contexts.identity.infrastructure.persistence.models import User
from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
    TenantProject,
    ProjectMember,
)


def verify_project_access(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TenantProject:
    """
    FastAPI Dependency Guard preventing IDOR and enforcing Matrix RBAC.
    Validates that:
    1. The target TenantProject exists.
    2. The target project belongs to the current user's Tenant (or user is system admin).
    3. The user has access (Tenant Owner OR assigned in ProjectMember).
    """
    if not is_supported_role(current_user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Unsupported user role")

    project = db.query(TenantProject).filter(TenantProject.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Global system admins
    if current_user.role == "admin":
        return project

    # Verify tenant boundary
    if current_user.tenant_id != project.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Tenant owners have automatic full access to all projects in their tenant
    if current_user.role == "tenant_owner":
        return project

    # Check project-level membership (Matrix RBAC)
    membership = (
        db.query(ProjectMember)
        .filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
        .first()
    )

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You are not assigned to this project workspace",
        )

    return project


def require_project_role(*allowed_roles: str) -> Callable:
    """
    Dependency factory to enforce specific Project Roles (e.g. project_admin, project_operator).
    """

    def dependency(
        project_id: uuid.UUID,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> ProjectMember | None:
        verify_project_access(project_id, current_user, db)

        # Tenant owners/admins bypass project-level role restrictions
        if current_user.role in ("admin", "tenant_owner"):
            return None

        membership = (
            db.query(ProjectMember)
            .filter(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == current_user.id,
            )
            .first()
        )

        if not membership or (allowed_roles and membership.role not in allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: Requires project role in {allowed_roles}",
            )

        return membership

    return dependency
