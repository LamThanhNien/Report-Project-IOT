import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.bounded_contexts.tenant_management.infrastructure import repositories as tenant_repo
from app.bounded_contexts.identity.infrastructure.token_cleanup import TokenCleanupTask
from app.bounded_contexts.identity.infrastructure.persistence.token_blacklist import (
    BlacklistedToken,
)


@pytest.fixture(scope="module")
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_baseline_enforces_one_tenant_per_device(db_session: Session):
    # Clean up existing test state if any
    db_session.execute(text("DELETE FROM audit_logs"))
    db_session.execute(text("DELETE FROM tenant_device_mappings"))
    db_session.execute(text("DELETE FROM devices"))
    db_session.execute(text("DELETE FROM tenants"))
    db_session.commit()

    # Create two test tenants and one test device
    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    device_id = uuid.uuid4()

    db_session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A', 'tenant-a')"),
        {"id": tenant_a_id},
    )
    db_session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B', 'tenant-b')"),
        {"id": tenant_b_id},
    )
    db_session.execute(
        text(
            "INSERT INTO devices (id, device_uid, name, status) VALUES (:id, 'dev-001', 'Test Device', 'offline')"
        ),
        {"id": device_id},
    )
    db_session.commit()

    # The squashed baseline owns the final uniqueness rule directly.
    db_session.execute(
        text(
            "INSERT INTO tenant_device_mappings (tenant_id, device_id) VALUES (:tenant_id, :device_id)"
        ),
        {"tenant_id": tenant_a_id, "device_id": device_id},
    )
    db_session.commit()

    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO tenant_device_mappings (tenant_id, device_id) VALUES (:tenant_id, :device_id)"
            ),
            {"tenant_id": tenant_b_id, "device_id": device_id},
        )
        db_session.commit()
    db_session.rollback()

    db_session.execute(text("DELETE FROM audit_logs"))
    db_session.execute(text("DELETE FROM tenant_device_mappings"))
    db_session.execute(text("DELETE FROM devices"))
    db_session.execute(text("DELETE FROM tenants"))
    db_session.commit()


def test_assign_device_integrity_and_idempotency(db_session: Session):
    db_session.execute(text("DELETE FROM audit_logs"))
    db_session.execute(text("DELETE FROM tenant_device_mappings"))
    db_session.execute(text("DELETE FROM devices"))
    db_session.execute(text("DELETE FROM tenants"))
    db_session.commit()

    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    device_id = uuid.uuid4()

    db_session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A', 'tenant-a')"),
        {"id": tenant_a_id},
    )
    db_session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B', 'tenant-b')"),
        {"id": tenant_b_id},
    )
    db_session.execute(
        text(
            "INSERT INTO devices (id, device_uid, name, status) VALUES (:id, 'dev-002', 'Test Device 2', 'offline')"
        ),
        {"id": device_id},
    )
    db_session.commit()

    # 1. Idempotency check: assigning to same tenant twice should succeed
    map1 = tenant_repo.assign_device(db_session, tenant_a_id, device_id)
    assert map1.tenant_id == tenant_a_id
    assert map1.device_id == device_id

    map2 = tenant_repo.assign_device(db_session, tenant_a_id, device_id)
    assert map2.tenant_id == tenant_a_id

    # 2. Conflict check: assigning to another tenant should raise HTTP 409
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        tenant_repo.assign_device(db_session, tenant_b_id, device_id)
    assert exc_info.value.status_code == 409
    assert "already assigned to another tenant" in exc_info.value.detail


def test_concurrent_assignment_simulated(db_session: Session):
    db_session.execute(text("DELETE FROM audit_logs"))
    db_session.execute(text("DELETE FROM tenant_device_mappings"))
    db_session.execute(text("DELETE FROM devices"))
    db_session.execute(text("DELETE FROM tenants"))
    db_session.commit()

    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    device_id = uuid.uuid4()

    db_session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A', 'tenant-a')"),
        {"id": tenant_a_id},
    )
    db_session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B', 'tenant-b')"),
        {"id": tenant_b_id},
    )
    db_session.execute(
        text(
            "INSERT INTO devices (id, device_uid, name, status) VALUES (:id, 'dev-003', 'Test Device 3', 'offline')"
        ),
        {"id": device_id},
    )
    db_session.commit()

    db_session.execute(
        text(
            "INSERT INTO tenant_device_mappings (tenant_id, device_id) VALUES (:tenant_id, :device_id)"
        ),
        {"tenant_id": tenant_a_id, "device_id": device_id},
    )
    db_session.commit()

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        tenant_repo.assign_device(db_session, tenant_b_id, device_id)
    assert exc_info.value.status_code == 409


@pytest.mark.anyio
async def test_token_cleanup_task(db_session: Session):
    db_session.execute(text("DELETE FROM blacklisted_tokens"))
    db_session.commit()

    # Create mock tokens: one expired, one valid
    expired_token = BlacklistedToken(
        id=uuid.uuid4(),
        jti="expired-jti-123",
        token_type="access",
        user_id="user1",
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=10),
    )
    valid_token = BlacklistedToken(
        id=uuid.uuid4(),
        jti="valid-jti-123",
        token_type="access",
        user_id="user1",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db_session.add(expired_token)
    db_session.add(valid_token)
    db_session.commit()

    # Instantiate TokenCleanupTask
    task = TokenCleanupTask(interval_seconds=1)

    # 1. Test successful deletion
    deleted = task.run_once()
    assert deleted == 1

    # Verify expired token is gone but valid token remains
    remaining = db_session.query(BlacklistedToken).all()
    assert len(remaining) == 1
    assert remaining[0].jti == "valid-jti-123"

    # 2. Test lock exclusion
    db2 = SessionLocal()
    try:
        db2.execute(text(f"SELECT pg_advisory_lock({task._lock_id})"))
        deleted_while_locked = task.run_once()
        assert deleted_while_locked == 0
    finally:
        db2.execute(text(f"SELECT pg_advisory_unlock({task._lock_id})"))
        db2.close()

    # 3. Test running loop and clean stop/cancellation
    task_fail = TokenCleanupTask(interval_seconds=1)
    task_fail.start()
    assert task_fail._running is True
    await asyncio.sleep(0.1)
    await task_fail.stop()
    assert task_fail._running is False
