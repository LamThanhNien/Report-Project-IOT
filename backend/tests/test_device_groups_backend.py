from datetime import datetime, timezone
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main as app_main
from app.bounded_contexts.device_groups.application.use_cases import DeviceGroupUseCases
from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
    DeviceGroup,
    DeviceGroupMember,
)
from app.bounded_contexts.device_groups.presentation import router as device_group_router
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies
from app.bounded_contexts.tenant_management.presentation import dependencies as tenant_dependencies
from app.core import security as security_module
from app.core import tenant as tenant_module
from sqlalchemy.exc import IntegrityError


TENANT_A = uuid4()
TENANT_B = uuid4()
DEVICE_A = uuid4()
DEVICE_FOREIGN = uuid4()


def _tenant_user(
    *,
    tenant_id=TENANT_A,
    role: str = "tenant_owner",
    permissions: list[str] | None = None,
):
    return SimpleNamespace(
        id=uuid4(),
        email="tenant-user@test.local",
        role=role,
        tenant_id=tenant_id,
        is_active=True,
        permissions=permissions,
    )


class _TenantOverride:
    def __init__(self, user, fake_use_case=None):
        self.user = user
        self.fake_use_case = fake_use_case
        self._saved = None

    def __enter__(self):
        self._saved = dict(app_main.app.dependency_overrides)
        app_main.app.dependency_overrides = {
            security_module.get_current_user: lambda: self.user,
            tenant_module.get_current_tenant_user: lambda: self.user,
            identity_dependencies.get_current_user: lambda: self.user,
            identity_dependencies.get_current_tenant_user: lambda: self.user,
            tenant_dependencies.get_current_tenant_user: lambda: self.user,
            device_group_router.get_db: lambda: object(),
        }
        if self.fake_use_case is not None:
            self._saved_use_case = device_group_router.DeviceGroupUseCases
            device_group_router.DeviceGroupUseCases = lambda db: self.fake_use_case
        return TestClient(app_main.app)

    def __exit__(self, *_):
        if self.fake_use_case is not None:
            device_group_router.DeviceGroupUseCases = self._saved_use_case
        app_main.app.dependency_overrides = self._saved


def _group(group_id, tenant_id, name="Group A", description=None, device_count=0):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=group_id,
        tenant_id=tenant_id,
        tenant=None,
        name=name,
        description=description,
        group_type="manual",
        status="active",
        tags=[],
        extra_metadata={},
        device_count=device_count,
        created_at=now,
        updated_at=now,
    )


class FakeDeviceGroupUseCases:
    def __init__(self):
        self.group_a_id = uuid4()
        self.group_b_id = uuid4()
        self.groups = {
            self.group_a_id: _group(self.group_a_id, TENANT_A, "Tenant A group"),
            self.group_b_id: _group(self.group_b_id, TENANT_B, "Tenant B group"),
        }
        self.devices = {DEVICE_A: TENANT_A, DEVICE_FOREIGN: TENANT_B}
        self.memberships: set[tuple[UUID, UUID]] = set()
        self.deleted_devices: list[UUID] = []

    def create_group(self, tenant_id, data, created_by=None):
        group_id = uuid4()
        group = _group(group_id, tenant_id, data.name, data.description)
        self.groups[group_id] = group
        return group

    def list_groups(self, tenant_id, group_type=None, status=None, search=None, skip=0, limit=50):
        items = [group for group in self.groups.values() if group.tenant_id == tenant_id]
        return items[skip : skip + limit], len(items)

    def get_group(self, tenant_id, group_id):
        group = self.groups.get(group_id)
        return group if group and group.tenant_id == tenant_id else None

    def update_group(self, tenant_id, group_id, data):
        group = self.get_group(tenant_id, group_id)
        if group is None:
            return None
        if data.name is not None:
            group.name = data.name
        if data.description is not None:
            group.description = data.description
        return group

    def delete_group(self, tenant_id, group_id):
        group = self.get_group(tenant_id, group_id)
        if group is None:
            return False
        self.memberships = {
            membership for membership in self.memberships if membership[0] != group_id
        }
        del self.groups[group_id]
        return True

    def add_devices_to_group(self, tenant_id, group_id, device_ids, added_by=None):
        if self.get_group(tenant_id, group_id) is None:
            raise LookupError("Device group not found")
        if any(self.devices.get(device_id) != tenant_id for device_id in device_ids):
            raise PermissionError("One or more devices were not found for this tenant")
        before = len(self.memberships)
        for device_id in device_ids:
            self.memberships.add((group_id, device_id))
        return len(self.memberships) - before

    def remove_devices_from_group(self, tenant_id, group_id, device_ids):
        if self.get_group(tenant_id, group_id) is None:
            raise LookupError("Device group not found")
        if any(self.devices.get(device_id) != tenant_id for device_id in device_ids):
            raise PermissionError("One or more devices were not found for this tenant")
        before = len(self.memberships)
        for device_id in device_ids:
            self.memberships.discard((group_id, device_id))
        return before - len(self.memberships)

    def list_group_devices(self, tenant_id, group_id, skip=0, limit=50):
        if self.get_group(tenant_id, group_id) is None:
            raise LookupError("Device group not found")
        items = [
            {
                "member_id": uuid4(),
                "device_id": device_id,
                "device_uid": f"device-{device_id}",
                "device_name": "Device",
                "device_status": "online",
                "added_at": datetime.now(timezone.utc),
            }
            for member_group_id, device_id in self.memberships
            if member_group_id == group_id
        ]
        return items[skip : skip + limit], len(items)

    def list_device_groups(self, tenant_id, device_id, skip=0, limit=50):
        if self.devices.get(device_id) != tenant_id:
            raise PermissionError("One or more devices were not found for this tenant")
        group_ids = [
            group_id
            for group_id, member_device_id in self.memberships
            if member_device_id == device_id
        ]
        items = [self.groups[group_id] for group_id in group_ids]
        return items[skip : skip + limit], len(items)


def test_device_group_orm_constraints_match_migration() -> None:
    group_constraints = {constraint.name for constraint in DeviceGroup.__table__.constraints}
    member_constraints = {constraint.name for constraint in DeviceGroupMember.__table__.constraints}
    group_indexes = {index.name for index in DeviceGroup.__table__.indexes}
    member_indexes = {index.name for index in DeviceGroupMember.__table__.indexes}

    assert "uq_device_groups_tenant_name" in group_constraints
    assert "chk_device_groups_group_type" in group_constraints
    assert "chk_device_groups_status" in group_constraints
    assert "idx_device_groups_tenant_id" in group_indexes
    assert "idx_device_groups_status" in group_indexes
    assert "uq_device_group_members_group_device" in member_constraints
    assert "idx_device_group_members_group_id" in member_indexes
    assert "idx_device_group_members_device_id" in member_indexes


def test_tenant_owner_can_create_list_get_update_and_delete_group_without_deleting_devices() -> (
    None
):
    fake = FakeDeviceGroupUseCases()
    owner = _tenant_user()

    with _TenantOverride(owner, fake) as client:
        create = client.post(
            "/api/v1/client/device-groups",
            json={"name": "Created group", "description": "Created description"},
        )
        assert create.status_code == 201, create.text
        created_id = create.json()["id"]

        listed = client.get("/api/v1/client/device-groups")
        assert listed.status_code == 200, listed.text
        assert {item["tenant_id"] for item in listed.json()["items"]} == {str(TENANT_A)}

        detail = client.get(f"/api/v1/client/device-groups/{created_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["name"] == "Created group"

        updated = client.put(
            f"/api/v1/client/device-groups/{created_id}",
            json={"name": "Updated group", "description": "Updated description"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["name"] == "Updated group"
        assert updated.json()["description"] == "Updated description"

        deleted = client.delete(f"/api/v1/client/device-groups/{created_id}")
        assert deleted.status_code == 204, deleted.text

    assert fake.deleted_devices == []


def test_tenant_owner_can_add_duplicate_list_and_remove_tenant_device_members() -> None:
    fake = FakeDeviceGroupUseCases()
    owner = _tenant_user()
    group_id = fake.group_a_id

    with _TenantOverride(owner, fake) as client:
        added = client.post(
            f"/api/v1/client/device-groups/{group_id}/members",
            json={"device_ids": [str(DEVICE_A)]},
        )
        assert added.status_code == 200, added.text
        assert added.json() == {"added": 1}

        duplicate = client.post(
            f"/api/v1/client/device-groups/{group_id}/members",
            json={"device_ids": [str(DEVICE_A)]},
        )
        assert duplicate.status_code == 200, duplicate.text
        assert duplicate.json() == {"added": 0}
        assert fake.memberships == {(group_id, DEVICE_A)}

        device_groups = client.get(f"/api/v1/client/devices/{DEVICE_A}/groups")
        assert device_groups.status_code == 200, device_groups.text
        assert device_groups.json()["total"] == 1

        removed = client.post(
            f"/api/v1/client/device-groups/{group_id}/members/remove",
            json={"device_ids": [str(DEVICE_A)]},
        )
        assert removed.status_code == 200, removed.text
        assert removed.json() == {"removed": 1}
        assert fake.memberships == set()


def test_tenant_cannot_add_or_remove_foreign_tenant_device_membership() -> None:
    fake = FakeDeviceGroupUseCases()
    owner = _tenant_user()
    group_id = fake.group_a_id
    fake.memberships.add((group_id, DEVICE_A))
    fake.memberships.add((group_id, DEVICE_FOREIGN))

    with _TenantOverride(owner, fake) as client:
        add_foreign = client.post(
            f"/api/v1/client/device-groups/{group_id}/members",
            json={"device_ids": [str(DEVICE_FOREIGN)]},
        )
        assert add_foreign.status_code == 403, add_foreign.text

        remove_foreign = client.post(
            f"/api/v1/client/device-groups/{group_id}/members/remove",
            json={"device_ids": [str(DEVICE_FOREIGN)]},
        )
        assert remove_foreign.status_code == 403, remove_foreign.text

    assert (group_id, DEVICE_A) in fake.memberships
    assert (group_id, DEVICE_FOREIGN) in fake.memberships


class _FakeQuery:
    def __init__(self, *, first_value=None, all_value=None, scalar_value=0):
        self.first_value = first_value
        self.all_value = all_value if all_value is not None else []
        self.scalar_value = scalar_value
        self.delete_called = False

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self.first_value

    def all(self):
        return self.all_value

    def scalar(self):
        return self.scalar_value

    def delete(self, synchronize_session=False):
        self.delete_called = True
        return 1


class _UseCaseFakeDb:
    def __init__(self, *, tenant_device_rows, commit_raises_integrity=False):
        self.group = _group(uuid4(), TENANT_A, "Tenant A group")
        self.tenant_device_rows = tenant_device_rows
        self.commit_raises_integrity = commit_raises_integrity
        self.member_delete_query = _FakeQuery()
        self.added = []
        self.rollback_called = False

    def query(self, *entities):
        entity = entities[0]
        if entity is DeviceGroup:
            return _FakeQuery(first_value=self.group)
        if entity is DeviceGroupMember:
            return self.member_delete_query
        if getattr(entity, "key", None) == "device_id":
            return _FakeQuery(all_value=self.tenant_device_rows)
        return _FakeQuery(scalar_value=0)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        if self.commit_raises_integrity:
            raise IntegrityError("duplicate", {}, None)

    def rollback(self):
        self.rollback_called = True


def test_use_case_remove_validates_tenant_device_ownership_before_deleting() -> None:
    db = _UseCaseFakeDb(tenant_device_rows=[(DEVICE_A,)])
    uc = DeviceGroupUseCases(db)

    try:
        uc.remove_devices_from_group(TENANT_A, db.group.id, [DEVICE_FOREIGN])
    except PermissionError as exc:
        assert str(exc) == "One or more devices were not found for this tenant"
    else:
        raise AssertionError("Expected PermissionError")

    assert db.member_delete_query.delete_called is False


def test_use_case_add_duplicate_commit_error_is_controlled() -> None:
    db = _UseCaseFakeDb(tenant_device_rows=[(DEVICE_A,)], commit_raises_integrity=True)
    uc = DeviceGroupUseCases(db)

    try:
        uc.add_devices_to_group(
            TENANT_A,
            db.group.id,
            [DEVICE_A],
            added_by=uuid4(),
        )
    except ValueError as exc:
        assert str(exc) == "One or more devices are already members of this group"
    else:
        raise AssertionError("Expected ValueError")

    assert db.rollback_called is True


def test_tenant_a_cannot_view_update_or_delete_tenant_b_group() -> None:
    fake = FakeDeviceGroupUseCases()
    owner = _tenant_user()
    foreign_group_id = fake.group_b_id

    with _TenantOverride(owner, fake) as client:
        assert client.get(f"/api/v1/client/device-groups/{foreign_group_id}").status_code == 404
        assert (
            client.put(
                f"/api/v1/client/device-groups/{foreign_group_id}",
                json={"name": "Cross tenant"},
            ).status_code
            == 404
        )
        assert client.delete(f"/api/v1/client/device-groups/{foreign_group_id}").status_code == 404


def test_viewer_can_view_groups_but_cannot_manage_groups() -> None:
    fake = FakeDeviceGroupUseCases()
    viewer = _tenant_user(role="viewer", permissions=["device_groups.view"])

    with _TenantOverride(viewer, fake) as client:
        assert client.get("/api/v1/client/device-groups").status_code == 200
        assert (
            client.post("/api/v1/client/device-groups", json={"name": "Denied"}).status_code == 403
        )
        assert (
            client.post(
                f"/api/v1/client/device-groups/{fake.group_a_id}/members",
                json={"device_ids": [str(DEVICE_A)]},
            ).status_code
            == 403
        )


def test_unauthorized_device_group_requests_are_rejected() -> None:
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}
    try:
        response = TestClient(app_main.app).get("/api/v1/client/device-groups")
        assert response.status_code == 401
    finally:
        app_main.app.dependency_overrides = saved
