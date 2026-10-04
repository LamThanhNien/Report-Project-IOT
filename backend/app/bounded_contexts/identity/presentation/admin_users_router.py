from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.bounded_contexts.identity.infrastructure.adapters import BcryptPasswordService
from app.bounded_contexts.identity.presentation.schemas import UserRead, validate_password_policy
from app.core.security import require_admin
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.auth.model import User

router = APIRouter(prefix="/admin/users/admins", tags=["admin-users"])


class AdminCreate(BaseModel):
    email: str
    full_name: str | None = Field(default=None, max_length=255)
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or "." not in value.rsplit("@", 1)[-1]:
            raise ValueError("email must be valid")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_password_policy(value)


class AdminUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)


def _get_admin(db: Session, user_id: UUID) -> User:
    user = db.query(User).filter(User.id == user_id, User.role == "admin").first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin user not found")
    return user


@router.get("", response_model=list[UserRead])
def list_admins(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> list[User]:
    return db.query(User).filter(User.role == "admin").order_by(User.created_at).all()


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_admin(
    payload: AdminCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> User:
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    user = User(
        email=payload.email,
        full_name=payload.full_name.strip() if payload.full_name else None,
        hashed_password=BcryptPasswordService().hash_password(payload.password),
        role="admin",
        tenant_id=None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit_service.log_event_best_effort(
        db,
        action="create_admin_user",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=str(user.id),
        detail={"email": user.email},
    )
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_admin(
    user_id: UUID,
    payload: AdminUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> User:
    user = _get_admin(db, user_id)
    user.full_name = payload.full_name.strip() if payload.full_name else None
    db.commit()
    db.refresh(user)
    audit_service.log_event_best_effort(
        db,
        action="update_admin_user",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=str(user.id),
        detail={"changed_fields": ["full_name"]},
    )
    return user


def _set_active(db: Session, user: User, current_admin: User, active: bool) -> User:
    if not active and user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot deactivate your own admin account",
        )
    user.is_active = active
    db.commit()
    db.refresh(user)
    audit_service.log_event_best_effort(
        db,
        action="activate_admin_user" if active else "deactivate_admin_user",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=str(user.id),
        detail={"email": user.email},
    )
    return user


@router.post("/{user_id}/activate", response_model=UserRead)
def activate_admin(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> User:
    return _set_active(db, _get_admin(db, user_id), current_admin, True)


@router.post("/{user_id}/deactivate", response_model=UserRead)
def deactivate_admin(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> User:
    return _set_active(db, _get_admin(db, user_id), current_admin, False)
