"""Application-layer error codes.

These codes are used by application services to signal specific failure
conditions.  Presentation adapters (FastAPI routers) map them to HTTP
status codes and response bodies.
"""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    """Standardized error codes for the AIFOM application layer."""

    # General
    INTERNAL_ERROR = "INTERNAL_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    FORBIDDEN = "FORBIDDEN"
    UNAUTHORIZED = "UNAUTHORIZED"

    # Identity
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    USER_INACTIVE = "USER_INACTIVE"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"

    # Device registry
    DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND"
    DEVICE_ALREADY_EXISTS = "DEVICE_ALREADY_EXISTS"
    DEVICE_ALREADY_ASSIGNED = "DEVICE_ALREADY_ASSIGNED"
    DEVICE_TYPE_NOT_FOUND = "DEVICE_TYPE_NOT_FOUND"

    # Firmware / OTA
    FIRMWARE_NOT_FOUND = "FIRMWARE_NOT_FOUND"
    FIRMWARE_TOO_LARGE = "FIRMWARE_TOO_LARGE"
    FIRMWARE_EMPTY = "FIRMWARE_EMPTY"
    OTA_JOB_NOT_FOUND = "OTA_JOB_NOT_FOUND"
    OTA_PUBLISH_FAILED = "OTA_PUBLISH_FAILED"

    # Tenant management
    TENANT_NOT_FOUND = "TENANT_NOT_FOUND"
    TENANT_SLUG_CONFLICT = "TENANT_SLUG_CONFLICT"
    PLAN_NOT_FOUND = "PLAN_NOT_FOUND"
    FEATURE_NOT_ENABLED = "FEATURE_NOT_ENABLED"

    # Telemetry
    DEVICE_UID_NOT_FOUND = "DEVICE_UID_NOT_FOUND"

    # Project dashboard
    PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
    PAGE_NOT_FOUND = "PAGE_NOT_FOUND"
    WIDGET_NOT_FOUND = "WIDGET_NOT_FOUND"
