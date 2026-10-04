"""Tests for MQTT & Deployment Hardening Remediation (Production Mosquitto ACL & Configuration)"""

from pathlib import Path


def get_repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_acl_prod_file_exists_and_hardened():
    root = get_repo_root()
    acl_prod_path = root / "infrastructure" / "mosquitto" / "config" / "acl.prod"

    assert acl_prod_path.exists(), f"acl.prod file missing at {acl_prod_path}"

    content = acl_prod_path.read_text(encoding="utf-8")

    # 1. Reject shared dev/demo accounts in production ACL
    assert "user aifom_device" not in content, (
        "Shared demo account 'aifom_device' found in acl.prod"
    )
    assert "devices/fffff/" not in content, "Demo device 'fffff' hardcoded topics found in acl.prod"

    # 2. Must enforce per-device isolation using %u (username = device_uid)
    assert "pattern write devices/%u/telemetry" in content
    assert "pattern write devices/%u/status" in content
    assert "pattern write devices/%u/heartbeat" in content
    assert "pattern write devices/%u/events" in content
    assert "pattern write devices/%u/ota/status" in content
    assert "pattern read  devices/%u/commands" in content
    assert "pattern read  devices/%u/ota" in content

    # 3. Ensure no wildcards (+ or #) are allowed in standard device pattern topics (devices/%u/...)
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("pattern") and line.split()[-1].startswith("devices/%u/"):
            topic = line.split()[-1]
            assert "+" not in topic, (
                f"Wildcard '+' forbidden in standard device pattern topic: {line}"
            )
            assert "#" not in topic, (
                f"Wildcard '#' forbidden in standard device pattern topic: {line}"
            )


def test_mosquitto_prod_conf_hardened():
    root = get_repo_root()
    prod_conf_path = root / "infrastructure" / "mosquitto" / "config" / "mosquitto.prod.conf"

    assert prod_conf_path.exists(), f"mosquitto.prod.conf missing at {prod_conf_path}"

    content = prod_conf_path.read_text(encoding="utf-8")

    assert "allow_anonymous false" in content, (
        "allow_anonymous must be false in mosquitto.prod.conf"
    )
    assert "listener 8883" in content, "Production Mosquitto must listen on TLS port 8883"
    assert "password_file /mosquitto/config/passwd" in content
    assert "acl_file /mosquitto/config/acl" in content
    assert "tls_version tlsv1.2" in content


def test_docker_compose_prod_mounts_prod_config_and_acl():
    root = get_repo_root()
    compose_prod_path = root / "infrastructure" / "docker-compose.prod.yml"

    assert compose_prod_path.exists(), f"docker-compose.prod.yml missing at {compose_prod_path}"

    content = compose_prod_path.read_text(encoding="utf-8")

    assert (
        "./mosquitto/config/mosquitto.prod.conf:/mosquitto/config/mosquitto.conf:ro" in content
    ), "docker-compose.prod.yml must mount mosquitto.prod.conf"
    assert "./mosquitto/config/acl.prod:/mosquitto/config/acl:ro" in content, (
        "docker-compose.prod.yml must mount acl.prod"
    )
    assert (
        'MQTT_PASSWORD_FILE_MANAGED_EXTERNALLY: "true"' in content
        or "MQTT_PASSWORD_FILE_MANAGED_EXTERNALLY: true" in content
    ), "docker-compose.prod.yml must set MQTT_PASSWORD_FILE_MANAGED_EXTERNALLY=true"


def test_per_device_isolation_logic_prevents_cross_device_access():
    root = get_repo_root()
    acl_prod_path = root / "infrastructure" / "mosquitto" / "config" / "acl.prod"

    from tests.test_mqtt_credentials import check_permission, parse_acl_file

    rules = parse_acl_file(acl_prod_path)

    dev_1 = "esp32-prod-001"
    dev_2 = "esp32-prod-002"

    # Device 1 access to its own topics
    assert check_permission(rules, dev_1, f"devices/{dev_1}/telemetry", "write") is True
    assert check_permission(rules, dev_1, f"devices/{dev_1}/commands", "read") is True

    # Device 1 CANNOT write to or read Device 2 topics
    assert check_permission(rules, dev_1, f"devices/{dev_2}/telemetry", "write") is False
    assert check_permission(rules, dev_1, f"devices/{dev_2}/commands", "read") is False

    # Device 1 CANNOT use wildcards
    assert check_permission(rules, dev_1, "devices/+/telemetry", "write") is False
    assert check_permission(rules, dev_1, "devices/#", "read") is False
