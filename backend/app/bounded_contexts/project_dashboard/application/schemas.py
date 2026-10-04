"""Project Dashboard application schemas.

Re-exports Pydantic schemas from legacy projects module.
"""

from app.modules.projects.schema import (
    AdminTenantProjectReadOnlyRead,
    DeviceActivityItemRead,
    DeviceCapabilityRead,
    DeviceCommandRequest,
    DeviceCommandResponse,
    DeviceLiveStatusRead,
    DeviceProjectBindingRead,
    ProjectAccessPolicyRead,
    ProjectCreate,
    ProjectDeviceSummaryRead,
    ProjectUpdate,
    TenantDeviceDetailRead,
    TenantProjectDetail,
    TenantProjectRead,
    TenantProjectSummary,
)

__all__ = [
    "AdminTenantProjectReadOnlyRead",
    "DeviceActivityItemRead",
    "DeviceCapabilityRead",
    "DeviceCommandRequest",
    "DeviceCommandResponse",
    "DeviceLiveStatusRead",
    "DeviceProjectBindingRead",
    "ProjectAccessPolicyRead",
    "ProjectCreate",
    "ProjectDeviceSummaryRead",
    "ProjectUpdate",
    "TenantDeviceDetailRead",
    "TenantProjectDetail",
    "TenantProjectRead",
    "TenantProjectSummary",
]
