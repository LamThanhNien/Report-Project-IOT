import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.bounded_contexts.identity.domain.value_objects import is_supported_role
from app.modules.auth.model import User



def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def get_user_by_id(db: Session, user_id: uuid.UUID | str) -> User | None:
    if isinstance(user_id, str):
        try:
            user_id = uuid.UUID(user_id)
        except ValueError:
            return None
    return db.scalar(select(User).where(User.id == user_id))


def create_user(
    db: Session,
    email: str,
    hashed_password: str,
    full_name: str | None = None,
    role: str = "viewer",
) -> User:
    if not is_supported_role(role):
        raise ValueError("Unsupported user role")
    user = User(
        email=email,
        hashed_password=hashed_password,
        full_name=full_name,
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
