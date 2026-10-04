"""Exercise catalog retirement SQL in a transaction-local PostgreSQL schema.

Set SIMULATOR_CATALOG_TEST_DATABASE_URL explicitly to run these tests. No
application tables are accessed: every table is created inside a random schema,
and the entire test transaction is rolled back, including schema creation.
"""

import ast
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic/versions/0014_remove_simulator_catalog.py"
)
spec = importlib.util.spec_from_file_location("retired_device_catalog", MIGRATION_PATH)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

DDL = [
    """CREATE TABLE device_platforms (
        id uuid PRIMARY KEY, key text UNIQUE NOT NULL, name text NOT NULL,
        sdk_toolchain text, description text, wifi_required boolean,
        supports_mqtt boolean, supports_ota boolean,
        supports_gpio_config boolean, supports_tinyml boolean)""",
    """CREATE TABLE device_models (
        id uuid PRIMARY KEY, platform_id uuid NOT NULL REFERENCES device_platforms ON DELETE CASCADE,
        key text NOT NULL, name text NOT NULL, description text,
        gpio_pins_json jsonb NOT NULL DEFAULT '{}',
        default_capabilities_json jsonb NOT NULL DEFAULT '[]',
        UNIQUE(platform_id, key))""",
    """CREATE TABLE capability_templates (
        id uuid PRIMARY KEY, device_model_id uuid NOT NULL REFERENCES device_models ON DELETE CASCADE,
        capability_key text, capability_type text, label text, gpio_pin int,
        channel text, command_name text, telemetry_state_key text,
        is_bindable boolean DEFAULT true, config_json jsonb DEFAULT '{}',
        UNIQUE(device_model_id, capability_key))""",
    """CREATE TABLE devices (
        id uuid PRIMARY KEY, platform_id uuid REFERENCES device_platforms ON DELETE SET NULL,
        device_model_id uuid REFERENCES device_models ON DELETE SET NULL, hardware_model text)""",
    """CREATE TABLE firmware_versions (
        id uuid PRIMARY KEY, target_platform_id uuid REFERENCES device_platforms ON DELETE SET NULL,
        target_model_id uuid REFERENCES device_models ON DELETE SET NULL, target_device_type text)""",
    "CREATE TABLE device_types (id uuid PRIMARY KEY, default_hardware_model text)",
    """CREATE TABLE datastream_template_compatibilities (
        id uuid PRIMARY KEY, device_model_id uuid REFERENCES device_models ON DELETE CASCADE)""",
]


@pytest.fixture
def catalog_db():
    dsn = os.environ.get("SIMULATOR_CATALOG_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip(
            "Set SIMULATOR_CATALOG_TEST_DATABASE_URL for isolated PostgreSQL migration tests"
        )
    engine = sa.create_engine(dsn)
    if engine.dialect.name != "postgresql":
        engine.dispose()
        pytest.fail("Catalog migration tests require PostgreSQL")
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            schema = "catalog_retirement_test_" + uuid4().hex
            connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(sa.text(f'SET LOCAL search_path TO "{schema}"'))
            for ddl in DDL:
                connection.execute(sa.text(ddl))
            for statement in migration.downgrade_statements():
                connection.execute(sa.text(statement))
            connection.execute(
                sa.text("""INSERT INTO device_platforms
                (id, key, name) VALUES ('a0000000-0000-0000-0000-000000000001', 'esp32_espidf', 'ESP32')""")
            )
            connection.execute(
                sa.text("""INSERT INTO device_models
                (id, platform_id, key, name) VALUES
                ('b0000000-0000-0000-0000-000000000001',
                 'a0000000-0000-0000-0000-000000000001', 'generic_esp32', 'ESP32')""")
            )
            yield connection
        finally:
            transaction.rollback()
            engine.dispose()


def _catalog(connection):
    return {
        table: list(connection.execute(sa.text(f"SELECT * FROM {table} ORDER BY id")))
        for table in ("device_platforms", "device_models", "capability_templates")
    }


def test_unreferenced_catalog_removal_and_exact_downgrade(catalog_db):
    before = _catalog(catalog_db)
    catalog_db.execute(sa.text(migration.upgrade_sql()))
    after = _catalog(catalog_db)
    assert len(after["device_platforms"]) == 1
    assert after["device_platforms"][0].key == "esp32_espidf"
    assert len(after["device_models"]) == 1
    assert after["device_models"][0].key == "generic_esp32"
    assert after["capability_templates"] == []
    # Repeated retirement is harmless; fresh baseline upgrades have this path.
    catalog_db.execute(sa.text(migration.upgrade_sql()))
    for statement in migration.downgrade_statements():
        catalog_db.execute(sa.text(statement))
    assert _catalog(catalog_db) == before


def test_restored_metadata_matches_original_baseline(catalog_db):
    baseline = ast.parse(
        MIGRATION_PATH.with_name("0001_initial_schema.py").read_text(encoding="utf-8")
    )
    seed_function = next(
        node
        for node in baseline.body
        if isinstance(node, ast.FunctionDef) and node.name == "_m0007__seed_platforms_and_models"
    )
    assignments = {
        node.targets[0].id: node.value
        for node in seed_function.body
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
    }
    platform_entry = next(
        node
        for node in assignments["platforms"].elts
        if isinstance(node.elts[0], ast.Name) and node.elts[0].id == "PLATFORM_SIMULATOR"
    )
    platform_metadata = tuple(ast.literal_eval(value) for value in platform_entry.elts[1:])
    assert (
        tuple(
            catalog_db.execute(
                sa.text("""SELECT key, name, sdk_toolchain,
        description, wifi_required, supports_mqtt, supports_ota,
        supports_gpio_config, supports_tinyml FROM device_platforms WHERE key = 'simulator'""")
            ).one()
        )
        == platform_metadata
    )
    model_entry = next(
        node
        for node in assignments["models"].elts
        if isinstance(node.elts[0], ast.Name) and node.elts[0].id == "MODEL_SIMULATOR"
    )
    model_metadata = tuple(ast.literal_eval(value) for value in model_entry.elts[2:5])
    assert (
        tuple(
            catalog_db.execute(
                sa.text("""SELECT key, name, description
        FROM device_models WHERE key = 'generic_simulator'""")
            ).one()
        )
        == model_metadata
    )
    original_capabilities = ast.literal_eval(assignments["sim_caps"])
    restored_capabilities = [
        tuple(row)
        for row in catalog_db.execute(
            sa.text("""
        SELECT capability_key, capability_type, label, gpio_pin, channel,
            command_name, telemetry_state_key FROM capability_templates ORDER BY id""")
        )
    ]
    assert restored_capabilities == original_capabilities


@pytest.mark.parametrize(
    "table, columns, values",
    [
        ("devices", "platform_id", f"'{migration.PLATFORM_ID}'"),
        ("devices", "device_model_id", f"'{migration.MODEL_ID}'"),
        ("devices", "hardware_model", "'generic_simulator'"),
        ("firmware_versions", "target_platform_id", f"'{migration.PLATFORM_ID}'"),
        ("firmware_versions", "target_model_id", f"'{migration.MODEL_ID}'"),
        ("firmware_versions", "target_device_type", "'simulator'"),
        ("device_types", "default_hardware_model", "'generic_simulator'"),
        ("datastream_template_compatibilities", "device_model_id", f"'{migration.MODEL_ID}'"),
        (
            "device_models",
            "platform_id, key, name",
            f"'{migration.PLATFORM_ID}', 'custom', 'User model'",
        ),
        (
            "capability_templates",
            "device_model_id, capability_key",
            f"'{migration.MODEL_ID}', 'custom'",
        ),
    ],
)
def test_references_block_without_changing_catalog_or_user_rows(catalog_db, table, columns, values):
    catalog_db.execute(
        sa.text(f"INSERT INTO {table} (id, {columns}) VALUES ('{uuid4()}', {values})")
    )
    before = _catalog(catalog_db)
    user_rows = list(catalog_db.execute(sa.text(f"SELECT * FROM {table} ORDER BY id")))
    with (
        pytest.raises(sa.exc.DBAPIError, match="Simulator catalog removal blocked"),
        catalog_db.begin_nested(),
    ):
        catalog_db.execute(sa.text(migration.upgrade_sql()))
    assert _catalog(catalog_db) == before
    assert list(catalog_db.execute(sa.text(f"SELECT * FROM {table} ORDER BY id"))) == user_rows


def test_changed_catalog_identity_blocks_removal(catalog_db):
    catalog_db.execute(
        sa.text("UPDATE device_platforms SET key = 'custom' WHERE key = 'simulator'")
    )
    before = _catalog(catalog_db)
    with (
        pytest.raises(sa.exc.DBAPIError, match="Simulator catalog identity changed"),
        catalog_db.begin_nested(),
    ):
        catalog_db.execute(sa.text(migration.upgrade_sql()))
    assert _catalog(catalog_db) == before


def _replace_with_noncanonical_platform(connection):
    connection.execute(sa.text(migration.upgrade_sql()))
    platform_id = uuid4()
    connection.execute(
        sa.text(f"""INSERT INTO device_platforms (id, key, name)
        VALUES ('{platform_id}', 'simulator', 'Virtual Device Simulator')""")
    )
    return platform_id


def test_noncanonical_unused_platform_is_removed(catalog_db):
    _replace_with_noncanonical_platform(catalog_db)
    catalog_db.execute(sa.text(migration.upgrade_sql()))
    assert [row.key for row in _catalog(catalog_db)["device_platforms"]] == ["esp32_espidf"]


@pytest.mark.parametrize(
    "table, column",
    [
        ("devices", "platform_id"),
        ("firmware_versions", "target_platform_id"),
    ],
)
def test_noncanonical_platform_references_block(catalog_db, table, column):
    platform_id = _replace_with_noncanonical_platform(catalog_db)
    catalog_db.execute(
        sa.text(f"""INSERT INTO {table} (id, {column})
        VALUES ('{uuid4()}', '{platform_id}')""")
    )
    before = _catalog(catalog_db)
    with (
        pytest.raises(sa.exc.DBAPIError, match="Simulator catalog removal blocked"),
        catalog_db.begin_nested(),
    ):
        catalog_db.execute(sa.text(migration.upgrade_sql()))
    assert _catalog(catalog_db) == before
    assert catalog_db.execute(sa.text(f"SELECT {column} FROM {table}")).scalar() == platform_id


def test_noncanonical_platform_custom_child_blocks_without_generic_model(catalog_db):
    platform_id = _replace_with_noncanonical_platform(catalog_db)
    catalog_db.execute(
        sa.text(f"""INSERT INTO device_models (id, platform_id, key, name)
        VALUES ('{uuid4()}', '{platform_id}', 'custom', 'User board')""")
    )
    before = _catalog(catalog_db)
    with pytest.raises(sa.exc.DBAPIError, match="custom device_models"), catalog_db.begin_nested():
        catalog_db.execute(sa.text(migration.upgrade_sql()))
    assert _catalog(catalog_db) == before


def test_noncanonical_generic_model_reference_blocks(catalog_db):
    platform_id = _replace_with_noncanonical_platform(catalog_db)
    model_id = uuid4()
    catalog_db.execute(
        sa.text(f"""INSERT INTO device_models (id, platform_id, key, name)
        VALUES ('{model_id}', '{platform_id}', 'generic_simulator', 'Virtual model')""")
    )
    catalog_db.execute(
        sa.text(f"""INSERT INTO devices (id, device_model_id)
        VALUES ('{uuid4()}', '{model_id}')""")
    )
    before = _catalog(catalog_db)
    with pytest.raises(sa.exc.DBAPIError, match="devices"), catalog_db.begin_nested():
        catalog_db.execute(sa.text(migration.upgrade_sql()))
    assert _catalog(catalog_db) == before
