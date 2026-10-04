"""Device Provisioning use cases."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bounded_contexts.device_provisioning.infrastructure.models import ProvisioningSession
from app.bounded_contexts.device_provisioning.application.schemas import ClaimCodeCreate


class ProvisioningUseCases:
    def __init__(self, db: Session):
        self.db = db

    def create_claim_code(
        self, tenant_id: uuid.UUID, data: ClaimCodeCreate, created_by: Optional[uuid.UUID] = None
    ) -> ProvisioningSession:
        # Verify device belongs to tenant
        if data.device_id:
            from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                TenantDeviceMapping,
            )

            mapping = (
                self.db.query(TenantDeviceMapping)
                .filter(
                    TenantDeviceMapping.device_id == data.device_id,
                    TenantDeviceMapping.tenant_id == tenant_id,
                )
                .first()
            )
            if not mapping:
                raise ValueError("Device not found or not accessible")

        # Generate unique claim code
        claim_code = secrets.token_urlsafe(32)

        session = ProvisioningSession(
            id=uuid.uuid4(),
            device_id=data.device_id,
            tenant_id=tenant_id,
            claim_code=claim_code,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=data.expires_in_hours),
        )
        self.db.add(session)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise ValueError("Failed to generate unique claim code. Please try again.")
        self.db.refresh(session)
        return session

    def list_sessions(
        self,
        tenant_id: uuid.UUID,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[List[ProvisioningSession], int]:
        query = self.db.query(ProvisioningSession).filter(
            ProvisioningSession.tenant_id == tenant_id
        )

        if status:
            query = query.filter(ProvisioningSession.status == status)

        total = query.count()
        sessions = (
            query.order_by(ProvisioningSession.created_at.desc()).offset(skip).limit(limit).all()
        )

        return sessions, total

    def claim_device(
        self, claim_code: str, claimed_by: uuid.UUID, claimer_tenant_id: Optional[uuid.UUID] = None
    ) -> ProvisioningSession:
        """Claim a device using a claim code.

        Raises ValueError with a specific Vietnamese message on failure so
        the router can return a meaningful error to the frontend.
        """
        session = (
            self.db.query(ProvisioningSession)
            .filter(ProvisioningSession.claim_code == claim_code)
            .first()
        )

        if not session:
            raise ValueError("Mã claim không tồn tại hoặc không hợp lệ.")

        # Check expiration BEFORE status — a pending code past its expiry
        # should surface as "expired", not "already used".
        if session.expires_at and session.expires_at < datetime.now(timezone.utc):
            session.status = "expired"
            self.db.commit()
            raise ValueError("Mã claim đã hết hạn.")

        if session.status == "claimed":
            raise ValueError("Mã claim đã được sử dụng.")
        if session.status == "revoked":
            raise ValueError("Mã claim đã bị thu hồi.")
        if session.status != "pending":
            raise ValueError("Mã claim không ở trạng thái có thể sử dụng.")

        # P0 security fix: verify claimer belongs to the same tenant
        if claimer_tenant_id and session.tenant_id and claimer_tenant_id != session.tenant_id:
            raise ValueError("Mã claim không thuộc tenant của bạn.")

        session.status = "claimed"
        session.claimed_at = datetime.now(timezone.utc)
        session.claimed_by = claimed_by

        # Assign device to tenant if device_id and tenant_id are set
        if session.device_id and session.tenant_id:
            self._assign_device_to_tenant(session.device_id, session.tenant_id)

        self.db.commit()
        self.db.refresh(session)
        return session

    def _assign_device_to_tenant(self, device_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
        """Create tenant-device mapping and sync devices.tenant_id."""
        from app.bounded_contexts.tenant_management.infrastructure.repositories import assign_device

        assign_device(self.db, tenant_id, device_id)

    def revoke_claim(self, tenant_id: uuid.UUID, session_id: uuid.UUID) -> bool:
        session = (
            self.db.query(ProvisioningSession)
            .filter(
                ProvisioningSession.id == session_id,
                ProvisioningSession.tenant_id == tenant_id,
            )
            .first()
        )

        if not session:
            return False

        if session.status != "pending":
            return False

        session.status = "revoked"
        self.db.commit()
        return True

    def get_session(
        self, tenant_id: uuid.UUID, session_id: uuid.UUID
    ) -> Optional[ProvisioningSession]:
        return (
            self.db.query(ProvisioningSession)
            .filter(
                ProvisioningSession.id == session_id,
                ProvisioningSession.tenant_id == tenant_id,
            )
            .first()
        )
