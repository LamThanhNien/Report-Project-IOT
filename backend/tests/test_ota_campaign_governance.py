from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.bounded_contexts.firmware_ota.application.campaign_service import CampaignService
from app.bounded_contexts.firmware_ota.application import firmware_governance
from app.bounded_contexts.firmware_ota.application.firmware_governance import (
    protection_reasons,
    retention_plan,
    sign_firmware,
    verify_firmware_signature_metadata,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_campaign_models import (
    CAMPAIGN_STATUS_PAUSED,
    CAMPAIGN_STATUS_RUNNING,
    OtaCampaign,
    OtaCampaignTarget,
    TARGET_STATUS_FAILED,
    TARGET_STATUS_PENDING,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.bounded_contexts.firmware_ota.presentation.ota_campaign_schemas import OtaCampaignCreate
from app.bounded_contexts.firmware_ota.presentation.router_campaigns import (
    router as campaigns_router,
)
from app.bounded_contexts.firmware_ota.presentation.router_firmware_admin import (
    router as firmware_admin_router,
)
from app.core.config import settings
from app.core.security import require_admin
from app.modules.alerts.model import Alert
from app.modules.firmware.model import FirmwareVersion
from app.shared.infrastructure.persistence.settings_models import SystemSettings

# Register relationship targets before constructing SQLAlchemy model instances.
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant  # noqa: F401
from app.bounded_contexts.device_registry.infrastructure.persistence import platform_models  # noqa: F401
from app.bounded_contexts.telemetry.infrastructure.persistence import models as telemetry_models  # noqa: F401


class FakeSession:
    def __init__(self):
        self.added = []

    def add(self, record):
        self.added.append(record)

    def commit(self):
        pass

    def refresh(self, _record):
        pass


def campaign_payload(**overrides):
    values = {
        "name": "Production rollout",
        "firmware_id": uuid4(),
        "target_scope": "all",
        "target_ids": [],
        "rollout_strategy": "phased",
    }
    values.update(overrides)
    return OtaCampaignCreate(**values)


def test_campaign_rollout_defaults_and_validation():
    service = CampaignService(FakeSession(), mqtt=SimpleNamespace())
    assert service._rollout(campaign_payload()) == [10, 50, 100]
    assert service._rollout(campaign_payload(rollout_strategy="canary")) == [5, 25, 100]
    with pytest.raises(ValueError):
        campaign_payload(rollout_percentages=[50, 25, 100])


def test_selected_target_scope_requires_ids():
    with pytest.raises(ValueError):
        campaign_payload(target_scope="selected_devices")


def test_signing_uses_real_ed25519_and_stores_verification_metadata(tmp_path, monkeypatch):
    key = Ed25519PrivateKey.generate()
    key_path = tmp_path / "ota-ed25519.pem"
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    monkeypatch.setattr(settings, "firmware_signing_private_key_path", str(key_path))
    monkeypatch.setattr(settings, "firmware_signing_key_id", "test-key-1")
    firmware = SimpleNamespace(checksum_sha256="a" * 64, release_channel="stable")

    signed = sign_firmware(FakeSession(), firmware)

    assert signed.signature_alg == "Ed25519"
    assert signed.signature_payload == "a" * 64
    assert signed.signing_key_id == "test-key-1"
    assert "BEGIN PUBLIC KEY" in signed.signing_public_key
    assert signed.signature
    assert signed.verification_required is True
    assert verify_firmware_signature_metadata(signed) is True
    signed.checksum_sha256 = "b" * 64
    assert verify_firmware_signature_metadata(signed) is False


def test_signing_generates_persistent_key_in_development(tmp_path, monkeypatch):
    key_path = tmp_path / "keys" / "firmware-signing-ed25519.pem"
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "firmware_signing_private_key_path", "")
    monkeypatch.setattr(settings, "firmware_signing_key_id", "")
    monkeypatch.setattr(
        firmware_governance,
        "_default_development_signing_key_path",
        lambda: key_path,
    )
    firmware = SimpleNamespace(checksum_sha256="a" * 64, release_channel="dev")

    signed = sign_firmware(FakeSession(), firmware)

    assert key_path.is_file()
    assert signed.signing_key_id == "firmware-signing-ed25519"
    assert verify_firmware_signature_metadata(signed) is True


def test_signing_requires_explicit_key_in_production(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "firmware_signing_private_key_path", "")
    firmware = SimpleNamespace(checksum_sha256="a" * 64, release_channel="stable")

    with pytest.raises(RuntimeError, match="not configured"):
        sign_firmware(FakeSession(), firmware)


class CreateSession(FakeSession):
    def __init__(self, firmware, policy, devices):
        super().__init__()
        self.firmware = firmware
        self.policy = policy
        self.devices = devices

    def get(self, model, _record_id):
        if model is FirmwareVersion:
            return self.firmware
        if model is SystemSettings:
            return self.policy
        return None

    def scalars(self, _statement):
        return SimpleNamespace(all=lambda: self.devices)

    def flush(self):
        for record in self.added:
            if getattr(record, "id", None) is None:
                record.id = uuid4()


def policy(**overrides):
    values = {
        "id": 1,
        "allowed_release_channels": ["dev", "staging", "stable"],
        "require_signed_stable_firmware": True,
        "max_concurrent_updates": 2,
        "ota_retry_limit": 2,
        "rollback_threshold": 30,
        "maintenance_window_start": None,
        "maintenance_window_end": None,
    }
    values.update(overrides)
    return SystemSettings(**values)


def test_create_campaign_resolves_targets_and_assigns_rollout_phases():
    firmware = FirmwareVersion(
        id=uuid4(), version="1.2.3", target_device_type="esp32", release_channel="dev"
    )
    devices = [SimpleNamespace(id=uuid4(), device_uid=f"esp32-{index}") for index in range(10)]
    db = CreateSession(firmware, policy(), devices)

    campaign = CampaignService(db, mqtt=SimpleNamespace()).create(
        campaign_payload(rollout_percentages=[10, 50, 100]), uuid4()
    )

    targets = [item for item in db.added if isinstance(item, OtaCampaignTarget)]
    assert campaign.total_targets == 10
    assert [target.phase for target in targets].count(0) == 1
    assert [target.phase for target in targets].count(1) == 4
    assert [target.phase for target in targets].count(2) == 5


def test_stable_campaign_rejects_invalid_signature_metadata():
    firmware = FirmwareVersion(
        id=uuid4(), version="2.0.0", target_device_type="esp32", release_channel="stable"
    )
    db = CreateSession(firmware, policy(), [SimpleNamespace(id=uuid4(), device_uid="esp32-1")])

    with pytest.raises(ValueError, match="valid signing metadata"):
        CampaignService(db, mqtt=SimpleNamespace()).create(campaign_payload(), uuid4())


class ExecuteSession(FakeSession):
    def __init__(self, campaign, firmware, devices, targets):
        super().__init__()
        self.campaign = campaign
        self.firmware = firmware
        self.devices = {item.id: item for item in devices}
        self.targets = targets
        self.jobs = {}
        self.scalar_calls = 0
        self.scalars_calls = 0

    def get(self, model, record_id):
        if model is FirmwareVersion:
            return self.firmware
        if model is OtaJob:
            return self.jobs.get(record_id)
        if model.__name__ == "Device":
            return self.devices.get(record_id)
        if model is SystemSettings:
            return policy()
        return None

    def scalar(self, _statement):
        self.scalar_calls += 1
        return 0 if self.scalar_calls == 1 else None

    def scalars(self, _statement):
        self.scalars_calls += 1
        records = self.targets[:1] if self.scalars_calls == 1 else self.targets
        return SimpleNamespace(all=lambda: records)

    def add(self, record):
        super().add(record)
        if isinstance(record, OtaJob):
            record.id = uuid4()
            self.jobs[record.id] = record

    def flush(self):
        pass


def test_start_campaign_dispatches_only_current_batch_and_avoids_duplicate_loop():
    firmware = FirmwareVersion(
        id=uuid4(),
        version="1.2.3",
        target_device_type="esp32",
        release_channel="dev",
        checksum_sha256="a" * 64,
        file_size=1024,
    )
    devices = [
        SimpleNamespace(
            id=uuid4(), device_uid=f"esp32-{index}", tenant_id=None, firmware_version="1.0.0"
        )
        for index in range(2)
    ]
    campaign = OtaCampaign(
        id=uuid4(),
        name="Phased",
        firmware_version_id=firmware.id,
        status="draft",
        current_phase=0,
        rollout_percentages=[50, 100],
        max_concurrent_updates=1,
        rollback_threshold=30,
        total_targets=2,
        success_count=0,
        failed_count=0,
        skipped_count=0,
    )
    targets = [
        OtaCampaignTarget(id=uuid4(), campaign_id=campaign.id, device_id=device.id, phase=index)
        for index, device in enumerate(devices)
    ]
    published = []
    mqtt = SimpleNamespace(
        publish_ota_request=lambda uid, payload: published.append((uid, payload))
    )
    db = ExecuteSession(campaign, firmware, devices, targets)

    CampaignService(db, mqtt=mqtt).execute(campaign)

    assert campaign.status == CAMPAIGN_STATUS_RUNNING
    assert len(db.jobs) == 1
    assert len(published) == 1
    assert published[0][1]["checksum_sha256"] == "a" * 64


def test_failure_threshold_pauses_campaign_and_emits_one_persistent_alert():
    campaign = OtaCampaign(
        id=uuid4(),
        name="Risky",
        firmware_version_id=uuid4(),
        status=CAMPAIGN_STATUS_RUNNING,
        current_phase=0,
        rollout_percentages=[100],
        rollback_threshold=30,
        total_targets=2,
        success_count=0,
        failed_count=0,
        skipped_count=0,
    )
    jobs = {
        uuid4(): SimpleNamespace(status="success"),
        uuid4(): SimpleNamespace(status="failed"),
    }
    targets = [
        OtaCampaignTarget(
            id=uuid4(),
            campaign_id=campaign.id,
            device_id=uuid4(),
            phase=0,
            ota_job_id=job_id,
            status=TARGET_STATUS_PENDING,
        )
        for job_id in jobs
    ]

    class RefreshSession(FakeSession):
        def scalars(self, _statement):
            return SimpleNamespace(all=lambda: targets)

        def get(self, model, record_id):
            if model is OtaJob:
                return jobs[record_id]
            return None

        def scalar(self, _statement):
            return None

    db = RefreshSession()
    CampaignService(db, mqtt=SimpleNamespace()).refresh(campaign, dispatch_next=False)

    assert campaign.status == CAMPAIGN_STATUS_PAUSED
    assert campaign.failed_count == 1
    assert len([item for item in db.added if isinstance(item, Alert)]) == 1


def test_pause_resume_cancel_and_retry_failed_transitions():
    pending = SimpleNamespace(status=TARGET_STATUS_PENDING)
    failed = SimpleNamespace(
        status=TARGET_STATUS_FAILED, retry_count=0, phase=1, ota_job_id=uuid4()
    )

    class TransitionSession(FakeSession):
        def __init__(self):
            super().__init__()
            self.records = [pending]

        def scalars(self, _statement):
            return SimpleNamespace(all=lambda: self.records)

    class TransitionService(CampaignService):
        def execute(self, campaign):
            campaign.status = CAMPAIGN_STATUS_RUNNING
            return campaign

        def refresh(self, campaign, dispatch_next):
            return campaign

    db = TransitionSession()
    service = TransitionService(db, mqtt=SimpleNamespace())
    campaign = SimpleNamespace(
        id=uuid4(),
        status=CAMPAIGN_STATUS_RUNNING,
        completed_at=None,
        current_phase=0,
        retry_limit=2,
    )

    assert service.pause(campaign).status == CAMPAIGN_STATUS_PAUSED
    assert service.resume(campaign).status == CAMPAIGN_STATUS_RUNNING
    assert service.cancel(campaign).status == "cancelled"
    assert pending.status == "skipped"

    campaign.status = "failed"
    db.records = [failed]
    assert service.retry_failed(campaign).status == CAMPAIGN_STATUS_RUNNING
    assert failed.retry_count == 1
    assert failed.ota_job_id is None


def test_retention_plan_dry_run_keeps_minimum_and_lists_only_safe_old_artifacts():
    now = datetime.now(timezone.utc)
    records = [
        SimpleNamespace(
            id=uuid4(),
            version="4",
            target_device_type="esp32",
            created_at=now,
            is_active=True,
            release_channel="dev",
        ),
        SimpleNamespace(
            id=uuid4(),
            version="3",
            target_device_type="esp32",
            created_at=now - timedelta(days=200),
            is_active=False,
            release_channel="stable",
        ),
        SimpleNamespace(
            id=uuid4(),
            version="2",
            target_device_type="esp32",
            created_at=now - timedelta(days=200),
            is_active=False,
            release_channel="dev",
        ),
        SimpleNamespace(
            id=uuid4(),
            version="1",
            target_device_type="esp32",
            created_at=now - timedelta(days=200),
            is_active=False,
            release_channel="dev",
        ),
    ]

    class RetentionSession:
        def get(self, model, _record_id):
            return SimpleNamespace(firmware_min_versions_per_target=2, firmware_retention_days=180)

        def scalars(self, _statement):
            return SimpleNamespace(all=lambda: records)

        def scalar(self, _statement):
            return None

    plan = retention_plan(RetentionSession())
    assert plan["candidate_count"] == 2
    assert {item["version"] for item in plan["candidates"]} == {"1", "2"}
    assert any("stable_release" in item["reasons"] for item in plan["protected"])


def test_bulk_delete_protects_active_stable_and_historical_firmware():
    firmware = SimpleNamespace(id=uuid4(), is_active=True, release_channel="stable")
    db = SimpleNamespace(scalar=lambda _statement: uuid4())
    reasons = protection_reasons(db, firmware, set())
    assert {"active", "stable_release", "campaign_history", "ota_job_history"} <= set(reasons)


def test_governance_routes_are_registered_and_admin_protected():
    paths = {route.path for route in [*campaigns_router.routes, *firmware_admin_router.routes]}
    assert "/admin/ota/campaigns/{campaign_id}/retry-failed" in paths
    assert "/admin/firmware/retention/dry-run" in paths
    for route in [*campaigns_router.routes, *firmware_admin_router.routes]:
        assert any(dependency.call is require_admin for dependency in route.dependant.dependencies)
