import base64
from datetime import datetime, timedelta, timezone
import hashlib
import logging
import os
import secrets
import subprocess
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.devices.model import Device
from app.modules.devices.schema import DeviceCreate
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
    Tenant,
)
from app.bounded_contexts.device_registry.infrastructure.persistence.platform_models import (
    DeviceModel,
)

logger = logging.getLogger(__name__)

MIN_OFFLINE_TIMEOUT_SECONDS = 10
MAX_OFFLINE_TIMEOUT_SECONDS = 600
DEFAULT_OFFLINE_TIMEOUT_SECONDS = 60

ONLINE_STATUSES = {"online", "connected", "ok", "up", "alive"}
OFFLINE_STATUSES = {"offline", "disconnected", "down", "dead", "unreachable", "lost"}
UNKNOWN_STATUSES = {"unknown", "n/a"}


def list_devices(db: Session, include_deleted: bool = False) -> list[Device]:
    stmt = select(Device).order_by(Device.created_at.desc())
    if not include_deleted:
        stmt = stmt.where(Device.status != "deleted")
    return list(db.scalars(stmt).all())


def list_devices_with_tenant(
    db: Session,
    tenant_id: str | None = None,
    include_deleted: bool = True,
) -> list[tuple[Device, Tenant | None]]:
    """Return devices with their owning tenant (if any).

    Uses the direct devices.tenant_id column for efficient lookup.
    Returns list of (Device, Tenant | None) tuples.
    """
    stmt = (
        select(Device, Tenant)
        .outerjoin(Tenant, Device.tenant_id == Tenant.id)
        .order_by(Device.created_at.desc())
    )
    if not include_deleted:
        stmt = stmt.where(Device.status != "deleted")
    if tenant_id:
        stmt = stmt.where(Device.tenant_id == tenant_id)
    return list(db.execute(stmt).all())


def get_tenant_for_device(db: Session, device_id) -> Tenant | None:
    """Return the tenant that owns the given device, or None."""
    stmt = select(Tenant).join(Device, Device.tenant_id == Tenant.id).where(Device.id == device_id)
    return db.scalar(stmt)


def get_device_by_uid(db: Session, device_uid: str) -> Device | None:
    return db.scalar(select(Device).where(Device.device_uid == device_uid))


def create_device(db: Session, payload: DeviceCreate) -> Device:
    device = Device(**_device_data_with_model(db, payload))
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def hash_mqtt_password(password: str) -> str:
    salt = os.urandom(64)
    hash_bytes = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"), salt, 71000, 64)
    b64_salt = base64.b64encode(salt).decode("utf-8")
    b64_hash = base64.b64encode(hash_bytes).decode("utf-8")
    return f"$7$71000${b64_salt}${b64_hash}"


def register_device(db: Session, payload: DeviceCreate) -> Device:
    existing = get_device_by_uid(db, payload.device_uid)
    if existing is not None:
        existing.name = payload.name
        if payload.hardware_model is not None:
            existing.hardware_model = payload.hardware_model
        if payload.description is not None:
            existing.description = payload.description
        existing.firmware_version = payload.firmware_version
        if getattr(payload, "project_id", None) is not None:
            existing.project_id = payload.project_id
        _apply_device_model(db, existing, getattr(payload, "device_model_id", None))

        raw_password = None
        if payload.auth_token_hash:
            existing.auth_token_hash = payload.auth_token_hash
        else:
            if not getattr(existing, "mqtt_username", None) or not getattr(
                existing, "mqtt_password_hash", None
            ):
                raw_password = secrets.token_hex(16)
                existing.mqtt_username = getattr(existing, "device_uid", payload.device_uid)
                existing.mqtt_password_hash = hash_mqtt_password(raw_password)

        db.commit()
        db.refresh(existing)
        if raw_password is not None:
            existing.mqtt_password = raw_password
        return existing

    try:
        raw_password = None
        device_data = _device_data_with_model(db, payload)
        if payload.auth_token_hash:
            device_data["auth_token_hash"] = payload.auth_token_hash
        else:
            raw_password = secrets.token_hex(16)
            device_data["mqtt_username"] = payload.device_uid
            device_data["mqtt_password_hash"] = hash_mqtt_password(raw_password)

        device = Device(**device_data)
        db.add(device)
        db.commit()
        db.refresh(device)

        if raw_password is not None:
            device.mqtt_password = raw_password
        return device
    except IntegrityError:
        db.rollback()
        existing = get_device_by_uid(db, payload.device_uid)
        if existing is not None:
            existing.name = payload.name
            if payload.hardware_model is not None:
                existing.hardware_model = payload.hardware_model
            if payload.description is not None:
                existing.description = payload.description
            existing.firmware_version = payload.firmware_version
            if getattr(payload, "project_id", None) is not None:
                existing.project_id = payload.project_id
            _apply_device_model(db, existing, getattr(payload, "device_model_id", None))

            raw_password = None
            if payload.auth_token_hash:
                existing.auth_token_hash = payload.auth_token_hash
            else:
                if not getattr(existing, "mqtt_username", None) or not getattr(
                    existing, "mqtt_password_hash", None
                ):
                    raw_password = secrets.token_hex(16)
                    existing.mqtt_username = getattr(existing, "device_uid", payload.device_uid)
                    existing.mqtt_password_hash = hash_mqtt_password(raw_password)

            db.commit()
            db.refresh(existing)
            if raw_password is not None:
                existing.mqtt_password = raw_password
            return existing
        raise


def update_device_metadata(
    db: Session,
    device: Device,
    *,
    name: str | None = None,
    hardware_model: str | None = None,
    mac_address: str | None = None,
    description: str | None = None,
    auth_token_hash: str | None = None,
    device_model_id=None,
    fields_set: set[str] | None = None,
) -> Device:
    fields = (
        fields_set
        if fields_set is not None
        else {"name", "hardware_model", "mac_address", "description"}
    )
    if "name" in fields and name is not None:
        device.name = name
    if "hardware_model" in fields:
        device.hardware_model = hardware_model
    if "mac_address" in fields:
        device.mac_address = mac_address
    if "description" in fields:
        device.description = description
    if "auth_token_hash" in fields and auth_token_hash is not None:
        device.auth_token_hash = auth_token_hash
    if "device_model_id" in fields:
        _apply_device_model(db, device, device_model_id)
    db.commit()
    db.refresh(device)
    return device


def _device_data_with_model(db: Session, payload: DeviceCreate) -> dict:
    data = payload.model_dump()
    model_id = data.get("device_model_id")
    if model_id is None and data.get("hardware_model"):
        hw_model = data["hardware_model"].strip()
        model = None
        if hasattr(db, "scalar"):
            model = db.scalar(
                select(DeviceModel).where(
                    (DeviceModel.name == hw_model) | (DeviceModel.key == hw_model)
                )
            )
        if model:
            data["device_model_id"] = model.id
            data["platform_id"] = model.platform_id
            data["hardware_model"] = model.name
            return data
    if model_id is not None:
        model = db.get(DeviceModel, model_id)
        if model is None:
            raise ValueError("Device model not found")
        data["platform_id"] = model.platform_id
        data["hardware_model"] = model.name
    return data


def _apply_device_model(db: Session, device: Device, model_id) -> None:
    if model_id is None:
        if device.hardware_model:
            hw_model = device.hardware_model.strip()
            model = None
            if hasattr(db, "scalar"):
                model = db.scalar(
                    select(DeviceModel).where(
                        (DeviceModel.name == hw_model) | (DeviceModel.key == hw_model)
                    )
                )
            if model:
                device.device_model_id = model.id
                device.platform_id = model.platform_id
                device.hardware_model = model.name
        return
    model = db.get(DeviceModel, model_id)
    if model is None:
        raise ValueError("Device model not found")
    device.device_model_id = model.id
    device.platform_id = model.platform_id
    device.hardware_model = model.name


def normalize_connection_status(value: str | None) -> str:
    if value is None:
        return "unknown"
    normalized = str(value).strip().lower()
    if normalized in ONLINE_STATUSES:
        return "online"
    if normalized in OFFLINE_STATUSES:
        return "offline"
    # Unrecognized values default to "unknown" rather than storing arbitrary strings
    return "unknown"


def normalize_offline_timeout_seconds(value: int | None) -> int:
    if value is None:
        return DEFAULT_OFFLINE_TIMEOUT_SECONDS
    return max(MIN_OFFLINE_TIMEOUT_SECONDS, min(MAX_OFFLINE_TIMEOUT_SECONDS, int(value)))


def _ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def is_device_effectively_online(device: Device, now: datetime | None = None) -> bool:
    """Return whether a device is online based on persisted status and freshness."""
    if normalize_connection_status(device.status) != "online":
        return False
    if device.last_seen_at is None:
        return False
    current = _ensure_aware_utc(now or datetime.now(timezone.utc))
    last_seen = _ensure_aware_utc(device.last_seen_at)
    timeout_seconds = normalize_offline_timeout_seconds(
        getattr(device, "offline_timeout_seconds", None)
    )
    return current - last_seen <= timedelta(seconds=timeout_seconds)


def effective_connection_status(device: Device, now: datetime | None = None) -> str:
    return "online" if is_device_effectively_online(device, now=now) else "offline"


def touch_device(
    db: Session,
    device_uid: str,
    status: str | None = None,
    firmware_version: str | None = None,
    ip_address: str | None = None,
    rssi: int | None = None,
    free_heap: int | None = None,
    uptime_ms: int | None = None,
    last_status_payload: dict | None = None,
    update_last_seen: bool = True,
) -> Device | None:
    device = get_device_by_uid(db, device_uid)
    if device is None:
        return None
    if status is not None:
        device.status = normalize_connection_status(status)
    if firmware_version is not None:
        device.firmware_version = firmware_version
    if ip_address is not None:
        device.ip_address = ip_address
    if rssi is not None:
        device.rssi = rssi
    if free_heap is not None:
        device.free_heap = free_heap
    if uptime_ms is not None:
        device.uptime_ms = uptime_ms
    if last_status_payload is not None:
        device.last_status_payload = last_status_payload
    if update_last_seen:
        device.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(device)
    return device


def update_offline_timeout_seconds(
    db: Session, device: Device, offline_timeout_seconds: int
) -> Device:
    device.offline_timeout_seconds = normalize_offline_timeout_seconds(offline_timeout_seconds)
    db.commit()
    db.refresh(device)
    return device


def apply_offline_timeouts(devices: Iterable[Device], now: datetime | None = None) -> int:
    current = _ensure_aware_utc(now or datetime.now(timezone.utc))
    changed = 0
    for device in devices:
        if normalize_connection_status(device.status) != "online":
            continue
        timeout_seconds = normalize_offline_timeout_seconds(device.offline_timeout_seconds)
        if device.last_seen_at is None:
            device.status = "offline"
            changed += 1
            continue
        last_seen = _ensure_aware_utc(device.last_seen_at)
        if current - last_seen > timedelta(seconds=timeout_seconds):
            device.status = "offline"
            changed += 1
    return changed


def mark_stale_devices_offline(db: Session, now: datetime | None = None) -> int:
    online_devices = list(db.scalars(select(Device).where(Device.status == "online")).all())
    changed = apply_offline_timeouts(online_devices, now=now)
    if changed > 0:
        db.commit()
    return changed


def mark_stale_devices_offline_with_details(
    db: Session, now: datetime | None = None
) -> list[Device]:
    """Like ``mark_stale_devices_offline`` but returns the devices that were changed."""
    online_devices = list(db.scalars(select(Device).where(Device.status == "online")).all())
    changed_devices: list[Device] = []
    current = _ensure_aware_utc(now or datetime.now(timezone.utc))
    for device in online_devices:
        if normalize_connection_status(device.status) != "online":
            continue
        timeout_seconds = normalize_offline_timeout_seconds(device.offline_timeout_seconds)
        if device.last_seen_at is None:
            device.status = "offline"
            changed_devices.append(device)
            continue
        last_seen = _ensure_aware_utc(device.last_seen_at)
        if current - last_seen > timedelta(seconds=timeout_seconds):
            device.status = "offline"
            changed_devices.append(device)
    if changed_devices:
        db.commit()
    return changed_devices


def force_offline_all_online(devices: Iterable[Device]) -> int:
    """Unconditionally set every device in *devices* to ``"offline"``.

    Returns the number of devices that were changed.
    """
    changed = 0
    for device in devices:
        if normalize_connection_status(device.status) == "online":
            device.status = "offline"
            changed += 1
    return changed


def reset_online_devices_on_startup(db: Session) -> int:
    """Mark all online devices as offline on backend startup.

    After a backend restart, persisted "online" status is stale because no
    MQTT connection from the current runtime has confirmed the device is still
    present.  This function unconditionally marks every device whose status is
    "online" as "offline" so the UI never shows a disconnected device as
    connected.

    Devices will return to "online" only after the current backend runtime
    receives a fresh heartbeat, telemetry, or status message from them.
    """
    online_devices = list(db.scalars(select(Device).where(Device.status == "online")).all())
    changed = force_offline_all_online(online_devices)
    if changed > 0:
        db.commit()
    return changed


def reset_online_devices_on_startup_with_events(db: Session) -> list[Device]:
    """Like ``reset_online_devices_on_startup`` but returns changed devices.

    The caller is responsible for emitting real-time status events for each
    returned device.
    """
    online_devices = list(db.scalars(select(Device).where(Device.status == "online")).all())
    changed_devices: list[Device] = []
    for device in online_devices:
        if normalize_connection_status(device.status) == "online":
            device.status = "offline"
            changed_devices.append(device)
    if changed_devices:
        db.commit()
    return changed_devices


def sync_mosquitto_passwd(db: Session) -> None:
    """Synchronize Mosquitto passwd file with all device unique credentials."""
    # 1. Get all active (not deleted) devices with credentials from DB
    stmt = select(Device).where(
        Device.status != "deleted",
        Device.mqtt_username.is_not(None),
        Device.mqtt_password_hash.is_not(None),
    )
    db_devices = db.scalars(stmt).all()
    device_creds = {d.mqtt_username: d.mqtt_password_hash for d in db_devices}

    # Get all active device usernames/UIDs to identify which usernames in the passwd file belong to devices
    stmt_all = select(Device).where(Device.status != "deleted")
    all_active = db.scalars(stmt_all).all()
    device_usernames = set()
    for d in all_active:
        if d.device_uid:
            device_usernames.add(d.device_uid)
        if d.mqtt_username:
            device_usernames.add(d.mqtt_username)

    # 2. Determine paths to passwd file to write
    target_paths = [settings.mosquitto_passwd_path]

    import tempfile

    for passwd_path in target_paths:
        dir_name = os.path.dirname(passwd_path)
        if not os.path.exists(dir_name):
            continue

        # Parse existing users to preserve them
        existing_users = {}
        if os.path.exists(passwd_path):
            try:
                with open(passwd_path, "r") as f:
                    for line in f:
                        line = line.strip()
                        if not line or ":" not in line:
                            continue
                        parts = line.split(":", 1)
                        if len(parts) == 2:
                            existing_users[parts[0]] = parts[1]
            except Exception as e:
                logger.error(f"Failed to read existing passwd file at {passwd_path}: {e}")

        # Build new passwd content
        new_users = {}
        # Start by preserving existing non-device users (e.g. aifom_backend)
        for username, pass_hash in existing_users.items():
            if username not in device_usernames:
                new_users[username] = pass_hash

        # Add/update devices from DB
        for username, pass_hash in device_creds.items():
            new_users[username] = pass_hash

        # Reject aifom_device in production
        is_prod = settings.app_env in {"production", "prod"}
        if is_prod:
            if "aifom_device" in new_users:
                del new_users["aifom_device"]

        # Write to file atomically
        try:
            fd, temp_path = tempfile.mkstemp(dir=dir_name, prefix="passwd.tmp")
            try:
                with os.fdopen(fd, "w") as f:
                    for username, pass_hash in new_users.items():
                        f.write(f"{username}:{pass_hash}\n")
                os.replace(temp_path, passwd_path)
            except Exception:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                raise
            logger.info(f"Successfully synchronized mosquitto passwd file at {passwd_path}")
        except Exception as e:
            logger.error(f"Failed to write passwd file at {passwd_path}: {e}")
            raise

    # 3. Reload mosquitto via SIGHUP
    try:
        res = subprocess.run(
            ["docker", "kill", "-s", "HUP", settings.mosquitto_container_name],
            capture_output=True,
            text=True,
        )
        if res.returncode == 0:
            logger.info("Successfully reloaded Mosquitto config via SIGHUP")
        else:
            logger.warning(f"Failed to reload Mosquitto container: {res.stderr.strip()}")
    except Exception as e:
        logger.warning(f"Could not execute docker kill command: {e}")
