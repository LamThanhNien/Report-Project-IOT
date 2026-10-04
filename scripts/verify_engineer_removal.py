"""Isolated SQLite regressions for the supported three-role contract.

Run: .venv/Scripts/python.exe scripts/verify_engineer_removal.py
No backend conftest, application lifespan, live database, MQTT, or storage.
"""

import unittest
import uuid
import importlib.util
import io
import re
from pathlib import Path
from types import SimpleNamespace

from verify_project_canvas import CanvasApiTests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

from app.api.v1.router import api_router
from app.bounded_contexts.identity.application import services
from app.bounded_contexts.identity.application.use_cases import (
    AuthenticationError, GetCurrentUserUseCase, LoginUseCase,
)
from app.bounded_contexts.identity.domain.value_objects import SUPPORTED_ROLES
from app.bounded_contexts.identity.infrastructure.adapters import (
    BcryptPasswordService, JwtTokenService, SqlAlchemyUserRepository,
)
from app.bounded_contexts.identity.infrastructure.repositories import create_user
from app.bounded_contexts.tenant_management.infrastructure.repositories import list_tenant_users
from app.core.permissions import OWNER_PERMISSIONS, VIEWER_PERMISSIONS, get_effective_permissions
from app.core.project_security import verify_project_access
from app.core.security import get_current_user_from_token
from app.db.base import Base
from app.db.session import get_db
from app.modules.auth.model import User
from app.modules.tenants.model import ServicePlan

PASSWORD = "IsolatedTest123!"
PASSWORD_HASH = services.hash_password(PASSWORD)
RETIRED_ROLES = ("platform_engineer", "tenant_engineer", "unknown_role")


class EngineerRemovalTests(unittest.TestCase):
    request = CanvasApiTests.request
    create_widget = CanvasApiTests.create_widget
    tearDown = CanvasApiTests.tearDown

    def setUp(self):
        CanvasApiTests.setUp(self)
        Base.metadata.create_all(self.engine, tables=[
            Base.metadata.tables["blacklisted_tokens"], Base.metadata.tables["service_plans"],
        ])
        plan = ServicePlan(name="isolated", max_users=100, features={"user_management": True})
        self.db.add(plan)
        self.tenant.plan = plan
        self.users = {}
        for role in ("admin", "tenant_owner", "viewer", *RETIRED_ROLES):
            user = User(
                email=f"{role}@example.com", hashed_password=PASSWORD_HASH, role=role,
                tenant_id=None if role in {"admin", "platform_engineer"} else self.tenant.id,
                is_active=True,
                permissions=["projects.view", "commands.view", "ota.view", "automation.view",
                             "projects.manage", "commands.send", "ota.manage", "automation.manage"],
            )
            self.db.add(user)
            self.users[role] = user
        self.db.commit()
        self.client.close()
        app = FastAPI()
        app.include_router(api_router, prefix="/api/v1")
        # Authentication, permission, tenant, feature, blacklist, and repository
        # logic stay real. Only the database dependency targets SQLite memory.
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app, client=(uuid.uuid4().hex, 50000))

    def headers(self, role, *, legacy=False):
        user = self.users[role]
        return {"Authorization": "Bearer " + services.create_access_token(
            str(user.id), "" if legacy else role,
        )}

    def test_removed_routes_and_role_contract(self):
        self.assertEqual(SUPPORTED_ROLES, {"admin", "tenant_owner", "viewer"})
        paths = self.client.app.openapi()["paths"]
        self.assertFalse(any("/engineer" in path for path in paths))
        for path in ("/api/v1/admin/engineers", "/api/v1/platform/engineer/me"):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_retired_users_cannot_login_refresh_or_use_existing_tokens(self):
        for role in RETIRED_ROLES:
            with self.subTest(role=role):
                user = self.users[role]
                login = self.client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
                self.assertEqual(login.status_code, 401, login.text)
                refresh = self.client.post("/api/v1/auth/refresh", json={
                    "refresh_token": services.create_refresh_token(str(user.id)),
                })
                self.assertEqual(refresh.status_code, 401, refresh.text)
                # Tokens created before role retirement may omit the role claim.
                headers = self.headers(role, legacy=True)
                for path in ("/api/v1/auth/me", f"/api/v1/client/projects/{self.project.id}", "/api/v1/devices"):
                    response = self.client.get(path, headers=headers)
                    self.assertEqual(response.status_code, 401, response.text)
                with self.assertRaises(HTTPException) as denied:
                    get_current_user_from_token(headers["Authorization"].split(" ", 1)[1], self.db)
                self.assertEqual(denied.exception.status_code, 401)
                with self.assertRaises(ValueError):
                    services.create_access_token(str(user.id), role)
                with self.assertRaises(ValueError):
                    create_user(self.db, f"new-{role}@example.com", PASSWORD_HASH, role=role)
                self.db.refresh(user)
                self.assertEqual(user.role, role)
                self.assertTrue(user.is_active)
                self.assertEqual(get_effective_permissions(user), [])
        self.assertEqual(self.client.get("/api/v1/auth/me", headers={"Authorization": "Bearer malformed"}).status_code, 401)

    def test_supported_login_refresh_and_both_authentication_dependencies(self):
        for role in ("admin", "tenant_owner", "viewer"):
            with self.subTest(role=role):
                user = self.users[role]
                login = self.client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
                self.assertEqual(login.status_code, 200, login.text)
                self.assertEqual(login.json()["user"]["role"], role)
                refresh = self.client.post("/api/v1/auth/refresh", json={
                    "refresh_token": services.create_refresh_token(str(user.id)),
                })
                self.assertEqual(refresh.status_code, 200, refresh.text)
                me = self.client.get("/api/v1/auth/me", headers=self.headers(role))
                self.assertEqual(me.status_code, 200, me.text)
                self.assertEqual(me.json()["role"], role)
                if role == "admin":
                    path = f"/api/v1/devices/{self.device.device_uid}/status"
                else:
                    path = f"/api/v1/client/projects/{self.project.id}"
                response = self.client.get(path, headers=self.headers(role))
                self.assertEqual(response.status_code, 200, response.text)

    def test_owner_can_edit_canvas_viewer_stays_read_only_and_tenants_are_isolated(self):
        owner = self.headers("tenant_owner")
        viewer = self.headers("viewer")
        created = self.request("POST", f"/pages/{self.page.id}/widgets", headers=owner, json={
            "widget_type": "number_card", "title": "Temperature", "binding": {},
        })
        self.assertEqual(created.status_code, 201, created.text)
        widget_id = created.json()["id"]
        for method, path, kwargs in (
            ("POST", f"/pages/{self.page.id}/widgets", {"json": {"widget_type": "number_card", "title": "X"}}),
            ("PUT", f"/widgets/{widget_id}", {"json": {"title": "X"}}),
            ("DELETE", f"/widgets/{widget_id}", {}),
            ("POST", f"/devices/{self.device.id}/commands", {"json": {"command": "reboot"}}),
            ("DELETE", f"/automation/rules/{uuid.uuid4()}", {}),
            ("PUT", f"/projects/{self.project.id}/devices/{self.device.device_uid}/assign", {}),
        ):
            response = self.request(method, path, headers=viewer, **kwargs)
            self.assertEqual(response.status_code, 403, response.text)
        for headers in (owner, viewer):
            detail = self.request("GET", f"/projects/{self.project.id}", headers=headers)
            self.assertEqual(detail.status_code, 200, detail.text)
            self.assertEqual(self.request("GET", f"/projects/{self.other_project.id}", headers=headers).status_code, 404)
        self.assertEqual(get_effective_permissions(self.users["tenant_owner"]), list(OWNER_PERMISSIONS))
        self.assertTrue(set(get_effective_permissions(self.users["viewer"])) <= set(VIEWER_PERMISSIONS))
        self.assertNotIn("commands.send", get_effective_permissions(self.users["viewer"]))

    def test_admin_ownership_restrictions_and_tenant_user_schema(self):
        admin = self.headers("admin")
        owner = self.headers("tenant_owner")
        response = self.request("PUT", f"/projects/{self.project.id}/devices/{self.device.device_uid}/assign", headers=admin)
        self.assertEqual(response.status_code, 403, response.text)
        response = self.client.post("/api/v1/devices", headers=admin, json={
            "device_uid": "admin-tenant-write", "name": "Forbidden", "tenant_id": str(self.tenant.id),
        })
        self.assertEqual(response.status_code, 403, response.text)
        for role in RETIRED_ROLES:
            response = self.request("POST", "/users", headers=owner, json={
                "email": f"new-{role}@example.com", "password": PASSWORD, "role": role,
            })
            self.assertEqual(response.status_code, 422, response.text)
        for payload in (
            {"permissions": ["commands.send"]}, {"role": "tenant_owner"},
            {"role": "tenant_engineer"},
        ):
            response = self.request("PATCH", f"/users/{self.users['viewer'].id}", headers=owner, json=payload)
            self.assertEqual(response.status_code, 422, response.text)
        created = self.request("POST", "/users", headers=owner, json={
            "email": "new-viewer@example.com", "password": PASSWORD,
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["role"], "viewer")
        self.assertFalse(any(permission.endswith(".manage") for permission in created.json()["permissions"]))
        listed = list_tenant_users(self.db, self.tenant.id)
        self.assertTrue(all(user.role in {"tenant_owner", "viewer"} for user in listed))
        self.assertEqual(self.db.scalar(select(User).where(User.id == self.users["tenant_engineer"].id)).role, "tenant_engineer")

    def test_domain_use_cases_and_project_guard_reject_unsupported_users(self):
        repository = SqlAlchemyUserRepository(self.db)
        tokens = JwtTokenService()
        for role in RETIRED_ROLES:
            user = self.users[role]
            login = LoginUseCase(repository, BcryptPasswordService(), tokens, SimpleNamespace())
            with self.assertRaises(AuthenticationError):
                login.execute(user.email, PASSWORD)
            current = GetCurrentUserUseCase(repository, tokens)
            with self.assertRaises(AuthenticationError):
                current.execute(services.create_access_token(str(user.id)))
            with self.assertRaises(HTTPException) as denied:
                verify_project_access(self.project.id, user, self.db)
            self.assertEqual(denied.exception.status_code, 403)

    def test_forward_rls_migration_changes_only_retired_role_branch_offline(self):
        migrations = Path(__file__).resolve().parents[1] / "backend" / "alembic" / "versions"

        def load(name):
            spec = importlib.util.spec_from_file_location(name[:-3], migrations / name)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module

        def render(module, operation):
            output = io.StringIO()
            context = MigrationContext.configure(dialect_name="postgresql", opts={
                "as_sql": True, "output_buffer": output,
            })
            with Operations.context(context):
                getattr(module, operation)()
            return [statement.strip() for statement in output.getvalue().split(";") if statement.strip()]

        def normalize(statement):
            statement = " ".join(statement.replace('"', '').split())
            return re.sub(r"\s*([(),])\s*", r"\1", statement)

        original = load("0004_enable_postgresql_rls.py")
        forward = load("0012_remove_retired_role_rls_bypass.py")
        original_policies = [s for s in render(original, "upgrade") if s.startswith("CREATE POLICY")]
        upgrade = render(forward, "upgrade")
        downgrade = render(forward, "downgrade")
        self.assertEqual(len(upgrade), 37)
        self.assertEqual(len(upgrade), len(original_policies))
        role_branch = "current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')"
        expected_upgrade = [normalize(s.replace("CREATE POLICY", "ALTER POLICY", 1).replace(
            role_branch, "current_setting('app.current_user_role', true) = 'admin'",
        )) for s in original_policies]
        expected_downgrade = [normalize(s.replace("CREATE POLICY", "ALTER POLICY", 1)) for s in original_policies]
        self.assertEqual([normalize(s) for s in upgrade], expected_upgrade)
        self.assertEqual([normalize(s) for s in downgrade], expected_downgrade)
        self.assertFalse(any("platform_engineer" in s for s in upgrade))
        self.assertTrue(all(s.startswith("ALTER POLICY tenant_isolation_policy") for s in upgrade))
        config = Config()
        config.set_main_option("script_location", str(migrations.parent))
        scripts = ScriptDirectory.from_config(config)
        self.assertEqual(scripts.get_heads(), ["0013"])
        self.assertEqual(scripts.get_revision("0013").down_revision, "0012")
        self.assertEqual(scripts.get_revision("0012").down_revision, "a910c513841a")


if __name__ == "__main__":
    unittest.main(defaultTest="EngineerRemovalTests", verbosity=2)
