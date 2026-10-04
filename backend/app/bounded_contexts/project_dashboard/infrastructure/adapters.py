"""Project Dashboard infrastructure adapters.

Wraps the legacy projects.repository module through a clean interface.
All heavy lifting (widget binding validation, GPIO pin resolution,
capability management) remains in the legacy module.
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.modules.projects import repository
from app.modules.projects.model import DeviceCapability, TenantProject
from app.modules.projects.schema import (
    ProjectCreate,
    ProjectUpdate,
)


class ProjectRepositoryAdapter:
    """Adapter wrapping modules.projects.repository."""

    # ── Project CRUD ──────────────────────────────────────────────────────

    @staticmethod
    def list_projects(db: Session, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return repository.list_projects(db, tenant_id)

    @staticmethod
    def get_project(
        db: Session, tenant_id: uuid.UUID, project_id: uuid.UUID
    ) -> TenantProject | None:
        return repository.get_project(db, tenant_id, project_id)


    @staticmethod
    def create_project(db: Session, tenant_id: uuid.UUID, payload: ProjectCreate) -> TenantProject:
        return repository.create_project(db, tenant_id, payload)

    @staticmethod
    def update_project(
        db: Session, project: TenantProject, payload: ProjectUpdate
    ) -> TenantProject:
        return repository.update_project(db, project, payload)

    @staticmethod
    def delete_project(db: Session, project: TenantProject) -> None:
        repository.delete_project(db, project)

    # ── Page CRUD ─────────────────────────────────────────────────────────




    # ── Widget CRUD ───────────────────────────────────────────────────────






    # ── Widget validation ─────────────────────────────────────────────────


    # ── Device capabilities ───────────────────────────────────────────────

    @staticmethod
    def get_tenant_device_by_id_or_uid(db: Session, tenant_id: uuid.UUID, device_id_or_uid: str):
        return repository.get_tenant_device_by_id_or_uid(db, tenant_id, device_id_or_uid)

    @staticmethod
    def list_device_capabilities(db: Session, device_id: uuid.UUID) -> list[DeviceCapability]:
        return repository.list_device_capabilities(db, device_id)

    @staticmethod
    def list_bindable_device_capabilities(
        db: Session, device_id: uuid.UUID
    ) -> list[DeviceCapability]:
        return repository.list_bindable_device_capabilities(db, device_id)

    @staticmethod
    def validate_command_for_device(
        db: Session, device, command: str, params: dict[str, Any]
    ) -> DeviceCapability:
        return repository.validate_command_for_device(db, device, command, params)


    # ── Aggregates ────────────────────────────────────────────────────────

    @staticmethod
    def build_latest_state(db: Session, project: TenantProject) -> dict[str, dict[str, Any]]:
        return repository.build_latest_state(db, project)

    @staticmethod
    def list_device_project_bindings(
        db: Session, tenant_id: uuid.UUID, device
    ) -> list[dict[str, Any]]:
        return repository.list_device_project_bindings(db, tenant_id, device)

    @staticmethod
    def list_project_device_bindings(
        db: Session, tenant_id: uuid.UUID, project: TenantProject
    ) -> list[dict[str, Any]]:
        return repository.list_project_device_bindings(db, tenant_id, project)
