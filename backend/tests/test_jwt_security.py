import os
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from jose import jwt

from app.core.config import Settings
from app.bounded_contexts.identity.application.services import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
)
from app.core.config import settings

ACCESS_SECRET = "0123456789abcdef" * 4
REFRESH_SECRET = "fedcba9876543210" * 4
OTA_SECRET = "00112233445566778899aabbccddeeff" * 2


def secure_settings_kwargs(**overrides) -> dict:
    values = {
        "app_env": "development",
        "jwt_secret": ACCESS_SECRET,
        "jwt_refresh_secret": REFRESH_SECRET,
        "ota_token_secret": OTA_SECRET,
        "mqtt_username": "test-api",
        "mqtt_password": "test-password",
    }
    values.update(overrides)
    return values


def test_startup_fails_with_pytest_in_sys_modules(monkeypatch):
    """Production must fail with weak secret even if pytest is imported."""
    # Ensure pytest is in sys.modules (it naturally is during tests)
    assert "pytest" in sys.modules
    if "AIFOM_TESTING" in os.environ:
        monkeypatch.delenv("AIFOM_TESTING", raising=False)

    with pytest.raises(SystemExit) as excinfo:
        Settings(
            app_env="production",
            jwt_secret="short",
            jwt_refresh_secret="short2",
            auth_cookie_secure=True,
            auth_legacy_token_response=False,
            mqtt_tls_enabled=True,
            minio_secure=True,
        )
    assert excinfo.value.code == 1


def test_startup_fails_with_aifom_testing_in_production(monkeypatch):
    """Production must fail with weak secret even if AIFOM_TESTING=1."""
    monkeypatch.setenv("AIFOM_TESTING", "1")

    with pytest.raises(SystemExit) as excinfo:
        Settings(
            app_env="production",
            jwt_secret="short",
            jwt_refresh_secret="short2",
            auth_cookie_secure=True,
            auth_legacy_token_response=False,
            mqtt_tls_enabled=True,
            minio_secure=True,
        )
    assert excinfo.value.code == 1


def test_startup_fails_with_identical_secrets(monkeypatch):
    """Production must reject if jwt_secret == jwt_refresh_secret."""
    monkeypatch.delitem(sys.modules, "pytest", raising=False)
    monkeypatch.delitem(sys.modules, "unittest", raising=False)
    if "AIFOM_TESTING" in os.environ:
        monkeypatch.delenv("AIFOM_TESTING", raising=False)

    valid_secret = ACCESS_SECRET
    with pytest.raises(SystemExit) as excinfo:
        Settings(
            app_env="production",
            jwt_secret=valid_secret,
            jwt_refresh_secret=valid_secret,
            auth_cookie_secure=True,
            auth_legacy_token_response=False,
            mqtt_tls_enabled=True,
            minio_secure=True,
        )
    assert excinfo.value.code == 1


def test_startup_fails_with_low_entropy_secret(monkeypatch):
    """Production must reject long secret with low entropy (< 16 unique chars)."""
    monkeypatch.delitem(sys.modules, "pytest", raising=False)
    monkeypatch.delitem(sys.modules, "unittest", raising=False)
    if "AIFOM_TESTING" in os.environ:
        monkeypatch.delenv("AIFOM_TESTING", raising=False)

    # 32 chars, but only 2 unique chars
    low_entropy = "abababababababababababababababab"
    valid_secret = REFRESH_SECRET
    with pytest.raises(SystemExit) as excinfo:
        Settings(
            app_env="production",
            jwt_secret=low_entropy,
            jwt_refresh_secret=valid_secret,
            auth_cookie_secure=True,
            auth_legacy_token_response=False,
            mqtt_tls_enabled=True,
            minio_secure=True,
        )
    assert excinfo.value.code == 1


def test_token_missing_required_claims_rejected():
    """Access token must be rejected if missing any required claim."""
    now = datetime.now(timezone.utc)
    base_payload = {
        "sub": str(uuid4()),
        "exp": now + timedelta(minutes=30),
        "type": "access",
        "jti": str(uuid4()),
        "iat": now,
        "nbf": now,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }

    required_claims = ["sub", "exp", "type", "jti", "iat", "nbf", "iss", "aud"]

    for claim in required_claims:
        payload = base_payload.copy()
        del payload[claim]
        token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        assert decode_access_token(token) is None, f"Token missing {claim} should be rejected"


def test_refresh_token_migration_fallback_success(monkeypatch, caplog):
    """Legacy refresh token without iss/aud succeeds if fallback active."""
    monkeypatch.setattr(settings, "jwt_refresh_secret", "new-refresh-secret-12345678901234")
    # Set deadline in the future
    future_deadline = datetime.now(timezone.utc) + timedelta(days=1)
    monkeypatch.setattr(settings, "jwt_migration_deadline", future_deadline)

    # Legacy token signed with OLD (main) secret, lacking iss and aud
    payload = {
        "sub": "user_legacy",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh",
        "jti": str(uuid4()),
        # missing iat, nbf, iss, aud
    }
    old_token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    # decode_refresh_token should fallback to settings.jwt_secret and succeed
    assert decode_refresh_token(old_token) == "user_legacy"
    assert "user_legacy" not in caplog.text
    assert "legacy_refresh_token_accepted" in caplog.text


def test_refresh_token_migration_fallback_expired(monkeypatch):
    """Legacy refresh token fails even in fallback if expired."""
    monkeypatch.setattr(settings, "jwt_refresh_secret", "new-refresh-secret-12345678901234")
    future_deadline = datetime.now(timezone.utc) + timedelta(days=1)
    monkeypatch.setattr(settings, "jwt_migration_deadline", future_deadline)

    payload = {
        "sub": "user_legacy",
        "exp": datetime.now(timezone.utc) - timedelta(days=1),  # Expired!
        "type": "refresh",
        "jti": str(uuid4()),
    }
    old_token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    assert decode_refresh_token(old_token) is None


def test_refresh_token_migration_deadline_passed(monkeypatch):
    """Legacy refresh token fails if migration deadline has passed."""
    monkeypatch.setattr(settings, "jwt_refresh_secret", "new-refresh-secret-12345678901234")
    # Set deadline in the PAST
    past_deadline = datetime.now(timezone.utc) - timedelta(days=1)
    monkeypatch.setattr(settings, "jwt_migration_deadline", past_deadline)

    payload = {
        "sub": "user_legacy",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh",
        "jti": str(uuid4()),
    }
    old_token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    assert decode_refresh_token(old_token) is None


def test_forged_tokens_rejected():
    """Tokens signed with a different secret must be rejected."""
    payload = {
        "sub": str(uuid4()),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        "type": "access",
        "jti": str(uuid4()),
        "iat": datetime.now(timezone.utc),
        "nbf": datetime.now(timezone.utc),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    forged_token = jwt.encode(
        payload, "forged-wrong-secret-a1b2c3d4e5f6", algorithm=settings.jwt_algorithm
    )
    assert decode_access_token(forged_token) is None


def test_access_token_rejected_as_refresh_token():
    """Access token must not be accepted as a refresh token."""
    access_token = create_access_token(str(uuid4()))
    assert decode_refresh_token(access_token) is None


def test_refresh_token_rejected_as_access_token():
    """Refresh token must not be accepted as an access token."""
    refresh_token = create_refresh_token(str(uuid4()))
    assert decode_access_token(refresh_token) is None


def test_startup_fails_when_environment_is_omitted_and_secrets_are_missing():
    """Forgetting APP_ENV must not restore an insecure development fallback."""
    with pytest.raises(SystemExit):
        Settings(
            _env_file=None,
            app_env="development",
            jwt_secret="",
            jwt_refresh_secret="",
            ota_token_secret=OTA_SECRET,
            mqtt_username="test-api",
            mqtt_password="test-password",
        )


def test_predictable_32_character_value_is_not_an_encoded_32_byte_secret():
    with pytest.raises(SystemExit):
        Settings(**secure_settings_kwargs(jwt_secret="abcdefghijklmnopqrstuvwxyzABCDEF"))


@pytest.mark.parametrize(
    "deadline",
    [
        datetime.now(),
        datetime.now(timezone.utc) - timedelta(minutes=1),
        datetime.now(timezone.utc) + timedelta(days=8),
    ],
)
def test_invalid_migration_deadline_fails_at_startup(deadline):
    with pytest.raises(SystemExit):
        Settings(**secure_settings_kwargs(jwt_migration_deadline=deadline))
