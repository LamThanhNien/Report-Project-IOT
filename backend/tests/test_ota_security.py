from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from jose import jwt
from pydantic import ValidationError
from fastapi import HTTPException

from app.core.config import Settings, settings
from app.core.ota_tokens import create_ota_download_token, decode_ota_download_token
from app.bounded_contexts.firmware_ota.presentation.router_firmware import (
    _ensure_ota_resource_scope,
)


def _claims(token: str) -> dict:
    return jwt.get_unverified_claims(token)


def _token() -> str:
    return create_ota_download_token(
        firmware_id=uuid4(),
        job_id=uuid4(),
        device_uid="esp32-secure-001",
        tenant_id=uuid4(),
        campaign_id=uuid4(),
    )


def test_ota_token_has_bounded_lifetime_and_scoped_claims(monkeypatch):
    monkeypatch.setattr(settings, "ota_token_expire_minutes", 2)
    token = _token()
    payload = _claims(token)

    assert decode_ota_download_token(token) == payload
    assert payload["exp"] - payload["iat"] == 120
    assert payload["nbf"] == payload["iat"]
    assert payload["aud"] == "aifom-ota-device"
    assert payload["sub"] == "ota-download"
    assert payload["typ"] == "ota-download+jwt"
    for claim in ("jti", "firmware_id", "job_id", "tenant_id", "campaign_id"):
        UUID(payload[claim])


@pytest.mark.parametrize(
    "claim",
    [
        "exp",
        "iat",
        "nbf",
        "iss",
        "aud",
        "sub",
        "typ",
        "jti",
        "firmware_id",
        "job_id",
        "device_uid",
        "tenant_id",
    ],
)
def test_ota_token_missing_required_claim_is_rejected(claim):
    payload = _claims(_token())
    payload.pop(claim)
    token = jwt.encode(payload, settings.ota_token_secret, algorithm=settings.jwt_algorithm)
    assert decode_ota_download_token(token) is None


def test_ota_token_forgery_expiry_and_wrong_audience_are_rejected():
    payload = _claims(_token())
    forged = jwt.encode(payload, "1" * 64, algorithm=settings.jwt_algorithm)
    assert decode_ota_download_token(forged) is None

    payload["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    expired = jwt.encode(payload, settings.ota_token_secret, algorithm=settings.jwt_algorithm)
    assert decode_ota_download_token(expired) is None

    payload = _claims(_token())
    payload["aud"] = "device:someone-else"
    wrong_audience = jwt.encode(
        payload, settings.ota_token_secret, algorithm=settings.jwt_algorithm
    )
    assert decode_ota_download_token(wrong_audience) is None


def test_weak_ota_secret_is_rejected_even_in_development():
    with pytest.raises(SystemExit):
        Settings(
            _env_file=None,
            app_env="development",
            jwt_secret="0123456789abcdef" * 4,
            jwt_refresh_secret="fedcba9876543210" * 4,
            ota_token_secret="changeme-ota-token-secret",
            mqtt_username="test-api",
            mqtt_password="test-password",
        )


def test_ota_token_lifetime_is_configuration_bounded():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_env="development",
            jwt_secret="0123456789abcdef" * 4,
            jwt_refresh_secret="fedcba9876543210" * 4,
            ota_token_secret="00112233445566778899aabbccddeeff" * 2,
            ota_token_expire_minutes=31,
            mqtt_username="test-api",
            mqtt_password="test-password",
        )


def test_ota_replay_migration_has_no_unrelated_destructive_operations():
    migration = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "0002_add_used_ota_token_replay_protection.py"
    ).read_text(encoding="utf-8")
    upgrade = migration.split("def downgrade", 1)[0]

    assert '"used_ota_tokens"' in upgrade
    assert "drop_table" not in upgrade
    assert "drop_index" not in upgrade
    assert "alter_column" not in upgrade
    assert "blacklisted_tokens" not in upgrade


def _scope_objects():
    tenant_id = uuid4()
    firmware_id = uuid4()
    device_id = uuid4()
    payload = {
        "tenant_id": str(tenant_id),
        "device_uid": "esp32-secure-001",
    }
    job = SimpleNamespace(
        firmware_version_id=firmware_id,
        device_id=device_id,
        tenant_id=tenant_id,
        campaign_id=None,
        status="pending",
    )
    device = SimpleNamespace(id=device_id, tenant_id=tenant_id, device_uid="esp32-secure-001")
    firmware = SimpleNamespace(
        id=firmware_id,
        uploaded_by_tenant_id=tenant_id,
        checksum_sha256="a" * 64,
        signature=None,
        signature_alg=None,
        signing_public_key=None,
        release_channel="dev",
        verification_required=False,
    )
    return payload, firmware_id, job, device, firmware


@pytest.mark.parametrize("target", ["device", "job", "firmware"])
def test_ota_scope_rejects_cross_tenant_resources(target):
    payload, firmware_id, job, device, firmware = _scope_objects()
    other_tenant = uuid4()
    if target == "device":
        device.tenant_id = other_tenant
    elif target == "job":
        job.tenant_id = other_tenant
    else:
        firmware.uploaded_by_tenant_id = other_tenant

    with pytest.raises(HTTPException) as exc_info:
        _ensure_ota_resource_scope(payload, firmware_id, job, device, firmware)
    assert exc_info.value.status_code == 403


def test_ota_scope_rejects_campaign_mismatch():
    payload, firmware_id, job, device, firmware = _scope_objects()
    job.campaign_id = uuid4()
    payload["campaign_id"] = str(uuid4())

    with pytest.raises(HTTPException) as exc_info:
        _ensure_ota_resource_scope(payload, firmware_id, job, device, firmware)
    assert exc_info.value.status_code == 403


def test_ota_scope_rejects_invalid_checksum_metadata():
    payload, firmware_id, job, device, firmware = _scope_objects()
    firmware.checksum_sha256 = "not-a-sha256"

    with pytest.raises(HTTPException) as exc_info:
        _ensure_ota_resource_scope(payload, firmware_id, job, device, firmware)
    assert exc_info.value.status_code == 403
