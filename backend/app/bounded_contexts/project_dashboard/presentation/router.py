"""Project Dashboard presentation router.

Functionally identical to app/modules/projects/router.py but delegates
through the bounded context's adapters and use cases.
"""

import logging
import threading
import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.permissions import require_tenant_permission
from app.core.tenant import get_current_tenant_user
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.auth.model import User
from app.modules.projects import repository as project_repository
from app.modules.projects.schema import (
    DeviceCapabilityRead,
    DeviceCommandRequest,
    DeviceCommandResponse,
    PageCreate,
    ProjectCreate,
    ProjectUpdate,
    ProjectPageRead,
    ProjectWidgetRead,
    WidgetCreate,
    WidgetUpdate,
    TenantProjectDetail,
    TenantProjectRead,
    TenantProjectSummary,
)
from app.bounded_contexts.project_dashboard.infrastructure.mqtt_adapter import (
    MqttDeviceCommandAdapter,
)

from pydantic import BaseModel
from app.bounded_contexts.project_dashboard.presentation.schemas import (
    DatastreamCreate,
    DatastreamListResponse,
    DatastreamRead,
    DatastreamUpdate,
)
from app.bounded_contexts.project_dashboard.infrastructure import repositories as ds_repo
from app.core.project_security import verify_project_access
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
    ProjectMember,
    TenantProject,
)

from app.bounded_contexts.project_dashboard.domain import widget_registry

logger = logging.getLogger(__name__)
router = APIRouter()

repo = project_repository
mqtt = MqttDeviceCommandAdapter()


class CommandHotPathCache:
    """Thread-safe in-memory TTL cache (300s) for device lookups and command capability validations."""

    def __init__(self, ttl_seconds: float = 300.0):
        self.ttl = ttl_seconds
        self._device_cache: dict[tuple[str, str], tuple[float, Any]] = {}
        self._capability_cache: dict[tuple[str, str, str, str], tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_device(self, tenant_id: uuid.UUID | str, device_id_or_uid: str) -> Any | None:
        key = (str(tenant_id), str(device_id_or_uid))
        now = time.time()
        with self._lock:
            if key in self._device_cache:
                timestamp, device = self._device_cache[key]
                if now - timestamp < self.ttl:
                    return device
                del self._device_cache[key]
        return None

    def set_device(self, tenant_id: uuid.UUID | str, device_id_or_uid: str, device: Any) -> None:
        if device is None:
            return
        now = time.time()
        tid = str(tenant_id)
        with self._lock:
            self._device_cache[(tid, str(device_id_or_uid))] = (now, device)
            dev_id = getattr(device, "id", None)
            if dev_id:
                self._device_cache[(tid, str(dev_id))] = (now, device)
            dev_uid = getattr(device, "device_uid", None)
            if dev_uid:
                self._device_cache[(tid, str(dev_uid))] = (now, device)

    def get_capability(
        self, tenant_id: uuid.UUID | str, device_id: uuid.UUID | str, command: str, target_key: str
    ) -> Any | None:
        key = (str(tenant_id), str(device_id), str(command), str(target_key))
        now = time.time()
        with self._lock:
            if key in self._capability_cache:
                timestamp, cap = self._capability_cache[key]
                if now - timestamp < self.ttl:
                    return cap
                del self._capability_cache[key]
        return None

    def set_capability(
        self,
        tenant_id: uuid.UUID | str,
        device_id: uuid.UUID | str,
        command: str,
        target_key: str,
        capability: Any,
    ) -> None:
        key = (str(tenant_id), str(device_id), str(command), str(target_key))
        now = time.time()
        with self._lock:
            self._capability_cache[key] = (now, capability)

    def clear(self) -> None:
        with self._lock:
            self._device_cache.clear()
            self._capability_cache.clear()


device_command_cache = CommandHotPathCache(ttl_seconds=300.0)



def _parse_uuid(value: str, label: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid {label}") from exc


def _project_or_404(db: Session, tenant_id: uuid.UUID, project_id: str):
    project = repo.get_project(db, tenant_id, _parse_uuid(project_id, "project_id"))
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project




def _normalize_widget_config_or_400(widget_type: str, config: dict[str, Any]) -> dict[str, Any]:
    """Apply the registry's semantic config contract before persistence."""

    try:
        return widget_registry.normalize_widget_config(widget_type, config)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/projects",
    response_model=list[TenantProjectSummary],
    dependencies=[require_tenant_permission("projects.view")],
)
def list_projects(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[TenantProjectSummary]:
    return [TenantProjectSummary(**item) for item in repo.list_projects(db, current_user.tenant_id)]


@router.post(
    "/projects",
    response_model=TenantProjectRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("projects.manage")],
)
def create_project(
    payload: ProjectCreate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> TenantProjectRead:
    from app.core.tenant_context import current_tenant_id_context

    current_tenant_id_context.set(current_user.tenant_id)
    project = repo.create_project(db, current_user.tenant_id, payload)
    audit_service.log_event_best_effort(
        db,
        action="create_project",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="tenant_project",
        resource_id=str(project.id),
        detail={"name": project.name},
    )
    return TenantProjectRead.model_validate(project)


@router.get(
    "/projects/{project_id}",
    response_model=TenantProjectDetail,
    dependencies=[require_tenant_permission("projects.view")],
)
def get_project(
    project_id: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> TenantProjectDetail:
    project = _project_or_404(db, current_user.tenant_id, project_id)
    data = TenantProjectDetail.model_validate(project)
    data.latest_state = repo.build_latest_state(db, project)
    return data


@router.put(
    "/projects/{project_id}",
    response_model=TenantProjectRead,
    dependencies=[require_tenant_permission("projects.manage")],
)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> TenantProjectRead:
    project = _project_or_404(db, current_user.tenant_id, project_id)
    return TenantProjectRead.model_validate(repo.update_project(db, project, payload))


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[require_tenant_permission("projects.manage")],
)
def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> None:
    project = _project_or_404(db, current_user.tenant_id, project_id)
    repo.delete_project(db, project)










@router.get(
    "/projects/{project_id}/runtime-state",
    dependencies=[require_tenant_permission("projects.view")],
)
def get_project_runtime_state(
    project_id: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return volatile widget state without refetching the project layout."""
    from app.core.tenant_context import current_tenant_id_context

    current_tenant_id_context.set(current_user.tenant_id)
    project = _project_or_404(db, current_user.tenant_id, project_id)
    return {"project_id": str(project.id), "latest_state": repo.build_latest_state(db, project)}


@router.post(
    "/projects/{project_id}/pages",
    response_model=ProjectPageRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("projects.manage")],
)
def create_page(
    project_id: str,
    payload: PageCreate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> ProjectPageRead:
    project = _project_or_404(db, current_user.tenant_id, project_id)
    page = repo.create_page(db, project, payload)
    return ProjectPageRead.model_validate(page)


@router.post(
    "/pages/{page_id}/widgets",
    response_model=ProjectWidgetRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("projects.manage")],
)
def create_widget(
    page_id: str,
    payload: WidgetCreate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> ProjectWidgetRead:
    from app.core.tenant_context import current_tenant_id_context

    current_tenant_id_context.set(current_user.tenant_id)
    page = repo.get_page_for_tenant(db, current_user.tenant_id, _parse_uuid(page_id, "page_id"))
    if page is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Page not found")
    project_id = page.project_id
    payload.config = _normalize_widget_config_or_400(payload.widget_type, payload.config)
    try:
        repo.validate_widget_binding(
            db,
            current_user.tenant_id,
            payload.widget_type,
            payload.binding,
            project_id=project_id,
        )
    except HTTPException:
        raise
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid widget binding"
        ) from exc
    return ProjectWidgetRead.model_validate(repo.create_widget(db, page, payload))


@router.put(
    "/widgets/{widget_id}",
    response_model=ProjectWidgetRead,
    dependencies=[require_tenant_permission("projects.manage")],
)
def update_widget(
    widget_id: str,
    payload: WidgetUpdate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> ProjectWidgetRead:
    widget = repo.get_widget_for_tenant(
        db, current_user.tenant_id, _parse_uuid(widget_id, "widget_id")
    )
    if widget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Widget not found")
    next_type = payload.widget_type or widget.widget_type
    next_binding = payload.binding if payload.binding is not None else dict(widget.binding or {})
    next_config = payload.config if payload.config is not None else dict(widget.config or {})
    project_id = repo.get_project_id_for_widget(db, widget.id)
    payload.config = _normalize_widget_config_or_400(next_type, next_config)
    try:
        repo.validate_widget_binding(
            db,
            current_user.tenant_id,
            next_type,
            next_binding,
            project_id=project_id,
            exclude_widget_id=widget.id,
        )
    except HTTPException:
        raise
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid widget binding"
        ) from exc
    if payload.binding is not None:
        payload.binding = next_binding
    return ProjectWidgetRead.model_validate(repo.update_widget(db, widget, payload))


@router.delete(
    "/widgets/{widget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[require_tenant_permission("projects.manage")],
)
def delete_widget(
    widget_id: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> None:
    widget = repo.get_widget_for_tenant(
        db, current_user.tenant_id, _parse_uuid(widget_id, "widget_id")
    )
    if widget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Widget not found")
    repo.delete_widget(db, widget)


@router.get(
    "/devices/{device_id}/capabilities",
    response_model=list[DeviceCapabilityRead],
    dependencies=[require_tenant_permission("projects.view")],
)
def list_device_capabilities(
    device_id: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[DeviceCapabilityRead]:
    device = repo.get_tenant_device_by_id_or_uid(db, current_user.tenant_id, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    capabilities = repo.list_bindable_device_capabilities(db, device.id)
    return [DeviceCapabilityRead.model_validate(item) for item in capabilities]




@router.post(
    "/devices/{device_id}/commands",
    response_model=DeviceCommandResponse,
    dependencies=[require_tenant_permission("commands.send")],
)
def send_device_command(
    device_id: str,
    payload: DeviceCommandRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> DeviceCommandResponse:
    device = device_command_cache.get_device(current_user.tenant_id, device_id)
    if device is None:
        device = repo.get_tenant_device_by_id_or_uid(db, current_user.tenant_id, device_id)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found",
            )
        device_command_cache.set_device(current_user.tenant_id, device_id, device)

    target_key = str(
        payload.params.get("target")
        or payload.params.get("channel")
        or payload.params.get("gpio_pin")
        or payload.params.get("pin")
        or ""
    )
    device_obj_id = getattr(device, "id", device_id)
    capability = device_command_cache.get_capability(
        current_user.tenant_id, device_obj_id, payload.command, target_key
    )
    if capability is None:
        capability = repo.validate_command_for_device(db, device, payload.command, payload.params)
        if capability is not None:
            device_command_cache.set_capability(
                current_user.tenant_id,
                device_obj_id,
                payload.command,
                target_key,
                capability,
            )

    if payload.command == "virtual_write":
        repo._validate_virtual_command_context(
            db,
            device,
            str(payload.params["channel"]),
            payload.params,
            current_user.tenant_id,
        )

    command_id = uuid.uuid4()
    topic = f"devices/{device.device_uid}/commands"
    target = payload.params.get("target")
    if not isinstance(target, str):
        if isinstance(payload.params.get("channel"), str):
            target = str(payload.params["channel"])
        elif payload.params.get("pin") is not None:
            target = f"gpio_{payload.params['pin']}"
        else:
            target = None
    value = payload.params.get("value")
    if value is None and isinstance(payload.params.get("state"), bool):
        value = payload.params.get("state")
    # Prefer widget-level gpio_pin from params over capability's fixed pin
    raw_gpio = payload.params.get("gpio_pin", payload.params.get("pin"))
    if isinstance(raw_gpio, int):
        gpio_pin = raw_gpio
    elif isinstance(raw_gpio, str) and raw_gpio.strip().isdigit():
        gpio_pin = int(raw_gpio)
    elif capability and getattr(capability, "gpio_pin", None) is not None:
        gpio_pin = capability.gpio_pin
    else:
        gpio_pin = None

    mqtt_payload = {
        "command_id": str(command_id),
        "type": payload.command,
        "command": payload.command,
        "capability_key": capability.capability_key
        if capability and getattr(capability, "capability_key", None)
        else None,
        "capability_type": capability.capability_type
        if capability and getattr(capability, "capability_type", None)
        else None,
        "gpio_pin": gpio_pin,
        "target": target,
        "value": value,
        "params": payload.params,
        "source": "tenant_widget",
        "issued_by_user_id": str(current_user.id),
        "tenant_id": str(current_user.tenant_id),
        # Backward compatibility fields.
        "request_id": str(command_id),
    }
    try:
        mqtt.publish_device_command(
            device_uid=device.device_uid,
            payload=mqtt_payload,
        )
    except Exception as exc:
        logger.exception(
            "Device command publish failed device=%s tenant=%s", device.id, current_user.tenant_id
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail="Command could not be published"
        ) from exc

    background_tasks.add_task(
        audit_service.log_event_best_effort,
        db=None,
        action="send_device_command",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="device",
        resource_id=str(device.id),
        detail={
            "command": payload.command,
            "params": payload.params,
            "command_id": str(command_id),
        },
    )
    return DeviceCommandResponse(accepted=True, request_id=command_id, topic=topic)



class ProjectMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = "project_viewer"


class ProjectMemberRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    role: str


@router.put("/projects/{project_id}/devices/{device_uid}/assign", dependencies=[require_tenant_permission("projects.manage")])
def assign_device_to_project(
    project_id: uuid.UUID,
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
    project: TenantProject = Depends(verify_project_access),
):
    device = (
        db.query(Device)
        .filter(Device.device_uid == device_uid, Device.tenant_id == current_user.tenant_id)
        .first()
    )
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")
    device.project_id = project_id
    db.commit()
    return {
        "message": f"Device {device_uid} assigned to project {project.name}",
        "device_uid": device_uid,
        "project_id": str(project_id),
    }


@router.delete("/projects/{project_id}/devices/{device_uid}/unassign", dependencies=[require_tenant_permission("projects.manage")])
def unassign_device_from_project(
    project_id: uuid.UUID,
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
    project: TenantProject = Depends(verify_project_access),
):
    device = (
        db.query(Device)
        .filter(Device.device_uid == device_uid, Device.project_id == project_id)
        .first()
    )
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found in this project")
    device.project_id = None
    db.commit()
    return {"message": f"Device {device_uid} unassigned from project", "device_uid": device_uid}


@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberRead], dependencies=[require_tenant_permission("projects.view")])
def list_project_members(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    project: TenantProject = Depends(verify_project_access),
):
    members = db.query(ProjectMember).filter(ProjectMember.project_id == project_id).all()
    return [
        ProjectMemberRead(id=m.id, project_id=m.project_id, user_id=m.user_id, role=m.role)
        for m in members
    ]


@router.post(
    "/projects/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("projects.manage")],
)
def add_project_member(
    project_id: uuid.UUID,
    body: ProjectMemberAdd,
    db: Session = Depends(get_db),
    project: TenantProject = Depends(verify_project_access),
):
    existing = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == body.user_id)
        .first()
    )
    if existing:
        existing.role = body.role
        db.commit()
        db.refresh(existing)
        return ProjectMemberRead(
            id=existing.id,
            project_id=existing.project_id,
            user_id=existing.user_id,
            role=existing.role,
        )

    member = ProjectMember(project_id=project_id, user_id=body.user_id, role=body.role)
    db.add(member)
    db.commit()
    db.refresh(member)
    return ProjectMemberRead(
        id=member.id, project_id=member.project_id, user_id=member.user_id, role=member.role
    )


@router.delete("/projects/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[require_tenant_permission("projects.manage")])
def remove_project_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    project: TenantProject = Depends(verify_project_access),
):
    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .first()
    )
    if member:
        db.delete(member)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── Datastream (Virtual Pin) Endpoints ──────────────────────────────────────────


@router.get("/datastreams", response_model=DatastreamListResponse, dependencies=[require_tenant_permission("projects.view")])
def list_datastreams(
    project_id: uuid.UUID,
    search: str | None = None,
    data_type: str | None = None,
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
):
    """Lấy danh sách tất cả Datastreams (Virtual Pins) của tenant hiện tại thuộc về project."""
    verify_project_access(project_id=project_id, current_user=current_user, db=db)
    result = ds_repo.list_datastreams(
        db,
        tenant_id=current_user.tenant_id,
        project_id=project_id,
        search=search,
        data_type=data_type,
        skip=skip,
        limit=limit,
    )
    return result


@router.post(
    "/datastreams",
    response_model=DatastreamRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_tenant_permission("projects.manage")],
)
def create_datastream(
    payload: DatastreamCreate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
):
    """Tạo mới một Datastream (Virtual Pin)."""
    verify_project_access(project_id=payload.project_id, current_user=current_user, db=db)
    return ds_repo.create_datastream(db, tenant_id=current_user.tenant_id, payload=payload)


@router.put(
    "/datastreams/{datastream_id}",
    response_model=DatastreamRead,
    dependencies=[require_tenant_permission("projects.manage")],
)
def update_datastream(
    datastream_id: str,
    payload: DatastreamUpdate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
):
    """Cập nhật thông tin Datastream."""
    ds_id = _parse_uuid(datastream_id, "datastream_id")
    return ds_repo.update_datastream(
        db, tenant_id=current_user.tenant_id, datastream_id=ds_id, payload=payload
    )


@router.delete(
    "/datastreams/{datastream_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_tenant_permission("projects.manage")],
)
def delete_datastream(
    datastream_id: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
):
    """Xóa Datastream (kiểm tra không có widget nào đang sử dụng)."""
    ds_id = _parse_uuid(datastream_id, "datastream_id")
    ds_repo.delete_datastream(db, tenant_id=current_user.tenant_id, datastream_id=ds_id)
