"""MQTT Command Dispatch Service.

Handles dispatching commands to devices via MQTT and tracking command status.
Integrates with the existing MQTT publisher infrastructure.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.bounded_contexts.command_center.infrastructure.models import (
    CommandDispatch,
    CommandTarget,
)
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.shared.infrastructure.messaging.mqtt_publisher import publish_device_command


class CommandDispatchService:
    """Handles MQTT command dispatch and status tracking."""

    def __init__(self, db: Session):
        self.db = db

    def dispatch_to_device(
        self,
        dispatch_id: uuid.UUID,
        device_id: uuid.UUID,
        command_type: str,
        payload: dict,
    ) -> bool:
        """Send command to a single device via MQTT.

        Returns True if command was sent successfully.
        """
        device = self.db.query(Device).filter(Device.id == device_id).first()
        if not device:
            return False

        # Create target record
        target = CommandTarget(
            id=uuid.uuid4(),
            dispatch_id=dispatch_id,
            device_id=device_id,
            status="pending",
        )
        self.db.add(target)
        self.db.flush()

        # Build MQTT payload
        mqtt_payload = {
            "command_id": str(dispatch_id),
            "command_type": command_type,
            **payload,
        }

        try:
            publish_device_command(device.device_uid, mqtt_payload)
            target.status = "sent"
            target.sent_at = datetime.now(timezone.utc)
            return True
        except Exception as e:
            target.status = "failed"
            target.error_message = str(e)
            return False

    def handle_command_ack(
        self,
        device_uid: str,
        command_id: str,
        status: str,
        message: Optional[str] = None,
    ):
        """Process command acknowledgment from device events topic.

        Called when a device publishes a command_result event.
        """
        # Find the device
        device = self.db.query(Device).filter(Device.device_uid == device_uid).first()
        if not device:
            return

        # Find matching command target
        target = (
            self.db.query(CommandTarget)
            .join(CommandDispatch, CommandTarget.dispatch_id == CommandDispatch.id)
            .filter(
                CommandTarget.device_id == device.id,
                CommandDispatch.id == command_id,
                CommandTarget.status == "sent",
            )
            .first()
        )

        if not target:
            return

        # Update target status
        now = datetime.now(timezone.utc)
        if status in ("success", "completed"):
            target.status = "completed"
            target.completed_at = now
        elif status == "failed":
            target.status = "failed"
            target.error_message = message
        else:
            target.status = "acked"
            target.acked_at = now

        # Check if all targets for this dispatch are done
        dispatch = self.db.query(CommandDispatch).filter(CommandDispatch.id == command_id).first()
        if dispatch:
            all_targets = (
                self.db.query(CommandTarget).filter(CommandTarget.dispatch_id == command_id).all()
            )

            completed = sum(1 for t in all_targets if t.status in ("completed", "acked"))
            failed = sum(1 for t in all_targets if t.status == "failed")
            total = len(all_targets)

            if completed == total:
                dispatch.status = "completed"
                dispatch.completed_at = now
            elif failed == total:
                dispatch.status = "failed"
                dispatch.error_message = "All targets failed"
            elif completed + failed == total:
                dispatch.status = "completed"
                dispatch.completed_at = now

        self.db.commit()

    def check_timeouts(self, timeout_seconds: int = 60):
        """Check for commands that have timed out.

        Should be called periodically (e.g., every 30 seconds).
        """
        cutoff = datetime.now(timezone.utc).timestamp() - timeout_seconds

        # Find targets that are still 'sent' but older than timeout
        timed_out_targets = (
            self.db.query(CommandTarget)
            .filter(
                CommandTarget.status == "sent",
                CommandTarget.sent_at < datetime.fromtimestamp(cutoff, tz=timezone.utc),
            )
            .all()
        )

        for target in timed_out_targets:
            target.status = "timeout"
            target.error_message = "Command timed out"

            # Update dispatch status
            dispatch = (
                self.db.query(CommandDispatch)
                .filter(CommandDispatch.id == target.dispatch_id)
                .first()
            )
            if dispatch and dispatch.status == "sent":
                dispatch.status = "timeout"
                dispatch.error_message = "One or more targets timed out"

        if timed_out_targets:
            self.db.commit()

        return len(timed_out_targets)
