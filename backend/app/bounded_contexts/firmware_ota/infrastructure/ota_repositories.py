from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.ota.model import (
    JOB_STATUS_ACCEPTED,
    JOB_STATUS_APPLYING,
    JOB_STATUS_DOWNLOADING,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_STARTED,
    JOB_STATUS_SUCCESS,
    JOB_STATUS_VALUES,
    JOB_TERMINAL_STATUSES,
    OtaJob,
)
from app.modules.tenants.model import TenantDeviceMapping


def create_job(db: Session, *, device_id: UUID, firmware_version_id: UUID) -> OtaJob:
    tenant_id = db.scalar(
        select(TenantDeviceMapping.tenant_id)
        .where(TenantDeviceMapping.device_id == device_id)
        .limit(1)
    )
    job = OtaJob(
        device_id=device_id,
        firmware_version_id=firmware_version_id,
        tenant_id=tenant_id,
        status=JOB_STATUS_PENDING,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_status(
    db: Session,
    job_id: UUID,
    new_status: str,
    progress: int | None = None,
    message: str | None = None,
    error_message: str | None = None,
    error_code: str | None = None,
) -> OtaJob | None:
    if new_status not in JOB_STATUS_VALUES:
        return None
    job = db.scalar(select(OtaJob).where(OtaJob.id == job_id))
    if job is None:
        return None
    if job.status in JOB_TERMINAL_STATUSES:
        return job  # ignore further updates after terminal

    now = datetime.now(timezone.utc)
    job.status = new_status
    if (
        new_status
        in {
            JOB_STATUS_STARTED,
            JOB_STATUS_ACCEPTED,
            JOB_STATUS_DOWNLOADING,
            JOB_STATUS_APPLYING,
        }
        and job.started_at is None
    ):
        job.started_at = now
    if progress is not None:
        job.progress = max(0, min(100, int(progress)))
    elif new_status == JOB_STATUS_SUCCESS:
        job.progress = 100
    elif new_status == JOB_STATUS_FAILED and job.progress is None:
        job.progress = 0
    if message:
        job.last_message = message
    if new_status in JOB_TERMINAL_STATUSES:
        job.completed_at = now
    if new_status == JOB_STATUS_FAILED and error_message:
        job.error_message = error_message
    elif new_status == JOB_STATUS_SUCCESS:
        job.error_message = None
    elif message and new_status == JOB_STATUS_FAILED:
        job.error_message = message
    if new_status == JOB_STATUS_SUCCESS:
        job.error_code = None
    elif error_code:
        job.error_code = error_code
    db.commit()
    db.refresh(job)
    return job


def list_jobs(db: Session, device_id: UUID | None = None, limit: int = 100) -> list[OtaJob]:
    stmt = (
        select(OtaJob)
        .options(joinedload(OtaJob.device), joinedload(OtaJob.firmware_version))
        .order_by(OtaJob.created_at.desc())
        .limit(limit)
    )
    if device_id is not None:
        stmt = stmt.where(OtaJob.device_id == device_id)
    return list(db.scalars(stmt).all())


def get_job_by_id(db: Session, job_id: UUID) -> OtaJob | None:
    stmt = (
        select(OtaJob)
        .options(joinedload(OtaJob.device), joinedload(OtaJob.firmware_version))
        .where(OtaJob.id == job_id)
    )
    return db.scalar(stmt)
