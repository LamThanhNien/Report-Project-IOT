import pytest
from app.core.config import Settings


@pytest.fixture
def prod_settings(monkeypatch):
    # Simulate production environment variables
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MQTT_TLS_ENABLED", "true")
    monkeypatch.setenv("MQTT_TLS_CA_CERT", "/run/secrets/mqtt/ca.crt")
    monkeypatch.setenv("MQTT_TLS_CERTFILE", "/run/secrets/mqtt/server.crt")
    monkeypatch.setenv("MQTT_TLS_KEYFILE", "/run/secrets/mqtt/server.key")
    monkeypatch.setenv("MQTT_TLS_INSECURE", "false")
    # Required MQTT credentials
    monkeypatch.setenv("MQTT_USERNAME", "aifom_backend")
    monkeypatch.setenv("MQTT_PASSWORD", "dummy_password")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_LEGACY_TOKEN_RESPONSE", "false")
    monkeypatch.setenv("MINIO_SECURE", "true")
    monkeypatch.setenv("MQTT_DEVICE_USER", "prod_device_user")
    return Settings()


def test_tls_params_enabled(prod_settings, monkeypatch):
    from app.shared.infrastructure.messaging.mqtt_publisher import _tls_params

    monkeypatch.setattr(
        "app.shared.infrastructure.messaging.mqtt_publisher.settings", prod_settings
    )
    tls = _tls_params()
    assert tls is not None
    assert tls["ca_certs"] == "/run/secrets/mqtt/ca.crt"
    assert tls["certfile"] == "/run/secrets/mqtt/server.crt"
    assert tls["keyfile"] == "/run/secrets/mqtt/server.key"
    assert tls["cert_reqs"] != 0
    assert "ciphers" not in tls or tls["ciphers"] is not None


def test_production_requires_tls(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MQTT_TLS_ENABLED", "false")
    monkeypatch.setenv("MQTT_USERNAME", "aifom_backend")
    monkeypatch.setenv("MQTT_PASSWORD", "dummy_password")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_LEGACY_TOKEN_RESPONSE", "false")
    monkeypatch.setenv("MINIO_SECURE", "true")
    monkeypatch.setenv("MQTT_DEVICE_USER", "prod_device_user")
    with pytest.raises(SystemExit):
        Settings()
