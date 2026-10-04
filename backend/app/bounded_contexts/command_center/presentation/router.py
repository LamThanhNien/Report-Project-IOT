"""Command Center API router."""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.tenant import get_current_tenant_user
from app.core.permissions import require_tenant_permission
from app.modules.auth.model import User
from app.bounded_contexts.command_center.application.schemas import (
    CommandTemplateCreate,
    CommandTemplateResponse,
    CommandTemplateUpdate,
    CommandDispatchRequest,
    CommandDispatchResponse,
)
from app.bounded_contexts.command_center.application.use_cases import CommandCenterUseCases

router = APIRouter(prefix="/client/commands", tags=["Command Center"])


@router.post(
    "/templates",
    response_model=CommandTemplateResponse,
    status_code=201,
    dependencies=[require_tenant_permission("command_templates.manage")],
)
def create_template(
    data: CommandTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    try:
        template = uc.create_template(current_user.tenant_id, data, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return template


@router.get(
    "/templates",
    response_model=List[CommandTemplateResponse],
    dependencies=[require_tenant_permission("command_templates.view")],
)
def list_templates(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    return uc.list_templates(current_user.tenant_id, project_id=project_id)


@router.get(
    "/templates/{template_id}",
    response_model=CommandTemplateResponse,
    dependencies=[require_tenant_permission("command_templates.view")],
)
def get_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    template = uc.get_template(current_user.tenant_id, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Command template not found")
    return template


@router.put(
    "/templates/{template_id}",
    response_model=CommandTemplateResponse,
    dependencies=[require_tenant_permission("command_templates.manage")],
)
def update_template(
    template_id: UUID,
    data: CommandTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    try:
        template = uc.update_template(current_user.tenant_id, template_id, data)
    except ValueError as e:
        if str(e) == "Cannot modify system templates":
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=404, detail=str(e))
    return template


@router.delete(
    "/templates/{template_id}",
    status_code=204,
    response_class=Response,
    dependencies=[require_tenant_permission("command_templates.manage")],
)
def delete_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    try:
        uc.delete_template(current_user.tenant_id, template_id)
    except ValueError as e:
        if str(e) == "Cannot delete system templates":
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/dispatch",
    response_model=CommandDispatchResponse,
    status_code=201,
    dependencies=[require_tenant_permission("commands.send")],
)
def dispatch_command(
    data: CommandDispatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    try:
        dispatch = uc.dispatch_command(current_user.tenant_id, data, created_by=current_user.id)
        return dispatch
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/dispatch/{dispatch_id}",
    response_model=CommandDispatchResponse,
    dependencies=[require_tenant_permission("commands.view")],
)
def get_dispatch(
    dispatch_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    dispatch = uc.get_dispatch(current_user.tenant_id, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Command dispatch not found")
    return dispatch


@router.get(
    "/history",
    response_model=dict,
    dependencies=[require_tenant_permission("commands.view")],
)
def list_history(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    status: Optional[str] = Query(None),
    command_type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    dispatches, total = uc.list_dispatches(
        current_user.tenant_id, status, command_type, project_id, skip, limit
    )
    return {
        "items": [CommandDispatchResponse.model_validate(d) for d in dispatches],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post(
    "/dispatch/{dispatch_id}/retry",
    response_model=CommandDispatchResponse,
    dependencies=[require_tenant_permission("commands.send")],
)
def retry_dispatch(
    dispatch_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = CommandCenterUseCases(db)
    try:
        dispatch = uc.retry_dispatch(current_user.tenant_id, dispatch_id)
        if not dispatch:
            raise HTTPException(status_code=404, detail="Command dispatch not found")
        return dispatch
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
