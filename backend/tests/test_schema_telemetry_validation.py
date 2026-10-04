"""Unit tests for Pydantic schema validation and telemetry interval whitelist validation.

Covers security remediations for input validation:
- Invalid email format rejection via EmailStr.
- Special character rejection in tenant_slug and target_device_type fields.
- Whitelist enforcement for telemetry query bucket_interval and aggregate parameters.
"""

from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from app.bounded_contexts.firmware_ota.presentation.firmware_schemas import FirmwareCreate
from app.bounded_contexts.identity.presentation.schemas import RegisterRequest
from app.bounded_contexts.telemetry.infrastructure.repositories import (
    list_telemetry_by_device_uid,
)
from app.bounded_contexts.tenant_management.presentation.schemas import TenantCreate


def test_register_request_invalid_email():
    """Verify RegisterRequest rejects malformed email addresses."""
    invalid_emails = [
        "not-an-email",
        "user@domain",
        "@domain.com",
        "user@",
        "user space@domain.com",
    ]
    for email in invalid_emails:
        with pytest.raises(ValidationError):
            RegisterRequest(
                tenant_name="Test Tenant",
                tenant_slug="valid-slug",
                owner_email=email,
                owner_password="Password123!",
            )


def test_register_request_tenant_slug_special_characters():
    """Verify RegisterRequest rejects tenant_slug with special characters or invalid length."""
    invalid_slugs = [
        "ab",  # Too short (<3)
        "tenant;drop",  # Semicolon
        "tenant'--",  # SQL injection vector with quote and comment
        "<script>alert(1)</script>",  # XSS
        "tenant slug",  # Whitespace
        "TenantSlug",  # Uppercase
        "tenant_slug",  # Underscore (not matched by ^[a-z0-9-]+$)
    ]
    for slug in invalid_slugs:
        with pytest.raises(ValidationError):
            RegisterRequest(
                tenant_name="Test Tenant",
                tenant_slug=slug,
                owner_email="owner@example.com",
                owner_password="Password123!",
            )


def test_register_request_valid():
    """Verify RegisterRequest accepts valid email and tenant_slug."""
    req = RegisterRequest(
        tenant_name="Test Tenant",
        tenant_slug="my-tenant-123",
        owner_email="owner@example.com",
        owner_password="Password123!",
    )
    assert req.owner_email == "owner@example.com"
    assert req.tenant_slug == "my-tenant-123"


def test_tenant_create_validation():
    """Verify TenantCreate validates slug and owner_email constraints."""
    # Invalid slug with special characters
    with pytest.raises(ValidationError):
        TenantCreate(name="Test Tenant", slug="bad;slug", owner_email="valid@example.com")

    # Invalid email
    with pytest.raises(ValidationError):
        TenantCreate(name="Test Tenant", slug="valid-slug", owner_email="invalid-email")

    # Valid tenant create
    tenant = TenantCreate(
        name="Test Tenant", slug="valid-slug-123", owner_email="valid@example.com"
    )
    assert tenant.slug == "valid-slug-123"


def test_firmware_create_target_device_type_validation():
    """Verify FirmwareCreate validates target_device_type slug constraints."""
    invalid_targets = [
        "ab",  # Too short
        "esp32;injection",  # Special character
        "<script>",  # HTML tag
        "ESP32",  # Uppercase
        "esp32 device",  # Whitespace
    ]
    for target in invalid_targets:
        with pytest.raises(ValidationError):
            FirmwareCreate(
                version="1.0.0",
                target_device_type=target,
                file_name="firmware.bin",
                object_key="firmware/firmware.bin",
                file_size=1024,
                checksum_sha256="a" * 64,
            )

    # Valid target_device_type
    fw = FirmwareCreate(
        version="1.0.0",
        target_device_type="esp32-sensor",
        file_name="firmware.bin",
        object_key="firmware/firmware.bin",
        file_size=1024,
        checksum_sha256="a" * 64,
    )
    assert fw.target_device_type == "esp32-sensor"


def test_telemetry_bucket_interval_invalid_rejected_before_sql():
    """Verify list_telemetry_by_device_uid rejects invalid time_range or aggregate before SQL execution."""
    db_mock = MagicMock()

    # Invalid time_range with SQL injection attempt
    with pytest.raises(ValueError, match="Invalid time_range parameter"):
        list_telemetry_by_device_uid(
            db=db_mock,
            device_uid="test-dev-uid",
            time_range="1d'; DROP TABLE telemetry;--",  # type: ignore
        )

    # Invalid aggregate function
    with pytest.raises(ValueError, match="Invalid aggregate parameter"):
        list_telemetry_by_device_uid(
            db=db_mock,
            device_uid="test-dev-uid",
            time_range="1d",
            aggregate="SUM';--",  # type: ignore
        )

    # Assert db query methods were NEVER called due to early ValueError validation
    db_mock.execute.assert_not_called()
    db_mock.scalars.assert_not_called()
