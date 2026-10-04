import math
import uuid
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.bounded_contexts.device_groups.infrastructure.persistence.models import DeviceGroupMember
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.firmware_ota.infrastructure.mqtt_adapter import MqttOtaPublisherAdapter
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_campaign_models import (
    CAMPAIGN_STATUS_CANCELLED,
    CAMPAIGN_STATUS_COMPLETED,
    CAMPAIGN_STATUS_DRAFT,
    CAMPAIGN_STATUS_PAUSED,
    CAMPAIGN_STATUS_RUNNING,
    CAMPAIGN_STATUS_SCHEDULED,
    OtaCampaign,
    OtaCampaignTarget,
    TARGET_STATUS_DOWNLOADING,
    TARGET_STATUS_FAILED,
    TARGET_STATUS_NOTIFIED,
    TARGET_STATUS_PENDING,
    TARGET_STATUS_SKIPPED,
    TARGET_STATUS_SUCCESS,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.bounded_contexts.firmware_ota.application.firmware_governance import (
    verify_firmware_signature_metadata,
)
from app.bounded_contexts.firmware_ota.presentation.ota_campaign_schemas import (
    OtaCampaignCreate,
    OtaCampaignUpdate,
)
from app.core.config import settings
from app.core.ota_tokens import create_ota_download_token
from app.modules.alerts.model import Alert
from app.modules.firmware.model import FirmwareVersion
from app.shared.infrastructure.persistence.settings_models import SystemSettings

ACTIVE_JOB_STATUSES = {
    "pending",
    "sent",
    "started",
    "accepted",
    "downloading",
    "flashing",
    "applying",
    "rebooting",
}


class CampaignService:
    def __init__(self, db: Session, mqtt=None):
        self.db = db
        self.mqtt = mqtt or MqttOtaPublisherAdapter()

    def _policy(self) -> SystemSettings:
        policy = self.db.get(SystemSettings, 1)
        if policy is None:
            policy = SystemSettings(id=1)
            self.db.add(policy)
            self.db.flush()
        return policy

    def _rollout(self, payload: OtaCampaignCreate) -> list[int]:
        if payload.rollout_percentages:
            return payload.rollout_percentages
        if payload.rollout_strategy == "canary":
            return [5, 25, 100]
        if payload.rollout_strategy == "phased":
            return [10, 50, 100]
        return [100]

    def _resolve_devices(self, payload: OtaCampaignCreate) -> list[Device]:
        if payload.tenant_id:
            if payload.target_scope == "selected_devices":
                for item in payload.target_ids:
                    dev_id = None
                    try:
                        dev_id = uuid.UUID(item)
                    except ValueError:
                        pass
                    if dev_id:
                        d = (
                            self.db.query(Device)
                            .filter(
                                Device.id == dev_id,
                                Device.tenant_id == payload.tenant_id,
                                Device.deleted_at.is_(None),
                            )
                            .first()
                        )
                    else:
                        d = (
                            self.db.query(Device)
                            .filter(
                                Device.device_uid == item,
                                Device.tenant_id == payload.tenant_id,
                                Device.deleted_at.is_(None),
                            )
                            .first()
                        )
                    if not d:
                        raise ValueError("Device not found or not accessible")
            elif payload.target_scope == "device_group":
                from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
                    DeviceGroup,
                )

                for item in payload.target_ids:
                    try:
                        gid = uuid.UUID(item)
                    except ValueError:
                        raise ValueError("Invalid group ID format")
                    g = (
                        self.db.query(DeviceGroup)
                        .filter(DeviceGroup.id == gid, DeviceGroup.tenant_id == payload.tenant_id)
                        .first()
                    )
                    if not g:
                        raise ValueError("Device group not found or not accessible")

        stmt = select(Device).where(Device.deleted_at.is_(None))
        if payload.tenant_id:
            stmt = stmt.where(Device.tenant_id == payload.tenant_id)
        if payload.target_scope == "selected_devices":
            ids = []
            for item in payload.target_ids:
                try:
                    ids.append(uuid.UUID(item))
                except ValueError:
                    pass
            stmt = stmt.where(or_(Device.id.in_(ids), Device.device_uid.in_(payload.target_ids)))
        elif payload.target_scope == "device_model":
            stmt = stmt.where(Device.device_model_id == uuid.UUID(payload.target_ids[0]))
        elif payload.target_scope == "device_group":
            group_ids = [uuid.UUID(item) for item in payload.target_ids]
            member_ids = select(DeviceGroupMember.device_id).where(
                DeviceGroupMember.group_id.in_(group_ids)
            )
            stmt = stmt.where(Device.id.in_(member_ids))
        devices = list(self.db.scalars(stmt.order_by(Device.device_uid)).all())
        if not devices:
            raise ValueError("Campaign target selector resolved to no devices")
        return devices

    def create(self, payload: OtaCampaignCreate, user_id: uuid.UUID | None) -> OtaCampaign:
        firmware = self.db.get(FirmwareVersion, payload.firmware_id)
        if firmware is None:
            raise ValueError("Firmware not found")
        # Validate that the firmware belongs to the campaign's tenant
        if (
            firmware.uploaded_by_tenant_id is not None
            and firmware.uploaded_by_tenant_id != payload.tenant_id
        ):
            raise ValueError("Firmware not found or not accessible")
        policy = self._policy()
        channel = firmware.release_channel or "dev"
        if channel not in (policy.allowed_release_channels or []):
            raise ValueError(f"Firmware release channel '{channel}' is not allowed by OTA policy")
        if (
            channel == "stable"
            and policy.require_signed_stable_firmware
            and not verify_firmware_signature_metadata(firmware)
        ):
            raise ValueError(
                "Stable firmware must have valid signing metadata before campaign creation"
            )
        devices = self._resolve_devices(payload)
        rollout = self._rollout(payload)
        campaign = OtaCampaign(
            tenant_id=payload.tenant_id,
            name=payload.name,
            firmware_version_id=firmware.id,
            target_type=payload.target_scope,
            target_ids=payload.target_ids,
            strategy=payload.rollout_strategy,
            rollout_percentages=rollout,
            status=CAMPAIGN_STATUS_SCHEDULED if payload.scheduled_at else CAMPAIGN_STATUS_DRAFT,
            requested_by_user_id=user_id,
            total_targets=len(devices),
            max_concurrent_updates=payload.max_concurrent_updates or policy.max_concurrent_updates,
            retry_limit=payload.retry_limit
            if payload.retry_limit is not None
            else policy.ota_retry_limit,
            rollback_threshold=payload.rollback_threshold or policy.rollback_threshold,
            maintenance_window_start=payload.maintenance_window_start
            or policy.maintenance_window_start,
            maintenance_window_end=payload.maintenance_window_end or policy.maintenance_window_end,
            scheduled_at=payload.scheduled_at,
        )
        self.db.add(campaign)
        self.db.flush()
        for index, device in enumerate(devices, start=1):
            phase = next(
                phase_index
                for phase_index, percentage in enumerate(rollout)
                if index <= math.ceil(len(devices) * percentage / 100)
            )
            self.db.add(
                OtaCampaignTarget(campaign_id=campaign.id, device_id=device.id, phase=phase)
            )
        self.db.commit()
        self.db.refresh(campaign)
        return campaign

    def list(self, tenant_id: uuid.UUID | None = None) -> list[OtaCampaign]:
        stmt = select(OtaCampaign)
        if tenant_id is not None:
            stmt = stmt.where(OtaCampaign.tenant_id == tenant_id)
        campaigns = list(self.db.scalars(stmt.order_by(OtaCampaign.created_at.desc())).all())
        for campaign in campaigns:
            if (
                campaign.status == CAMPAIGN_STATUS_SCHEDULED
                and campaign.scheduled_at
                and campaign.scheduled_at <= datetime.now(timezone.utc)
            ):
                self.execute(campaign)
            else:
                self.refresh(campaign, dispatch_next=False)
        return campaigns

    def get(self, campaign_id: uuid.UUID) -> OtaCampaign | None:
        campaign = self.db.get(OtaCampaign, campaign_id)
        if campaign:
            self.refresh(campaign, dispatch_next=True)
        return campaign

    def update(self, campaign: OtaCampaign, payload: OtaCampaignUpdate) -> OtaCampaign:
        if campaign.status not in {
            CAMPAIGN_STATUS_DRAFT,
            CAMPAIGN_STATUS_SCHEDULED,
            CAMPAIGN_STATUS_PAUSED,
        }:
            raise ValueError("Only draft, scheduled, or paused campaigns can be edited")
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(campaign, key, value)
        self.db.commit()
        self.db.refresh(campaign)
        return campaign

    def _inside_window(self, campaign: OtaCampaign) -> bool:
        if not campaign.maintenance_window_start or not campaign.maintenance_window_end:
            return True
        policy = self._policy()
        now = datetime.now(ZoneInfo(policy.timezone)).time()
        start = time.fromisoformat(campaign.maintenance_window_start)
        end = time.fromisoformat(campaign.maintenance_window_end)
        return start <= now <= end if start <= end else now >= start or now <= end

    def _payload(self, job: OtaJob, firmware: FirmwareVersion, device: Device) -> dict:
        base = settings.device_api_base_url.rstrip("/")
        token = create_ota_download_token(
            firmware_id=firmware.id,
            job_id=job.id,
            device_uid=device.device_uid,
            tenant_id=device.tenant_id,
            campaign_id=job.campaign_id,
        )
        url = f"{base}/api/v1/firmware/ota-download/{firmware.id}?token={token}"
        return {
            "job_id": str(job.id),
            "firmware_version_id": str(firmware.id),
            "firmware_version": firmware.version,
            "version": firmware.version,
            "firmware_url": url,
            "download_url": url,
            "checksum": firmware.checksum_sha256,
            "checksum_sha256": firmware.checksum_sha256,
            "signature": firmware.signature,
            "signature_alg": firmware.signature_alg,
            "signature_algorithm": firmware.signature_alg,
            "signature_payload": firmware.signature_payload,
            "signing_key_id": firmware.signing_key_id,
            "signing_public_key": firmware.signing_public_key,
            "verification_required": firmware.verification_required,
            "file_size": firmware.file_size,
            "size_bytes": firmware.file_size,
            "force": False,
        }

    def execute(self, campaign: OtaCampaign) -> OtaCampaign:
        if campaign.status in {CAMPAIGN_STATUS_CANCELLED, CAMPAIGN_STATUS_COMPLETED}:
            raise ValueError("Campaign is already terminal")
        now = datetime.now(timezone.utc)
        if campaign.scheduled_at and campaign.scheduled_at > now:
            campaign.status = CAMPAIGN_STATUS_SCHEDULED
            self.db.commit()
            return campaign
        if not self._inside_window(campaign):
            campaign.status = CAMPAIGN_STATUS_SCHEDULED
            campaign.last_error = "Waiting for maintenance window"
            self.db.commit()
            return campaign
        if campaign.started_at is None:
            campaign.started_at = now
        campaign.status = CAMPAIGN_STATUS_RUNNING
        campaign.last_error = None
        active = (
            self.db.scalar(
                select(func.count(OtaJob.id)).where(
                    OtaJob.campaign_id == campaign.id,
                    OtaJob.status.in_(ACTIVE_JOB_STATUSES),
                )
            )
            or 0
        )
        slots = max(0, campaign.max_concurrent_updates - active)
        targets = list(
            self.db.scalars(
                select(OtaCampaignTarget)
                .where(
                    OtaCampaignTarget.campaign_id == campaign.id,
                    OtaCampaignTarget.phase == campaign.current_phase,
                    OtaCampaignTarget.status == TARGET_STATUS_PENDING,
                )
                .order_by(OtaCampaignTarget.created_at)
                .limit(slots)
            ).all()
        )
        firmware = self.db.get(FirmwareVersion, campaign.firmware_version_id)
        for target in targets:
            duplicate = self.db.scalar(
                select(OtaJob)
                .where(
                    OtaJob.campaign_id == campaign.id,
                    OtaJob.device_id == target.device_id,
                    OtaJob.firmware_version_id == campaign.firmware_version_id,
                )
                .order_by(OtaJob.created_at.desc())
                .limit(1)
            )
            if duplicate and duplicate.status != "failed":
                target.ota_job_id = duplicate.id
                target.status = TARGET_STATUS_NOTIFIED
                continue
            device = self.db.get(Device, target.device_id)
            job = OtaJob(
                device_id=device.id,
                firmware_version_id=firmware.id,
                tenant_id=device.tenant_id,
                campaign_id=campaign.id,
                previous_firmware_version=device.firmware_version,
                status="pending",
            )
            self.db.add(job)
            self.db.flush()
            target.ota_job_id = job.id
            try:
                self.mqtt.publish_ota_request(
                    device.device_uid, self._payload(job, firmware, device)
                )
                job.status = "sent"
                target.status = TARGET_STATUS_NOTIFIED
            except Exception as exc:
                job.status = "failed"
                job.error_message = f"publish failed: {exc}"
                job.completed_at = datetime.now(timezone.utc)
                target.status = TARGET_STATUS_FAILED
                campaign.last_error = job.error_message
        self.db.commit()
        self.refresh(campaign, dispatch_next=False)
        return campaign

    def refresh(self, campaign: OtaCampaign, dispatch_next: bool) -> OtaCampaign:
        targets = list(
            self.db.scalars(
                select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == campaign.id)
            ).all()
        )
        for target in targets:
            if not target.ota_job_id:
                continue
            job = self.db.get(OtaJob, target.ota_job_id)
            if not job:
                continue
            if job.status == "success":
                target.status = TARGET_STATUS_SUCCESS
            elif job.status == "failed":
                target.status = TARGET_STATUS_FAILED
            elif job.status in {"downloading", "flashing", "applying", "rebooting"}:
                target.status = TARGET_STATUS_DOWNLOADING
            else:
                target.status = TARGET_STATUS_NOTIFIED
        campaign.success_count = sum(t.status == TARGET_STATUS_SUCCESS for t in targets)
        campaign.failed_count = sum(t.status == TARGET_STATUS_FAILED for t in targets)
        campaign.skipped_count = sum(t.status == TARGET_STATUS_SKIPPED for t in targets)
        terminal = campaign.success_count + campaign.failed_count
        failure_rate = campaign.failed_count * 100 / terminal if terminal else 0
        if (
            terminal
            and failure_rate > campaign.rollback_threshold
            and campaign.status == CAMPAIGN_STATUS_RUNNING
        ):
            campaign.status = CAMPAIGN_STATUS_PAUSED
            campaign.last_error = f"Failure rate {failure_rate:.1f}% exceeded threshold {campaign.rollback_threshold}%"
            self._failure_alert(campaign, failure_rate)
        phase_targets = [t for t in targets if t.phase == campaign.current_phase]
        phase_done = phase_targets and all(
            t.status in {TARGET_STATUS_SUCCESS, TARGET_STATUS_FAILED, TARGET_STATUS_SKIPPED}
            for t in phase_targets
        )
        if campaign.status == CAMPAIGN_STATUS_RUNNING and phase_done:
            if campaign.current_phase + 1 < len(campaign.rollout_percentages):
                campaign.current_phase += 1
                self.db.commit()
                if dispatch_next:
                    return self.execute(campaign)
            elif terminal + campaign.skipped_count >= campaign.total_targets:
                campaign.status = (
                    CAMPAIGN_STATUS_COMPLETED if campaign.failed_count == 0 else "failed"
                )
                campaign.completed_at = datetime.now(timezone.utc)
        elif (
            dispatch_next
            and campaign.status == CAMPAIGN_STATUS_RUNNING
            and any(t.status == TARGET_STATUS_PENDING for t in phase_targets)
        ):
            self.db.commit()
            return self.execute(campaign)
        self.db.commit()
        self.db.refresh(campaign)
        return campaign

    def _failure_alert(self, campaign: OtaCampaign, failure_rate: float) -> None:
        existing = self.db.scalar(
            select(Alert)
            .where(
                Alert.source == "ota_campaign",
                Alert.source_id == campaign.id,
                Alert.status != "resolved",
            )
            .limit(1)
        )
        if existing is None:
            self.db.add(
                Alert(
                    tenant_id=campaign.tenant_id,
                    severity="critical",
                    source="ota_campaign",
                    source_id=campaign.id,
                    code="ota_campaign_failure_threshold",
                    title=f"OTA campaign paused: {campaign.name}",
                    message=campaign.last_error or "Failure threshold exceeded",
                    details={"campaign_id": str(campaign.id), "failure_rate": failure_rate},
                )
            )

    def pause(self, campaign: OtaCampaign) -> OtaCampaign:
        if campaign.status != CAMPAIGN_STATUS_RUNNING:
            raise ValueError("Only running campaigns can be paused")
        campaign.status = CAMPAIGN_STATUS_PAUSED
        self.db.commit()
        return campaign

    def resume(self, campaign: OtaCampaign) -> OtaCampaign:
        if campaign.status not in {CAMPAIGN_STATUS_PAUSED, CAMPAIGN_STATUS_SCHEDULED}:
            raise ValueError("Only paused or scheduled campaigns can be resumed")
        return self.execute(campaign)

    def cancel(self, campaign: OtaCampaign) -> OtaCampaign:
        if campaign.status in {CAMPAIGN_STATUS_COMPLETED, CAMPAIGN_STATUS_CANCELLED}:
            raise ValueError("Campaign is already terminal")
        campaign.status = CAMPAIGN_STATUS_CANCELLED
        campaign.completed_at = datetime.now(timezone.utc)
        for target in self.db.scalars(
            select(OtaCampaignTarget).where(
                OtaCampaignTarget.campaign_id == campaign.id,
                OtaCampaignTarget.status == TARGET_STATUS_PENDING,
            )
        ).all():
            target.status = TARGET_STATUS_SKIPPED
        self.db.commit()
        return self.refresh(campaign, False)

    def retry_failed(self, campaign: OtaCampaign) -> OtaCampaign:
        failed = list(
            self.db.scalars(
                select(OtaCampaignTarget).where(
                    OtaCampaignTarget.campaign_id == campaign.id,
                    OtaCampaignTarget.status == TARGET_STATUS_FAILED,
                    OtaCampaignTarget.retry_count < campaign.retry_limit,
                )
            ).all()
        )
        if not failed:
            raise ValueError("No failed campaign targets are eligible for retry")
        campaign.status = CAMPAIGN_STATUS_RUNNING
        campaign.current_phase = min(target.phase for target in failed)
        for target in failed:
            target.status = TARGET_STATUS_PENDING
            target.ota_job_id = None
            target.retry_count += 1
        self.db.commit()
        return self.execute(campaign)

    def summary(self, campaign: OtaCampaign) -> dict:
        targets = list(
            self.db.scalars(
                select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == campaign.id)
            ).all()
        )
        terminal = campaign.success_count + campaign.failed_count
        return {
            "id": campaign.id,
            "tenant_id": campaign.tenant_id,
            "name": campaign.name,
            "firmware_id": campaign.firmware_version_id,
            "firmware_version": self.db.get(FirmwareVersion, campaign.firmware_version_id).version,
            "target_scope": campaign.target_type,
            "target_ids": campaign.target_ids,
            "rollout_strategy": campaign.strategy,
            "rollout_percentages": campaign.rollout_percentages,
            "current_phase": campaign.current_phase,
            "status": campaign.status,
            "max_concurrent_updates": campaign.max_concurrent_updates,
            "retry_limit": campaign.retry_limit,
            "rollback_threshold": campaign.rollback_threshold,
            "maintenance_window_start": campaign.maintenance_window_start,
            "maintenance_window_end": campaign.maintenance_window_end,
            "scheduled_at": campaign.scheduled_at,
            "started_at": campaign.started_at,
            "completed_at": campaign.completed_at,
            "created_at": campaign.created_at,
            "updated_at": campaign.updated_at,
            "total_targets": campaign.total_targets,
            "pending_count": sum(t.status == TARGET_STATUS_PENDING for t in targets),
            "running_count": sum(
                t.status in {TARGET_STATUS_NOTIFIED, TARGET_STATUS_DOWNLOADING} for t in targets
            ),
            "success_count": campaign.success_count,
            "failed_count": campaign.failed_count,
            "skipped_count": campaign.skipped_count,
            "failure_rate": round(campaign.failed_count * 100 / terminal, 2) if terminal else 0,
            "last_error": campaign.last_error,
        }
