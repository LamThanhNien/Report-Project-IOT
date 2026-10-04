"""Short-lived signed tokens for OTA firmware downloads.

Devices cannot use normal JWT auth. Instead, the backend generates a
short-lived, scoped token when creating an OTA job. The token is embedded
in the firmware download URL sent to the device via MQTT. The download
endpoint validates the token before streaming the file.

Token payload:
  - firmware_id: UUID of the firmware version
  - job_id: UUID of the OTA job
  - device_uid: the target device
  - exp: expiration timestamp (short-lived, configurable up to 30 min)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.core.config import settings

OTA_TOKEN_ISSUER = "aifom-backend"
OTA_TOKEN_AUDIENCE = "aifom-ota-device"
OTA_TOKEN_SUBJECT = "ota-download"
OTA_TOKEN_TYPE = "ota-download+jwt"


def create_ota_download_token(
    firmware_id: uuid.UUID,
    job_id: uuid.UUID,
    device_uid: str,
    tenant_id: uuid.UUID,
    campaign_id: uuid.UUID | None = None,
) -> str:
    """Create a short-lived token scoped to a specific firmware/job/device/tenant."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ota_token_expire_minutes)
    payload = {
        "iss": OTA_TOKEN_ISSUER,
        "aud": OTA_TOKEN_AUDIENCE,
        "sub": OTA_TOKEN_SUBJECT,
        "typ": OTA_TOKEN_TYPE,
        "jti": str(uuid.uuid4()),
        "firmware_id": str(firmware_id),
        "job_id": str(job_id),
        "device_uid": device_uid,
        "tenant_id": str(tenant_id),
        "iat": now,
        "nbf": now,
        "exp": expire,
    }
    if campaign_id:
        payload["campaign_id"] = str(campaign_id)

    return jwt.encode(payload, settings.ota_token_secret, algorithm=settings.jwt_algorithm)


def decode_ota_download_token(token: str) -> dict | None:
    """Validate and decode an OTA download token.

    Returns the payload dict on success, None on any failure.
    """
    try:
        payload = jwt.decode(
            token,
            settings.ota_token_secret,
            algorithms=[settings.jwt_algorithm],
            options={
                "require_exp": True,
                "require_iat": True,
                "require_nbf": True,
                "require_iss": True,
                "require_aud": True,
                "require_sub": True,
            },
            issuer=OTA_TOKEN_ISSUER,
            audience=OTA_TOKEN_AUDIENCE,
        )

        # Verify it's an OTA download token
        if payload.get("sub") != OTA_TOKEN_SUBJECT or payload.get("typ") != OTA_TOKEN_TYPE:
            return None

        device_uid = payload.get("device_uid")
        if not device_uid:
            return None

        # Verify required fields
        required_uuid_claims = ("firmware_id", "job_id", "jti", "tenant_id")
        try:
            for claim in required_uuid_claims:
                uuid.UUID(str(payload[claim]))
            if payload.get("campaign_id") is not None:
                uuid.UUID(str(payload["campaign_id"]))
        except (KeyError, TypeError, ValueError):
            return None

        return payload
    except JWTError:
        return None
