from fastapi import APIRouter

from app.shared.presentation.audit_router import router as audit_router
from app.bounded_contexts.identity.presentation.router import router as auth_router
from app.bounded_contexts.identity.presentation.mqtt_webhook_router import (
    router as mqtt_webhook_router,
)
from app.bounded_contexts.identity.presentation.admin_users_router import (
    router as admin_users_router,
)
from app.shared.presentation.debug_router import router as debug_router
from app.shared.presentation.system_health_router import router as system_health_router
from app.bounded_contexts.device_registry.presentation.router import router as devices_router
from app.bounded_contexts.device_registry.presentation.admin_operations_router import (
    router as admin_device_operations_router,
)
from app.bounded_contexts.device_registry.presentation.router_device_types import (
    router as device_types_router,
)
from app.bounded_contexts.device_registry.presentation.router_platforms import (
    caps_router as capability_templates_router,
    client_router as client_platforms_router,
    models_router as device_models_router,
    router as platforms_router,
)
from app.bounded_contexts.firmware_ota.presentation.router_firmware import router as firmware_router
from app.bounded_contexts.firmware_ota.presentation.router_firmware_admin import (
    router as firmware_admin_router,
)
from app.bounded_contexts.firmware_ota.presentation.router_ota import router as ota_router
from app.bounded_contexts.firmware_ota.presentation.router_campaigns import (
    router as ota_campaigns_router,
)
from app.bounded_contexts.project_dashboard.presentation.router import router as projects_router
from app.bounded_contexts.telemetry.presentation.router import router as telemetry_router
from app.bounded_contexts.telemetry.presentation.admin_alerts_router import (
    router as admin_alerts_router,
)
from app.bounded_contexts.tenant_management.presentation.router_admin import (
    router as admin_tenant_router,
)
from app.bounded_contexts.tenant_management.presentation.router_client import (
    router as client_router,
)
from app.bounded_contexts.device_groups.presentation.router import (
    device_router as device_groups_device_router,
    router as device_groups_router,
)
from app.bounded_contexts.device_groups.presentation.admin_router import (
    router as admin_device_groups_router,
)
from app.bounded_contexts.device_provisioning.presentation.router import (
    router as provisioning_router,
)
from app.bounded_contexts.device_provisioning.presentation.admin_router import (
    router as admin_provisioning_router,
)
from app.bounded_contexts.command_center.presentation.router import (
    router as command_center_router,
)
from app.bounded_contexts.command_center.presentation.admin_router import (
    router as admin_command_center_router,
)
from app.bounded_contexts.rule_engine.presentation.router import (
    router as rule_engine_router,
)
from app.shared.presentation.settings_router import router as admin_settings_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(mqtt_webhook_router, prefix="/mqtt", tags=["mqtt-webhooks"])
api_router.include_router(admin_users_router)
api_router.include_router(devices_router, prefix="/devices", tags=["devices"])
api_router.include_router(admin_device_operations_router)
api_router.include_router(device_types_router, prefix="/admin/device-types", tags=["admin"])
api_router.include_router(platforms_router, prefix="/admin/platforms", tags=["admin-platforms"])
api_router.include_router(
    device_models_router, prefix="/admin/device-models", tags=["admin-device-models"]
)
api_router.include_router(
    capability_templates_router,
    prefix="/admin/capability-templates",
    tags=["admin-capability-templates"],
)
api_router.include_router(telemetry_router, prefix="/telemetry", tags=["telemetry"])
api_router.include_router(admin_alerts_router, prefix="/admin/alerts", tags=["admin-alerts"])
api_router.include_router(firmware_router, prefix="/firmware", tags=["firmware"])
api_router.include_router(firmware_admin_router)
api_router.include_router(ota_router, prefix="/ota", tags=["ota"])
api_router.include_router(ota_campaigns_router)
api_router.include_router(admin_tenant_router, prefix="/admin", tags=["admin"])
api_router.include_router(audit_router, prefix="/admin/audit-logs", tags=["admin"])
api_router.include_router(client_router, prefix="/client", tags=["client"])
api_router.include_router(client_platforms_router, prefix="/client", tags=["client-platforms"])
api_router.include_router(projects_router, prefix="/client", tags=["client-projects"])
api_router.include_router(device_groups_router, tags=["device-groups"])
api_router.include_router(device_groups_device_router, tags=["device-groups"])
api_router.include_router(admin_device_groups_router, tags=["admin"])
api_router.include_router(provisioning_router, tags=["provisioning"])
api_router.include_router(admin_provisioning_router, tags=["admin"])
api_router.include_router(command_center_router, tags=["command-center"])
api_router.include_router(admin_command_center_router, tags=["admin"])
api_router.include_router(rule_engine_router, tags=["rule-engine"])
api_router.include_router(admin_settings_router)
api_router.include_router(debug_router, prefix="/debug", tags=["debug"])
api_router.include_router(system_health_router, prefix="/debug", tags=["observability"])
