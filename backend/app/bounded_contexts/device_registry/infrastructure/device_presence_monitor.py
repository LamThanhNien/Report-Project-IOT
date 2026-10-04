import logging
import threading
import time
from datetime import datetime, timezone

from app.db.session import SessionLocal
from app.modules.devices import repository as device_repository
from app.shared.infrastructure.messaging.device_status_events import (
    DeviceStatusEvent,
    device_status_bus,
)

logger = logging.getLogger(__name__)


class DevicePresenceMonitor:
    def __init__(self, check_interval_seconds: int = 5) -> None:
        self._check_interval_seconds = max(1, int(check_interval_seconds))
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
            name="device-presence-monitor",
        )
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=self._check_interval_seconds + 2)
            self._thread = None

    def _run_loop(self) -> None:
        while self._running:
            self.run_once()
            time.sleep(self._check_interval_seconds)

    def run_once(self) -> None:
        from app.core.tenant_context import tenant_context

        with tenant_context(bypass_rls=True):
            db = SessionLocal()
            try:
                changed_devices = device_repository.mark_stale_devices_offline_with_details(db)
                if changed_devices:
                    logger.info(
                        "Device presence monitor marked %d device(s) offline", len(changed_devices)
                    )
                    self._emit_offline_events(db, changed_devices)
            except Exception:
                logger.exception("Device presence monitor iteration failed")
                db.rollback()
            finally:
                db.close()

    def _emit_offline_events(self, db, devices) -> None:
        """Publish offline status events for devices just marked offline."""
        from sqlalchemy import select

        from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
            TenantDeviceMapping,
        )

        now = datetime.now(timezone.utc).isoformat()
        for device in devices:
            mapping = db.scalar(
                select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == device.id)
            )
            if mapping is None:
                continue
            event: DeviceStatusEvent = {
                "device_uid": device.device_uid,
                "tenant_id": str(mapping.tenant_id),
                "status": "offline",
                "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
                "timestamp": now,
            }
            device_status_bus.publish(event)

            try:
                from app.bounded_contexts.rule_engine.application.use_cases import (
                    RuleEngineUseCases,
                )

                RuleEngineUseCases(db).evaluate_enabled_rules_for_device_status(
                    mapping.tenant_id,
                    device,
                )
            except Exception:
                logger.exception(
                    "Failed to evaluate rules for offline device %s", device.device_uid
                )
