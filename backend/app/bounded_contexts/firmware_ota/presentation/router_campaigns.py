from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.bounded_contexts.firmware_ota.application.campaign_service import CampaignService
from app.bounded_contexts.firmware_ota.presentation.ota_campaign_schemas import (
    OtaCampaignCreate,
    OtaCampaignRead,
    OtaCampaignUpdate,
)
from app.core.security import require_admin
from app.core.platform_tenant_access import forbid_tenant_mutation
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.auth.model import User

router = APIRouter(prefix="/admin/ota/campaigns", tags=["admin-ota-campaigns"])


def _campaign_or_404(service: CampaignService, campaign_id: UUID):
    campaign = service.get(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OTA campaign not found")
    return campaign


def _audit(db: Session, admin: User, campaign, action: str) -> None:
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=admin.id,
        tenant_id=campaign.tenant_id,
        resource_type="ota_campaign",
        resource_id=str(campaign.id),
        detail={"name": campaign.name, "status": campaign.status},
    )


@router.get("", response_model=list[OtaCampaignRead])
def list_campaigns(
    tenant_id: UUID = Query(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict]:
    service = CampaignService(db)
    return [service.summary(item) for item in service.list(tenant_id=tenant_id)]


@router.post("", response_model=OtaCampaignRead, status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: OtaCampaignCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if payload.tenant_id is None:
        raise HTTPException(status_code=422, detail="Tenant-scoped OTA campaign required")
    forbid_tenant_mutation()


@router.get("/{campaign_id}", response_model=OtaCampaignRead)
def get_campaign(
    campaign_id: UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    service = CampaignService(db)
    campaign = _campaign_or_404(service, campaign_id)
    return service.summary(campaign)


@router.patch("/{campaign_id}", response_model=OtaCampaignRead)
def update_campaign(
    campaign_id: UUID,
    payload: OtaCampaignUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    service = CampaignService(db)
    _campaign_or_404(service, campaign_id)
    forbid_tenant_mutation()


def _transition(campaign_id: UUID, action: str, db: Session, admin: User) -> dict:
    service = CampaignService(db)
    _campaign_or_404(service, campaign_id)
    forbid_tenant_mutation()


@router.post("/{campaign_id}/start", response_model=OtaCampaignRead)
def start_campaign(
    campaign_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    service = CampaignService(db)
    _campaign_or_404(service, campaign_id)
    forbid_tenant_mutation()


@router.post("/{campaign_id}/pause", response_model=OtaCampaignRead)
def pause_campaign(
    campaign_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    return _transition(campaign_id, "pause", db, admin)


@router.post("/{campaign_id}/resume", response_model=OtaCampaignRead)
def resume_campaign(
    campaign_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    return _transition(campaign_id, "resume", db, admin)


@router.post("/{campaign_id}/cancel", response_model=OtaCampaignRead)
def cancel_campaign(
    campaign_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    return _transition(campaign_id, "cancel", db, admin)


@router.post("/{campaign_id}/retry-failed", response_model=OtaCampaignRead)
def retry_failed_campaign(
    campaign_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    return _transition(campaign_id, "retry_failed", db, admin)
