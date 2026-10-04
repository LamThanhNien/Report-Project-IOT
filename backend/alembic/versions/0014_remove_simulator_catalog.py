"""Remove the retired simulator platform and its seeded hardware catalog.

Revision ID: 0014
Revises: 0013

Run the targeted seeded-device cleanup before upgrading a demo installation.
The exact simulator platform key is retired, including installations with
noncanonical catalog UUIDs. User devices, firmware, device types and
datastream configuration are blockers, never implicitly detached or deleted.
Downgrade restores the original catalog, not previously removed demo data.
"""

import json

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

PLATFORM_ID = "a0000000-0000-0000-0000-000000000006"
MODEL_ID = "b0000000-0000-0000-0000-000000000006"
CAPABILITIES = [
    ("relay_1", "relay", "Relay 1", 25, None, "set_relay", "relay_1_state"),
    ("relay_2", "relay", "Relay 2", 26, None, "set_relay", "relay_2_state"),
    ("led_builtin", "led", "Simulated LED", 2, None, "set_led", "led_state"),
    ("temp_sensor", "sensor", "Temperature", None, "temperature", "get_temperature", "temperature"),
    ("humidity_sensor", "sensor", "Humidity", None, "humidity", "get_humidity", "humidity"),
]


def _literal(value: str | int | None) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + value.replace("'", "''") + "'"


def upgrade_sql() -> str:
    platform = "v_platform"
    model = "v_model"
    template_ids = ", ".join(_literal(f"c0000000-0000-0000-0002-{i:012d}") for i in range(5))
    return f"""DO $remove_simulator_catalog$
DECLARE
    blockers text;
    v_platform uuid;
    v_model uuid;
BEGIN
    -- Hold configuration writers until all guards and deletions have finished.
    LOCK TABLE device_platforms, device_models, capability_templates,
        devices, firmware_versions, device_types,
        datastream_template_compatibilities IN SHARE ROW EXCLUSIVE MODE;

    SELECT id INTO v_platform FROM device_platforms WHERE key = 'simulator';
    SELECT id INTO v_model FROM device_models
        WHERE platform_id = v_platform AND key = 'generic_simulator';

    IF EXISTS (
        SELECT 1 FROM device_platforms
        WHERE id = {_literal(PLATFORM_ID)} AND key <> 'simulator'
    ) OR EXISTS (
        SELECT 1 FROM device_models
        WHERE id = {_literal(MODEL_ID)} AND (
            key <> 'generic_simulator' OR platform_id <> {_literal(PLATFORM_ID)}
        )
    ) THEN
        RAISE EXCEPTION 'Simulator catalog identity changed; review the platform/model before migration 0014';
    END IF;

    SELECT string_agg(reason, ', ') INTO blockers FROM (
        SELECT 'devices' AS reason WHERE EXISTS (
            SELECT 1 FROM devices WHERE platform_id = {platform}
                OR device_model_id = {model}
                OR lower(hardware_model) IN ('simulator', 'generic_simulator')
        )
        UNION ALL SELECT 'firmware_versions' WHERE EXISTS (
            SELECT 1 FROM firmware_versions WHERE target_platform_id = {platform}
                OR target_model_id = {model}
                OR lower(target_device_type) IN ('simulator', 'generic_simulator')
        )
        UNION ALL SELECT 'device_types' WHERE EXISTS (
            SELECT 1 FROM device_types
            WHERE lower(default_hardware_model) IN ('simulator', 'generic_simulator')
        )
        UNION ALL SELECT 'datastream_template_compatibilities' WHERE EXISTS (
            SELECT 1 FROM datastream_template_compatibilities WHERE device_model_id = {model}
        )
        UNION ALL SELECT 'custom device_models' WHERE EXISTS (
            SELECT 1 FROM device_models
            WHERE platform_id = {platform} AND id IS DISTINCT FROM {model}
        )
        UNION ALL SELECT 'custom capability_templates' WHERE EXISTS (
            SELECT 1 FROM capability_templates
            WHERE device_model_id = {model} AND id NOT IN ({template_ids})
        )
    ) AS references_to_simulator;
    IF blockers IS NOT NULL THEN
        RAISE EXCEPTION 'Simulator catalog removal blocked by %. Remove only identified simulator demo resources, then review remaining user configuration before retrying migration 0014', blockers;
    END IF;

    DELETE FROM capability_templates WHERE device_model_id = {model};
    DELETE FROM device_models WHERE id = {model};
    DELETE FROM device_platforms WHERE id = {platform};
END
$remove_simulator_catalog$;"""


def downgrade_statements():
    """Restore only the catalog rows seeded by the original baseline."""
    yield f"""INSERT INTO device_platforms
        (id, key, name, sdk_toolchain, description, wifi_required,
         supports_mqtt, supports_ota, supports_gpio_config, supports_tinyml)
        VALUES ({_literal(PLATFORM_ID)}, 'simulator', 'Simulated Device', 'python',
            'Generic simulated device for testing. All capabilities emulated.',
            true, true, true, true, true);"""
    gpio = json.dumps(
        {
            "min": 0,
            "max": 39,
            "reserved": [],
            "bootstraps": [],
            "output_capable": list(range(40)),
        }
    )
    yield f"""INSERT INTO device_models
        (id, platform_id, key, name, description, gpio_pins_json)
        VALUES ({_literal(MODEL_ID)}, {_literal(PLATFORM_ID)}, 'generic_simulator',
            'Generic Simulated Device', 'Python-based simulated device', {_literal(gpio)}::jsonb);"""
    for i, capability in enumerate(CAPABILITIES):
        values = [f"c0000000-0000-0000-0002-{i:012d}", MODEL_ID, *capability]
        yield (
            """INSERT INTO capability_templates
            (id, device_model_id, capability_key, capability_type, label,
             gpio_pin, channel, command_name, telemetry_state_key)
            VALUES ("""
            + ", ".join(_literal(value) for value in values)
            + ");"
        )


def upgrade() -> None:
    op.execute(upgrade_sql())


def downgrade() -> None:
    for statement in downgrade_statements():
        op.execute(statement)
