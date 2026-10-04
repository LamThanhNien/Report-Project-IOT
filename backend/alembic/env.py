"""Alembic environment for AIFOM.

Reads DATABASE_URL from app.core.config (same source as the runtime app)
so that ``alembic upgrade head`` and ``alembic revision --autogenerate``
always target the correct database.
"""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# ---------------------------------------------------------------------------
# Make sure the backend package is importable when alembic runs from the
# ``backend/`` working directory (the normal case).
# ---------------------------------------------------------------------------
_backend_dir = str(Path(__file__).resolve().parents[1])
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# Import app settings and ORM metadata ------------------------------------
from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402

# Force-import every model module so Base.metadata is fully populated.
# These mirrors the imports in app/main.py.
import app.modules.anomaly.model  # noqa: F401, E402
import app.modules.audit.model  # noqa: F401, E402
import app.modules.auth.model  # noqa: F401, E402
import app.modules.devices.model  # noqa: F401, E402
import app.modules.devices.model_device_types  # noqa: F401, E402
import app.modules.firmware.model  # noqa: F401, E402
import app.modules.firmware.model_profiles  # noqa: F401, E402
import app.modules.ota.model  # noqa: F401, E402
import app.modules.ota.model_campaigns  # noqa: F401, E402
import app.modules.projects.model  # noqa: F401, E402
import app.modules.telemetry.model  # noqa: F401, E402
import app.modules.telemetry.model_extended  # noqa: F401, E402
import app.modules.tenants.model  # noqa: F401, E402
import app.modules.alerts.model  # noqa: F401, E402
import app.bounded_contexts.device_registry.infrastructure.persistence.platform_models  # noqa: F401, E402
import app.bounded_contexts.command_center.infrastructure.models  # noqa: F401, E402
import app.bounded_contexts.device_groups.infrastructure.persistence.models  # noqa: F401, E402
import app.bounded_contexts.device_provisioning.infrastructure.models  # noqa: F401, E402
import app.bounded_contexts.device_registry.infrastructure.persistence.device_type_models  # noqa: F401, E402
import app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_campaign_models  # noqa: F401, E402
import app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models  # noqa: F401, E402
import app.bounded_contexts.rule_engine.infrastructure.persistence.models  # noqa: F401, E402
import app.bounded_contexts.tinyml_model_management.infrastructure.sqlalchemy_models  # noqa: F401, E402
import app.bounded_contexts.api_docs.infrastructure.models  # noqa: F401, E402
import app.bounded_contexts.identity.infrastructure.persistence.token_blacklist  # noqa: F401, E402
import app.shared.infrastructure.persistence.settings_models  # noqa: F401, E402

# Alembic Config object
config = context.config

# Override sqlalchemy.url with the real DATABASE_URL from app settings.
# This avoids hardcoding credentials in alembic.ini.
config.set_main_option("sqlalchemy.url", settings.database_url)

# Logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Generates SQL scripts without connecting to a database.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
