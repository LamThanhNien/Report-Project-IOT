"""Project Dashboard domain entities.

Re-exports ORM models from the legacy projects module.
"""

from app.modules.projects.model import (
    DeviceCapability,
    ProjectPage,
    ProjectWidget,
    TenantProject,
)

__all__ = [
    "TenantProject",
    "ProjectPage",
    "ProjectWidget",
    "DeviceCapability",
]
