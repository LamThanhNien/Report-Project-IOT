"""Tenant Rule Engine API."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.bounded_contexts.rule_engine.application.schemas import (
    AutomationRuleCreate,
    AutomationRuleResponse,
    AutomationRuleUpdate,
    FieldDefinitionCreate,
    FieldDefinitionResponse,
    RuleExecutionResponse,
    RuleStatsResponse,
    RuleTemplateResponse,
    RuleTestRequest,
    RuleTestResponse,
)
from app.bounded_contexts.rule_engine.application.use_cases import RuleEngineUseCases
from app.core.permissions import require_tenant_permission
from app.core.tenant import get_current_tenant_user
from app.db.session import get_db
from app.modules.auth.model import User
from app.modules.audit import service as audit_service

router = APIRouter(prefix="/client/automation", tags=["Rule Engine"])


def _audit_rule(db: Session, user: User, action: str, resource_id: UUID, detail=None) -> None:
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=user.id,
        tenant_id=user.tenant_id,
        resource_type="automation_rule",
        resource_id=str(resource_id),
        detail=detail or {},
        outcome="success",
    )


@router.get(
    "/rules",
    response_model=list[AutomationRuleResponse],
    dependencies=[require_tenant_permission("automation.view")],
)
def list_rules(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).list_rules(current_user.tenant_id, project_id=project_id)


@router.post(
    "/rules",
    response_model=AutomationRuleResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("automation.manage")],
)
def create_rule(
    data: AutomationRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    try:
        rule = RuleEngineUseCases(db).create_rule(current_user.tenant_id, data, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        audit_service.log_event_best_effort(
            db,
            action="rule.create",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            resource_type="automation_rule",
            detail={"name": data.name},
            outcome="failure",
        )
        raise
    _audit_rule(db, current_user, "rule.create", rule.id, {"name": rule.name})
    return rule


@router.get(
    "/rules/{rule_id}",
    response_model=AutomationRuleResponse,
    dependencies=[require_tenant_permission("automation.view")],
)
def get_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    rule = RuleEngineUseCases(db).get_rule(current_user.tenant_id, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    return rule


@router.patch(
    "/rules/{rule_id}",
    response_model=AutomationRuleResponse,
    dependencies=[require_tenant_permission("automation.manage")],
)
def update_rule(
    rule_id: UUID,
    data: AutomationRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    try:
        rule = RuleEngineUseCases(db).update_rule(current_user.tenant_id, rule_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if rule is None:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    _audit_rule(
        db,
        current_user,
        "rule.update",
        rule_id,
        {"changed_fields": sorted(data.model_dump(exclude_unset=True))},
    )
    return rule


@router.delete(
    "/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[require_tenant_permission("automation.manage")],
)
def delete_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    if not RuleEngineUseCases(db).delete_rule(current_user.tenant_id, rule_id):
        raise HTTPException(status_code=404, detail="Automation rule not found")
    _audit_rule(db, current_user, "rule.delete", rule_id)


@router.post(
    "/rules/{rule_id}/enable",
    response_model=AutomationRuleResponse,
    dependencies=[require_tenant_permission("automation.manage")],
)
def enable_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    rule = RuleEngineUseCases(db).set_rule_enabled(current_user.tenant_id, rule_id, True)
    if rule is None:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    _audit_rule(db, current_user, "rule.enable", rule_id)
    return rule


@router.post(
    "/rules/{rule_id}/disable",
    response_model=AutomationRuleResponse,
    dependencies=[require_tenant_permission("automation.manage")],
)
def disable_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    rule = RuleEngineUseCases(db).set_rule_enabled(current_user.tenant_id, rule_id, False)
    if rule is None:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    _audit_rule(db, current_user, "rule.disable", rule_id)
    return rule


@router.post(
    "/rules/{rule_id}/duplicate",
    response_model=AutomationRuleResponse,
    dependencies=[require_tenant_permission("automation.manage")],
)
def duplicate_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    rule = RuleEngineUseCases(db).duplicate_rule(current_user.tenant_id, rule_id, current_user.id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    _audit_rule(db, current_user, "rule.duplicate", rule.id, {"source_rule_id": str(rule_id)})
    return rule


@router.post(
    "/rules/test",
    response_model=RuleTestResponse,
    dependencies=[require_tenant_permission("automation.manage")],
)
def test_rule(
    data: RuleTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).test_rule(current_user.tenant_id, data)


@router.get(
    "/executions",
    response_model=list[RuleExecutionResponse],
    dependencies=[require_tenant_permission("automation.view")],
)
def list_executions(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).list_executions(current_user.tenant_id, limit, offset)


@router.get(
    "/stats",
    response_model=RuleStatsResponse,
    dependencies=[require_tenant_permission("automation.view")],
)
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).stats(current_user.tenant_id)


@router.get(
    "/templates",
    response_model=list[RuleTemplateResponse],
    dependencies=[require_tenant_permission("automation.view")],
)
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).templates()


@router.get(
    "/field-definitions",
    response_model=list[FieldDefinitionResponse],
    dependencies=[require_tenant_permission("automation.view")],
)
def list_field_definitions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).list_field_definitions(current_user.tenant_id)


@router.post(
    "/field-definitions",
    response_model=FieldDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("automation.manage")],
)
def create_field_definition(
    data: FieldDefinitionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    definition = RuleEngineUseCases(db).create_field_definition(current_user.tenant_id, data)
    audit_service.log_event_best_effort(
        db,
        action="rule.field_definition_create",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="rule_field_definition",
        resource_id=str(definition.id),
        detail={"field_key": definition.field_key, "data_type": definition.data_type},
        outcome="success",
    )
    return definition


@router.get(
    "/field-suggestions",
    response_model=list[str],
    dependencies=[require_tenant_permission("automation.view")],
)
def suggest_fields(
    device_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    return RuleEngineUseCases(db).suggest_fields(current_user.tenant_id, device_id)
