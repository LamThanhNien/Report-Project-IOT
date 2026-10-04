"""Tenant management admin presentation router.

Preserves all existing /api/v1/admin/* endpoints.
Delegates to use_cases + infrastructure adapters.
"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.core.platform_tenant_access import forbid_tenant_mutation
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.bounded_contexts.telemetry.infrastructure.persistence.alert_models import Alert
from app.modules.auth import repository as auth_repo
from app.modules.auth import service as auth_service
from app.modules.auth.model import User
from app.modules.auth.schema import UserRead
from app.modules.devices import repository as device_repo
from app.modules.devices.schema import DeviceRead
from app.modules.ota.model import OtaJob
from app.modules.ota.schema import OtaJobRead
from app.modules.projects import repository as project_repository
from app.modules.projects.schema import (
    AdminTenantProjectReadOnlyRead,
    ProjectAccessPolicyRead,
    ProjectDeviceSummaryRead,
    TenantProjectDetail,
    TenantProjectSummary,
)
from app.modules.tenants import repository, service as tenant_service
from app.modules.tenants.schema import (
    ServicePlanRead,
    TenantCreate,
    TenantDeviceAssign,
    TenantFeaturesRead,
    TenantFeaturesUpdate,
    TenantRead,
    TenantStatusUpdate,
    TenantUpdate,
    TenantUserCreate,
)

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin)])




def _device_to_read(device) -> DeviceRead:
    read = DeviceRead.model_validate(device)
    status = (
        "deleted" if device.status == "deleted" else device_repo.effective_connection_status(device)
    )
    return read.model_copy(update={"status": status})


def _ota_job_read(job: OtaJob) -> OtaJobRead:
    return OtaJobRead(
        id=job.id,
        device_id=job.device_id,
        device_uid=job.device.device_uid,
        firmware_version_id=job.firmware_version_id,
        firmware_version=job.firmware_version.version,
        status=job.status,
        requested_at=job.requested_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        progress=job.progress,
        last_message=job.last_message,
        error_code=getattr(job, "error_code", None),
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _list_project_ota_jobs(
    db: Session, device_ids: list[uuid.UUID], limit: int = 20
) -> list[OtaJob]:
    if not device_ids:
        return []
    return list(
        db.scalars(
            select(OtaJob)
            .where(OtaJob.device_id.in_(device_ids))
            .order_by(OtaJob.created_at.desc())
            .limit(limit)
        ).all()
    )


def _list_project_alert_events(
    db: Session, device_ids: list[uuid.UUID], limit: int = 20
) -> list[Alert]:
    if not device_ids:
        return []
    return list(
        db.scalars(
            select(Alert)
            .where(Alert.device_id.in_(device_ids))
            .order_by(Alert.last_seen_at.desc(), Alert.created_at.desc())
            .limit(limit)
        ).all()
    )


# Existing plans remain readable for tenant onboarding and quota selection.
@router.get("/service-plans", response_model=list[ServicePlanRead])
def list_service_plans(db: Session = Depends(get_db)) -> list[ServicePlanRead]:
    return repository.list_plans(db)













# ── Tenants ──────────────────────────────────────────────────────────────────


@router.get("/tenants", response_model=list[TenantRead])
def list_tenants(db: Session = Depends(get_db)) -> list[TenantRead]:
    tenants = repository.list_tenants(db)
    result = []
    for t in tenants:
        result.append(
            TenantRead(
                id=t.id,
                name=t.name,
                slug=t.slug,
                is_active=t.is_active,
                plan_id=t.plan_id,
                plan_name=t.plan.name if t.plan else None,
                device_count=repository.count_tenant_devices(db, t.id),
                user_count=repository.count_tenant_users(db, t.id),
                created_at=t.created_at,
            )
        )
    return result


@router.post("/tenants", response_model=TenantRead, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TenantRead:
    if repository.get_tenant_by_slug(db, payload.slug):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Slug already in use")
    if payload.owner_email and auth_repo.get_user_by_email(db, payload.owner_email):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Owner email already exists")
    from sqlalchemy.exc import IntegrityError

    try:
        tenant = repository.create_tenant(db, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Tenant slug conflict")
    logger.info("[TENANT] create name=%s slug=%s id=%s", tenant.name, tenant.slug, tenant.id)

    owner_count = 0
    if payload.owner_email and payload.owner_password:
        hashed = auth_service.hash_password(payload.owner_password)
        owner = User(
            email=payload.owner_email,
            hashed_password=hashed,
            full_name=payload.owner_full_name,
            role="tenant_owner",
            tenant_id=tenant.id,
            is_active=True,
        )
        db.add(owner)
        db.commit()
        owner_count = 1
        logger.info("[TENANT USER] create email=%s tenant=%s", payload.owner_email, tenant.slug)

    audit_service.log_event_best_effort(
        db,
        action="create_tenant",
        user_id=current_admin.id,
        tenant_id=tenant.id,
        resource_type="tenant",
        resource_id=str(tenant.id),
        detail={"name": tenant.name, "slug": tenant.slug},
    )

    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        is_active=tenant.is_active,
        plan_id=tenant.plan_id,
        plan_name=tenant.plan.name if tenant.plan else None,
        device_count=0,
        user_count=owner_count,
        created_at=tenant.created_at,
    )


@router.get("/tenants/{tenant_id}", response_model=TenantRead)
def get_tenant(tenant_id: uuid.UUID, db: Session = Depends(get_db)) -> TenantRead:
    tenant = repository.get_tenant(db, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        is_active=tenant.is_active,
        plan_id=tenant.plan_id,
        plan_name=tenant.plan.name if tenant.plan else None,
        device_count=repository.count_tenant_devices(db, tenant.id),
        user_count=repository.count_tenant_users(db, tenant.id),
        created_at=tenant.created_at,
    )


@router.put("/tenants/{tenant_id}", response_model=TenantRead)
def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TenantRead:
    tenant = repository.get_tenant(db, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    tenant = repository.update_tenant(db, tenant, payload)
    audit_service.log_event_best_effort(
        db,
        action="update_tenant",
        user_id=current_admin.id,
        tenant_id=tenant_id,
        resource_type="tenant",
        resource_id=str(tenant_id),
        detail={
            "name": tenant.name,
            "slug": tenant.slug,
            "plan_id": str(tenant.plan_id) if tenant.plan_id else None,
        },
    )
    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        is_active=tenant.is_active,
        plan_id=tenant.plan_id,
        plan_name=tenant.plan.name if tenant.plan else None,
        device_count=repository.count_tenant_devices(db, tenant.id),
        user_count=repository.count_tenant_users(db, tenant.id),
        created_at=tenant.created_at,
    )


@router.patch("/tenants/{tenant_id}/status", response_model=TenantRead)
def toggle_tenant_status(
    tenant_id: uuid.UUID,
    payload: TenantStatusUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TenantRead:
    tenant = repository.get_tenant(db, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    tenant = repository.set_tenant_active(db, tenant, payload.is_active)
    logger.info("[TENANT] status_toggle slug=%s is_active=%s", tenant.slug, tenant.is_active)
    audit_service.log_event_best_effort(
        db,
        action="toggle_tenant_status",
        user_id=current_admin.id,
        tenant_id=tenant_id,
        resource_type="tenant",
        resource_id=str(tenant_id),
        detail={"slug": tenant.slug, "is_active": tenant.is_active},
    )
    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        is_active=tenant.is_active,
        plan_id=tenant.plan_id,
        plan_name=tenant.plan.name if tenant.plan else None,
        device_count=repository.count_tenant_devices(db, tenant.id),
        user_count=repository.count_tenant_users(db, tenant.id),
        created_at=tenant.created_at,
    )


# ── Tenant features ───────────────────────────────────────────────────────────


@router.get("/tenants/{tenant_id}/features", response_model=TenantFeaturesRead)
def get_tenant_features(tenant_id: uuid.UUID, db: Session = Depends(get_db)) -> TenantFeaturesRead:
    tenant = repository.get_tenant(db, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    plan_feats = tenant_service.plan_features_dict(tenant)
    overrides = {
        o.feature_name: o.is_enabled for o in repository.get_tenant_overrides(db, tenant_id)
    }
    effective = tenant_service.get_effective_features(db, tenant_id)
    return TenantFeaturesRead(
        tenant_id=tenant_id,
        plan_features=plan_feats,
        overrides=overrides,
        effective=effective,
    )


@router.put("/tenants/{tenant_id}/features", response_model=TenantFeaturesRead)
def set_tenant_features(
    tenant_id: uuid.UUID,
    payload: TenantFeaturesUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TenantFeaturesRead:
    tenant = repository.get_tenant(db, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    repository.set_tenant_features(db, tenant_id, payload)
    plan_feats = tenant_service.plan_features_dict(tenant)
    overrides = {
        o.feature_name: o.is_enabled for o in repository.get_tenant_overrides(db, tenant_id)
    }
    effective = tenant_service.get_effective_features(db, tenant_id)
    changes = "  ".join(f'{k}="{v}"' for k, v in (payload.overrides or {}).items())
    logger.info("[FEATURE TOGGLE] tenant=%s %s", tenant.slug, changes)
    audit_service.log_event_best_effort(
        db,
        action="set_tenant_features",
        user_id=current_admin.id,
        tenant_id=tenant_id,
        resource_type="tenant",
        resource_id=str(tenant_id),
        detail={"overrides": payload.overrides},
    )
    return TenantFeaturesRead(
        tenant_id=tenant_id,
        plan_features=plan_feats,
        overrides=overrides,
        effective=effective,
    )


# ── Tenant devices ────────────────────────────────────────────────────────────


@router.get("/tenants/{tenant_id}/devices", response_model=list[DeviceRead])
def list_tenant_devices(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> list[DeviceRead]:
    _check_tenant(db, tenant_id)
    devices = repository.list_tenant_devices(db, tenant_id)
    return [_device_to_read(d) for d in devices]


@router.post("/tenants/{tenant_id}/devices", status_code=status.HTTP_201_CREATED)
def assign_device_to_tenant(
    tenant_id: uuid.UUID,
    payload: TenantDeviceAssign,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict:
    _check_tenant(db, tenant_id)
    forbid_tenant_mutation()
    device = device_repo.get_device_by_uid(db, str(payload.device_id))
    if device is None:
        from sqlalchemy import select
        from app.modules.devices.model import Device

        device = db.scalar(select(Device).where(Device.id == payload.device_id))
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")
    repository.assign_device(db, tenant_id, device.id)
    logger.info("[DEVICE ASSIGN] device=%s tenant=%s", device.device_uid, tenant_id)
    audit_service.log_event_best_effort(
        db,
        action="assign_device",
        user_id=current_admin.id,
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid, "tenant_id": str(tenant_id)},
    )
    return {"status": "assigned", "device_id": str(device.id)}


@router.delete("/tenants/{tenant_id}/devices/{device_id}")
def remove_device_from_tenant(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> dict:
    _check_tenant(db, tenant_id)
    forbid_tenant_mutation()
    removed = repository.remove_device(db, tenant_id, device_id, deleted_by=current_admin.id)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not assigned to this tenant")
    logger.info("[DEVICE REMOVE] device_id=%s tenant=%s", device_id, tenant_id)
    audit_service.log_event_best_effort(
        db,
        action="remove_device",
        user_id=current_admin.id,
        tenant_id=tenant_id,
        resource_type="device",
        resource_id=str(device_id),
        detail={"tenant_id": str(tenant_id)},
    )
    return {"message": "Device deleted", "device_id": str(device_id), "status": "deleted"}


@router.get("/tenants/{tenant_id}/projects", response_model=list[TenantProjectSummary])
def list_tenant_projects(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> list[TenantProjectSummary]:
    _check_tenant(db, tenant_id)
    return [
        TenantProjectSummary(**item) for item in project_repository.list_projects(db, tenant_id)
    ]


@router.get(
    "/tenants/{tenant_id}/projects/{project_id}", response_model=AdminTenantProjectReadOnlyRead
)
def get_tenant_project_read_only(
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> AdminTenantProjectReadOnlyRead:
    tenant = repository.get_tenant(db, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    project = project_repository.get_project(db, tenant_id, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")

    base = TenantProjectDetail.model_validate(project)
    device_summaries_raw = project_repository.list_project_device_bindings(db, tenant_id, project)
    device_ids = [item["device"].id for item in device_summaries_raw]
    device_uid_by_id = {
        str(item["device"].id): item["device"].device_uid for item in device_summaries_raw
    }

    ota_jobs = _list_project_ota_jobs(db, device_ids, limit=20)
    ota_job_reads = [_ota_job_read(job) for job in ota_jobs]
    latest_ota_by_device: dict[str, OtaJobRead] = {}
    for job in ota_job_reads:
        latest_ota_by_device.setdefault(str(job.device_id), job)

    alert_events = _list_project_alert_events(db, device_ids, limit=20)
    alert_rows = [
        {
            "id": str(item.id),
            "device_id": str(item.device_id),
            "device_uid": device_uid_by_id.get(str(item.device_id), "unknown"),
            "timestamp": (item.last_seen_at or item.created_at).isoformat(),
            "title": item.title,
            "metric_name": item.title,
            "metric_value": None,
            "anomaly_score": None,
            "message": item.message,
            "source": item.source,
            "severity": item.severity,
        }
        for item in alert_events
    ]

    device_summaries = []
    for item in device_summaries_raw:
        device = DeviceRead.model_validate(item["device"])
        state = item["latest_state"] if isinstance(item["latest_state"], dict) else {}
        ts_value = state.get("ts")
        last_telemetry_at = None
        if isinstance(ts_value, str):
            try:
                last_telemetry_at = datetime.fromisoformat(ts_value)
            except ValueError:
                last_telemetry_at = None
        device_key = str(device.id)
        device_alerts = [row for row in alert_rows if row["device_id"] == device_key][:5]
        latest_ota = latest_ota_by_device.get(device_key)
        device_summaries.append(
            ProjectDeviceSummaryRead(
                device=device,
                latest_state=state,
                last_telemetry_at=last_telemetry_at,
                latest_ota_status=latest_ota.status if latest_ota else None,
                latest_ota_progress=latest_ota.progress if latest_ota else None,
                recent_alert_count=len(
                    [row for row in alert_rows if row["device_id"] == device_key]
                ),
                recent_alerts=device_alerts,
            )
        )

    base_data = base.model_dump()

    return AdminTenantProjectReadOnlyRead(
        **base_data,
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
        read_only=True,
        access_policy=ProjectAccessPolicyRead(
            tenant_ownership_rule="Tenant owns and edits project, device, firmware, and OTA configuration inside its own workspace.",
            admin_access_rule="Admin may inspect tenant projects and device bindings in read-only mode for support and platform operations.",
            support_mode_rule="Platform administrators may inspect tenant data without modifying customer-owned resources.",
            read_only=True,
        ),
        device_summaries=device_summaries,
        recent_ota_jobs=ota_job_reads,
        recent_alerts=alert_rows,
    )


# ── Tenant users ──────────────────────────────────────────────────────────────


@router.get("/tenants/{tenant_id}/users", response_model=list[UserRead])
def list_tenant_users(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> list[UserRead]:
    _check_tenant(db, tenant_id)
    users = repository.list_tenant_users(db, tenant_id)
    return [UserRead.model_validate(u) for u in users]


@router.post(
    "/tenants/{tenant_id}/users", response_model=UserRead, status_code=status.HTTP_201_CREATED
)
def create_tenant_user(
    request: Request,
    tenant_id: uuid.UUID,
    payload: TenantUserCreate,
    db: Session = Depends(get_db),
) -> UserRead:
    _check_tenant(db, tenant_id)
    forbid_tenant_mutation()
    if auth_repo.get_user_by_email(db, payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already exists")
    # Validate role is a permitted tenant-scoped role
    _VALID_TENANT_ROLES = {"tenant_owner", "viewer"}
    if payload.role not in _VALID_TENANT_ROLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role '{payload.role}'. Must be one of: {', '.join(sorted(_VALID_TENANT_ROLES))}",
        )
    hashed = auth_service.hash_password(payload.password)
    user = User(
        email=payload.email,
        hashed_password=hashed,
        full_name=payload.full_name,
        role=payload.role,
        tenant_id=tenant_id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Audit log for admin user creation
    try:
        audit_service.log_event_best_effort(
            db,
            action="admin_create_tenant_user",
            user_id=None,  # Admin action
            tenant_id=tenant_id,
            resource_type="user",
            resource_id=str(user.id),
            detail={
                "email": user.email,
                "role": user.role,
                "tenant_id": str(tenant_id),
            },
            ip_address=request.client.host if request.client else None,
        )
    except Exception:
        logger.warning(
            "[ADMIN] Audit logging failed for create_tenant_user (non-fatal)", exc_info=True
        )
        try:
            db.rollback()
        except Exception:
            pass

    return UserRead.model_validate(user)


@router.delete(
    "/tenants/{tenant_id}/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_tenant_user(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    _check_tenant(db, tenant_id)
    forbid_tenant_mutation()
    user = auth_repo.get_user_by_id(db, user_id)
    if user is None or user.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found in this tenant")
    audit_service.log_event_best_effort(
        db,
        action="admin_delete_tenant_user",
        user_id=current_admin.id,
        tenant_id=tenant_id,
        resource_type="user",
        resource_id=str(user_id),
        detail={"email": user.email, "role": user.role},
    )
    db.delete(user)
    db.commit()


# ── helper ────────────────────────────────────────────────────────────────────


def _check_tenant(db: Session, tenant_id: uuid.UUID) -> None:
    if repository.get_tenant(db, tenant_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
