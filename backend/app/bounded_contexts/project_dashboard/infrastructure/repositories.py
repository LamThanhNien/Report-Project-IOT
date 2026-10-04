import re
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, delete
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.modules.devices.model import Device
from app.modules.projects.model import DeviceCapability, ProjectPage, ProjectWidget, TenantProject
from app.modules.projects.schema import (
    PageCreate,
    ProjectCreate,
    ProjectUpdate,
    WidgetCreate,
    WidgetUpdate,
)
from app.modules.telemetry import repository as telemetry_repo
from app.modules.tenants.model import TenantDeviceMapping
from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
    TenantDatastream,
    DatastreamTemplateCompatibility,
)
from app.bounded_contexts.project_dashboard.domain import widget_registry


INT32_MAX = 2_147_483_647

ALLOWED_SWITCH_CAPABILITY_TYPES = {"digital_output", "relay", "led"}
ESP32_GPIO_MIN = 0
ESP32_GPIO_MAX = 39
ESP32_RESERVED_OR_UNSAFE_OUTPUT_PINS = {6, 7, 8, 9, 10, 11, 34, 35, 36, 39}
ESP32_BOOTSTRAP_PINS = {0, 1, 3, 5, 12}
CUSTOM_GPIO_CAPABILITY_KEY = "custom_gpio_output"

DEFAULT_DEVICE_CAPABILITIES: list[dict[str, Any]] = [
    {
        "capability_key": "led_builtin",
        "capability_type": "led",
        "label": "Built-in LED",
        "gpio_pin": 2,
        "channel": "led_builtin",
        "command_name": "set_output",
        "telemetry_state_key": "led_builtin",
        "is_bindable": True,
        "config_json": {
            "active_high": True,
            "unit": "bool",
            "widget_hint": "toggle",
        },
    },
    {
        "capability_key": "relay_1",
        "capability_type": "digital_output",
        "label": "Relay 1 / LED 1",
        "gpio_pin": 2,
        "channel": "relay_1",
        "command_name": "set_output",
        "telemetry_state_key": "relay_1",
        "is_bindable": True,
        "config_json": {
            "params_schema": {
                "type": "object",
                "required": ["target", "value"],
                "properties": {
                    "target": {"type": "string", "enum": ["relay_1"]},
                    "value": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "capability_key": "relay_2",
        "capability_type": "digital_output",
        "label": "Relay 2 / LED 2",
        "gpio_pin": 4,
        "channel": "relay_2",
        "command_name": "set_output",
        "telemetry_state_key": "relay_2",
        "is_bindable": True,
        "config_json": {
            "params_schema": {
                "type": "object",
                "required": ["target", "value"],
                "properties": {
                    "target": {"type": "string", "enum": ["relay_2"]},
                    "value": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "capability_key": "custom_gpio_output",
        "capability_type": "digital_output",
        "label": "Custom GPIO Output",
        "gpio_pin": None,
        "channel": None,
        "command_name": "set_output",
        "telemetry_state_key": None,
        "is_bindable": True,
        "config_json": {
            "supports_runtime_gpio": True,
            "widget_hint": "toggle",
        },
    },
    {
        "capability_key": "sensor_temperature",
        "capability_type": "sensor_temperature",
        "label": "Temperature",
        "gpio_pin": None,
        "channel": "temperature",
        "command_name": "request_telemetry",
        "telemetry_state_key": "temperature",
        "is_bindable": True,
        "config_json": {},
    },
    {
        "capability_key": "sensor_humidity",
        "capability_type": "sensor_humidity",
        "label": "Humidity",
        "gpio_pin": None,
        "channel": "humidity",
        "command_name": "request_telemetry",
        "telemetry_state_key": "humidity",
        "is_bindable": True,
        "config_json": {},
    },
    {
        "capability_key": "sensor_light",
        "capability_type": "sensor_light",
        "label": "Light",
        "gpio_pin": None,
        "channel": "light",
        "command_name": "request_telemetry",
        "telemetry_state_key": "light",
        "is_bindable": True,
        "config_json": {},
    },
    {
        "capability_key": "sensor_soil_moisture",
        "capability_type": "sensor_soil_moisture",
        "label": "Soil Moisture",
        "gpio_pin": None,
        "channel": "soil_moisture",
        "command_name": "request_telemetry",
        "telemetry_state_key": "soil_moisture",
        "is_bindable": True,
        "config_json": {},
    },
    {
        "capability_key": "system_status",
        "capability_type": "system_status",
        "label": "System Status",
        "gpio_pin": None,
        "channel": "system",
        "command_name": "request_status",
        "telemetry_state_key": "uptime_ms",
        "is_bindable": True,
        "config_json": {},
    },
    {
        "capability_key": "ota_update",
        "capability_type": "ota_update",
        "label": "OTA Update",
        "gpio_pin": None,
        "channel": "ota",
        "command_name": "ota_update",
        "telemetry_state_key": None,
        "is_bindable": False,
        "config_json": {},
    },
]


def list_projects(db: Session, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    projects = db.scalars(
        select(TenantProject)
        .where(TenantProject.tenant_id == tenant_id)
        .order_by(TenantProject.updated_at.desc(), TenantProject.created_at.desc())
    ).all()
    return [
        {
            "id": project.id,
            "tenant_id": project.tenant_id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }
        for project in projects
    ]


def get_project(db: Session, tenant_id: uuid.UUID, project_id: uuid.UUID) -> TenantProject | None:
    stmt = (
        select(TenantProject)
        .options(joinedload(TenantProject.pages).joinedload(ProjectPage.widgets))
        .where(TenantProject.id == project_id, TenantProject.tenant_id == tenant_id)
    )
    return db.scalars(stmt).unique().first()




def create_project(db: Session, tenant_id: uuid.UUID, payload: ProjectCreate) -> TenantProject:
    project = TenantProject(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
    )
    db.add(project)
    db.flush()
    db.add(ProjectPage(project_id=project.id, title="Main", slug="main", sort_order=0))
    db.commit()
    # No additional SELECT; the project already has its ID and fields.
    return project


def update_project(db: Session, project: TenantProject, payload: ProjectUpdate) -> TenantProject:
    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project: TenantProject) -> None:
    db.delete(project)
    db.commit()














def create_page(db: Session, project: TenantProject, payload: PageCreate) -> ProjectPage:
    page = ProjectPage(
        project_id=project.id,
        title=payload.title,
        slug=payload.slug,
        sort_order=payload.sort_order,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return page


def get_page_for_tenant(
    db: Session, tenant_id: uuid.UUID, page_id: uuid.UUID
) -> ProjectPage | None:
    stmt = (
        select(ProjectPage)
        .join(TenantProject, TenantProject.id == ProjectPage.project_id)
        .where(ProjectPage.id == page_id, TenantProject.tenant_id == tenant_id)
    )
    return db.scalar(stmt)


def get_widget_for_tenant(
    db: Session, tenant_id: uuid.UUID, widget_id: uuid.UUID
) -> ProjectWidget | None:
    stmt = (
        select(ProjectWidget)
        .join(ProjectPage, ProjectPage.id == ProjectWidget.page_id)
        .join(TenantProject, TenantProject.id == ProjectPage.project_id)
        .where(ProjectWidget.id == widget_id, TenantProject.tenant_id == tenant_id)
    )
    return db.scalar(stmt)


def create_widget(db: Session, page: ProjectPage, payload: WidgetCreate) -> ProjectWidget:
    if payload.sort_order > 0:
        sort_order = payload.sort_order
    else:
        max_sort_order = db.scalar(
            select(func.max(ProjectWidget.sort_order)).where(ProjectWidget.page_id == page.id)
        )
        if max_sort_order is None:
            sort_order = 0
        elif max_sort_order >= INT32_MAX:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot create more widgets on this page: sort order limit reached",
            )
        else:
            sort_order = int(max_sort_order) + 1

    widget = ProjectWidget(
        page_id=page.id,
        widget_type=payload.widget_type,
        title=payload.title,
        sort_order=sort_order,
        layout=payload.layout,
        config=payload.config,
        binding=payload.binding,
    )
    db.add(widget)
    db.commit()
    db.refresh(widget)
    return widget


def update_widget(db: Session, widget: ProjectWidget, payload: WidgetUpdate) -> ProjectWidget:
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None:
            setattr(widget, key, value)
    db.commit()
    db.refresh(widget)
    return widget


def delete_widget(db: Session, widget: ProjectWidget) -> None:
    db.delete(widget)
    db.commit()


def get_project_id_for_widget(db: Session, widget_id: uuid.UUID) -> uuid.UUID | None:
    """Get the project_id for a given widget."""
    stmt = (
        select(TenantProject.id)
        .join(ProjectPage, ProjectPage.project_id == TenantProject.id)
        .join(ProjectWidget, ProjectWidget.page_id == ProjectPage.id)
        .where(ProjectWidget.id == widget_id)
    )
    return db.scalar(stmt)


def get_tenant_device_by_id_or_uid(
    db: Session,
    tenant_id: uuid.UUID,
    device_id_or_uid: str,
) -> Device | None:
    filters = [Device.device_uid == device_id_or_uid]
    try:
        filters.append(Device.id == uuid.UUID(device_id_or_uid))
    except ValueError:
        pass
    stmt = (
        select(Device)
        .join(TenantDeviceMapping, TenantDeviceMapping.device_id == Device.id)
        .where(TenantDeviceMapping.tenant_id == tenant_id)
        .where(or_(*filters))
    )
    return db.scalar(stmt)


def list_device_capabilities(db: Session, device_id: uuid.UUID) -> list[DeviceCapability]:
    return list(
        db.scalars(
            select(DeviceCapability)
            .where(DeviceCapability.device_id == device_id)
            .order_by(DeviceCapability.capability_type.asc(), DeviceCapability.label.asc())
        ).all()
    )


def list_bindable_device_capabilities(db: Session, device_id: uuid.UUID) -> list[DeviceCapability]:
    return list(
        db.scalars(
            select(DeviceCapability)
            .where(
                DeviceCapability.device_id == device_id,
                DeviceCapability.is_bindable.is_(True),
                or_(
                    DeviceCapability.telemetry_state_key.isnot(None),
                    DeviceCapability.capability_key == CUSTOM_GPIO_CAPABILITY_KEY,
                ),
            )
            .order_by(DeviceCapability.capability_type.asc(), DeviceCapability.label.asc())
        ).all()
    )


def get_device_capability_by_key(
    db: Session,
    device_id: uuid.UUID,
    capability_key: str,
) -> DeviceCapability | None:
    return db.scalar(
        select(DeviceCapability).where(
            DeviceCapability.device_id == device_id,
            DeviceCapability.capability_key == capability_key,
        )
    )


def get_device_capability_by_id(
    db: Session,
    device_id: uuid.UUID,
    capability_id: uuid.UUID,
) -> DeviceCapability | None:
    return db.scalar(
        select(DeviceCapability).where(
            DeviceCapability.device_id == device_id,
            DeviceCapability.id == capability_id,
        )
    )


def get_device_capability_by_command_and_pin(
    db: Session,
    device_id: uuid.UUID,
    command_name: str,
    gpio_pin: int,
) -> DeviceCapability | None:
    return db.scalar(
        select(DeviceCapability).where(
            DeviceCapability.device_id == device_id,
            DeviceCapability.command_name == command_name,
            DeviceCapability.gpio_pin == gpio_pin,
            DeviceCapability.capability_type.in_(ALLOWED_SWITCH_CAPABILITY_TYPES),
        )
    )


def get_device_capability_by_target(
    db: Session,
    device_id: uuid.UUID,
    command_name: str,
    target: str,
) -> DeviceCapability | None:
    return db.scalar(
        select(DeviceCapability).where(
            DeviceCapability.device_id == device_id,
            DeviceCapability.command_name == command_name,
            DeviceCapability.capability_type.in_(ALLOWED_SWITCH_CAPABILITY_TYPES),
            or_(
                DeviceCapability.capability_key == target,
                DeviceCapability.channel == target,
            ),
        )
    )


def upsert_device_capability(
    db: Session,
    *,
    device_id: uuid.UUID,
    tenant_id: uuid.UUID | None,
    capability_key: str,
    capability_type: str,
    label: str,
    gpio_pin: int | None,
    channel: str | None = None,
    command_name: str,
    telemetry_state_key: str | None,
    is_bindable: bool = True,
    config_json: dict[str, Any] | None = None,
) -> DeviceCapability:
    stmt = pg_insert(DeviceCapability).values(
        device_id=device_id,
        tenant_id=tenant_id,
        capability_key=capability_key,
        capability_type=capability_type,
        label=label,
        gpio_pin=gpio_pin,
        channel=channel,
        command_name=command_name,
        telemetry_state_key=telemetry_state_key,
        is_bindable=is_bindable,
        config_json=config_json or {},
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["device_id", "capability_key"],
        set_={
            "tenant_id": stmt.excluded.tenant_id,
            "capability_type": stmt.excluded.capability_type,
            "label": stmt.excluded.label,
            "gpio_pin": stmt.excluded.gpio_pin,
            "channel": stmt.excluded.channel,
            "command_name": stmt.excluded.command_name,
            "telemetry_state_key": stmt.excluded.telemetry_state_key,
            "is_bindable": stmt.excluded.is_bindable,
            "config_json": stmt.excluded.config_json,
        },
    ).returning(DeviceCapability)
    capability = db.scalar(stmt)
    return capability


def ensure_small_project_capabilities(
    db: Session,
    *,
    device_id: uuid.UUID,
    tenant_id: uuid.UUID | None,
) -> None:
    for capability in DEFAULT_DEVICE_CAPABILITIES:
        upsert_device_capability(
            db,
            device_id=device_id,
            tenant_id=tenant_id,
            capability_key=capability["capability_key"],
            capability_type=capability["capability_type"],
            label=capability["label"],
            gpio_pin=capability["gpio_pin"],
            channel=capability["channel"],
            command_name=capability["command_name"],
            telemetry_state_key=capability["telemetry_state_key"],
            is_bindable=capability["is_bindable"],
            config_json=capability["config_json"],
        )
    db.commit()


def validate_params(schema: dict[str, Any], params: dict[str, Any]) -> None:
    required = schema.get("required", [])
    for field in required:
        if field not in params:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing command param '{field}'",
            )

    properties = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        extra = set(params) - set(properties)
        if extra:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported command params: {sorted(extra)}",
            )

    for key, rules in properties.items():
        if key not in params:
            continue
        value = params[key]
        expected_type = rules.get("type")
        if expected_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail=f"Param '{key}' must be boolean"
            )
        if expected_type == "string" and not isinstance(value, str):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Param '{key}' must be string")
        if expected_type == "number" and not isinstance(value, int | float):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Param '{key}' must be number")
        if "enum" in rules and value not in rules["enum"]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Param '{key}' must be one of {rules['enum']}",
            )


def validate_command_for_device(
    db: Session,
    device: Device,
    command: str,
    params: dict[str, Any],
) -> DeviceCapability:
    if command == "virtual_write":
        channel = params.get("channel")
        if not isinstance(channel, str) or not re.fullmatch(
            r"v(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])", channel
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Param 'channel' must be a virtual pin from v0 through v255, such as 'v2'",
            )
        if "value" not in params and "state" not in params:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Param 'value' or 'state' is required",
            )
        return DeviceCapability(
            device_id=device.id,
            tenant_id=None,
            capability_key="virtual_write",
            capability_type="virtual_pin",
            label="Virtual Pin",
            gpio_pin=None,
            channel=channel,
            command_name=command,
            telemetry_state_key=f"ch_{channel}",
            is_bindable=False,
            config_json={},
        )

    if command == "set_output":
        target = params.get("target")
        if not isinstance(target, str) or not target.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Param 'target' is required"
            )
        if not isinstance(params.get("value"), bool):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Param 'value' must be boolean"
            )
        capability = get_device_capability_by_target(db, device.id, command, target.strip())
        if capability is None:
            # Check if a valid gpio_pin is provided for runtime-configurable GPIO
            gpio_pin = params.get("gpio_pin") or params.get("pin")
            if (
                isinstance(gpio_pin, int)
                and ESP32_GPIO_MIN <= gpio_pin <= ESP32_GPIO_MAX
                and gpio_pin not in ESP32_RESERVED_OR_UNSAFE_OUTPUT_PINS
            ):
                # Create ad-hoc capability for custom GPIO
                capability = DeviceCapability(
                    device_id=device.id,
                    tenant_id=None,
                    capability_key=f"gpio_{gpio_pin}",
                    capability_type="digital_output",
                    label=f"GPIO {gpio_pin}",
                    gpio_pin=gpio_pin,
                    channel=f"gpio_{gpio_pin}",
                    command_name="set_output",
                    telemetry_state_key=f"gpio_{gpio_pin}_state",
                    is_bindable=True,
                    config_json={"supports_runtime_gpio": True},
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected output target is not available for this device",
                )
        return capability

    if command == "toggle_output":
        target = params.get("target")
        if not isinstance(target, str) or not target.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Param 'target' is required"
            )
        capability = get_device_capability_by_target(db, device.id, "set_output", target.strip())
        if capability is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected output target is not available for this device",
            )
        return capability

    if command == "set_gpio":
        if "pin" not in params:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Param 'pin' is required"
            )
        try:
            pin = int(params["pin"])
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Param 'pin' must be an integer"
            ) from exc
        capability = get_device_capability_by_command_and_pin(db, device.id, command, pin)
        if capability is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected GPIO pin is not available for this device",
            )
        if not isinstance(params.get("state"), bool):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Param 'state' must be boolean for digital_output",
            )
        return capability

    if command in {"request_status", "request_telemetry", "reboot", "ota_update"}:
        return DeviceCapability(
            device_id=device.id,
            tenant_id=None,
            capability_key=command,
            capability_type="system_status",
            label=command,
            gpio_pin=None,
            channel=None,
            command_name=command,
            telemetry_state_key=None,
            is_bindable=False,
            config_json={},
        )

    capabilities = list(
        db.scalars(
            select(DeviceCapability).where(
                DeviceCapability.device_id == device.id,
                DeviceCapability.command_name == command,
            )
        ).all()
    )
    if not capabilities:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Command is not supported by this device",
        )

    schema = (
        capabilities[0].config_json.get("params_schema")
        if isinstance(capabilities[0].config_json, dict)
        else None
    )
    if isinstance(schema, dict):
        validate_params(schema, params)
    return capabilities[0]


def _validate_virtual_command_context(
    db: Session,
    device: Device,
    channel: str,
    params: dict[str, Any],
    tenant_id: uuid.UUID | None,
) -> None:
    """Validate optional dashboard context without changing legacy device commands."""
    context_keys = {"project_id", "datastream_id", "widget_id"}
    if not context_keys.intersection(params):
        return
    if tenant_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Tenant context is required")

    try:
        project_id = uuid.UUID(str(params["project_id"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Param 'project_id' must be UUID when virtual command context is supplied",
        ) from exc
    project = get_project(db, tenant_id, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")

    datastream = None
    if "datastream_id" in params:
        try:
            datastream_id = uuid.UUID(str(params["datastream_id"]))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Param 'datastream_id' must be UUID"
            ) from exc
        datastream = db.scalar(
            select(TenantDatastream).where(
                TenantDatastream.id == datastream_id,
                TenantDatastream.tenant_id == tenant_id,
                TenantDatastream.project_id == project_id,
            )
        )
        if datastream is None or channel != f"v{datastream.pin}":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Virtual channel is not authorized by the selected datastream",
            )
        if datastream.direction not in {"command", "bidirectional"}:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Selected datastream does not accept commands",
            )
        compats = db.scalars(
            select(DatastreamTemplateCompatibility.device_model_id).where(
                DatastreamTemplateCompatibility.datastream_id == datastream_id
            )
        ).all()
        if compats:
            if device.device_model_id and device.device_model_id not in compats:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail="This device's model is not compatible with the selected datastream",
                )
        _validate_virtual_value(datastream, params.get("value", params.get("state")))
        _validate_manifest_virtual_channel(device, channel)

    if "widget_id" not in params:
        return
    try:
        widget_id = uuid.UUID(str(params["widget_id"]))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Param 'widget_id' must be UUID"
        ) from exc
    widget = db.scalar(
        select(ProjectWidget)
        .join(ProjectPage, ProjectWidget.page_id == ProjectPage.id)
        .where(ProjectWidget.id == widget_id, ProjectPage.project_id == project_id)
    )
    if widget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Widget not found")
    binding = widget.binding if isinstance(widget.binding, dict) else None
    bound_device = str(binding.get("device_id") or binding.get("device_uid") or "")
    if bound_device not in {str(device.id), device.device_uid}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Widget is not bound to this device")
    if binding.get("binding_type") != "virtual" or binding.get("channel") != channel:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Widget is not bound to this virtual channel"
        )
    if datastream is not None and binding.get("datastream_id") != str(datastream.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Widget is not bound to this datastream"
        )








def validate_binding(
    db: Session,
    tenant_id: uuid.UUID,
    widget_type: str,
    binding: dict[str, Any],
    *,
    project_id: uuid.UUID | None = None,
    exclude_widget_id: uuid.UUID | None = None,
) -> None:
    """Validate that the widget binding configuration is correct and user has permissions.

    This function does NOT modify the binding dictionary.
    """
    device_ref = binding.get("device_id") or binding.get("device_uid")
    canonical_type = widget_registry.canonical_widget_type(widget_type)
    requires_device = widget_registry.widget_requires_device(canonical_type)

    if not device_ref:
        if not requires_device:
            # Static widgets must not accidentally retain a device/datastream
            # binding when an editor changes type.
            if any(
                binding.get(key) not in (None, "", [], {})
                for key in (
                    "device_id",
                    "device_uid",
                    "datastream_id",
                    "datastream_ids",
                    "capability_id",
                    "capability_key",
                )
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Static widgets cannot have a device or datastream binding",
                )
            return

        # Allow completely empty or unbound bindings (draft / template widgets)
        has_any_binding_field = any(v not in (None, "", [], {}) for v in binding.values())
        if not has_any_binding_field:
            return

        device_ref = binding.get("device_id") or binding.get("device_uid")
        if not device_ref:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A device is required before saving this widget binding",
            )

    if not requires_device:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Static widgets cannot have a device or datastream binding",
        )

    binding_type = str(binding.get("binding_type") or "").strip().lower()
    inferred_virtual = bool(binding.get("datastream_id") or binding.get("datastream_ids"))
    if widget_registry.widget_requires_virtual_binding(canonical_type) and not (
        binding_type == "virtual" or (not binding_type and inferred_virtual)
    ):
        detail = (
            "multi_telemetry_chart only supports Virtual Datastream bindings"
            if canonical_type == "multi_telemetry_chart"
            else "Numeric control widgets only support Virtual Datastream bindings"
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    # A binding can carry a device id while still being incomplete.  The
    # subsequent branches provide the more specific datastream/capability
    # error; this guard only handles the empty object case.
    if not binding:
        return

    device = get_tenant_device_by_id_or_uid(db, tenant_id, str(device_ref))
    if device is None or device.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    if (
        project_id is not None
        and device.project_id != project_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected device does not belong to this project",
        )

    # 1. Virtual Pin / Datastream Path
    if canonical_type == "multi_telemetry_chart":
        datastream_ids_raw = binding.get("datastream_ids")
        if not datastream_ids_raw or not isinstance(datastream_ids_raw, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid widget binding: datastream_ids must be a non-empty list of UUIDs",
            )

        for ds_id_raw in datastream_ids_raw:
            if project_id is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="project_id is required for validating virtual datastream",
                )
            try:
                datastream_id = uuid.UUID(str(ds_id_raw))
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid widget binding: datastream_ids must contain valid UUIDs",
                ) from exc

            # Enforce project scoping strictly
            ds = db.scalar(
                select(TenantDatastream).where(
                    TenantDatastream.id == datastream_id,
                    TenantDatastream.tenant_id == tenant_id,
                    TenantDatastream.project_id == project_id,
                )
            )
            if ds is None or ds.status != "active":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Selected datastream '{ds_id_raw}' is not available for this project",
                )

            try:
                widget_registry.validate_datastream_compatibility(
                    canonical_type, ds.data_type, ds.direction
                )
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(exc),
                ) from exc
            compats = db.scalars(
                select(DatastreamTemplateCompatibility.device_model_id).where(
                    DatastreamTemplateCompatibility.datastream_id == datastream_id
                )
            ).all()
            if compats:
                if device.device_model_id and device.device_model_id not in compats:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="This device's model is not compatible with one of the selected datastreams",
                    )
            _validate_manifest_virtual_channel(device, f"v{ds.pin}")
        return

    datastream_id_raw = binding.get("datastream_id")
    if datastream_id_raw:
        if project_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="project_id is required for validating virtual datastream",
            )
        try:
            datastream_id = uuid.UUID(str(datastream_id_raw))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid widget binding: datastream_id must be UUID",
            ) from exc

        # Enforce project scoping strictly
        ds = db.scalar(
            select(TenantDatastream).where(
                TenantDatastream.id == datastream_id,
                TenantDatastream.tenant_id == tenant_id,
                TenantDatastream.project_id == project_id,
            )
        )
        if ds is None or ds.status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected datastream is not available for this project",
            )
        try:
            widget_registry.validate_datastream_compatibility(
                canonical_type, ds.data_type, ds.direction
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        compats = db.scalars(
            select(DatastreamTemplateCompatibility.device_model_id).where(
                DatastreamTemplateCompatibility.datastream_id == datastream_id
            )
        ).all()
        if compats:
            if device.device_model_id and device.device_model_id not in compats:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This device's model is not compatible with the selected datastream",
                )
        _validate_manifest_virtual_channel(device, f"v{ds.pin}")
        return

    if (
        binding.get("binding_type") == "virtual" or binding.get("command") == "virtual_write"
    ) and device_ref:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Virtual widget binding is missing datastream_id",
        )

    # 2. Hardware Capability / GPIO Validation Path
    is_command_widget = widget_registry.is_command_widget(canonical_type)
    requires_feedback = widget_registry.widget_requires_feedback(canonical_type)
    capability_key = str(binding.get("capability_key") or "").strip()

    if is_command_widget and not capability_key:
        if not list_device_capabilities(db, device.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This device has no command capabilities configured",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid widget binding: capability_key is required",
        )
    if not capability_key:
        return

    capability = get_device_capability_by_key(db, device.id, capability_key)
    is_custom_gpio = capability_key == CUSTOM_GPIO_CAPABILITY_KEY

    if capability is None and not is_custom_gpio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Selected capability is not available for this device")

    # For custom_gpio_output, create a virtual capability object
    if is_custom_gpio and capability is None:
        capability = DeviceCapability(
            device_id=device.id,
            tenant_id=tenant_id,
            capability_key=CUSTOM_GPIO_CAPABILITY_KEY,
            capability_type="digital_output",
            label="Custom GPIO Output",
            gpio_pin=None,
            channel=None,
            command_name="set_output",
            telemetry_state_key=None,
            is_bindable=True,
            config_json={"supports_runtime_gpio": True},
        )

    if not capability.is_bindable:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Selected capability cannot be bound to a widget")

    if not is_custom_gpio:
        capability_id_raw = binding.get("capability_id")
        if capability_id_raw:
            try:
                capability_id = uuid.UUID(str(capability_id_raw))
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid widget binding: capability_id must be UUID",
                ) from exc
            by_id = get_device_capability_by_id(db, device.id, capability_id)
            if by_id is None or by_id.capability_key != capability.capability_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid widget binding: capability_id does not match selected capability",
                )

    if (
        canonical_type in {"toggle_switch", "push_button", "momentary_button"}
        and capability.capability_type not in ALLOWED_SWITCH_CAPABILITY_TYPES
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid widget binding: selected capability is not supported for this widget",
        )

    requested_type = binding.get("capability_type")
    if requested_type and str(requested_type) != capability.capability_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid widget binding: capability_type mismatch",
        )

    command = str(binding.get("command") or capability.command_name or "").strip()
    if not command:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid widget binding: command is required",
        )

    allowed_commands = {capability.command_name}
    if capability.command_name == "set_output":
        allowed_commands.add("toggle_output")
    if is_command_widget and command not in allowed_commands:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Widget command does not match selected capability")

    requested_pin = binding.get("gpio_pin")
    allow_gpio_override = is_custom_gpio or bool(
        isinstance(capability.config_json, dict)
        and capability.config_json.get("allow_gpio_override")
    )

    if is_custom_gpio:
        if requested_pin is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="GPIO pin is required for custom GPIO output widget",
            )
        try:
            normalized_pin = int(requested_pin)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid widget binding: gpio_pin must be an integer",
            ) from exc
    elif capability.gpio_pin is not None or requested_pin is not None:
        try:
            normalized_pin = int(capability.gpio_pin if requested_pin is None else requested_pin)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid widget binding: gpio_pin must be an integer",
            ) from exc
    else:
        normalized_pin = None

    if normalized_pin is not None:
        if not (ESP32_GPIO_MIN <= normalized_pin <= ESP32_GPIO_MAX):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Selected GPIO pin must be in range {ESP32_GPIO_MIN}-{ESP32_GPIO_MAX}",
            )

        if normalized_pin in ESP32_RESERVED_OR_UNSAFE_OUTPUT_PINS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Selected GPIO pin {normalized_pin} is reserved/unsafe for output",
            )

        if (
            not is_custom_gpio
            and capability.gpio_pin is not None
            and normalized_pin != capability.gpio_pin
            and not allow_gpio_override
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected GPIO pin is not available for this device",
            )

    state_key = str(binding.get("state_key") or capability.telemetry_state_key or "").strip()
    if requires_feedback and not state_key and not is_custom_gpio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected capability is incomplete: telemetry_state_key is missing",
        )


def validate_widget_binding(
    db: Session,
    tenant_id: uuid.UUID,
    widget_type: str,
    binding: dict[str, Any],
    *,
    project_id: uuid.UUID | None = None,
    exclude_widget_id: uuid.UUID | None = None,
) -> None:
    """Validate and resolve widget binding.

    DEPRECATED: In-place mutation of binding in validate_widget_binding is deprecated.
    Future refactoring should migrate all callers to use resolve_binding() directly
    and treat widget bindings as immutable objects.
    """
    validate_binding(
        db,
        tenant_id,
        widget_type,
        binding,
        project_id=project_id,
        exclude_widget_id=exclude_widget_id,
    )
    resolved = resolve_binding(
        db,
        tenant_id,
        project_id,
        widget_type,
        binding,
    )
    binding.clear()
    binding.update(resolved)


def resolve_binding(
    db: Session,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID | None,
    widget_type: str,
    binding: dict[str, Any],
) -> dict[str, Any]:
    """Resolve the final widget binding configuration with state keys and params.

    This function returns a new resolved dictionary.
    """
    canonical_type = widget_registry.canonical_widget_type(widget_type)
    device_ref = binding.get("device_id") or binding.get("device_uid")
    if not device_ref:
        return dict(binding)

    device = get_tenant_device_by_id_or_uid(db, tenant_id, str(device_ref))
    if device is None or device.tenant_id != tenant_id:
        return {}

    if (
        project_id is not None
        and device.project_id != project_id
    ):
        return {}

    resolved = {**binding}
    resolved["device_id"] = str(device.id)
    resolved["device_uid"] = device.device_uid

    # 1. Virtual Pin / Datastream Path
    if canonical_type == "multi_telemetry_chart":
        resolved = {**binding}
        resolved["device_id"] = str(device.id)
        resolved["device_uid"] = device.device_uid
        resolved["binding_type"] = "virtual"
        return resolved

    datastream_id_raw = binding.get("datastream_id")
    if datastream_id_raw:
        ds_id = uuid.UUID(str(datastream_id_raw))
        stmt = select(TenantDatastream).where(
            TenantDatastream.id == ds_id,
            TenantDatastream.tenant_id == tenant_id,
        )
        if project_id:
            stmt = stmt.where(TenantDatastream.project_id == project_id)
        datastream = db.scalar(stmt)
        if datastream:
            pin_str = f"v{datastream.pin}"
            # Preserve extension fields owned by Web/future clients. Resolution
            # canonicalizes only the source-owned keys instead of rebuilding the
            # whole JSON document and silently erasing unknown metadata.
            resolved.update(
                {
                    "device_id": str(device.id),
                    "device_uid": device.device_uid,
                    "datastream_id": str(datastream.id),
                    "binding_type": "virtual",
                    "channel": pin_str,
                    "state_key": f"ch_{pin_str}",
                    "telemetry_field": f"ch_{pin_str}",
                    "feedback_key": f"ch_{pin_str}",
                }
            )
            for hardware_key in ("capability_id", "capability_key", "capability_type", "gpio_pin"):
                resolved.pop(hardware_key, None)
            if widget_registry.is_command_widget(canonical_type):
                resolved["command"] = "virtual_write"
                params = dict(binding.get("params") or {})
                params["channel"] = pin_str
                params.setdefault("value", None)
                params.setdefault("state", None)
                resolved["params"] = params
            return resolved

    # 2. Hardware Capability / GPIO Path
    is_command_widget = widget_registry.is_command_widget(canonical_type)
    capability_key = str(binding.get("capability_key") or "").strip()
    if not capability_key:
        return resolved

    capability = get_device_capability_by_key(db, device.id, capability_key)
    is_custom_gpio = capability_key == CUSTOM_GPIO_CAPABILITY_KEY

    if is_custom_gpio and capability is None:
        capability = DeviceCapability(
            device_id=device.id,
            tenant_id=tenant_id,
            capability_key=CUSTOM_GPIO_CAPABILITY_KEY,
            capability_type="digital_output",
            label="Custom GPIO Output",
            gpio_pin=None,
            channel=None,
            command_name="set_output",
            telemetry_state_key=None,
            is_bindable=True,
            config_json={"supports_runtime_gpio": True},
        )
    elif capability is None:
        if not is_command_widget:
            resolved["binding_type"] = "physical"
            return resolved
        return resolved

    requested_pin = binding.get("gpio_pin")
    if is_custom_gpio:
        normalized_pin = int(requested_pin) if requested_pin is not None else None
    elif capability.gpio_pin is not None or requested_pin is not None:
        normalized_pin = int(capability.gpio_pin if requested_pin is None else requested_pin)
    else:
        normalized_pin = None

    if normalized_pin is not None:
        resolved["gpio_pin"] = normalized_pin

    if is_custom_gpio and normalized_pin is not None:
        resolved["channel"] = f"gpio_{normalized_pin}"
        resolved["state_key"] = f"gpio_{normalized_pin}_state"
        resolved["telemetry_field"] = f"gpio_{normalized_pin}_state"

    state_key = str(binding.get("state_key") or capability.telemetry_state_key or "").strip()
    resolved["capability_key"] = capability.capability_key
    if not is_custom_gpio and capability.id is not None:
        resolved["capability_id"] = str(capability.id)
    resolved["capability_type"] = capability.capability_type

    command = str(binding.get("command") or capability.command_name)
    resolved["command"] = command
    resolved["binding_type"] = "hardware"
    resolved.pop("datastream_id", None)

    if capability.channel:
        resolved["channel"] = capability.channel
    if state_key:
        resolved["state_key"] = state_key
        resolved["telemetry_field"] = binding.get("telemetry_field") or state_key

    if is_command_widget:
        if command == "set_gpio":
            pin_for_cmd = normalized_pin if normalized_pin is not None else capability.gpio_pin
            if pin_for_cmd is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid widget binding: capability has no gpio_pin",
                )
            resolved["params"] = {"pin": pin_for_cmd, "state": False}
        elif command == "set_output":
            target = capability.capability_key
            if is_custom_gpio and normalized_pin is not None:
                target = f"gpio_{normalized_pin}"
            elif capability.channel:
                target = capability.channel
            params: dict[str, Any] = {"target": target, "value": False}
            if normalized_pin is not None:
                params["gpio_pin"] = normalized_pin
                params["pin"] = normalized_pin
            resolved["params"] = params
        elif command == "toggle_output":
            target = capability.capability_key
            if is_custom_gpio and normalized_pin is not None:
                target = f"gpio_{normalized_pin}"
            elif capability.channel:
                target = capability.channel
            params = {"target": target}
            if normalized_pin is not None:
                params["gpio_pin"] = normalized_pin
                params["pin"] = normalized_pin
            resolved["params"] = params
        elif capability.channel:
            resolved["params"] = {"channel": capability.channel, "state": False}
        elif "params" not in resolved:
            resolved["params"] = {}

    return resolved


def _validate_virtual_value(datastream: TenantDatastream, value: Any) -> None:
    if datastream.data_type == "boolean" and not isinstance(value, bool):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Datastream value must be boolean")
    if datastream.data_type == "integer" and (
        not isinstance(value, int) or isinstance(value, bool)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Datastream value must be an integer"
        )
    if datastream.data_type == "double" and (
        not isinstance(value, int | float) or isinstance(value, bool)
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Datastream value must be numeric")
    if datastream.data_type == "string" and not isinstance(value, str):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Datastream value must be a string")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if datastream.min_value is not None and value < datastream.min_value:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Datastream value is below min_value"
            )
        if datastream.max_value is not None and value > datastream.max_value:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Datastream value is above max_value"
            )


def _validate_manifest_virtual_channel(device: Device, channel: str) -> None:
    """Enforce a device-advertised manifest only when a valid list is present."""
    payload = getattr(device, "last_status_payload", None)
    if not isinstance(payload, dict):
        return
    manifest = payload.get("capabilities") or payload.get("capability_manifest")
    if isinstance(manifest, dict):
        manifest = manifest.get("virtual_channels") or manifest.get("channels")
    if not isinstance(manifest, list):
        return
    channels = {
        str(item.get("channel"))
        for item in manifest
        if isinstance(item, dict) and item.get("channel") is not None
    } | {item for item in manifest if isinstance(item, str)}
    if channels and channel not in channels:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Virtual channel is not advertised by this device",
        )














def list_device_project_bindings(
    db: Session,
    tenant_id: uuid.UUID,
    device: Device,
) -> list[dict[str, Any]]:
    if device.project_id is None:
        return []
    project = get_project(db, tenant_id, device.project_id)
    if project is None:
        return []
    return [{"project_id": project.id, "project_name": project.name}]


def list_project_device_bindings(
    db: Session,
    tenant_id: uuid.UUID,
    project: TenantProject,
) -> list[dict[str, Any]]:
    from app.modules.tenants import repository as tenant_repository

    devices = tenant_repository.list_tenant_devices(db, tenant_id, project_id=project.id)
    latest_state = build_latest_state(db, project)
    return [
        {"device": device, "latest_state": latest_state.get(str(device.id), {})}
        for device in devices
    ]


def build_latest_state(db: Session, project: TenantProject) -> dict[str, dict[str, Any]]:
    from app.modules.tenants import repository as tenant_repository

    devices = tenant_repository.list_tenant_devices(db, project.tenant_id, project_id=project.id)
    state: dict[str, dict[str, Any]] = {}
    for device in devices:
        values: dict[str, Any] = {}
        for record in telemetry_repo.latest_telemetry_by_device_uid(db, device.device_uid):
            if isinstance(record.raw_payload, dict):
                values.update(record.raw_payload)
            typed_value = getattr(record, "metric_value_json", None)
            values[record.metric_name] = (
                typed_value if typed_value is not None else record.metric_value
            )
            values["ts"] = record.timestamp.isoformat()
        state[str(device.id)] = values
    return state


# ─── Datastream (Virtual Pin) Repository ──────────────────────────────────────


def _slugify(text: str) -> str:
    """Tạo alias từ name: lowercase, thay khoảng trắng/ký tự đặc biệt bằng '_'."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"[\s_]+", "_", text)
    return text[:255]


def list_datastreams(
    db: Session,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    search: str | None = None,
    data_type: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> dict:
    """Trả về danh sách Datastreams của tenant kèm thông tin phân trang và danh sách pin đã dùng."""
    q = select(TenantDatastream).where(
        TenantDatastream.tenant_id == tenant_id,
        TenantDatastream.project_id == project_id,
    )
    if search:
        like = f"%{search}%"
        q = q.where(
            or_(
                TenantDatastream.name.ilike(like),
                TenantDatastream.alias.ilike(like),
            )
        )
    if data_type:
        q = q.where(TenantDatastream.data_type == data_type)

    total = db.scalar(select(func.count()).select_from(q.subquery()))
    items = db.scalars(q.order_by(TenantDatastream.pin).offset(skip).limit(limit)).all()
    used_pins = db.scalars(
        select(TenantDatastream.pin).where(
            TenantDatastream.tenant_id == tenant_id,
            TenantDatastream.project_id == project_id,
        )
    ).all()

    # Bulk load supported_model_ids
    ds_ids = [ds.id for ds in items]
    compat_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    if ds_ids:
        compats = db.execute(
            select(
                DatastreamTemplateCompatibility.datastream_id,
                DatastreamTemplateCompatibility.device_model_id,
            ).where(DatastreamTemplateCompatibility.datastream_id.in_(ds_ids))
        ).all()
        for ds_id, model_id in compats:
            compat_map.setdefault(ds_id, []).append(model_id)

    for ds in items:
        ds.supported_model_ids = compat_map.get(ds.id, [])

    return {"items": list(items), "total": total or 0, "used_pins": sorted(used_pins)}


def get_datastream(db: Session, tenant_id: uuid.UUID, datastream_id: uuid.UUID) -> TenantDatastream:
    ds = db.scalar(
        select(TenantDatastream).where(
            TenantDatastream.id == datastream_id,
            TenantDatastream.tenant_id == tenant_id,
        )
    )
    if not ds:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Datastream not found")

    # Load supported_model_ids
    compats = db.scalars(
        select(DatastreamTemplateCompatibility.device_model_id).where(
            DatastreamTemplateCompatibility.datastream_id == datastream_id
        )
    ).all()
    ds.supported_model_ids = list(compats)
    return ds


def create_datastream(
    db: Session,
    tenant_id: uuid.UUID,
    payload,  # DatastreamCreate
) -> TenantDatastream:
    # Kiểm tra pin đã được dùng chưa
    existing = db.scalar(
        select(TenantDatastream).where(
            TenantDatastream.project_id == payload.project_id,
            TenantDatastream.pin == payload.pin,
        )
    )
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Virtual pin V{payload.pin} is already in use",
        )

    alias = payload.alias if payload.alias else _slugify(payload.name)
    ds = TenantDatastream(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=payload.project_id,
        name=payload.name,
        alias=alias,
        pin=payload.pin,
        data_type=payload.data_type,
        direction=payload.direction,
        unit=payload.unit,
        min_value=payload.min_value,
        max_value=payload.max_value,
        default_value=payload.default_value,
        description=payload.description,
        is_custom=payload.is_custom,
        status=payload.status,
    )
    db.add(ds)
    db.commit()

    # Add compatibilities
    for model_id in getattr(payload, "supported_model_ids", []):
        compat = DatastreamTemplateCompatibility(
            id=uuid.uuid4(),
            datastream_id=ds.id,
            device_model_id=model_id,
            channel=f"v{ds.pin}",
        )
        db.add(compat)
    db.commit()
    db.refresh(ds)

    # Attach supported_model_ids for Pydantic schema serialization
    ds.supported_model_ids = getattr(payload, "supported_model_ids", [])
    return ds


def update_datastream(
    db: Session,
    tenant_id: uuid.UUID,
    datastream_id: uuid.UUID,
    payload,  # DatastreamUpdate
) -> TenantDatastream:
    ds = get_datastream(db, tenant_id, datastream_id)
    data = payload.model_dump(exclude_unset=True)
    merged = {
        "data_type": data.get("data_type", ds.data_type),
        "min_value": data.get("min_value", ds.min_value),
        "max_value": data.get("max_value", ds.max_value),
        "default_value": data.get("default_value", ds.default_value),
    }
    # Reuse create-contract validation for partial updates against persisted values.
    from app.bounded_contexts.project_dashboard.presentation.schemas import DatastreamCreate

    DatastreamCreate(
        project_id=ds.project_id,
        name=ds.name,
        pin=ds.pin,
        direction=data.get("direction", ds.direction),
        is_custom=data.get("is_custom", ds.is_custom),
        status=data.get("status", ds.status),
        **merged,
    )

    if "supported_model_ids" in data:
        # Delete old compatibilities
        db.execute(
            delete(DatastreamTemplateCompatibility).where(
                DatastreamTemplateCompatibility.datastream_id == ds.id
            )
        )
        # Add new compatibilities
        for model_id in data["supported_model_ids"]:
            compat = DatastreamTemplateCompatibility(
                id=uuid.uuid4(),
                datastream_id=ds.id,
                device_model_id=model_id,
                channel=f"v{ds.pin}",
            )
            db.add(compat)

    for field, value in data.items():
        if field != "supported_model_ids":
            setattr(ds, field, value)

    db.commit()
    db.refresh(ds)

    # Attach updated supported_model_ids
    compats = db.scalars(
        select(DatastreamTemplateCompatibility.device_model_id).where(
            DatastreamTemplateCompatibility.datastream_id == ds.id
        )
    ).all()
    ds.supported_model_ids = list(compats)
    return ds


def delete_datastream(
    db: Session,
    tenant_id: uuid.UUID,
    datastream_id: uuid.UUID,
) -> dict:
    """Delete a tenant datastream after its ownership has been verified."""
    ds = get_datastream(db, tenant_id, datastream_id)
    ds_id_str = str(datastream_id)

    db.delete(ds)
    db.commit()
    return {"deleted": True, "id": ds_id_str}
