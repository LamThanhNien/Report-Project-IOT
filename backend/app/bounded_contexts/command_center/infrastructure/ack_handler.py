"""Command ACK Handler.

Processes command_result events from devices and updates command status.
This handler is designed to be called by the MQTT subscriber when it processes
events from the devices/{uid}/events topic.

Integration point: The existing MQTT subscriber's _handle_events() method
already logs command_result events. To enable automatic ACK processing,
add a call to this handler in the subscriber's event processing path.

Future integration (when modifying mqtt_subscriber.py is approved):
    # In mqtt_subscriber.py _handle_events():
    from app.bounded_contexts.command_center.infrastructure.ack_handler import CommandAckHandler
    if event_type == "command_result":
        CommandAckHandler(db_session).handle_event(device_uid, payload)
"""

from datetime import datetime, timezone
import logging
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.bounded_contexts.command_center.infrastructure.models import (
    CommandDispatch,
    CommandTarget,
)
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

logger = logging.getLogger(__name__)


class CommandAckHandler:
    """Processes command_result events from devices."""

    def __init__(self, db: Session):
        self.db = db

    def handle_event(self, device_uid: str, event_type: str, payload: dict):
        """Called by MQTT subscriber when events topic message arrives.

        Args:
            device_uid: The device UID that published the event
            event_type: The event type (e.g., "command_result")
            payload: The event payload containing command_id, status, etc.
        """
        if event_type != "command_result":
            return

        command_id = payload.get("command_id")
        status = payload.get("status")  # success/failed
        message = payload.get("message", "")

        if not command_id:
            return

        # Find the device
        device = self.db.query(Device).filter(Device.device_uid == device_uid).first()
        if not device:
            return

        now = datetime.now(timezone.utc)
        cmd_type = (
            payload.get("type") or payload.get("command") or payload.get("command_type") or ""
        )
        promoted = False

        if status in ("success", "completed") and cmd_type == "rotate_mqtt_creds":
            promoted = self._promote_pending_mqtt_credentials(device, str(command_id), now)

        try:
            command_uuid = uuid.UUID(str(command_id))
        except (TypeError, ValueError):
            command_uuid = None

        # Find matching command target
        target = None
        if command_uuid is not None:
            target = (
                self.db.query(CommandTarget)
                .filter(
                    CommandTarget.device_id == device.id,
                    CommandTarget.dispatch_id == command_uuid,
                    CommandTarget.status.in_(["sent", "pending"]),
                )
                .first()
            )

        if not target:
            if promoted:
                self.db.commit()
                self._sync_mosquitto_passwd()
            return

        # Update target status
        if status in ("success", "completed"):
            target.status = "completed"
            target.completed_at = now
        elif status == "failed":
            target.status = "failed"
            target.error_message = message
        else:
            target.status = "acked"
            target.acked_at = now

        # Update dispatch status if all targets are done
        self._update_dispatch_status(command_uuid)

        self.db.commit()

        # Sync Mosquitto after successful commit
        if promoted:
            self._sync_mosquitto_passwd()

    def _promote_pending_mqtt_credentials(
        self, device: Device, command_id: str, now: datetime
    ) -> bool:
        """Promote pending MQTT credentials after the matching device ACK.

        Rotation endpoints publish directly to MQTT and do not necessarily create
        CommandDispatch/CommandTarget rows.  Therefore pending credential
        promotion must be keyed by the pending command_id itself, not by command
        center tracking rows.
        """
        if not device.metadata_ or "pending_mqtt_creds" not in device.metadata_:
            return False
        pending = device.metadata_["pending_mqtt_creds"]
        if pending.get("command_id") != command_id:
            return False

        expires_at_str = pending.get("expires_at")
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str)
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if now > expires_at:
                    return False
            except Exception:
                return False

        device.mqtt_username = pending["username"]
        device.mqtt_password_hash = pending["password_hash"]
        del device.metadata_["pending_mqtt_creds"]
        flag_modified(device, "metadata_")
        return True

    def _sync_mosquitto_passwd(self) -> None:
        try:
            from app.bounded_contexts.device_registry.infrastructure import (
                repositories as device_repo,
            )

            device_repo.sync_mosquitto_passwd(self.db)
        except Exception as exc:
            logger.error(
                "Failed to sync mosquitto passwd after credentials promotion: %s",
                exc,
            )

    def _update_dispatch_status(self, dispatch_id: uuid.UUID):
        """Update dispatch status based on all target statuses."""
        dispatch = self.db.query(CommandDispatch).filter(CommandDispatch.id == dispatch_id).first()

        if not dispatch:
            return

        all_targets = (
            self.db.query(CommandTarget).filter(CommandTarget.dispatch_id == dispatch_id).all()
        )

        if not all_targets:
            return

        completed = sum(1 for t in all_targets if t.status in ("completed", "acked"))
        failed = sum(1 for t in all_targets if t.status == "failed")
        total = len(all_targets)

        now = datetime.now(timezone.utc)

        if completed == total:
            dispatch.status = "completed"
            dispatch.completed_at = now
        elif failed == total:
            dispatch.status = "failed"
            dispatch.error_message = "All targets failed"
        elif completed + failed == total:
            # Mixed results
            dispatch.status = "completed"
            dispatch.completed_at = now
