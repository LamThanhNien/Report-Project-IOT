import uuid
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, InternalError, ProgrammingError

from app.db.session import SessionLocal
from app.core.tenant_context import tenant_context
from app.modules.devices.model import Device


@pytest.fixture(scope="function")
def db_session():
    session = SessionLocal()
    # Clean up any residual data before tests (using bypass_rls=True)
    with tenant_context(bypass_rls=True):
        session.execute(text("DELETE FROM audit_logs"))
        session.execute(text("DELETE FROM model_deployments"))
        session.execute(text("DELETE FROM ml_model_versions"))
        session.execute(text("DELETE FROM ml_models"))
        session.execute(text("DELETE FROM tenant_device_mappings"))
        session.execute(text("DELETE FROM devices"))
        session.execute(text("DELETE FROM users"))
        session.execute(text("DELETE FROM tenants"))
        session.commit()
    try:
        yield session
    finally:
        # Clean up after tests
        with tenant_context(bypass_rls=True):
            session.execute(text("DELETE FROM audit_logs"))
            session.execute(text("DELETE FROM model_deployments"))
            session.execute(text("DELETE FROM ml_model_versions"))
            session.execute(text("DELETE FROM ml_models"))
            session.execute(text("DELETE FROM tenant_device_mappings"))
            session.execute(text("DELETE FROM devices"))
            session.execute(text("DELETE FROM users"))
            session.execute(text("DELETE FROM tenants"))
            session.commit()
        session.close()


def test_tenant_isolation_select(db_session: Session):
    role = db_session.execute(
        text(
            "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user"
        )
    ).first()
    assert role.rolsuper is False
    assert role.rolbypassrls is False

    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    device_a_id = uuid.uuid4()
    device_b_id = uuid.uuid4()

    # 1. Insert test data with bypass_rls=True
    with tenant_context(bypass_rls=True):
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
                "INSERT INTO devices (id, device_uid, name, status, tenant_id) VALUES (:id, 'dev-a', 'Device A', 'online', :tenant_id)"
            ),
            {"id": device_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO devices (id, device_uid, name, status, tenant_id) VALUES (:id, 'dev-b', 'Device B', 'online', :tenant_id)"
            ),
            {"id": device_b_id, "tenant_id": tenant_b_id},
        )
        db_session.commit()

    # 2. Query as Tenant A (using ORM)
    with tenant_context(tenant_id=tenant_a_id):
        devices = db_session.query(Device).all()
        assert len(devices) == 1
        assert devices[0].id == device_a_id
        assert devices[0].device_uid == "dev-a"
        db_session.commit()

    # 3. Query as Tenant B (using raw SQL)
    with tenant_context(tenant_id=tenant_b_id):
        res = db_session.execute(text("SELECT id, device_uid FROM devices")).fetchall()
        assert len(res) == 1
        assert res[0][0] == device_b_id
        assert res[0][1] == "dev-b"
        db_session.commit()

    # 4. Query as Admin (role = 'admin')
    with tenant_context(role="admin"):
        devices = db_session.query(Device).all()
        assert len(devices) == 2
        db_session.commit()

    # 5. Query without context (anonymous) -> should see 0 devices
    with tenant_context():
        devices = db_session.query(Device).all()
        assert len(devices) == 0
        db_session.commit()


def test_tenant_isolation_insert_prevent_cross_tenant(db_session: Session):
    role = db_session.execute(
        text(
            "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user"
        )
    ).first()
    assert role.rolsuper is False
    assert role.rolbypassrls is False

    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    device_new_id = uuid.uuid4()

    # Create tenants using bypass
    with tenant_context(bypass_rls=True):
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A-2', 'tenant-a-2')"),
            {"id": tenant_a_id},
        )
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B-2', 'tenant-b-2')"),
            {"id": tenant_b_id},
        )
        db_session.commit()

    # Attempt to insert a device for Tenant B while in Tenant A's context
    with tenant_context(tenant_id=tenant_a_id):
        # We try to create a device that belongs to Tenant B.
        # This must fail due to the WITH CHECK constraint on RLS policy.
        new_device = Device(
            id=device_new_id,
            device_uid="dev-cross",
            name="Cross Device",
            status="offline",
            tenant_id=tenant_b_id,  # Attempted leak
        )
        db_session.add(new_device)
        with pytest.raises((ProgrammingError, IntegrityError, InternalError)):
            db_session.commit()
        db_session.rollback()


def test_tenant_isolation_update_prevent_cross_tenant(db_session: Session):
    role = db_session.execute(
        text(
            "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user"
        )
    ).first()
    assert role.rolsuper is False
    assert role.rolbypassrls is False

    # Setup Tenant A and B, and a device belonging to Tenant B
    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    device_b_id = uuid.uuid4()

    with tenant_context(bypass_rls=True):
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A-3', 'tenant-a-3')"),
            {"id": tenant_a_id},
        )
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B-3', 'tenant-b-3')"),
            {"id": tenant_b_id},
        )
        db_session.execute(
            text(
                "INSERT INTO devices (id, device_uid, name, status, tenant_id) VALUES (:id, 'dev-b-3', 'Device B-3', 'online', :tenant_id)"
            ),
            {"id": device_b_id, "tenant_id": tenant_b_id},
        )
        db_session.commit()

    # Attempt to update Tenant B's device in Tenant A's context
    with tenant_context(tenant_id=tenant_a_id):
        # Querying for the device should yield nothing (filtered by RLS USING clause)
        device = db_session.query(Device).filter(Device.id == device_b_id).first()
        assert device is None

        # Trying to update it directly via update statement should affect 0 rows
        affected = db_session.execute(
            text("UPDATE devices SET name = 'Hacked' WHERE id = :id"), {"id": device_b_id}
        ).rowcount
        assert affected == 0
        db_session.commit()

    # Verify device remains untouched
    with tenant_context(bypass_rls=True):
        updated_device = db_session.query(Device).filter(Device.id == device_b_id).first()
        assert updated_device.name == "Device B-3"
        db_session.commit()


def test_context_leak_prevention_on_pool_reuse(db_session: Session):
    tenant_a_id = uuid.uuid4()

    # Start a transaction and set context
    with tenant_context(tenant_id=tenant_a_id):
        # Trigger event listener
        db_session.execute(text("SELECT 1")).scalar()

        # Verify pg session has the tenant id
        curr_tenant = db_session.execute(text("SHOW app.current_tenant_id")).scalar()
        assert curr_tenant == str(tenant_a_id)

        # Commit transaction
        db_session.commit()

    # Immediately check outside the context block
    # Since transaction ended (commit) and we are outside tenant_context,
    # the next execution should run without tenant context.
    # Note: SQLAlchemy might reuse the same connection from the pool.
    db_session.execute(text("SELECT 1")).scalar()
    curr_tenant_outside = db_session.execute(text("SHOW app.current_tenant_id")).scalar()

    # It must be reset to empty string (which is our default when tenant_id is None)
    assert curr_tenant_outside == ""
    db_session.commit()


def test_audit_log_best_effort_bypass(db_session: Session):
    from app.shared.application.audit_service import log_event_best_effort
    from app.modules.audit.model import AuditLog

    tenant_id = None

    # Run the audit log without any active context, it should bypass RLS successfully
    log_event_best_effort(
        action="TEST_BYPASS",
        user_id=None,
        tenant_id=tenant_id,
        resource_type="system",
        resource_id="test",
        detail={},
        ip_address="127.0.0.1",
    )

    # Verify the log was written using bypass context
    with tenant_context(bypass_rls=True):
        audit_log = (
            db_session.query(AuditLog).filter_by(action="TEST_BYPASS", tenant_id=tenant_id).first()
        )
        assert audit_log is not None
        assert audit_log.ip_address == "127.0.0.1"
