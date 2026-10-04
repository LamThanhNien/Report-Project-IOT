"""Command Center use cases."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bounded_contexts.command_center.infrastructure.models import (
    CommandTemplate,
    CommandDispatch,
    CommandTarget,
)
from app.bounded_contexts.command_center.application.schemas import (
    CommandTemplateCreate,
    CommandTemplateUpdate,
    CommandDispatchRequest,
)
from app.bounded_contexts.device_groups.infrastructure.persistence.models import DeviceGroupMember
from app.shared.infrastructure.messaging.mqtt_publisher import publish_device_command

try:
    from app.bounded_contexts.billing.application.use_cases import QuotaService
except ModuleNotFoundError:  # Billing is restored in a later feature slice.
    QuotaService = None  # type: ignore[assignment]


class CommandCenterUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.quota = QuotaService(db) if QuotaService is not None else None

    def create_template(
        self,
        tenant_id: uuid.UUID,
        data: CommandTemplateCreate,
        created_by: Optional[uuid.UUID] = None,
    ) -> CommandTemplate:
        template = CommandTemplate(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=data.name,
            description=data.description,
            command_type=data.command_type,
            payload_template=data.payload_template,
            is_system=False,
            created_by=created_by,
        )
        self.db.add(template)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise ValueError(f"Command template with name '{data.name}' already exists")
        self.db.refresh(template)
        return template

    def list_templates(
        self, tenant_id: uuid.UUID, project_id: Optional[uuid.UUID] = None
    ) -> List[CommandTemplate]:
        query = self.db.query(CommandTemplate).filter(
            (CommandTemplate.tenant_id == tenant_id) | CommandTemplate.is_system
        )
        return query.order_by(CommandTemplate.is_system.desc(), CommandTemplate.name).all()

    def get_template(
        self, tenant_id: uuid.UUID, template_id: uuid.UUID
    ) -> Optional[CommandTemplate]:
        return (
            self.db.query(CommandTemplate)
            .filter(
                CommandTemplate.id == template_id,
                (CommandTemplate.tenant_id == tenant_id) | CommandTemplate.is_system,
            )
            .first()
        )

    def update_template(
        self,
        tenant_id: uuid.UUID,
        template_id: uuid.UUID,
        data: CommandTemplateUpdate,
    ) -> CommandTemplate:
        template = self.get_template(tenant_id, template_id)
        if not template:
            raise ValueError("Command template not found or not accessible")
        if template.is_system:
            raise ValueError("Cannot modify system templates")

        updates = data.model_dump(exclude_unset=True)
        if data.name is not None:
            template.name = data.name
        if "description" in updates:
            template.description = (
                data.description.strip() or None if data.description is not None else None
            )
        if data.command_type is not None:
            template.command_type = data.command_type
        if data.payload_template is not None:
            template.payload_template = data.payload_template

        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise ValueError(f"Command template with name '{data.name}' already exists")
        self.db.refresh(template)
        return template

    def delete_template(self, tenant_id: uuid.UUID, template_id: uuid.UUID) -> None:
        template = self.get_template(tenant_id, template_id)
        if not template:
            raise ValueError("Command template not found or not accessible")
        if template.is_system:
            raise ValueError("Cannot delete system templates")

        self.db.delete(template)
        self.db.commit()

    def dispatch_command(
        self,
        tenant_id: uuid.UUID,
        data: CommandDispatchRequest,
        created_by: Optional[uuid.UUID] = None,
    ) -> CommandDispatch:
        # Validate target
        if data.target_type == "device" and not data.target_device_id:
            raise ValueError("target_device_id required for device target type")
        if data.target_type == "group" and not data.target_group_id:
            raise ValueError("target_group_id required for group target type")

        # Verify group belongs to tenant (P0 security fix)
        if data.target_type == "group" and data.target_group_id:
            from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
                DeviceGroup,
            )

            group = (
                self.db.query(DeviceGroup)
                .filter(
                    DeviceGroup.id == data.target_group_id,
                    DeviceGroup.tenant_id == tenant_id,
                )
                .first()
            )
            if not group:
                raise ValueError("Device group not found or not accessible")

        # Verify device belongs to tenant (P0 security fix)
        if data.target_type == "device" and data.target_device_id:
            from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                TenantDeviceMapping,
            )

            mapping = (
                self.db.query(TenantDeviceMapping)
                .filter(
                    TenantDeviceMapping.device_id == data.target_device_id,
                    TenantDeviceMapping.tenant_id == tenant_id,
                )
                .first()
            )
            if not mapping:
                raise ValueError("Device not found or not accessible")

        # Verify template belongs to tenant (or is system template)
        if data.template_id:
            template = self.get_template(tenant_id, data.template_id)
            if not template:
                raise ValueError("Command template not found or not accessible")

        # Quota enforcement — count commands to dispatch
        if data.target_type == "group" and data.target_group_id:
            device_count = (
                self.db.query(DeviceGroupMember)
                .filter(DeviceGroupMember.group_id == data.target_group_id)
                .count()
            )
            cmd_amount = max(1, device_count)
        else:
            cmd_amount = 1

        if self.quota is not None:
            quota = self.quota.check_quota(tenant_id, "commands_per_month", cmd_amount)
            if not quota["allowed"]:
                raise ValueError(
                    f"Quota exceeded: commands_per_month limit is {quota['limit']}, "
                    f"current usage is {quota['current']}, needed {cmd_amount}"
                )

        # Create dispatch record
        dispatch = CommandDispatch(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            template_id=data.template_id,
            command_type=data.command_type,
            payload=data.payload,
            target_type=data.target_type,
            target_device_id=data.target_device_id,
            target_group_id=data.target_group_id,
            status="pending",
            created_by=created_by,
        )
        self.db.add(dispatch)
        self.db.flush()

        if data.target_type == "device":
            self._dispatch_to_device(
                dispatch, data.target_device_id, data.command_type, data.payload
            )
        elif data.target_type == "group":
            self._dispatch_to_group(dispatch, data.target_group_id, data.command_type, data.payload)

        self.db.commit()
        self.db.refresh(dispatch)

        # Consume quota after successful dispatch
        if self.quota is not None:
            self.quota.consume_usage(
                tenant_id, "commands_per_month", cmd_amount, reference_id=dispatch.id
            )

        return dispatch

    def dispatch_admin_device_command(
        self,
        device,
        command_type: str,
        payload: dict | None = None,
        created_by: Optional[uuid.UUID] = None,
        tenant_id: Optional[uuid.UUID] = None,
    ) -> CommandDispatch:
        """Dispatch a platform-admin command through the tracked MQTT pipeline."""
        dispatch = CommandDispatch(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            command_type=command_type,
            payload=payload or {},
            target_type="device",
            target_device_id=device.id,
            status="pending",
            created_by=created_by,
        )
        self.db.add(dispatch)
        self.db.flush()
        self._dispatch_to_device(dispatch, device.id, command_type, payload or {})
        self.db.commit()
        self.db.refresh(dispatch)
        dispatch.targets = (
            self.db.query(CommandTarget).filter(CommandTarget.dispatch_id == dispatch.id).all()
        )
        return dispatch

    def _dispatch_to_device(
        self, dispatch: CommandDispatch, device_id: uuid.UUID, command_type: str, payload: dict
    ):
        from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

        device = self.db.query(Device).filter(Device.id == device_id).first()
        if not device:
            dispatch.status = "failed"
            dispatch.error_message = "Device not found"
            return

        # Create target record
        target = CommandTarget(
            id=uuid.uuid4(),
            dispatch_id=dispatch.id,
            device_id=device_id,
            status="pending",
        )
        self.db.add(target)
        self.db.flush()

        # Publish MQTT command
        try:
            mqtt_payload = {
                "command_id": str(dispatch.id),
                "command_type": command_type,
                **payload,
            }
            publish_device_command(device.device_uid, mqtt_payload)
            target.status = "sent"
            target.sent_at = datetime.now(timezone.utc)
            dispatch.status = "sent"
            dispatch.sent_at = datetime.now(timezone.utc)
        except Exception as e:
            target.status = "failed"
            target.error_message = str(e)
            dispatch.status = "failed"
            dispatch.error_message = str(e)

    def _dispatch_to_group(
        self, dispatch: CommandDispatch, group_id: uuid.UUID, command_type: str, payload: dict
    ):
        from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

        members = (
            self.db.query(DeviceGroupMember).filter(DeviceGroupMember.group_id == group_id).all()
        )

        if not members:
            dispatch.status = "failed"
            dispatch.error_message = "No devices in group"
            return

        sent_count = 0
        failed_count = 0
        device_ids = [member.device_id for member in members]
        devices_by_id = {
            device.id: device
            for device in self.db.query(Device).filter(Device.id.in_(device_ids)).all()
        }

        for member in members:
            device = devices_by_id.get(member.device_id)
            if not device:
                failed_count += 1
                continue

            target = CommandTarget(
                id=uuid.uuid4(),
                dispatch_id=dispatch.id,
                device_id=member.device_id,
                status="pending",
            )
            self.db.add(target)
            self.db.flush()

            try:
                mqtt_payload = {
                    "command_id": str(dispatch.id),
                    "command_type": command_type,
                    **payload,
                }
                publish_device_command(device.device_uid, mqtt_payload)
                target.status = "sent"
                target.sent_at = datetime.now(timezone.utc)
                sent_count += 1
            except Exception as e:
                target.status = "failed"
                target.error_message = str(e)
                failed_count += 1

        if sent_count > 0:
            dispatch.status = "sent"
            dispatch.sent_at = datetime.now(timezone.utc)
        if failed_count > 0 and sent_count == 0:
            dispatch.status = "failed"
            dispatch.error_message = f"All {failed_count} targets failed"

    def get_dispatch(
        self, tenant_id: uuid.UUID, dispatch_id: uuid.UUID
    ) -> Optional[CommandDispatch]:
        dispatch = (
            self.db.query(CommandDispatch)
            .filter(CommandDispatch.id == dispatch_id, CommandDispatch.tenant_id == tenant_id)
            .first()
        )
        if dispatch:
            dispatch.targets = (
                self.db.query(CommandTarget).filter(CommandTarget.dispatch_id == dispatch_id).all()
            )
        return dispatch

    def list_dispatches(
        self,
        tenant_id: uuid.UUID,
        status: Optional[str] = None,
        command_type: Optional[str] = None,
        project_id: Optional[uuid.UUID] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[List[CommandDispatch], int]:
        query = self.db.query(CommandDispatch).filter(CommandDispatch.tenant_id == tenant_id)

        if project_id:
            from app.bounded_contexts.device_registry.infrastructure.persistence.models import (
                Device,
            )

            query = query.join(Device, CommandDispatch.target_device_id == Device.id).filter(
                Device.project_id == project_id
            )

        if status:
            query = query.filter(CommandDispatch.status == status)
        if command_type:
            query = query.filter(CommandDispatch.command_type == command_type)

        total = query.count()
        dispatches = (
            query.order_by(CommandDispatch.created_at.desc()).offset(skip).limit(limit).all()
        )

        targets_by_dispatch = {dispatch.id: [] for dispatch in dispatches}
        if targets_by_dispatch:
            targets = (
                self.db.query(CommandTarget)
                .filter(CommandTarget.dispatch_id.in_(list(targets_by_dispatch)))
                .all()
            )
            for target in targets:
                targets_by_dispatch.setdefault(target.dispatch_id, []).append(target)

        for dispatch in dispatches:
            dispatch.targets = targets_by_dispatch.get(dispatch.id, [])

        return dispatches, total

    def retry_dispatch(
        self, tenant_id: uuid.UUID, dispatch_id: uuid.UUID
    ) -> Optional[CommandDispatch]:
        dispatch = self.get_dispatch(tenant_id, dispatch_id)
        if not dispatch:
            return None

        if dispatch.status not in ("failed", "timeout"):
            raise ValueError("Can only retry failed or timed out commands")

        # Find failed targets
        failed_targets = (
            self.db.query(CommandTarget)
            .filter(
                CommandTarget.dispatch_id == dispatch_id,
                CommandTarget.status.in_(["failed", "timeout"]),
            )
            .all()
        )

        if not failed_targets:
            raise ValueError("No failed targets to retry")

        from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

        device_ids = [target.device_id for target in failed_targets]
        devices_by_id = {
            device.id: device
            for device in self.db.query(Device).filter(Device.id.in_(device_ids)).all()
        }

        sent_count = 0
        for target in failed_targets:
            device = devices_by_id.get(target.device_id)
            if not device:
                continue

            try:
                mqtt_payload = {
                    "command_id": str(dispatch.id),
                    "command_type": dispatch.command_type,
                    **(dispatch.payload or {}),
                }
                publish_device_command(device.device_uid, mqtt_payload)
                target.status = "sent"
                target.sent_at = datetime.now(timezone.utc)
                target.error_message = None
                sent_count += 1
            except Exception as e:
                target.status = "failed"
                target.error_message = str(e)

        dispatch.retry_count += 1
        if sent_count > 0:
            dispatch.status = "sent"
            dispatch.sent_at = datetime.now(timezone.utc)
            dispatch.error_message = None
        else:
            dispatch.status = "failed"
            dispatch.error_message = "All retry attempts failed"

        self.db.commit()
        self.db.refresh(dispatch)
        return dispatch
