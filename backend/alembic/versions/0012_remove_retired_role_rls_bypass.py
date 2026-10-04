"""Remove retired role access from existing PostgreSQL isolation policies.

Revision ID: 0012
Revises: a910c513841a

Only the role bypass introduced by 0004 changes. Tenant ownership, explicit
system bypass, public firmware reads, and RLS enable/force flags stay intact.
No accounts or resource rows are updated, removed, or assigned new roles.
"""

from collections.abc import Iterator, Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "a910c513841a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DIRECT_TENANT_TABLES = (
    "tenant_feature_overrides", "tenant_device_mappings", "users", "devices",
    "device_capabilities", "tenant_projects", "ota_campaigns", "ota_jobs",
    "used_ota_tokens", "automation_rules", "telemetry_field_definitions",
    "automation_rule_executions", "alerts", "ml_models", "ml_model_versions",
    "model_deployments", "ml_training_jobs", "ml_inference_results",
    "ml_anomaly_events", "audit_logs", "provisioning_sessions", "device_groups",
)
INDIRECT_TENANT_TABLES = (
    ("device_credentials", "device_id", "devices"),
    ("device_group_members", "group_id", "device_groups"),
    ("ota_campaign_targets", "campaign_id", "ota_campaigns"),
    ("ota_job_events", "ota_job_id", "ota_jobs"),
    ("anomaly_events", "device_id", "devices"),
)
HYPER_TABLES = (
    "telemetry", "device_status_events", "device_health", "model_predictions", "health_scores",
)

TENANT_SETTING = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"


def _predicate(ownership: str, *, restore_retired_role: bool) -> str:
    role_check = (
        "current_setting('app.current_user_role', true) IN ('admin', 'platform_engineer')"
        if restore_retired_role
        else "current_setting('app.current_user_role', true) = 'admin'"
    )
    return (
        "current_setting('app.bypass_rls', true) = 'true' "
        f"OR {role_check} OR {ownership}"
    )


def _policy(table: str, using: str, check: str | None = None) -> str:
    # All identifiers are fixed migration constants; quote them explicitly.
    statement = f'ALTER POLICY tenant_isolation_policy ON "{table}" USING ({using})'
    if check is not None:
        statement += f" WITH CHECK ({check})"
    return statement + ";"


def policy_statements(*, restore_retired_role: bool = False) -> Iterator[str]:
    """Reproduce 0004 policy expressions with only its role branch changed."""
    def predicate(ownership: str) -> str:
        return _predicate(ownership, restore_retired_role=restore_retired_role)

    scoped = predicate(f"id = {TENANT_SETTING}")
    yield _policy("tenants", scoped, scoped)

    yield _policy(
        "firmware_versions",
        predicate(f"uploaded_by_tenant_id IS NULL OR uploaded_by_tenant_id = {TENANT_SETTING}"),
        predicate(f"uploaded_by_tenant_id = {TENANT_SETTING}"),
    )
    for table in DIRECT_TENANT_TABLES:
        scoped = predicate(f"tenant_id = {TENANT_SETTING}")
        yield _policy(table, scoped, scoped)

    scoped = predicate(
        "EXISTS (SELECT 1 FROM tenant_projects "
        "WHERE tenant_projects.id = project_pages.project_id "
        f"AND tenant_projects.tenant_id = {TENANT_SETTING})"
    )
    yield _policy("project_pages", scoped, scoped)
    scoped = predicate(
        "EXISTS (SELECT 1 FROM project_pages "
        "JOIN tenant_projects ON tenant_projects.id = project_pages.project_id "
        "WHERE project_pages.id = project_widgets.page_id "
        f"AND tenant_projects.tenant_id = {TENANT_SETTING})"
    )
    yield _policy("project_widgets", scoped, scoped)

    for table, foreign_key, parent in INDIRECT_TENANT_TABLES:
        scoped = predicate(
            f"EXISTS (SELECT 1 FROM {parent} "
            f"WHERE {parent}.id = {table}.{foreign_key} "
            f"AND {parent}.tenant_id = {TENANT_SETTING})"
        )
        yield _policy(table, scoped, scoped)

    for table in HYPER_TABLES:
        scoped = predicate(
            "EXISTS (SELECT 1 FROM devices "
            f"WHERE devices.id = {table}.device_id "
            f"AND devices.tenant_id = {TENANT_SETTING})"
        )
        # 0004 specifies USING only for hypertables; retain implicit CHECK behavior.
        yield _policy(table, scoped)

    scoped = predicate(
        "EXISTS (SELECT 1 FROM ml_model_versions "
        "WHERE ml_model_versions.id = model_artifacts.model_version_id "
        f"AND ml_model_versions.tenant_id = {TENANT_SETTING})"
    )
    yield _policy("model_artifacts", scoped, scoped)


def upgrade() -> None:
    for statement in policy_statements():
        op.execute(statement)


def downgrade() -> None:
    # Explicit reversal only: application authentication still rejects retired roles.
    for statement in policy_statements(restore_retired_role=True):
        op.execute(statement)
