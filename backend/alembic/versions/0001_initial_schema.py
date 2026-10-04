"""Initial AIFOM schema baseline (squashed from revisions 0001-0030)."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _upgrade_0001() -> None:
    op.create_table(
        "service_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("max_devices", sa.Integer, nullable=False, server_default="5"),
        sa.Column("max_users", sa.Integer, nullable=False, server_default="3"),
        sa.Column("telemetry_retention_days", sa.Integer, nullable=False, server_default="7"),
        sa.Column(
            "features", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False, index=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("service_plans.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("role", sa.String(32), nullable=False, server_default="viewer"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tenant_feature_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("feature_name", sa.String(64), nullable=False),
        sa.Column("is_enabled", sa.Boolean, nullable=False),
        sa.UniqueConstraint("tenant_id", "feature_name", name="uq_tenant_feature"),
    )
    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_uid", sa.String(128), unique=True, nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hardware_model", sa.String(128), nullable=True),
        sa.Column("mac_address", sa.String(17), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("firmware_version", sa.String(64), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="offline"),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("rssi", sa.Integer, nullable=True),
        sa.Column("free_heap", sa.Integer, nullable=True),
        sa.Column("uptime_ms", sa.Integer, nullable=True),
        sa.Column("last_status_payload", postgresql.JSONB, nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("offline_timeout_seconds", sa.Integer, nullable=False, server_default="60"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tenant_device_mappings",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "firmware_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("version", sa.String(64), nullable=False, index=True),
        sa.Column("target_device_type", sa.String(64), nullable=False, index=True),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("object_key", sa.String(512), nullable=True),
        sa.Column("file_size", sa.Integer, nullable=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("release_notes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("source_type", sa.String(20), nullable=False, server_default="binary"),
        sa.Column("source_code", sa.Text, nullable=True),
        sa.Column("board_fqbn", sa.String(128), nullable=True),
        sa.Column(
            "uploaded_by_tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "ota_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "firmware_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("firmware_versions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("progress", sa.Integer, nullable=True),
        sa.Column("last_message", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "telemetry",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metric_name", sa.String(128), nullable=False, index=True),
        sa.Column("metric_value", sa.Float, nullable=False),
        sa.Column("unit", sa.String(32), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("action", sa.String(64), nullable=False, index=True),
        sa.Column("resource_type", sa.String(64), nullable=True),
        sa.Column("resource_id", sa.String(64), nullable=True),
        sa.Column("detail", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
        ),
    )
    op.create_table(
        "anomaly_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("metric_name", sa.String(128), nullable=False, index=True),
        sa.Column("metric_value", sa.Float, nullable=False),
        sa.Column("anomaly_score", sa.Float, nullable=False),
        sa.Column("is_anomaly", sa.Boolean, nullable=False, server_default="false", index=True),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tenant_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "project_pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False, server_default="main"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "project_widgets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_pages.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("widget_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "layout", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "config", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "binding", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "device_capabilities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("capability_key", sa.String(128), nullable=False),
        sa.Column("capability_type", sa.String(64), nullable=False, index=True),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("gpio_pin", sa.Integer, nullable=True),
        sa.Column("channel", sa.String(64), nullable=True),
        sa.Column("command_name", sa.String(64), nullable=False),
        sa.Column("telemetry_state_key", sa.String(128), nullable=True),
        sa.Column("is_bindable", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "config_json", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("device_id", "capability_key", name="uq_device_capability_key"),
    )


def _downgrade_0001() -> None:
    op.drop_table("device_capabilities")
    op.drop_table("project_widgets")
    op.drop_table("project_pages")
    op.drop_table("tenant_projects")
    op.drop_table("anomaly_events")
    op.drop_table("audit_logs")
    op.drop_table("telemetry")
    op.drop_table("ota_jobs")
    op.drop_table("firmware_versions")
    op.drop_table("tenant_device_mappings")
    op.drop_table("devices")
    op.drop_table("tenant_feature_overrides")
    op.drop_table("users")
    op.drop_table("tenants")
    op.drop_table("service_plans")


def _upgrade_0002() -> None:
    op.create_table(
        "device_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(64), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("default_hardware_model", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "telemetry_schemas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_types.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("schema_version", sa.String(64), nullable=False),
        sa.Column(
            "fields", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("device_type_id", "schema_version", name="uq_telemetry_schema_version"),
    )
    op.create_table(
        "firmware_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_types.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("target_device_type", sa.String(64), nullable=False),
        sa.Column("target_hardware", sa.String(64), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "constraints", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "device_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("credential_type", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=True),
        sa.Column("public_key", sa.Text, nullable=True),
        sa.Column("cert_fingerprint", sa.String(128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "ota_campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "firmware_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("firmware_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(32), nullable=False, server_default="devices"),
        sa.Column("strategy", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column(
            "requested_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("total_targets", sa.Integer, nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "ota_campaign_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "campaign_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_campaigns.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ota_job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("campaign_id", "device_id", name="uq_campaign_device"),
    )
    op.create_table(
        "ota_job_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "ota_job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_jobs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("old_status", sa.String(32), nullable=True),
        sa.Column("new_status", sa.String(32), nullable=False),
        sa.Column("progress", sa.Integer, nullable=True),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("payload", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "device_status_events",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_uid", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("firmware_version", sa.String(64), nullable=True),
        sa.Column("model_version", sa.String(64), nullable=True),
        sa.Column(
            "payload", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.create_table(
        "device_health",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_uid", sa.String(128), nullable=False),
        sa.Column("free_heap", sa.Integer, nullable=True),
        sa.Column("uptime_ms", sa.BigInteger, nullable=True),
        sa.Column("wifi_rssi", sa.Integer, nullable=True),
        sa.Column("cpu_temp", sa.Float, nullable=True),
        sa.Column(
            "payload", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("severity", sa.String(32), nullable=False, server_default="warning"),
        sa.Column("status", sa.String(32), nullable=False, server_default="open"),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("code", sa.String(128), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column(
            "details", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "acknowledged_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_device_types_key", "device_types", ["key"])
    op.create_index("idx_firmware_profiles_device_type", "firmware_profiles", ["device_type_id"])
    op.create_index(
        "idx_device_status_events_device_time",
        "device_status_events",
        ["device_id", sa.text("time DESC")],
    )
    op.create_index(
        "idx_device_status_events_uid_time",
        "device_status_events",
        ["device_uid", sa.text("time DESC")],
    )
    op.create_index(
        "idx_device_health_device_time", "device_health", ["device_id", sa.text("time DESC")]
    )
    op.create_index(
        "idx_device_health_uid_time", "device_health", ["device_uid", sa.text("time DESC")]
    )
    op.create_index("idx_alerts_status_severity", "alerts", ["status", "severity"])
    op.create_index("idx_alerts_source_code", "alerts", ["source", "code"])
    op.create_index("idx_ota_campaigns_status", "ota_campaigns", ["status"])
    op.create_index("idx_ota_campaign_targets_device", "ota_campaign_targets", ["device_id"])
    op.create_index("idx_device_credentials_type", "device_credentials", ["credential_type"])
    op.add_column(
        "devices",
        sa.Column(
            "device_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("devices", sa.Column("model_version", sa.String(64), nullable=True))
    op.add_column(
        "devices",
        sa.Column(
            "metadata", postgresql.JSONB, nullable=True, server_default=sa.text("'{}'::jsonb")
        ),
    )
    _m0002__create_index_if_not_exists("idx_devices_status", "devices", ["status"])
    _m0002__create_index_if_not_exists("idx_devices_hardware_model", "devices", ["hardware_model"])
    _m0002__create_index_if_not_exists(
        "idx_devices_last_seen_at", "devices", [sa.text("last_seen_at DESC")]
    )
    op.create_index("idx_devices_device_type_id", "devices", ["device_type_id"])
    op.add_column(
        "firmware_versions",
        sa.Column("status", sa.String(32), nullable=False, server_default="uploaded"),
    )
    op.add_column("firmware_versions", sa.Column("release_channel", sa.String(32), nullable=True))
    op.add_column("firmware_versions", sa.Column("signature", sa.Text, nullable=True))
    op.add_column("firmware_versions", sa.Column("signing_key_id", sa.String(128), nullable=True))
    op.add_column(
        "firmware_versions", sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "firmware_versions", sa.Column("quarantined_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        "\n        CREATE UNIQUE INDEX IF NOT EXISTS uq_firmware_global_version\n        ON firmware_versions (target_device_type, version)\n        WHERE uploaded_by_tenant_id IS NULL\n        "
    )
    op.execute(
        "\n        CREATE UNIQUE INDEX IF NOT EXISTS uq_firmware_tenant_version\n        ON firmware_versions (uploaded_by_tenant_id, target_device_type, version)\n        WHERE uploaded_by_tenant_id IS NOT NULL\n        "
    )
    op.add_column(
        "ota_jobs",
        sa.Column(
            "campaign_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_campaigns.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("ota_jobs", sa.Column("previous_firmware_version", sa.String(64), nullable=True))
    op.add_column("ota_jobs", sa.Column("error_code", sa.String(128), nullable=True))
    op.create_index("idx_ota_jobs_campaign_id", "ota_jobs", ["campaign_id"])
    _m0002__create_index_if_not_exists(
        "idx_telemetry_device_timestamp", "telemetry", ["device_id", sa.text("timestamp DESC")]
    )
    _m0002__create_index_if_not_exists(
        "idx_telemetry_metric_timestamp", "telemetry", ["metric_name", sa.text("timestamp DESC")]
    )
    _m0002__try_create_hypertable("device_status_events", "time")
    _m0002__try_create_hypertable("device_health", "time")


def _m0002__create_index_if_not_exists(index_name: str, table_name: str, columns: list) -> None:
    """Create an index only if it does not already exist.

    Uses raw SQL ``CREATE INDEX IF NOT EXISTS`` so the migration does not fail
    when the index was already created by 0001 or a previous run.
    """
    col_parts = []
    for col in columns:
        if isinstance(col, str):
            col_parts.append(col)
        else:
            col_parts.append(str(col.compile(compile_kwargs={"literal_binds": True})))
    cols_sql = ", ".join(col_parts)
    op.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({cols_sql})")


def _m0002__try_create_hypertable(table_name: str, time_column: str) -> None:
    """Convert to hypertable only when TimescaleDB is available.

    Checking to_regproc first avoids undefined_function errors that would
    abort the whole PostgreSQL migration transaction.
    """
    op.execute(
        f"\n        DO $$\n        BEGIN\n            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_hypertable') THEN\n                BEGIN\n                    PERFORM create_hypertable('{table_name}', '{time_column}', if_not_exists => TRUE);\n                EXCEPTION WHEN OTHERS THEN\n                    RAISE NOTICE 'TimescaleDB hypertable skipped for {table_name}: %', SQLERRM;\n                END;\n            ELSE\n                RAISE NOTICE 'TimescaleDB hypertable skipped for {table_name}';\n            END IF;\n        END $$;\n        "
    )


def _downgrade_0002() -> None:
    op.drop_index("idx_ota_jobs_campaign_id", table_name="ota_jobs")
    op.execute("DROP INDEX IF EXISTS uq_firmware_tenant_version")
    op.execute("DROP INDEX IF EXISTS uq_firmware_global_version")
    op.drop_index("idx_devices_device_type_id", table_name="devices")
    op.execute("DROP INDEX IF EXISTS idx_devices_last_seen_at")
    op.execute("DROP INDEX IF EXISTS idx_devices_hardware_model")
    op.execute("DROP INDEX IF EXISTS idx_devices_status")
    op.execute("DROP INDEX IF EXISTS idx_telemetry_metric_timestamp")
    op.execute("DROP INDEX IF EXISTS idx_telemetry_device_timestamp")
    op.drop_column("ota_jobs", "error_code")
    op.drop_column("ota_jobs", "previous_firmware_version")
    op.drop_column("ota_jobs", "campaign_id")
    op.drop_column("firmware_versions", "quarantined_at")
    op.drop_column("firmware_versions", "promoted_at")
    op.drop_column("firmware_versions", "signing_key_id")
    op.drop_column("firmware_versions", "signature")
    op.drop_column("firmware_versions", "release_channel")
    op.drop_column("firmware_versions", "status")
    op.drop_column("devices", "metadata")
    op.drop_column("devices", "model_version")
    op.drop_column("devices", "device_type_id")
    op.drop_index("idx_device_credentials_type", table_name="device_credentials")
    op.drop_index("idx_ota_campaign_targets_device", table_name="ota_campaign_targets")
    op.drop_index("idx_ota_campaigns_status", table_name="ota_campaigns")
    op.drop_index("idx_alerts_source_code", table_name="alerts")
    op.drop_index("idx_alerts_status_severity", table_name="alerts")
    op.drop_index("idx_device_health_uid_time", table_name="device_health")
    op.drop_index("idx_device_health_device_time", table_name="device_health")
    op.drop_index("idx_device_status_events_uid_time", table_name="device_status_events")
    op.drop_index("idx_device_status_events_device_time", table_name="device_status_events")
    op.drop_index("idx_firmware_profiles_device_type", table_name="firmware_profiles")
    op.drop_index("idx_device_types_key", table_name="device_types")
    op.drop_table("alerts")
    op.drop_table("device_health")
    op.drop_table("device_status_events")
    op.drop_table("ota_job_events")
    op.drop_table("ota_campaign_targets")
    op.drop_table("ota_campaigns")
    op.drop_table("device_credentials")
    op.drop_table("firmware_profiles")
    op.drop_table("telemetry_schemas")
    op.drop_table("device_types")


def _upgrade_0003() -> None:
    op.create_table(
        "intelligence_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "device_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_types.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("profile_type", sa.String(64), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "config", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_intelligence_profiles_type", "intelligence_profiles", ["profile_type"])
    op.create_index("idx_intelligence_profiles_active", "intelligence_profiles", ["is_active"])
    op.create_table(
        "ml_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("task_type", sa.String(64), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_ml_models_task_type", "ml_models", ["task_type"])
    op.create_table(
        "ml_model_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_models.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("framework", sa.String(64), nullable=True),
        sa.Column("target_hardware", sa.String(128), nullable=True),
        sa.Column(
            "input_schema", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "output_schema", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "metrics", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("stage", sa.String(32), nullable=False, server_default="none"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("model_id", "version", name="uq_ml_model_version"),
    )
    op.create_index("idx_ml_model_versions_stage", "ml_model_versions", ["stage"])
    op.create_table(
        "model_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_model_versions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("artifact_type", sa.String(64), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger, nullable=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "model_deployments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "model_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_model_versions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("previous_model_version", sa.String(64), nullable=True),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(128), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_model_deployments_status", "model_deployments", ["status"])
    op.create_index("idx_model_deployments_device", "model_deployments", ["device_id"])
    op.create_table(
        "model_predictions",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_uid", sa.String(128), nullable=False),
        sa.Column("model_name", sa.String(255), nullable=False),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("predicted_label", sa.String(255), nullable=True),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("latency_ms", sa.Float, nullable=True),
        sa.Column(
            "payload", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.create_index(
        "idx_model_predictions_device_time",
        "model_predictions",
        ["device_id", sa.text("time DESC")],
    )
    op.create_index(
        "idx_model_predictions_uid_time", "model_predictions", ["device_uid", sa.text("time DESC")]
    )
    op.create_table(
        "health_scores",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_uid", sa.String(128), nullable=False),
        sa.Column("model_name", sa.String(255), nullable=False),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("anomaly_score", sa.Float, nullable=False),
        sa.Column("is_anomaly", sa.Boolean, nullable=False),
        sa.Column(
            "reason", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.create_index(
        "idx_health_scores_device_time", "health_scores", ["device_id", sa.text("time DESC")]
    )
    op.create_index(
        "idx_health_scores_uid_time", "health_scores", ["device_uid", sa.text("time DESC")]
    )
    _m0003__try_create_hypertable("model_predictions", "time")
    _m0003__try_create_hypertable("health_scores", "time")


def _m0003__try_create_hypertable(table_name: str, time_column: str) -> None:
    """Convert to hypertable only when TimescaleDB is available."""
    op.execute(
        f"\n        DO $$\n        BEGIN\n            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_hypertable') THEN\n                BEGIN\n                    PERFORM create_hypertable('{table_name}', '{time_column}', if_not_exists => TRUE);\n                EXCEPTION WHEN OTHERS THEN\n                    RAISE NOTICE 'TimescaleDB hypertable skipped for {table_name}: %', SQLERRM;\n                END;\n            ELSE\n                RAISE NOTICE 'TimescaleDB hypertable skipped for {table_name}';\n            END IF;\n        END $$;\n        "
    )


def _downgrade_0003() -> None:
    op.drop_table("health_scores")
    op.drop_table("model_predictions")
    op.drop_table("model_deployments")
    op.drop_table("model_artifacts")
    op.drop_table("ml_model_versions")
    op.drop_table("ml_models")
    op.drop_table("intelligence_profiles")


def _upgrade_0004() -> None:
    op.execute(
        "\n        CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts_metric\n        ON telemetry (device_id, timestamp DESC, metric_name)\n        "
    )
    op.execute(
        "\n        DO $$\n        BEGIN\n            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_hypertable') THEN\n                BEGIN\n                    PERFORM create_hypertable(\n                        'telemetry', 'timestamp',\n                        migrate_data => TRUE,\n                        if_not_exists => TRUE\n                    );\n                    RAISE NOTICE 'TimescaleDB hypertable created for telemetry';\n                EXCEPTION WHEN OTHERS THEN\n                    RAISE NOTICE 'TimescaleDB hypertable skipped for telemetry: %', SQLERRM;\n                END;\n            ELSE\n                RAISE NOTICE 'TimescaleDB not available — telemetry hypertable skipped';\n            END IF;\n        END $$;\n        "
    )
    op.execute(
        "\n        DO $$\n        BEGIN\n            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_retention_policy')\n               AND EXISTS (\n                   SELECT 1\n                   FROM _timescaledb_catalog.hypertable\n                   WHERE schema_name = 'public' AND table_name = 'telemetry'\n               ) THEN\n                PERFORM add_retention_policy('telemetry', INTERVAL '90 days', if_not_exists => TRUE);\n                RAISE NOTICE 'Retention policy set: telemetry chunks older than 90 days will be dropped';\n            ELSE\n                RAISE NOTICE 'Retention policy skipped because telemetry is not a hypertable';\n            END IF;\n        END $$;\n        "
    )


def _downgrade_0004() -> None:
    op.execute("DROP INDEX IF EXISTS idx_telemetry_device_ts_metric")


def _m0005__column_exists(table: str, column: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.first() is not None


def _m0005__index_exists(index_name: str) -> bool:
    """Check if an index exists."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
    )
    return result.first() is not None


def _upgrade_0005() -> None:
    if not _m0005__column_exists("ota_jobs", "tenant_id"):
        op.add_column(
            "ota_jobs",
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.execute(
            "\n            UPDATE ota_jobs\n            SET tenant_id = (\n                SELECT tdm.tenant_id\n                FROM tenant_device_mappings tdm\n                WHERE tdm.device_id = ota_jobs.device_id\n                LIMIT 1\n            )\n            WHERE tenant_id IS NULL\n            "
        )
    if not _m0005__index_exists("idx_ota_jobs_tenant_id"):
        op.execute(
            "\n            CREATE INDEX idx_ota_jobs_tenant_id\n            ON ota_jobs (tenant_id)\n            "
        )
    if not _m0005__index_exists("uq_firmware_version_type_tenant"):
        op.execute(
            "\n            CREATE UNIQUE INDEX uq_firmware_version_type_tenant\n            ON firmware_versions (version, target_device_type, uploaded_by_tenant_id)\n            WHERE uploaded_by_tenant_id IS NOT NULL\n            "
        )
    if not _m0005__index_exists("uq_firmware_version_type_global"):
        op.execute(
            "\n            CREATE UNIQUE INDEX uq_firmware_version_type_global\n            ON firmware_versions (version, target_device_type)\n            WHERE uploaded_by_tenant_id IS NULL\n            "
        )
    if not _m0005__column_exists("audit_logs", "ip_address"):
        op.add_column("audit_logs", sa.Column("ip_address", sa.String(45), nullable=True))
    if not _m0005__index_exists("idx_audit_logs_ip_address"):
        op.execute(
            "\n            CREATE INDEX idx_audit_logs_ip_address\n            ON audit_logs (ip_address)\n            WHERE ip_address IS NOT NULL\n            "
        )
    if not _m0005__index_exists("idx_devices_tenant_status"):
        op.execute(
            "\n            CREATE INDEX idx_devices_tenant_status\n            ON devices (id)\n            WHERE status IS NOT NULL\n            "
        )
    if not _m0005__index_exists("idx_ota_jobs_device_status"):
        op.execute(
            "\n            CREATE INDEX idx_ota_jobs_device_status\n            ON ota_jobs (device_id, status)\n            "
        )
    if not _m0005__index_exists("idx_firmware_tenant_type"):
        op.execute(
            "\n            CREATE INDEX idx_firmware_tenant_type\n            ON firmware_versions (uploaded_by_tenant_id, target_device_type)\n            WHERE uploaded_by_tenant_id IS NOT NULL\n            "
        )


def _downgrade_0005() -> None:
    op.execute("DROP INDEX IF EXISTS idx_firmware_tenant_type")
    op.execute("DROP INDEX IF EXISTS idx_ota_jobs_device_status")
    op.execute("DROP INDEX IF EXISTS idx_devices_tenant_status")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_ip_address")
    if _m0005__column_exists("audit_logs", "ip_address"):
        op.drop_column("audit_logs", "ip_address")
    op.execute("DROP INDEX IF EXISTS uq_firmware_version_type_global")
    op.execute("DROP INDEX IF EXISTS uq_firmware_version_type_tenant")
    op.execute("DROP INDEX IF EXISTS idx_ota_jobs_tenant_id")
    if _m0005__column_exists("ota_jobs", "tenant_id"):
        op.drop_column("ota_jobs", "tenant_id")


def _m0006__table_exists(table_name: str) -> bool:
    """Check if a table exists."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.tables WHERE table_name = :name AND table_schema = 'public'"
        ),
        {"name": table_name},
    )
    return result.first() is not None


def _m0006__index_exists(index_name: str) -> bool:
    """Check if an index exists."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
    )
    return result.first() is not None


def _upgrade_0006() -> None:
    if not _m0006__table_exists("blacklisted_tokens"):
        op.create_table(
            "blacklisted_tokens",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("jti", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("token_type", sa.String(16), nullable=False),
            sa.Column("user_id", sa.String(64), nullable=False, index=True),
            sa.Column("reason", sa.String(32), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "blacklisted_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("extra", sa.Text(), nullable=True),
        )
    if not _m0006__index_exists("ix_blacklisted_tokens_expires_at"):
        op.execute(
            "\n            CREATE INDEX ix_blacklisted_tokens_expires_at\n            ON blacklisted_tokens (expires_at)\n            "
        )


def _downgrade_0006() -> None:
    op.drop_table("blacklisted_tokens")


def _m0007__table_exists(table_name: str) -> bool:
    """Check if a table exists."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :name)"
        ),
        {"name": table_name},
    )
    return bool(result.scalar())


def _m0007__column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists on a table."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl AND column_name = :col)"
        ),
        {"tbl": table_name, "col": column_name},
    )
    return bool(result.scalar())


def _upgrade_0007() -> None:
    if not _m0007__table_exists("device_platforms"):
        op.create_table(
            "device_platforms",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("key", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("sdk_toolchain", sa.String(128), nullable=True),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("wifi_required", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("supports_mqtt", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("supports_ota", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("supports_gpio_config", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("supports_tinyml", sa.Boolean, nullable=False, server_default="false"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
    if not _m0007__table_exists("device_models"):
        op.create_table(
            "device_models",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "platform_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("device_platforms.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("key", sa.String(64), nullable=False, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column(
                "gpio_pins_json",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
            sa.Column(
                "default_capabilities_json",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.UniqueConstraint("platform_id", "key", name="uq_platform_model_key"),
        )
    if not _m0007__table_exists("capability_templates"):
        op.create_table(
            "capability_templates",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "device_model_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("device_models.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("capability_key", sa.String(128), nullable=False),
            sa.Column("capability_type", sa.String(64), nullable=False, index=True),
            sa.Column("label", sa.String(255), nullable=False),
            sa.Column("gpio_pin", sa.Integer, nullable=True),
            sa.Column("channel", sa.String(64), nullable=True),
            sa.Column("command_name", sa.String(64), nullable=False),
            sa.Column("telemetry_state_key", sa.String(128), nullable=True),
            sa.Column("is_bindable", sa.Boolean, nullable=False, server_default="true"),
            sa.Column(
                "config_json",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.UniqueConstraint(
                "device_model_id", "capability_key", name="uq_model_capability_key"
            ),
        )
    if not _m0007__column_exists("devices", "platform_id"):
        op.add_column(
            "devices",
            sa.Column(
                "platform_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("device_platforms.id", ondelete="SET NULL"),
                nullable=True,
                index=True,
            ),
        )
    if not _m0007__column_exists("devices", "device_model_id"):
        op.add_column(
            "devices",
            sa.Column(
                "device_model_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("device_models.id", ondelete="SET NULL"),
                nullable=True,
                index=True,
            ),
        )
    if not _m0007__column_exists("firmware_versions", "target_platform_id"):
        op.add_column(
            "firmware_versions",
            sa.Column(
                "target_platform_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("device_platforms.id", ondelete="SET NULL"),
                nullable=True,
                index=True,
            ),
        )
    if not _m0007__column_exists("firmware_versions", "target_model_id"):
        op.add_column(
            "firmware_versions",
            sa.Column(
                "target_model_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("device_models.id", ondelete="SET NULL"),
                nullable=True,
                index=True,
            ),
        )
    bind = op.get_bind()
    existing = bind.execute(sa.text("SELECT COUNT(*) FROM device_platforms")).scalar()
    if existing == 0:
        _m0007__seed_platforms_and_models(bind)


def _m0007__seed_platforms_and_models(bind) -> None:
    """Seed device platforms, models, and capability templates."""
    import json
    import uuid as _uuid

    PLATFORM_ESP32 = str(_uuid.UUID("a0000000-0000-0000-0000-000000000001"))
    PLATFORM_ESP8266 = str(_uuid.UUID("a0000000-0000-0000-0000-000000000002"))
    PLATFORM_ARDUINO = str(_uuid.UUID("a0000000-0000-0000-0000-000000000003"))
    PLATFORM_RP2040 = str(_uuid.UUID("a0000000-0000-0000-0000-000000000004"))
    PLATFORM_LINUX = str(_uuid.UUID("a0000000-0000-0000-0000-000000000005"))
    PLATFORM_SIMULATOR = str(_uuid.UUID("a0000000-0000-0000-0000-000000000006"))
    MODEL_ESP32_GENERIC = str(_uuid.UUID("b0000000-0000-0000-0000-000000000001"))
    MODEL_ESP8266_NODEMCU = str(_uuid.UUID("b0000000-0000-0000-0000-000000000002"))
    MODEL_ARDUINO_WIFI = str(_uuid.UUID("b0000000-0000-0000-0000-000000000003"))
    MODEL_RP2040_PICO_W = str(_uuid.UUID("b0000000-0000-0000-0000-000000000004"))
    MODEL_LINUX_GATEWAY = str(_uuid.UUID("b0000000-0000-0000-0000-000000000005"))
    MODEL_SIMULATOR = str(_uuid.UUID("b0000000-0000-0000-0000-000000000006"))
    platforms = [
        (
            PLATFORM_ESP32,
            "esp32_espidf",
            "ESP32 (ESP-IDF)",
            "esp-idf",
            "ESP32 with ESP-IDF framework. Full support: MQTT, OTA, GPIO, TinyML.",
            True,
            True,
            True,
            True,
            True,
        ),
        (
            PLATFORM_ESP8266,
            "esp8266_arduino",
            "ESP8266 (Arduino)",
            "arduino-esp8266",
            "ESP8266 with Arduino framework. WiFi, MQTT, OTA, limited GPIO.",
            True,
            True,
            True,
            True,
            False,
        ),
        (
            PLATFORM_ARDUINO,
            "arduino_wifi",
            "Arduino WiFi",
            "arduino",
            "Generic Arduino WiFi boards. Basic WiFi and MQTT support.",
            True,
            True,
            True,
            False,
            False,
        ),
        (
            PLATFORM_RP2040,
            "rp2040_pico_w",
            "Raspberry Pi Pico W",
            "arduino-pico",
            "RP2040 Pico W with Arduino-Pico SDK. WiFi, MQTT, OTA.",
            True,
            True,
            True,
            True,
            False,
        ),
        (
            PLATFORM_LINUX,
            "linux_gateway",
            "Linux WiFi Gateway",
            "linux",
            "Linux-based WiFi gateway device. Full software capabilities.",
            True,
            True,
            True,
            False,
            False,
        ),
        (
            PLATFORM_SIMULATOR,
            "simulator",
            "Simulated Device",
            "python",
            "Generic simulated device for testing. All capabilities emulated.",
            True,
            True,
            True,
            True,
            True,
        ),
    ]
    for p in platforms:
        bind.execute(
            sa.text(
                "INSERT INTO device_platforms (id, key, name, sdk_toolchain, description, wifi_required, supports_mqtt, supports_ota, supports_gpio_config, supports_tinyml) VALUES (:id, :key, :name, :sdk, :desc, :wifi, :mqtt, :ota, :gpio, :tinyml) ON CONFLICT (key) DO NOTHING"
            ),
            {
                "id": p[0],
                "key": p[1],
                "name": p[2],
                "sdk": p[3],
                "desc": p[4],
                "wifi": p[5],
                "mqtt": p[6],
                "ota": p[7],
                "gpio": p[8],
                "tinyml": p[9],
            },
        )
    esp32_gpio = json.dumps(
        {
            "min": 0,
            "max": 39,
            "reserved": [6, 7, 8, 9, 10, 11, 34, 35, 36, 39],
            "bootstraps": [0, 1, 3, 5, 12],
            "output_capable": [
                0,
                1,
                2,
                3,
                4,
                5,
                12,
                13,
                14,
                15,
                16,
                17,
                18,
                19,
                21,
                22,
                23,
                25,
                26,
                27,
                32,
                33,
            ],
        }
    )
    esp8266_gpio = json.dumps(
        {
            "min": 0,
            "max": 16,
            "reserved": [6, 7, 8, 9, 10, 11],
            "bootstraps": [0, 2, 15],
            "output_capable": [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16],
        }
    )
    rp2040_gpio = json.dumps(
        {
            "min": 0,
            "max": 28,
            "reserved": [],
            "bootstraps": [],
            "output_capable": list(range(0, 29)),
        }
    )
    empty_gpio = json.dumps({})
    simulator_gpio = json.dumps(
        {
            "min": 0,
            "max": 39,
            "reserved": [],
            "bootstraps": [],
            "output_capable": list(range(0, 40)),
        }
    )
    models = [
        (
            MODEL_ESP32_GENERIC,
            PLATFORM_ESP32,
            "generic_esp32",
            "Generic ESP32",
            "ESP32-WROOM-32 DevKit V1",
            esp32_gpio,
        ),
        (
            MODEL_ESP8266_NODEMCU,
            PLATFORM_ESP8266,
            "nodemcu_esp8266",
            "NodeMCU ESP8266",
            "NodeMCU V3 with ESP-12E",
            esp8266_gpio,
        ),
        (
            MODEL_ARDUINO_WIFI,
            PLATFORM_ARDUINO,
            "arduino_wifi_generic",
            "Arduino WiFi Generic",
            "Arduino boards with WiFi shield/module",
            empty_gpio,
        ),
        (
            MODEL_RP2040_PICO_W,
            PLATFORM_RP2040,
            "rp2040_pico_w",
            "Raspberry Pi Pico W",
            "RP2040 Pico W with onboard WiFi",
            rp2040_gpio,
        ),
        (
            MODEL_LINUX_GATEWAY,
            PLATFORM_LINUX,
            "linux_wifi_gateway",
            "Linux WiFi Gateway",
            "Linux SBC acting as IoT gateway",
            empty_gpio,
        ),
        (
            MODEL_SIMULATOR,
            PLATFORM_SIMULATOR,
            "generic_simulator",
            "Generic Simulated Device",
            "Python-based simulated device",
            simulator_gpio,
        ),
    ]
    for m in models:
        bind.execute(
            sa.text(
                "INSERT INTO device_models (id, platform_id, key, name, description, gpio_pins_json) VALUES (:id, :pid, :key, :name, :desc, CAST(:gpio AS jsonb)) ON CONFLICT (platform_id, key) DO NOTHING"
            ),
            {"id": m[0], "pid": m[1], "key": m[2], "name": m[3], "desc": m[4], "gpio": m[5]},
        )
    esp32_caps = [
        ("relay_1", "relay", "Relay 1", 25, None, "set_relay", "relay_1_state"),
        ("relay_2", "relay", "Relay 2", 26, None, "set_relay", "relay_2_state"),
        ("led_builtin", "led", "Built-in LED", 2, None, "set_led", "led_state"),
        (
            "digital_out_1",
            "digital_output",
            "Digital Output 1",
            13,
            None,
            "set_gpio",
            "gpio_13_state",
        ),
        (
            "digital_out_2",
            "digital_output",
            "Digital Output 2",
            14,
            None,
            "set_gpio",
            "gpio_14_state",
        ),
        ("analog_in_1", "analog_input", "Analog Input 1", 34, None, "read_analog", "analog_34"),
        ("analog_in_2", "analog_input", "Analog Input 2", 35, None, "read_analog", "analog_35"),
        (
            "temp_sensor",
            "sensor",
            "Temperature",
            None,
            "temperature",
            "get_temperature",
            "temperature",
        ),
        ("humidity_sensor", "sensor", "Humidity", None, "humidity", "get_humidity", "humidity"),
    ]
    for i, cap in enumerate(esp32_caps):
        cap_id = str(_uuid.UUID(f"c0000000-0000-0000-0000-{i:012d}"))
        bind.execute(
            sa.text(
                "INSERT INTO capability_templates (id, device_model_id, capability_key, capability_type, label, gpio_pin, channel, command_name, telemetry_state_key) VALUES (:id, :mid, :key, :type, :label, :pin, :chan, :cmd, :tskey) ON CONFLICT (device_model_id, capability_key) DO NOTHING"
            ),
            {
                "id": cap_id,
                "mid": MODEL_ESP32_GENERIC,
                "key": cap[0],
                "type": cap[1],
                "label": cap[2],
                "pin": cap[3],
                "chan": cap[4],
                "cmd": cap[5],
                "tskey": cap[6],
            },
        )
    esp8266_caps = [
        ("led_builtin", "led", "Built-in LED", 2, None, "set_led", "led_state"),
        ("relay_1", "relay", "Relay 1", 5, None, "set_relay", "relay_1_state"),
        (
            "digital_out_1",
            "digital_output",
            "Digital Output 1",
            12,
            None,
            "set_gpio",
            "gpio_12_state",
        ),
        (
            "temp_sensor",
            "sensor",
            "Temperature",
            None,
            "temperature",
            "get_temperature",
            "temperature",
        ),
    ]
    for i, cap in enumerate(esp8266_caps):
        cap_id = str(_uuid.UUID(f"c0000000-0000-0000-0001-{i:012d}"))
        bind.execute(
            sa.text(
                "INSERT INTO capability_templates (id, device_model_id, capability_key, capability_type, label, gpio_pin, channel, command_name, telemetry_state_key) VALUES (:id, :mid, :key, :type, :label, :pin, :chan, :cmd, :tskey) ON CONFLICT (device_model_id, capability_key) DO NOTHING"
            ),
            {
                "id": cap_id,
                "mid": MODEL_ESP8266_NODEMCU,
                "key": cap[0],
                "type": cap[1],
                "label": cap[2],
                "pin": cap[3],
                "chan": cap[4],
                "cmd": cap[5],
                "tskey": cap[6],
            },
        )
    sim_caps = [
        ("relay_1", "relay", "Relay 1", 25, None, "set_relay", "relay_1_state"),
        ("relay_2", "relay", "Relay 2", 26, None, "set_relay", "relay_2_state"),
        ("led_builtin", "led", "Simulated LED", 2, None, "set_led", "led_state"),
        (
            "temp_sensor",
            "sensor",
            "Temperature",
            None,
            "temperature",
            "get_temperature",
            "temperature",
        ),
        ("humidity_sensor", "sensor", "Humidity", None, "humidity", "get_humidity", "humidity"),
    ]
    for i, cap in enumerate(sim_caps):
        cap_id = str(_uuid.UUID(f"c0000000-0000-0000-0002-{i:012d}"))
        bind.execute(
            sa.text(
                "INSERT INTO capability_templates (id, device_model_id, capability_key, capability_type, label, gpio_pin, channel, command_name, telemetry_state_key) VALUES (:id, :mid, :key, :type, :label, :pin, :chan, :cmd, :tskey) ON CONFLICT (device_model_id, capability_key) DO NOTHING"
            ),
            {
                "id": cap_id,
                "mid": MODEL_SIMULATOR,
                "key": cap[0],
                "type": cap[1],
                "label": cap[2],
                "pin": cap[3],
                "chan": cap[4],
                "cmd": cap[5],
                "tskey": cap[6],
            },
        )
    bind.execute(
        sa.text(
            "UPDATE devices SET platform_id = :pid, device_model_id = :mid WHERE platform_id IS NULL AND (hardware_model ILIKE '%esp32%' OR hardware_model IS NULL OR device_type_id IN (SELECT id FROM device_types WHERE key ILIKE '%esp32%'))"
        ),
        {"pid": PLATFORM_ESP32, "mid": MODEL_ESP32_GENERIC},
    )
    bind.execute(
        sa.text(
            "UPDATE firmware_versions SET target_platform_id = :pid, target_model_id = :mid WHERE target_platform_id IS NULL AND (target_device_type ILIKE '%esp32%' OR target_device_type IS NULL)"
        ),
        {"pid": PLATFORM_ESP32, "mid": MODEL_ESP32_GENERIC},
    )


def _downgrade_0007() -> None:
    if _m0007__column_exists("firmware_versions", "target_model_id"):
        op.drop_column("firmware_versions", "target_model_id")
    if _m0007__column_exists("firmware_versions", "target_platform_id"):
        op.drop_column("firmware_versions", "target_platform_id")
    if _m0007__column_exists("devices", "device_model_id"):
        op.drop_column("devices", "device_model_id")
    if _m0007__column_exists("devices", "platform_id"):
        op.drop_column("devices", "platform_id")
    if _m0007__table_exists("capability_templates"):
        op.drop_table("capability_templates")
    if _m0007__table_exists("device_models"):
        op.drop_table("device_models")
    if _m0007__table_exists("device_platforms"):
        op.drop_table("device_platforms")


def _m0008__column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl AND column_name = :col)"
        ),
        {"tbl": table_name, "col": column_name},
    )
    return bool(result.scalar())


def _upgrade_0008() -> None:
    if not _m0008__column_exists("firmware_versions", "signature_alg"):
        op.add_column("firmware_versions", sa.Column("signature_alg", sa.String(32), nullable=True))
    if not _m0008__column_exists("firmware_versions", "signature_payload"):
        op.add_column(
            "firmware_versions", sa.Column("signature_payload", sa.String(64), nullable=True)
        )


def _downgrade_0008() -> None:
    if _m0008__column_exists("firmware_versions", "signature_payload"):
        op.drop_column("firmware_versions", "signature_payload")
    if _m0008__column_exists("firmware_versions", "signature_alg"):
        op.drop_column("firmware_versions", "signature_alg")


def _m0009__constraint_exists(constraint_name: str, table_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND table_name = :tbl AND constraint_name = :con"
        ),
        {"tbl": table_name, "con": constraint_name},
    )
    return result.first() is not None


def _m0009__index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
    )
    return result.first() is not None


def _m0009__add_check(table: str, constraint: str, condition: str) -> None:
    """Add a CHECK constraint if it does not already exist."""
    if not _m0009__constraint_exists(constraint, table):
        op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {constraint} CHECK ({condition})")


def _upgrade_0009() -> None:
    _m0009__add_check(
        "devices",
        "chk_devices_status",
        "status IN ('online', 'offline', 'provisioning', 'error', 'unknown')",
    )
    _m0009__add_check(
        "devices",
        "chk_devices_offline_timeout",
        "offline_timeout_seconds >= 10 AND offline_timeout_seconds <= 600",
    )
    _m0009__add_check(
        "ota_jobs",
        "chk_ota_jobs_status",
        "status IN ('pending', 'sent', 'accepted', 'downloading', 'flashing', 'rebooting', 'success', 'failed')",
    )
    _m0009__add_check(
        "ota_jobs",
        "chk_ota_jobs_progress",
        "progress IS NULL OR (progress >= 0 AND progress <= 100)",
    )
    _m0009__add_check(
        "ota_campaigns",
        "chk_ota_campaigns_status",
        "status IN ('draft', 'running', 'paused', 'completed', 'failed', 'cancelled')",
    )
    _m0009__add_check(
        "ota_campaign_targets",
        "chk_ota_campaign_targets_status",
        "status IN ('pending', 'notified', 'downloading', 'success', 'failed', 'skipped')",
    )
    _m0009__add_check(
        "alerts", "chk_alerts_severity", "severity IN ('info', 'warning', 'critical')"
    )
    _m0009__add_check(
        "alerts", "chk_alerts_status", "status IN ('open', 'acknowledged', 'resolved')"
    )
    _m0009__add_check(
        "users", "chk_users_role", "role IN ('admin', 'tenant_owner', 'tenant_engineer', 'viewer')"
    )
    _m0009__add_check(
        "firmware_versions", "chk_firmware_status", "status IN ('uploaded', 'active', 'deprecated')"
    )
    _m0009__add_check(
        "firmware_versions",
        "chk_firmware_source_type",
        "source_type IN ('binary', 'ino_source', 'ino_compiled')",
    )
    _m0009__add_check(
        "firmware_versions", "chk_firmware_file_size", "file_size IS NULL OR file_size >= 0"
    )
    _m0009__add_check(
        "blacklisted_tokens",
        "chk_blacklisted_tokens_token_type",
        "token_type IN ('access', 'refresh')",
    )
    _m0009__add_check(
        "service_plans", "chk_service_plans_max_devices", "max_devices IS NULL OR max_devices > 0"
    )
    _m0009__add_check(
        "service_plans", "chk_service_plans_max_users", "max_users IS NULL OR max_users > 0"
    )
    if _m0009__index_exists("idx_devices_tenant_status"):
        op.drop_index("idx_devices_tenant_status", table_name="devices")
    op.execute("CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status)")


def _downgrade_0009() -> None:
    constraints = [
        ("devices", "chk_devices_status"),
        ("devices", "chk_devices_offline_timeout"),
        ("ota_jobs", "chk_ota_jobs_status"),
        ("ota_jobs", "chk_ota_jobs_progress"),
        ("ota_campaigns", "chk_ota_campaigns_status"),
        ("ota_campaign_targets", "chk_ota_campaign_targets_status"),
        ("alerts", "chk_alerts_severity"),
        ("alerts", "chk_alerts_status"),
        ("blacklisted_tokens", "chk_blacklisted_tokens_token_type"),
        ("users", "chk_users_role"),
        ("firmware_versions", "chk_firmware_status"),
        ("firmware_versions", "chk_firmware_source_type"),
        ("firmware_versions", "chk_firmware_file_size"),
        ("service_plans", "chk_service_plans_max_devices"),
        ("service_plans", "chk_service_plans_max_users"),
    ]
    for table, constraint in constraints:
        if _m0009__constraint_exists(constraint, table):
            op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {constraint}")
    if _m0009__index_exists("idx_devices_status"):
        op.drop_index("idx_devices_status", table_name="devices")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_devices_tenant_status ON devices (id) WHERE status IS NOT NULL"
    )


def _m0010__table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :tbl"
        ),
        {"tbl": table_name},
    )
    return result.first() is not None


def _m0010__index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
    )
    return result.first() is not None


def _upgrade_0010() -> None:
    if not _m0010__table_exists("device_groups"):
        op.create_table(
            "device_groups",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "tenant_id",
                UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("group_type", sa.String(32), nullable=False, server_default="manual"),
            sa.Column("status", sa.String(32), nullable=False, server_default="active"),
            sa.Column("tags", JSONB, server_default="[]"),
            sa.Column("extra_metadata", JSONB, server_default="{}"),
            sa.Column(
                "created_by",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "name", name="uq_device_groups_tenant_name"),
            sa.CheckConstraint(
                "group_type IN ('manual', 'dynamic', 'tag_based')",
                name="chk_device_groups_group_type",
            ),
            sa.CheckConstraint("status IN ('active', 'archived')", name="chk_device_groups_status"),
        )
    if not _m0010__index_exists("idx_device_groups_tenant_id"):
        op.create_index("idx_device_groups_tenant_id", "device_groups", ["tenant_id"])
    if not _m0010__table_exists("device_group_members"):
        op.create_table(
            "device_group_members",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "group_id",
                UUID(as_uuid=True),
                sa.ForeignKey("device_groups.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "device_id",
                UUID(as_uuid=True),
                sa.ForeignKey("devices.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column(
                "added_by",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.UniqueConstraint(
                "group_id", "device_id", name="uq_device_group_members_group_device"
            ),
        )
    if not _m0010__index_exists("idx_device_group_members_group_id"):
        op.create_index("idx_device_group_members_group_id", "device_group_members", ["group_id"])
    if not _m0010__index_exists("idx_device_group_members_device_id"):
        op.create_index("idx_device_group_members_device_id", "device_group_members", ["device_id"])


def _downgrade_0010() -> None:
    if _m0010__table_exists("device_group_members"):
        op.drop_table("device_group_members")
    if _m0010__table_exists("device_groups"):
        op.drop_table("device_groups")


def _m0011__table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :tbl"
        ),
        {"tbl": table_name},
    )
    return result.first() is not None


def _m0011__index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
    )
    return result.first() is not None


def _upgrade_0011() -> None:
    if not _m0011__table_exists("provisioning_sessions"):
        op.create_table(
            "provisioning_sessions",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "device_id",
                UUID(as_uuid=True),
                sa.ForeignKey("devices.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "tenant_id",
                UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("claim_code", sa.String(128), nullable=True, unique=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "claimed_by",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("extra_metadata", JSONB, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.CheckConstraint(
                "status IN ('pending', 'claimed', 'expired', 'revoked')",
                name="chk_provisioning_sessions_status",
            ),
        )
    indexes = [
        ("idx_provisioning_sessions_device_id", ["device_id"]),
        ("idx_provisioning_sessions_tenant_id", ["tenant_id"]),
        ("idx_provisioning_sessions_claim_code", ["claim_code"]),
        ("idx_provisioning_sessions_tenant_status", ["tenant_id", "status"]),
    ]
    for name, columns in indexes:
        if not _m0011__index_exists(name):
            op.create_index(name, "provisioning_sessions", columns)


def _downgrade_0011() -> None:
    if _m0011__table_exists("provisioning_sessions"):
        op.drop_table("provisioning_sessions")


def _m0012__table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :tbl"
        ),
        {"tbl": table_name},
    )
    return result.first() is not None


def _m0012__index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
    )
    return result.first() is not None


def _upgrade_0012() -> None:
    if not _m0012__table_exists("command_templates"):
        op.create_table(
            "command_templates",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "tenant_id",
                UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("command_type", sa.String(64), nullable=False),
            sa.Column("payload_template", JSONB, server_default="{}"),
            sa.Column("is_system", sa.Boolean, server_default="false"),
            sa.Column(
                "created_by",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
    if not _m0012__table_exists("command_dispatches"):
        op.create_table(
            "command_dispatches",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "tenant_id",
                UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "template_id",
                UUID(as_uuid=True),
                sa.ForeignKey("command_templates.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("command_type", sa.String(64), nullable=False),
            sa.Column("payload", JSONB, server_default="{}"),
            sa.Column("target_type", sa.String(32), nullable=False),
            sa.Column(
                "target_device_id",
                UUID(as_uuid=True),
                sa.ForeignKey("devices.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "target_group_id",
                UUID(as_uuid=True),
                sa.ForeignKey("device_groups.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error_message", sa.Text, nullable=True),
            sa.Column("retry_count", sa.Integer, server_default="0"),
            sa.Column("max_retries", sa.Integer, server_default="3"),
            sa.Column(
                "created_by",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.CheckConstraint(
                "target_type IN ('device', 'group')", name="chk_command_dispatches_target_type"
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'sent', 'acked', 'completed', 'failed', 'timeout')",
                name="chk_command_dispatches_status",
            ),
        )
    if not _m0012__table_exists("command_targets"):
        op.create_table(
            "command_targets",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "dispatch_id",
                UUID(as_uuid=True),
                sa.ForeignKey("command_dispatches.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "device_id",
                UUID(as_uuid=True),
                sa.ForeignKey("devices.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error_message", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint(
                "dispatch_id", "device_id", name="uq_command_targets_dispatch_device"
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'sent', 'acked', 'completed', 'failed', 'timeout')",
                name="chk_command_targets_status",
            ),
        )
    indexes = [
        ("idx_command_templates_tenant_id", "command_templates", ["tenant_id"]),
        ("idx_command_dispatches_tenant_id", "command_dispatches", ["tenant_id"]),
        (
            "idx_command_dispatches_tenant_created",
            "command_dispatches",
            ["tenant_id", "created_at"],
        ),
        ("idx_command_dispatches_status", "command_dispatches", ["status"]),
        ("idx_command_targets_dispatch_id", "command_targets", ["dispatch_id"]),
        ("idx_command_targets_device_id", "command_targets", ["device_id"]),
    ]
    for name, table, columns in indexes:
        if not _m0012__index_exists(name):
            op.create_index(name, table, columns)


def _downgrade_0012() -> None:
    if _m0012__table_exists("command_targets"):
        op.drop_table("command_targets")
    if _m0012__table_exists("command_dispatches"):
        op.drop_table("command_dispatches")
    if _m0012__table_exists("command_templates"):
        op.drop_table("command_templates")


_m0013_NEW_STATUS_CHECK = "status IN ('pending', 'sent', 'started', 'accepted', 'downloading', 'flashing', 'applying', 'rebooting', 'success', 'failed')"
_m0013_OLD_STATUS_CHECK = "status IN ('pending', 'sent', 'accepted', 'downloading', 'flashing', 'rebooting', 'success', 'failed')"


def _upgrade_0013() -> None:
    op.execute("ALTER TABLE ota_jobs DROP CONSTRAINT IF EXISTS chk_ota_jobs_status")
    op.execute(
        f"ALTER TABLE ota_jobs ADD CONSTRAINT chk_ota_jobs_status CHECK ({_m0013_NEW_STATUS_CHECK})"
    )


def _downgrade_0013() -> None:
    op.execute("ALTER TABLE ota_jobs DROP CONSTRAINT IF EXISTS chk_ota_jobs_status")
    op.execute(
        f"ALTER TABLE ota_jobs ADD CONSTRAINT chk_ota_jobs_status CHECK ({_m0013_OLD_STATUS_CHECK})"
    )


def _upgrade_0014() -> None:
    op.create_table(
        "automation_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("project_id", UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("severity", sa.String(32), nullable=False, server_default="warning"),
        sa.Column("cooldown_seconds", sa.Integer, nullable=False, server_default="300"),
        sa.Column("trigger_type", sa.String(64), nullable=False, server_default="telemetry"),
        sa.Column("target_scope", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("condition_logic", sa.String(8), nullable=False, server_default="and"),
        sa.Column("conditions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("condition_config", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("actions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "telemetry_field_definitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("project_id", UUID(as_uuid=True), nullable=True),
        sa.Column("device_type", sa.String(128), nullable=True),
        sa.Column("field_key", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("data_type", sa.String(32), nullable=False),
        sa.Column("unit", sa.String(32), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "project_id",
            "device_type",
            "field_key",
            name="uq_telemetry_field_definition_scope",
        ),
    )
    op.create_table(
        "automation_rule_executions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "rule_id",
            UUID(as_uuid=True),
            sa.ForeignKey("automation_rules.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("trigger_type", sa.String(64), nullable=False, server_default="telemetry"),
        sa.Column("matched", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("event_payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("evaluated_fields", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "matched_conditions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "failed_conditions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("action_preview", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("executed_actions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("idx_automation_rules_tenant_id", "automation_rules", ["tenant_id"])
    op.create_index("idx_automation_rules_project_id", "automation_rules", ["project_id"])
    op.create_index(
        "idx_automation_rule_executions_rule_id", "automation_rule_executions", ["rule_id"]
    )
    op.create_index(
        "idx_automation_rule_executions_tenant_id", "automation_rule_executions", ["tenant_id"]
    )
    op.create_index(
        "idx_automation_rule_executions_device_id", "automation_rule_executions", ["device_id"]
    )
    op.create_index(
        "idx_telemetry_field_definitions_tenant_id", "telemetry_field_definitions", ["tenant_id"]
    )
    op.create_index(
        "idx_telemetry_field_definitions_project_id", "telemetry_field_definitions", ["project_id"]
    )


def _downgrade_0014() -> None:
    op.drop_index(
        "idx_telemetry_field_definitions_project_id", table_name="telemetry_field_definitions"
    )
    op.drop_index(
        "idx_telemetry_field_definitions_tenant_id", table_name="telemetry_field_definitions"
    )
    op.drop_index(
        "idx_automation_rule_executions_device_id", table_name="automation_rule_executions"
    )
    op.drop_index(
        "idx_automation_rule_executions_tenant_id", table_name="automation_rule_executions"
    )
    op.drop_index("idx_automation_rule_executions_rule_id", table_name="automation_rule_executions")
    op.drop_index("idx_automation_rules_project_id", table_name="automation_rules")
    op.drop_index("idx_automation_rules_tenant_id", table_name="automation_rules")
    op.drop_table("automation_rule_executions")
    op.drop_table("telemetry_field_definitions")
    op.drop_table("automation_rules")


def _m0015__constraint_exists(name: str, table: str) -> bool:
    conn = op.get_bind()
    sql = (
        "SELECT 1 FROM pg_constraint WHERE conname = '"
        + name
        + "' AND conrelid = '"
        + table
        + "'::regclass"
    )
    row = conn.execute(sa.text(sql)).fetchone()
    return row is not None


def _upgrade_0015() -> None:
    op.add_column("devices", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "devices",
        sa.Column(
            "deleted_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    if _m0015__constraint_exists("chk_devices_status", "devices"):
        op.execute("ALTER TABLE devices DROP CONSTRAINT chk_devices_status")
    op.execute(
        "ALTER TABLE devices ADD CONSTRAINT chk_devices_status CHECK (status IN ('online', 'offline', 'provisioning', 'error', 'unknown', 'deleted'))"
    )


def _downgrade_0015() -> None:
    if _m0015__constraint_exists("chk_devices_status", "devices"):
        op.execute("ALTER TABLE devices DROP CONSTRAINT chk_devices_status")
    op.execute(
        "ALTER TABLE devices ADD CONSTRAINT chk_devices_status CHECK (status IN ('online', 'offline', 'provisioning', 'error', 'unknown'))"
    )
    op.drop_column("devices", "deleted_by")
    op.drop_column("devices", "deleted_at")


def _upgrade_0016() -> None:
    op.add_column(
        "devices",
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute(
        "UPDATE devices SET tenant_id = resolved.tenant_id FROM (  SELECT device_id, (ARRAY_AGG(tenant_id))[1] AS tenant_id   FROM tenant_device_mappings   GROUP BY device_id   HAVING COUNT(*) = 1) AS resolved WHERE devices.id = resolved.device_id AND devices.tenant_id IS NULL"
    )
    op.create_index(op.f("ix_devices_tenant_id"), "devices", ["tenant_id"], unique=False)


def _downgrade_0016() -> None:
    op.drop_index(op.f("ix_devices_tenant_id"), table_name="devices")
    op.drop_column("devices", "tenant_id")


def _upgrade_0017() -> None:
    op.add_column("users", sa.Column("permissions", sa.JSON(), nullable=True))


def _downgrade_0017() -> None:
    op.drop_column("users", "permissions")


def _upgrade_0018() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_alerts_tenant_created_at ON alerts (tenant_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_alerts_device_created_at ON alerts (device_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ota_jobs_tenant_created_at ON ota_jobs (tenant_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at ON audit_logs (tenant_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_device_groups_tenant_created_at ON device_groups (tenant_id, created_at DESC)"
    )


def _downgrade_0018() -> None:
    op.execute("DROP INDEX IF EXISTS idx_device_groups_tenant_created_at")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_tenant_created_at")
    op.execute("DROP INDEX IF EXISTS idx_ota_jobs_tenant_created_at")
    op.execute("DROP INDEX IF EXISTS idx_alerts_device_created_at")
    op.execute("DROP INDEX IF EXISTS idx_alerts_tenant_created_at")


def _upgrade_0019() -> None:
    op.add_column(
        "ml_models",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "ml_models",
        sa.Column(
            "problem_type", sa.String(64), nullable=False, server_default="anomaly_detection"
        ),
    )
    op.add_column(
        "ml_models", sa.Column("status", sa.String(32), nullable=False, server_default="active")
    )
    op.add_column(
        "ml_models",
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("idx_ml_models_tenant_id", "ml_models", ["tenant_id"])
    op.create_index("idx_ml_models_problem_type", "ml_models", ["problem_type"])
    op.create_index("idx_ml_models_status", "ml_models", ["status"])
    op.add_column(
        "ml_model_versions",
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column("ml_model_versions", sa.Column("algorithm", sa.String(64), nullable=True))
    op.add_column(
        "ml_model_versions",
        sa.Column("runtime", sa.String(64), nullable=False, server_default="server_sklearn"),
    )
    op.add_column("ml_model_versions", sa.Column("artifact_uri", sa.String(512), nullable=True))
    op.add_column("ml_model_versions", sa.Column("artifact_hash", sa.String(64), nullable=True))
    op.add_column(
        "ml_model_versions", sa.Column("artifact_size_bytes", sa.BigInteger, nullable=True)
    )
    op.add_column(
        "ml_model_versions",
        sa.Column(
            "feature_schema",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "ml_model_versions",
        sa.Column(
            "parameters", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.add_column(
        "ml_model_versions",
        sa.Column("status", sa.String(32), nullable=False, server_default="created"),
    )
    op.add_column(
        "ml_model_versions",
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="false"),
    )
    op.add_column(
        "ml_model_versions",
        sa.Column("training_job_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "ml_model_versions",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_ml_model_versions_tenant_id", "ml_model_versions", ["tenant_id"])
    op.create_index("idx_ml_model_versions_algorithm", "ml_model_versions", ["algorithm"])
    op.create_index("idx_ml_model_versions_status", "ml_model_versions", ["status"])
    op.create_index("idx_ml_model_versions_is_active", "ml_model_versions", ["is_active"])
    op.create_table(
        "ml_training_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_models.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "model_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_model_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("algorithm", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column(
            "input_config", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "parameters", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "feature_schema",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "metrics", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("artifact_uri", sa.String(512), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_ml_training_jobs_tenant_id", "ml_training_jobs", ["tenant_id"])
    op.create_index("idx_ml_training_jobs_model_id", "ml_training_jobs", ["model_id"])
    op.create_index(
        "idx_ml_training_jobs_model_version_id", "ml_training_jobs", ["model_version_id"]
    )
    op.create_index("idx_ml_training_jobs_algorithm", "ml_training_jobs", ["algorithm"])
    op.create_index("idx_ml_training_jobs_status", "ml_training_jobs", ["status"])
    op.create_foreign_key(
        "fk_ml_model_versions_training_job_id",
        "ml_model_versions",
        "ml_training_jobs",
        ["training_job_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "ml_inference_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_models.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "model_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_model_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("prediction", sa.String(32), nullable=False, server_default="unknown"),
        sa.Column("anomaly_score", sa.Float, nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("feature_window_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feature_window_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "features", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "request", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_ml_inference_results_tenant_id", "ml_inference_results", ["tenant_id"])
    op.create_index("idx_ml_inference_results_model_id", "ml_inference_results", ["model_id"])
    op.create_index(
        "idx_ml_inference_results_model_version_id", "ml_inference_results", ["model_version_id"]
    )
    op.create_index("idx_ml_inference_results_device_id", "ml_inference_results", ["device_id"])
    op.create_index("idx_ml_inference_results_prediction", "ml_inference_results", ["prediction"])
    op.create_index("idx_ml_inference_results_created_at", "ml_inference_results", ["created_at"])
    op.create_table(
        "ml_anomaly_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "model_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_model_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "inference_result_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_inference_results.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(32), nullable=False, server_default="open"),
        sa.Column("severity", sa.String(32), nullable=False, server_default="warning"),
        sa.Column("anomaly_score", sa.Float, nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("dedup_key", sa.String(255), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "acknowledged_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_ml_anomaly_events_tenant_id", "ml_anomaly_events", ["tenant_id"])
    op.create_index("idx_ml_anomaly_events_device_id", "ml_anomaly_events", ["device_id"])
    op.create_index(
        "idx_ml_anomaly_events_model_version_id", "ml_anomaly_events", ["model_version_id"]
    )
    op.create_index(
        "idx_ml_anomaly_events_inference_result_id", "ml_anomaly_events", ["inference_result_id"]
    )
    op.create_index("idx_ml_anomaly_events_status", "ml_anomaly_events", ["status"])
    op.create_index("idx_ml_anomaly_events_severity", "ml_anomaly_events", ["severity"])
    op.create_index("idx_ml_anomaly_events_dedup_key", "ml_anomaly_events", ["dedup_key"])
    op.create_index("idx_ml_anomaly_events_detected_at", "ml_anomaly_events", ["detected_at"])
    op.add_column(
        "model_deployments",
        sa.Column("target_type", sa.String(32), nullable=False, server_default="device"),
    )
    op.add_column(
        "model_deployments",
        sa.Column(
            "target_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "model_deployments",
        sa.Column(
            "target_group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_groups.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "model_deployments",
        sa.Column("runtime", sa.String(64), nullable=False, server_default="server_sklearn"),
    )
    op.add_column(
        "model_deployments",
        sa.Column("deployment_method", sa.String(64), nullable=False, server_default="record_only"),
    )
    op.add_column("model_deployments", sa.Column("artifact_uri", sa.String(512), nullable=True))
    op.add_column("model_deployments", sa.Column("artifact_hash", sa.String(64), nullable=True))
    op.add_column(
        "model_deployments", sa.Column("artifact_size_bytes", sa.BigInteger, nullable=True)
    )
    op.add_column(
        "model_deployments",
        sa.Column(
            "requested_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "model_deployments", sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "model_deployments", sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "model_deployments",
        sa.Column(
            "device_report", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.execute(
        "UPDATE model_deployments SET target_device_id = device_id WHERE device_id IS NOT NULL"
    )
    op.alter_column("model_deployments", "device_id", nullable=True)
    op.create_index("idx_model_deployments_target_type", "model_deployments", ["target_type"])
    op.create_index(
        "idx_model_deployments_target_device_id", "model_deployments", ["target_device_id"]
    )
    op.create_index(
        "idx_model_deployments_target_group_id", "model_deployments", ["target_group_id"]
    )


def _downgrade_0019() -> None:
    op.drop_index("idx_model_deployments_target_group_id", table_name="model_deployments")
    op.drop_index("idx_model_deployments_target_device_id", table_name="model_deployments")
    op.drop_index("idx_model_deployments_target_type", table_name="model_deployments")
    op.alter_column("model_deployments", "device_id", nullable=False)
    op.drop_column("model_deployments", "device_report")
    op.drop_column("model_deployments", "applied_at")
    op.drop_column("model_deployments", "requested_at")
    op.drop_column("model_deployments", "requested_by")
    op.drop_column("model_deployments", "artifact_size_bytes")
    op.drop_column("model_deployments", "artifact_hash")
    op.drop_column("model_deployments", "artifact_uri")
    op.drop_column("model_deployments", "deployment_method")
    op.drop_column("model_deployments", "runtime")
    op.drop_column("model_deployments", "target_group_id")
    op.drop_column("model_deployments", "target_device_id")
    op.drop_column("model_deployments", "target_type")
    op.drop_table("ml_anomaly_events")
    op.drop_table("ml_inference_results")
    op.drop_constraint(
        "fk_ml_model_versions_training_job_id", "ml_model_versions", type_="foreignkey"
    )
    op.drop_table("ml_training_jobs")
    op.drop_index("idx_ml_model_versions_is_active", table_name="ml_model_versions")
    op.drop_index("idx_ml_model_versions_status", table_name="ml_model_versions")
    op.drop_index("idx_ml_model_versions_algorithm", table_name="ml_model_versions")
    op.drop_index("idx_ml_model_versions_tenant_id", table_name="ml_model_versions")
    op.drop_column("ml_model_versions", "updated_at")
    op.drop_column("ml_model_versions", "training_job_id")
    op.drop_column("ml_model_versions", "is_active")
    op.drop_column("ml_model_versions", "status")
    op.drop_column("ml_model_versions", "parameters")
    op.drop_column("ml_model_versions", "feature_schema")
    op.drop_column("ml_model_versions", "artifact_size_bytes")
    op.drop_column("ml_model_versions", "artifact_hash")
    op.drop_column("ml_model_versions", "artifact_uri")
    op.drop_column("ml_model_versions", "runtime")
    op.drop_column("ml_model_versions", "algorithm")
    op.drop_column("ml_model_versions", "tenant_id")
    op.drop_index("idx_ml_models_status", table_name="ml_models")
    op.drop_index("idx_ml_models_problem_type", table_name="ml_models")
    op.drop_index("idx_ml_models_tenant_id", table_name="ml_models")
    op.drop_column("ml_models", "created_by")
    op.drop_column("ml_models", "status")
    op.drop_column("ml_models", "problem_type")
    op.drop_column("ml_models", "tenant_id")


def _upgrade_0020() -> None:
    op.add_column(
        "model_artifacts",
        sa.Column("artifact_kind", sa.String(64), nullable=False, server_default="server_model"),
    )
    op.add_column(
        "model_artifacts",
        sa.Column("artifact_format", sa.String(64), nullable=False, server_default="joblib"),
    )
    op.add_column("model_artifacts", sa.Column("artifact_path", sa.String(512), nullable=True))
    op.add_column(
        "model_artifacts",
        sa.Column("storage_backend", sa.String(64), nullable=False, server_default="local"),
    )
    op.add_column(
        "model_artifacts",
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute("UPDATE model_artifacts SET artifact_path = object_key WHERE artifact_path IS NULL")
    op.add_column(
        "model_deployments",
        sa.Column(
            "model_artifact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("model_artifacts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "model_deployments", sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "model_deployments", sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "idx_model_deployments_model_artifact_id", "model_deployments", ["model_artifact_id"]
    )
    op.add_column("ml_inference_results", sa.Column("algorithm", sa.String(64), nullable=True))
    op.add_column(
        "ml_inference_results",
        sa.Column("runtime", sa.String(64), nullable=False, server_default="server_sklearn"),
    )
    op.add_column("ml_inference_results", sa.Column("threshold", sa.Float(), nullable=True))
    op.add_column(
        "ml_inference_results",
        sa.Column("is_anomaly", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("idx_ml_inference_results_algorithm", "ml_inference_results", ["algorithm"])
    op.create_index("idx_ml_inference_results_runtime", "ml_inference_results", ["runtime"])
    op.create_index("idx_ml_inference_results_is_anomaly", "ml_inference_results", ["is_anomaly"])


def _downgrade_0020() -> None:
    op.drop_index("idx_ml_inference_results_is_anomaly", table_name="ml_inference_results")
    op.drop_index("idx_ml_inference_results_runtime", table_name="ml_inference_results")
    op.drop_index("idx_ml_inference_results_algorithm", table_name="ml_inference_results")
    op.drop_column("ml_inference_results", "is_anomaly")
    op.drop_column("ml_inference_results", "threshold")
    op.drop_column("ml_inference_results", "runtime")
    op.drop_column("ml_inference_results", "algorithm")
    op.drop_index("idx_model_deployments_model_artifact_id", table_name="model_deployments")
    op.drop_column("model_deployments", "acknowledged_at")
    op.drop_column("model_deployments", "dispatched_at")
    op.drop_column("model_deployments", "model_artifact_id")
    op.drop_column("model_artifacts", "created_by")
    op.drop_column("model_artifacts", "storage_backend")
    op.drop_column("model_artifacts", "artifact_path")
    op.drop_column("model_artifacts", "artifact_format")
    op.drop_column("model_artifacts", "artifact_kind")


def _upgrade_0021() -> None:
    op.add_column(
        "model_deployments",
        sa.Column(
            "parent_deployment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("model_deployments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "model_deployments", sa.Column("received_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "model_deployments", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "model_deployments", sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "idx_model_deployments_parent_deployment_id", "model_deployments", ["parent_deployment_id"]
    )


def _downgrade_0021() -> None:
    op.drop_index("idx_model_deployments_parent_deployment_id", table_name="model_deployments")
    op.drop_column("model_deployments", "failed_at")
    op.drop_column("model_deployments", "verified_at")
    op.drop_column("model_deployments", "received_at")
    op.drop_column("model_deployments", "parent_deployment_id")


def _upgrade_0022() -> None:
    op.create_table(
        "api_doc_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation_id", sa.String(length=255), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("description_override", sa.Text(), nullable=True),
        sa.Column("api_status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("access_level", sa.String(length=32), nullable=False, server_default="user"),
        sa.Column("owner", sa.String(length=120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')",
            name="ck_api_doc_overrides_method",
        ),
        sa.CheckConstraint(
            "api_status in ('active', 'deprecated', 'experimental')",
            name="ck_api_doc_overrides_api_status",
        ),
        sa.CheckConstraint(
            "access_level in ('public', 'user', 'admin')", name="ck_api_doc_overrides_access_level"
        ),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_id", name="uq_api_doc_overrides_operation_id"),
    )
    op.create_index("ix_api_doc_overrides_operation_id", "api_doc_overrides", ["operation_id"])
    op.create_index("ix_api_doc_overrides_method", "api_doc_overrides", ["method"])
    op.create_index("ix_api_doc_overrides_path", "api_doc_overrides", ["path"])
    op.create_index("ix_api_doc_overrides_api_status", "api_doc_overrides", ["api_status"])
    op.create_index("ix_api_doc_overrides_access_level", "api_doc_overrides", ["access_level"])
    op.create_index("ix_api_doc_overrides_is_visible", "api_doc_overrides", ["is_visible"])


def _downgrade_0022() -> None:
    op.drop_index("ix_api_doc_overrides_is_visible", table_name="api_doc_overrides")
    op.drop_index("ix_api_doc_overrides_access_level", table_name="api_doc_overrides")
    op.drop_index("ix_api_doc_overrides_api_status", table_name="api_doc_overrides")
    op.drop_index("ix_api_doc_overrides_path", table_name="api_doc_overrides")
    op.drop_index("ix_api_doc_overrides_method", table_name="api_doc_overrides")
    op.drop_index("ix_api_doc_overrides_operation_id", table_name="api_doc_overrides")
    op.drop_table("api_doc_overrides")


def _m0023__constraint_exists(constraint_name: str, table_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND table_name = :tbl AND constraint_name = :con"
        ),
        {"tbl": table_name, "con": constraint_name},
    )
    return result.first() is not None


def _m0023__replace_users_role_check(condition: str) -> None:
    if _m0023__constraint_exists("chk_users_role", "users"):
        op.execute("ALTER TABLE users DROP CONSTRAINT chk_users_role")
    op.execute(f"ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK ({condition})")


def _upgrade_0023() -> None:
    _m0023__replace_users_role_check(
        "role IN ('admin', 'platform_engineer', 'tenant_owner', 'tenant_engineer', 'viewer')"
    )


def _downgrade_0023() -> None:
    _m0023__replace_users_role_check(
        "role IN ('admin', 'tenant_owner', 'tenant_engineer', 'viewer')"
    )


def _upgrade_0024() -> None:
    op.add_column("alerts", sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_alerts_source_id", "alerts", ["source_id"], unique=False)


def _downgrade_0024() -> None:
    op.drop_index("ix_alerts_source_id", table_name="alerts")
    op.drop_column("alerts", "source_id")


def _upgrade_0025() -> None:
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "organization_name", sa.String(length=255), nullable=False, server_default="AIFOM Lab"
        ),
        sa.Column(
            "timezone", sa.String(length=64), nullable=False, server_default="Asia/Ho_Chi_Minh"
        ),
        sa.Column("default_locale", sa.String(length=16), nullable=False, server_default="vi"),
        sa.Column(
            "email_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("auto_update_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "maintenance_window_start", sa.String(length=5), nullable=False, server_default="02:00"
        ),
        sa.Column(
            "maintenance_window_end", sa.String(length=5), nullable=False, server_default="05:00"
        ),
        sa.Column("rollback_threshold", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("max_concurrent_updates", sa.Integer(), nullable=False, server_default="10"),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = 1", name="ck_system_settings_singleton"),
        sa.CheckConstraint(
            "rollback_threshold BETWEEN 1 AND 100", name="ck_system_settings_rollback"
        ),
        sa.CheckConstraint("max_concurrent_updates > 0", name="ck_system_settings_concurrency"),
    )
    op.execute(
        "INSERT INTO system_settings (id, organization_name, timezone, default_locale, email_notifications_enabled, auto_update_enabled, maintenance_window_start, maintenance_window_end, rollback_threshold, max_concurrent_updates) VALUES (1, 'AIFOM Lab', 'Asia/Ho_Chi_Minh', 'vi', true, false, '02:00', '05:00', 30, 10)"
    )


def _downgrade_0025() -> None:
    op.drop_table("system_settings")


def _upgrade_0026() -> None:
    op.drop_constraint("chk_ota_campaigns_status", "ota_campaigns", type_="check")
    op.create_check_constraint(
        "chk_ota_campaigns_status",
        "ota_campaigns",
        "status IN ('draft','scheduled','running','paused','completed','failed','cancelled')",
    )
    op.add_column(
        "ota_campaigns",
        sa.Column("target_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "ota_campaigns",
        sa.Column(
            "rollout_percentages", postgresql.JSONB(), nullable=False, server_default="[100]"
        ),
    )
    op.add_column(
        "ota_campaigns",
        sa.Column("current_phase", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "ota_campaigns",
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "ota_campaigns",
        sa.Column("max_concurrent_updates", sa.Integer(), nullable=False, server_default="10"),
    )
    op.add_column(
        "ota_campaigns", sa.Column("retry_limit", sa.Integer(), nullable=False, server_default="2")
    )
    op.add_column(
        "ota_campaigns",
        sa.Column("rollback_threshold", sa.Integer(), nullable=False, server_default="30"),
    )
    op.add_column(
        "ota_campaigns", sa.Column("maintenance_window_start", sa.String(5), nullable=True)
    )
    op.add_column("ota_campaigns", sa.Column("maintenance_window_end", sa.String(5), nullable=True))
    op.add_column(
        "ota_campaigns", sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("ota_campaigns", sa.Column("last_error", sa.Text(), nullable=True))
    op.add_column(
        "ota_campaign_targets", sa.Column("phase", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "ota_campaign_targets",
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "firmware_versions", sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("firmware_versions", sa.Column("signing_public_key", sa.Text(), nullable=True))
    op.add_column(
        "firmware_versions",
        sa.Column("verification_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "system_settings",
        sa.Column("ota_retry_limit", sa.Integer(), nullable=False, server_default="2"),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "allowed_release_channels",
            postgresql.JSONB(),
            nullable=False,
            server_default='["dev","staging","stable"]',
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "require_signed_stable_firmware", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column("firmware_retention_days", sa.Integer(), nullable=False, server_default="180"),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "firmware_min_versions_per_target", sa.Integer(), nullable=False, server_default="3"
        ),
    )


def _downgrade_0026() -> None:
    for column in (
        "firmware_min_versions_per_target",
        "firmware_retention_days",
        "require_signed_stable_firmware",
        "allowed_release_channels",
        "ota_retry_limit",
    ):
        op.drop_column("system_settings", column)
    op.drop_column("firmware_versions", "verification_required")
    op.drop_column("firmware_versions", "signing_public_key")
    op.drop_column("firmware_versions", "signed_at")
    op.drop_column("ota_campaign_targets", "retry_count")
    op.drop_column("ota_campaign_targets", "phase")
    for column in (
        "last_error",
        "scheduled_at",
        "maintenance_window_end",
        "maintenance_window_start",
        "rollback_threshold",
        "retry_limit",
        "max_concurrent_updates",
        "skipped_count",
        "current_phase",
        "rollout_percentages",
        "target_ids",
    ):
        op.drop_column("ota_campaigns", column)
    op.drop_constraint("chk_ota_campaigns_status", "ota_campaigns", type_="check")
    op.create_check_constraint(
        "chk_ota_campaigns_status",
        "ota_campaigns",
        "status IN ('draft','running','paused','completed','failed','cancelled')",
    )


def _m0027__column_names(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def _m0027__add_missing(table_name: str, columns: list[sa.Column]) -> None:
    existing = _m0027__column_names(table_name)
    for column in columns:
        if column.name not in existing:
            op.add_column(table_name, column)


def _upgrade_0027() -> None:
    _m0027__add_missing(
        "ota_campaigns",
        [
            sa.Column(
                "target_ids",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column(
                "rollout_percentages",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'[100]'::jsonb"),
            ),
            sa.Column("current_phase", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_concurrent_updates", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("retry_limit", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("rollback_threshold", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("maintenance_window_start", sa.String(5), nullable=True),
            sa.Column("maintenance_window_end", sa.String(5), nullable=True),
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
        ],
    )
    _m0027__add_missing(
        "ota_campaign_targets",
        [
            sa.Column("phase", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        ],
    )
    _m0027__add_missing(
        "firmware_versions",
        [
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("signing_public_key", sa.Text(), nullable=True),
            sa.Column(
                "verification_required", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        ],
    )
    _m0027__add_missing(
        "system_settings",
        [
            sa.Column("ota_retry_limit", sa.Integer(), nullable=False, server_default="2"),
            sa.Column(
                "allowed_release_channels",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text('\'["dev", "staging", "stable"]\'::jsonb'),
            ),
            sa.Column(
                "require_signed_stable_firmware",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "firmware_retention_days", sa.Integer(), nullable=False, server_default="180"
            ),
            sa.Column(
                "firmware_min_versions_per_target", sa.Integer(), nullable=False, server_default="3"
            ),
        ],
    )
    op.execute("ALTER TABLE ota_campaigns DROP CONSTRAINT IF EXISTS chk_ota_campaigns_status")
    op.create_check_constraint(
        "chk_ota_campaigns_status",
        "ota_campaigns",
        "status IN ('draft','scheduled','running','paused','completed','failed','cancelled')",
    )


def _downgrade_0027() -> None:
    pass


def _upgrade_0028() -> None:
    connection = op.get_bind()
    results = connection.execute(
        sa.text(
            "SELECT device_id, COUNT(*), ARRAY_AGG(tenant_id) as tenant_ids FROM tenant_device_mappings GROUP BY device_id HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if results:
        total_duplicates = len(results)
        sample_size = min(5, total_duplicates)
        sample = results[:sample_size]
        sample_details = ", ".join(
            (f"[device_id={row[0]} mapped to tenants: {list(row[2])}]" for row in sample)
        )
        raise RuntimeError(
            f"Database migration failed: Detected {total_duplicates} duplicate device mappings in 'tenant_device_mappings'. Offending sample (max 5): {sample_details}. Please manually resolve the duplicates before migrating."
        )
    op.create_unique_constraint(
        "uq_tenant_device_mappings_device_id", "tenant_device_mappings", ["device_id"]
    )


def _downgrade_0028() -> None:
    op.drop_constraint(
        "uq_tenant_device_mappings_device_id", "tenant_device_mappings", type_="unique"
    )


def _upgrade_0029() -> None:
    op.create_table(
        "support_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("granted_to_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("device_ids", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("ticket_reference", sa.String(length=255), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_grants_grantee_active", "support_grants", ["granted_to_user_id", "expires_at"]
    )
    op.create_index(
        "ix_support_grants_tenant_created", "support_grants", ["tenant_id", "created_at"]
    )


def _downgrade_0029() -> None:
    op.drop_index("ix_support_grants_tenant_created", table_name="support_grants")
    op.drop_index("ix_support_grants_grantee_active", table_name="support_grants")
    op.drop_table("support_grants")


def _upgrade_0030() -> None:
    op.drop_table("support_grants")


def _downgrade_0030() -> None:
    op.create_table(
        "support_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("granted_to_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("device_ids", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("ticket_reference", sa.String(length=255), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_grants_grantee_active", "support_grants", ["granted_to_user_id", "expires_at"]
    )
    op.create_index(
        "ix_support_grants_tenant_created", "support_grants", ["tenant_id", "created_at"]
    )


def upgrade() -> None:
    _upgrade_0001()
    _upgrade_0002()
    _upgrade_0003()
    _upgrade_0004()
    _upgrade_0005()
    _upgrade_0006()
    _upgrade_0007()
    _upgrade_0008()
    _upgrade_0009()
    _upgrade_0010()
    _upgrade_0011()
    _upgrade_0012()
    _upgrade_0013()
    _upgrade_0014()
    _upgrade_0015()
    _upgrade_0016()
    _upgrade_0017()
    _upgrade_0018()
    _upgrade_0019()
    _upgrade_0020()
    _upgrade_0021()
    _upgrade_0022()
    _upgrade_0023()
    _upgrade_0024()
    _upgrade_0025()
    _upgrade_0026()
    _upgrade_0027()
    _upgrade_0028()
    _upgrade_0029()
    _upgrade_0030()


def downgrade() -> None:
    _downgrade_0030()
    _downgrade_0029()
    _downgrade_0028()
    _downgrade_0027()
    _downgrade_0026()
    _downgrade_0025()
    _downgrade_0024()
    _downgrade_0023()
    _downgrade_0022()
    _downgrade_0021()
    _downgrade_0020()
    _downgrade_0019()
    _downgrade_0018()
    _downgrade_0017()
    _downgrade_0016()
    _downgrade_0015()
    _downgrade_0014()
    _downgrade_0013()
    _downgrade_0012()
    _downgrade_0011()
    _downgrade_0010()
    _downgrade_0009()
    _downgrade_0008()
    _downgrade_0007()
    _downgrade_0006()
    _downgrade_0005()
    _downgrade_0004()
    _downgrade_0003()
    _downgrade_0002()
    _downgrade_0001()
