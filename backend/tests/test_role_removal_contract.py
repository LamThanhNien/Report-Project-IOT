"""Role and route contract checks; these tests never enter app lifespan."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main as app_main
from app.bounded_contexts.identity.domain.value_objects import SUPPORTED_ROLES
from app.bounded_contexts.tenant_management.presentation.schemas import TenantUserCreate, TenantUserUpdate
from app.core.permissions import get_effective_permissions


def test_supported_role_contract_and_removed_routes():
    assert SUPPORTED_ROLES == {"admin", "tenant_owner", "viewer"}
    paths = app_main.app.openapi()["paths"]
    assert not any("/engineer" in path for path in paths)
    client = TestClient(app_main.app)
    for path in ("/api/v1/admin/engineers", "/api/v1/platform/engineer/me"):
        assert client.get(path).status_code == 404


@pytest.mark.parametrize("role", ["platform_engineer", "tenant_engineer", "unknown"])
def test_unsupported_role_has_no_permissions_or_creation_schema(role):
    assert get_effective_permissions(SimpleNamespace(role=role, permissions=["projects.manage"])) == []
    with pytest.raises(ValidationError):
        TenantUserCreate(email="retired@example.com", password="Validpass1", role=role)
    with pytest.raises(ValidationError):
        TenantUserUpdate(role=role)


def test_viewer_write_permissions_are_rejected():
    with pytest.raises(HTTPException):
        TenantUserCreate(email="viewer@example.com", password="Validpass1", permissions=["commands.send"])
    with pytest.raises(HTTPException):
        TenantUserUpdate(permissions=["projects.manage"])
