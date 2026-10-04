"""Token blacklist model for server-side token revocation.

Stores revoked JWT tokens (by jti claim) to enable:
- Server-side logout (invalidates access + refresh tokens)
- Refresh token rotation (old refresh tokens are blacklisted)
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BlacklistedToken(Base):
    """A revoked JWT token identified by its jti claim."""

    __tablename__ = "blacklisted_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    token_type: Mapped[str] = mapped_column(String(16), nullable=False)  # "access" or "refresh"
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # "logout", "refresh_rotation", "admin_revoke"
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    blacklisted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON metadata

    __table_args__ = (Index("ix_blacklisted_tokens_expires_at", "expires_at"),)
