"""enable postgresql rls

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Bảng tenant-scoped trực tiếp có cột tenant_id
DIRECT_TENANT_TABLES = [
    "tenant_feature_overrides",
    "tenant_device_mappings",
    "users",
    "devices",
    "device_capabilities",
    "tenant_projects",
    "ota_campaigns",
    "ota_jobs",
    "used_ota_tokens",
    "automation_rules",
    "telemetry_field_definitions",
    "automation_rule_executions",
    "alerts",
    "ml_models",
    "ml_model_versions",
    "model_deployments",
    "ml_training_jobs",
    "ml_inference_results",
    "ml_anomaly_events",
    "audit_logs",
    "provisioning_sessions",
    "device_groups",
]

# Bảng liên kết gián tiếp đến tenant
INDIRECT_TENANT_TABLES = [
    ("project_pages", "project_id", "tenant_projects"),
    ("device_credentials", "device_id", "devices"),
    ("device_group_members", "group_id", "device_groups"),
    ("ota_campaign_targets", "campaign_id", "ota_campaigns"),
    ("ota_job_events", "ota_job_id", "ota_jobs"),
    ("anomaly_events", "device_id", "devices"),
]

# TimescaleDB hypertables / Time-series tables (chỉ ENABLE RLS, không FORCE RLS)
HYPER_TABLES = [
    "telemetry",
    "device_status_events",
    "device_health",
    "model_predictions",
    "health_scores",
]


def upgrade() -> None:
    # 1. Bảng tenants (so sánh trực tiếp id)
    op.execute("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE tenants FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy ON tenants
        USING (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        );
        """
    )

    # 2. Bảng firmware_versions (cho phép select public firmware hoặc tenant-owned)
    op.execute("ALTER TABLE firmware_versions ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE firmware_versions FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy ON firmware_versions
        USING (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR uploaded_by_tenant_id IS NULL
            OR uploaded_by_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR uploaded_by_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        );
        """
    )

    # 3. Bảng tenant-scoped trực tiếp
    for table in DIRECT_TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation_policy ON {table}
            USING (
                current_setting('app.bypass_rls', true) = 'true'
                OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
                OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
            WITH CHECK (
                current_setting('app.bypass_rls', true) = 'true'
                OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
                OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            );
            """
        )

    # 4. Bảng liên kết gián tiếp: project_pages & project_widgets (2 cấp độ join đặc biệt)
    # project_pages -> tenant_projects
    op.execute("ALTER TABLE project_pages ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_pages FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy ON project_pages
        USING (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR EXISTS (
                SELECT 1 FROM tenant_projects 
                WHERE tenant_projects.id = project_pages.project_id
                AND tenant_projects.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
        )
        WITH CHECK (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR EXISTS (
                SELECT 1 FROM tenant_projects 
                WHERE tenant_projects.id = project_pages.project_id
                AND tenant_projects.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
        );
        """
    )

    # project_widgets -> project_pages -> tenant_projects
    op.execute("ALTER TABLE project_widgets ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_widgets FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy ON project_widgets
        USING (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR EXISTS (
                SELECT 1 FROM project_pages
                JOIN tenant_projects ON tenant_projects.id = project_pages.project_id
                WHERE project_pages.id = project_widgets.page_id
                AND tenant_projects.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
        )
        WITH CHECK (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR EXISTS (
                SELECT 1 FROM project_pages
                JOIN tenant_projects ON tenant_projects.id = project_pages.project_id
                WHERE project_pages.id = project_widgets.page_id
                AND tenant_projects.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
        );
        """
    )

    # Các bảng liên kết gián tiếp 1 cấp khác
    for table, fk, parent in INDIRECT_TENANT_TABLES:
        if table in ("project_pages", "project_widgets"):
            continue
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation_policy ON {table}
            USING (
                current_setting('app.bypass_rls', true) = 'true'
                OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
                OR EXISTS (
                    SELECT 1 FROM {parent} 
                    WHERE {parent}.id = {table}.{fk}
                    AND {parent}.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
                )
            )
            WITH CHECK (
                current_setting('app.bypass_rls', true) = 'true'
                OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
                OR EXISTS (
                    SELECT 1 FROM {parent} 
                    WHERE {parent}.id = {table}.{fk}
                    AND {parent}.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
                )
            );
            """
        )

    # 5. Các bảng TimescaleDB hypertables / Time-series tables (chỉ ENABLE RLS, không FORCE RLS)
    for table in HYPER_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation_policy ON {table}
            USING (
                current_setting('app.bypass_rls', true) = 'true'
                OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
                OR EXISTS (
                    SELECT 1 FROM devices 
                    WHERE devices.id = {table}.device_id
                    AND devices.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
                )
            );
            """
        )

    # 6. Bảng model_artifacts -> ml_model_versions -> ml_models -> tenant_id
    op.execute("ALTER TABLE model_artifacts ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE model_artifacts FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy ON model_artifacts
        USING (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR EXISTS (
                SELECT 1 FROM ml_model_versions 
                WHERE ml_model_versions.id = model_artifacts.model_version_id
                AND ml_model_versions.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
        )
        WITH CHECK (
            current_setting('app.bypass_rls', true) = 'true'
            OR current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')
            OR EXISTS (
                SELECT 1 FROM ml_model_versions 
                WHERE ml_model_versions.id = model_artifacts.model_version_id
                AND ml_model_versions.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            )
        );
        """
    )


def downgrade() -> None:
    # Disable and drop policy for tenants
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON tenants;")
    op.execute("ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;")

    # Disable and drop policy for firmware_versions
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON firmware_versions;")
    op.execute("ALTER TABLE firmware_versions NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE firmware_versions DISABLE ROW LEVEL SECURITY;")

    # Disable and drop policy for direct tenant-scoped tables
    for table in DIRECT_TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    # Disable and drop policy for project pages and widgets
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON project_widgets;")
    op.execute("ALTER TABLE project_widgets NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_widgets DISABLE ROW LEVEL SECURITY;")

    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON project_pages;")
    op.execute("ALTER TABLE project_pages NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE project_pages DISABLE ROW LEVEL SECURITY;")

    # Disable and drop policy for indirect tenant-scoped tables
    for table, _, _ in INDIRECT_TENANT_TABLES:
        if table in ("project_pages", "project_widgets"):
            continue
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    # Disable and drop policy for hypertables
    for table in HYPER_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    # Disable and drop policy for model_artifacts
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON model_artifacts;")
    op.execute("ALTER TABLE model_artifacts NO FORCE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE model_artifacts DISABLE ROW LEVEL SECURITY;")
