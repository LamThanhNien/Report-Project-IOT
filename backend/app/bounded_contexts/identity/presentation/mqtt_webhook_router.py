"""MQTT Webhook Router for Mosquitto Webhook Authentication.

Implements mosquitto-go-auth webhook endpoints:
- POST /api/v1/mqtt/auth
- POST /api/v1/mqtt/superuser
- POST /api/v1/mqtt/acl
"""

import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db, postgres_rls_bypass
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

logger = logging.getLogger(__name__)
router = APIRouter()


def compute_sha256(value: str) -> str:
    """Compute the SHA-256 hash of a string."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def get_webhook_params(
    request: Request,
    username: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    clientid: Optional[str] = Form(None),
    topic: Optional[str] = Form(None),
    acc: Optional[int] = Form(None),
) -> dict:
    """Extract parameters from urlencoded Form first, fallback to JSON body if not present."""
    # Check form parameters (when FastAPI injects, these are string/int values or None)
    if username is not None or clientid is not None or topic is not None:
        return {
            "username": username,
            "password": password,
            "clientid": clientid,
            "topic": topic,
            "acc": acc,
        }

    # Fallback to JSON
    try:
        json_data = await request.json()
        return {
            "username": json_data.get("username"),
            "password": json_data.get("password"),
            "clientid": json_data.get("clientid"),
            "topic": json_data.get("topic"),
            "acc": json_data.get("acc"),
        }
    except Exception:
        return {}


@router.post("/auth")
async def mqtt_auth(
    params: dict = Depends(get_webhook_params),
    db: Session = Depends(get_db),
) -> Response:
    """Authenticate an MQTT client connection.

    - Superuser check: username == "aifom-api" and password == settings.mqtt_password
    - Device check: Compute SHA-256 of username (token), query DB. If active, allow.
    """
    username = params.get("username")
    password = params.get("password")

    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing username",
        )

    # 1. Superuser Check
    mqtt_pass = getattr(settings, "mqtt_password", None) or getattr(settings, "MQTT_PASSWORD", None)
    if username == "aifom-api" and mqtt_pass and password == mqtt_pass:
        logger.info("MQTT Webhook: Superuser authenticated successfully")
        return Response(status_code=status.HTTP_200_OK)

    # 2. Token Check (Modern approach)
    # The token might be passed as the username (Blynk-style) or as the password (Standard)
    token_candidates = [t for t in (username, password) if t]
    for token in token_candidates:
        token_hash = compute_sha256(token)
        with postgres_rls_bypass(db):
            device = db.scalar(
                select(Device).where(
                    Device.auth_token_hash == token_hash,
                    Device.status != "deleted",
                    Device.deleted_at.is_(None),
                )
            )
        if device is not None:
            logger.info(
                "MQTT Webhook: Device %s authenticated successfully via token", device.device_uid
            )
            return Response(status_code=status.HTTP_200_OK)

    # 3. Legacy Check (Username = device_uid, Password = raw password)
    from app.bounded_contexts.identity.application.services import verify_password

    with postgres_rls_bypass(db):
        legacy_device = db.scalar(
            select(Device).where(
                Device.mqtt_username == username,
                Device.status != "deleted",
                Device.deleted_at.is_(None),
            )
        )
    if legacy_device is not None and legacy_device.mqtt_password_hash:
        if password and verify_password(password, legacy_device.mqtt_password_hash):
            logger.info(
                "MQTT Webhook: Device %s authenticated successfully via legacy password",
                legacy_device.device_uid,
            )
            return Response(status_code=status.HTTP_200_OK)

    logger.warning("MQTT Webhook: Auth failed for username=%s", username)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
    )


@router.post("/superuser")
async def mqtt_superuser(
    params: dict = Depends(get_webhook_params),
) -> Response:
    """Determine if the client is a superuser (backend service)."""
    username = params.get("username")

    if username == "aifom-api":
        logger.info("MQTT Webhook: Superuser check passed for %s", username)
        return Response(status_code=status.HTTP_200_OK)

    logger.warning("MQTT Webhook: Superuser check failed for %s", username)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Not a superuser",
    )


@router.post("/acl")
async def mqtt_acl(
    params: dict = Depends(get_webhook_params),
    db: Session = Depends(get_db),
) -> Response:
    """Enforce topic access control list (ACL) rules.

    - Superuser: access to all topics allowed
    - Devices: can only subscribe/publish to their own topics under restrictions:
      - subscribe (acc=1): commands/+ (devices/{device_uid}/commands/ch_1 or commands)
      - publish (acc=2): telemetry/+, status, heartbeat, events
    """
    username = params.get("username")
    topic = params.get("topic")
    acc = params.get("acc")  # 1 = read/subscribe, 2 = write/publish

    if not username or not topic or acc is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing ACL params",
        )

    # 1. Superuser Check
    if username == "aifom-api":
        logger.debug("MQTT Webhook ACL: Superuser access allowed topic=%s acc=%s", topic, acc)
        return Response(status_code=status.HTTP_200_OK)

    # 2. Parse Topic & Extract Device UID
    parts = topic.split("/")
    if len(parts) < 3 or parts[0] != "devices":
        logger.warning(
            "MQTT Webhook ACL: Rejected topic format '%s' for username=%s", topic, username
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden topic prefix or format",
        )

    topic_device_uid = parts[1]

    # 3. Authenticate Device and Check UID Ownership
    password = params.get("password")
    token_candidates = [t for t in (username, password) if t]
    device = None
    for token in token_candidates:
        token_hash = compute_sha256(token)
        with postgres_rls_bypass(db):
            device = db.scalar(
                select(Device).where(
                    Device.auth_token_hash == token_hash,
                    Device.status != "deleted",
                    Device.deleted_at.is_(None),
                )
            )
        if device is not None:
            break

    if device is None and username:
        with postgres_rls_bypass(db):
            device = db.scalar(
                select(Device).where(
                    (Device.device_uid == username) | (Device.mqtt_username == username),
                    Device.status != "deleted",
                    Device.deleted_at.is_(None),
                )
            )

    if device is None or device.device_uid != topic_device_uid:
        logger.warning(
            "MQTT Webhook ACL: Device verification failed username=%s topic_device_uid=%s",
            username,
            topic_device_uid,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device token mismatch or device not found",
        )

    # 4. Check Access Constraints (acc: 1=read/subscribe, 2=write/publish, 4=subscribe pattern)
    action = parts[2]
    if acc == 1 or acc == 4:
        # Devices can only subscribe to commands/+ or ota
        allowed = False
        if action == "commands":
            allowed = True
        elif action == "ota" and len(parts) == 3:
            allowed = True

        if not allowed:
            logger.warning(
                "MQTT Webhook ACL: Device %s forbidden subscription to topic=%s",
                device.device_uid,
                topic,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden subscription topic",
            )

    elif acc == 2:
        # Devices can only publish to telemetry/+, status, heartbeat, events, ota/status
        allowed = False
        if action in {"telemetry", "status", "heartbeat", "events"}:
            allowed = True
        elif action == "ota" and len(parts) >= 4 and parts[3] == "status":
            allowed = True

        if not allowed:
            logger.warning(
                "MQTT Webhook ACL: Device %s forbidden publish to topic=%s",
                device.device_uid,
                topic,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden publish topic",
            )
    else:
        logger.warning("MQTT Webhook ACL: Invalid acc value=%s", acc)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid access level",
        )

    logger.info(
        "MQTT Webhook ACL: Access granted to device %s for topic=%s acc=%s",
        device.device_uid,
        topic,
        acc,
    )
    return Response(status_code=status.HTTP_200_OK)
