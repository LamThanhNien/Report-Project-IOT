"""Device Group use cases."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
    DeviceGroup,
    DeviceGroupMember,
)
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
    TenantDeviceMapping,
)
from app.bounded_contexts.device_groups.application.schemas import (
    DeviceGroupCreate,
    DeviceGroupUpdate,
)

try:
    from app.bounded_contexts.billing.application.use_cases import QuotaService
except ModuleNotFoundError:  # Billing is restored in a later feature slice.
    QuotaService = None  # type: ignore[assignment]


class DeviceGroupUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.quota = QuotaService(db) if QuotaService is not None else None

    def create_group(
        self, tenant_id: uuid.UUID, data: DeviceGroupCreate, created_by: Optional[uuid.UUID] = None
    ) -> DeviceGroup:
        # Quota enforcement
        if self.quota is not None:
            quota = self.quota.check_quota(tenant_id, "device_groups", 1)
            if not quota["allowed"]:
                raise ValueError(
                    f"Quota exceeded: device_groups limit is {quota['limit']}, "
                    f"current usage is {quota['current']}"
                )

        group = DeviceGroup(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=data.name,
            description=data.description,
            group_type=data.group_type,
            tags=data.tags,
            extra_metadata=data.metadata,
            created_by=created_by,
        )
        self.db.add(group)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise ValueError(f"Device group with name '{data.name}' already exists in this tenant")
        self.db.refresh(group)

        # Consume quota after successful creation
        if self.quota is not None:
            self.quota.consume_usage(tenant_id, "device_groups", 1, reference_id=group.id)

        return group

    def _tenant_device_ids(
        self, tenant_id: uuid.UUID, device_ids: List[uuid.UUID]
    ) -> set[uuid.UUID]:
        if not device_ids:
            return set()
        return {
            row[0]
            for row in (
                self.db.query(TenantDeviceMapping.device_id)
                .filter(
                    TenantDeviceMapping.tenant_id == tenant_id,
                    TenantDeviceMapping.device_id.in_(device_ids),
                )
                .all()
            )
        }

    def _ensure_devices_belong_to_tenant(
        self, tenant_id: uuid.UUID, device_ids: List[uuid.UUID]
    ) -> None:
        valid_device_ids = self._tenant_device_ids(tenant_id, device_ids)
        invalid_device_ids = [
            device_id for device_id in device_ids if device_id not in valid_device_ids
        ]
        if invalid_device_ids:
            raise PermissionError("One or more devices were not found for this tenant")

    def _attach_device_counts(self, groups: List[DeviceGroup]) -> None:
        group_ids = [group.id for group in groups]
        if not group_ids:
            return

        rows = (
            self.db.query(DeviceGroupMember.group_id, func.count(DeviceGroupMember.id))
            .filter(DeviceGroupMember.group_id.in_(group_ids))
            .group_by(DeviceGroupMember.group_id)
            .all()
        )
        counts = {group_id: int(count) for group_id, count in rows}
        for group in groups:
            group.device_count = counts.get(group.id, 0)

    def list_groups(
        self,
        tenant_id: uuid.UUID,
        group_type: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[List[DeviceGroup], int]:
        query = self.db.query(DeviceGroup).filter(DeviceGroup.tenant_id == tenant_id)

        if group_type:
            query = query.filter(DeviceGroup.group_type == group_type)
        if status:
            query = query.filter(DeviceGroup.status == status)
        if search:
            query = query.filter(DeviceGroup.name.ilike(f"%{search}%"))

        total = query.count()
        groups = query.order_by(DeviceGroup.created_at.desc()).offset(skip).limit(limit).all()

        self._attach_device_counts(groups)

        return groups, total

    def get_group(self, tenant_id: uuid.UUID, group_id: uuid.UUID) -> Optional[DeviceGroup]:
        group = (
            self.db.query(DeviceGroup)
            .filter(DeviceGroup.id == group_id, DeviceGroup.tenant_id == tenant_id)
            .first()
        )
        if group:
            group.device_count = (
                self.db.query(func.count(DeviceGroupMember.id))
                .filter(DeviceGroupMember.group_id == group.id)
                .scalar()
            )
        return group

    def update_group(
        self, tenant_id: uuid.UUID, group_id: uuid.UUID, data: DeviceGroupUpdate
    ) -> Optional[DeviceGroup]:
        group = self.get_group(tenant_id, group_id)
        if not group:
            return None

        if data.name is not None:
            group.name = data.name
        if data.description is not None:
            group.description = data.description
        if data.tags is not None:
            group.tags = data.tags
        if data.metadata is not None:
            group.extra_metadata = data.metadata
        if data.status is not None:
            group.status = data.status

        group.updated_at = datetime.now(timezone.utc)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise ValueError(f"Device group with name '{data.name}' already exists in this tenant")
        self.db.refresh(group)
        return group

    def archive_group(self, tenant_id: uuid.UUID, group_id: uuid.UUID) -> bool:
        group = self.get_group(tenant_id, group_id)
        if not group:
            return False
        group.status = "archived"
        group.updated_at = datetime.now(timezone.utc)
        self.db.commit()

        # Release quota on archive
        if self.quota is not None:
            self.quota.release_usage(tenant_id, "device_groups", 1, reference_id=group.id)

        return True

    def delete_group(self, tenant_id: uuid.UUID, group_id: uuid.UUID) -> bool:
        group = self.get_group(tenant_id, group_id)
        if not group:
            return False

        try:
            if self.quota is not None and group.status != "archived":
                self.quota.release_usage(tenant_id, "device_groups", 1, reference_id=group_id)

            self.db.query(DeviceGroupMember).filter(DeviceGroupMember.group_id == group.id).delete(
                synchronize_session=False
            )
            self.db.delete(group)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        return True

    def add_devices_to_group(
        self,
        tenant_id: uuid.UUID,
        group_id: uuid.UUID,
        device_ids: List[uuid.UUID],
        added_by: Optional[uuid.UUID] = None,
    ) -> int:
        group = self.get_group(tenant_id, group_id)
        if not group:
            raise LookupError("Device group not found")

        self._ensure_devices_belong_to_tenant(tenant_id, device_ids)

        added = 0
        for device_id in device_ids:
            existing = (
                self.db.query(DeviceGroupMember)
                .filter(
                    DeviceGroupMember.group_id == group_id, DeviceGroupMember.device_id == device_id
                )
                .first()
            )
            if not existing:
                member = DeviceGroupMember(
                    id=uuid.uuid4(),
                    group_id=group_id,
                    device_id=device_id,
                    added_by=added_by,
                )
                self.db.add(member)
                added += 1

        if added > 0:
            group.updated_at = datetime.now(timezone.utc)
            try:
                self.db.commit()
            except IntegrityError as exc:
                self.db.rollback()
                raise ValueError("One or more devices are already members of this group") from exc
        return added

    def remove_devices_from_group(
        self, tenant_id: uuid.UUID, group_id: uuid.UUID, device_ids: List[uuid.UUID]
    ) -> int:
        group = self.get_group(tenant_id, group_id)
        if not group:
            raise LookupError("Device group not found")

        self._ensure_devices_belong_to_tenant(tenant_id, device_ids)

        removed = (
            self.db.query(DeviceGroupMember)
            .filter(
                DeviceGroupMember.group_id == group_id,
                DeviceGroupMember.device_id.in_(device_ids),
            )
            .delete(synchronize_session=False)
        )

        if removed > 0:
            group.updated_at = datetime.now(timezone.utc)
            self.db.commit()
        return removed

    def list_group_devices(
        self, tenant_id: uuid.UUID, group_id: uuid.UUID, skip: int = 0, limit: int = 50
    ) -> tuple[List[dict], int]:
        group = self.get_group(tenant_id, group_id)
        if not group:
            raise LookupError("Device group not found")

        from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

        query = (
            self.db.query(DeviceGroupMember, Device)
            .join(Device, DeviceGroupMember.device_id == Device.id)
            .join(TenantDeviceMapping, TenantDeviceMapping.device_id == Device.id)
            .filter(
                DeviceGroupMember.group_id == group_id,
                TenantDeviceMapping.tenant_id == tenant_id,
            )
        )

        total = query.count()
        rows = query.order_by(DeviceGroupMember.added_at.desc()).offset(skip).limit(limit).all()

        devices = []
        for member, device in rows:
            devices.append(
                {
                    "member_id": member.id,
                    "device_id": device.id,
                    "device_uid": device.device_uid,
                    "device_name": device.name,
                    "device_status": device.status,
                    "added_at": member.added_at,
                }
            )

        return devices, total

    def list_device_groups(
        self, tenant_id: uuid.UUID, device_id: uuid.UUID, skip: int = 0, limit: int = 50
    ) -> tuple[List[DeviceGroup], int]:
        self._ensure_devices_belong_to_tenant(tenant_id, [device_id])

        query = (
            self.db.query(DeviceGroup)
            .join(DeviceGroupMember, DeviceGroupMember.group_id == DeviceGroup.id)
            .filter(
                DeviceGroup.tenant_id == tenant_id,
                DeviceGroupMember.device_id == device_id,
            )
        )
        total = query.count()
        groups = query.order_by(DeviceGroup.name.asc()).offset(skip).limit(limit).all()

        self._attach_device_counts(groups)

        return groups, total
