from dataclasses import dataclass
import ssl

from app.core.config import settings


@dataclass(frozen=True)
class MqttConfig:
    host: str
    port: int
    username: str | None = None
    password: str | None = None
    tls_enabled: bool = False
    tls_ca_cert: str | None = None
    tls_certfile: str | None = None
    tls_keyfile: str | None = None
    tls_insecure: bool = False

    def tls_params(self) -> dict | None:
        if not self.tls_enabled:
            return None
        return {
            "ca_certs": self.tls_ca_cert,
            "certfile": self.tls_certfile,
            "keyfile": self.tls_keyfile,
            "cert_reqs": ssl.CERT_NONE if self.tls_insecure else ssl.CERT_REQUIRED,
            "tls_version": ssl.PROTOCOL_TLS_CLIENT,
        }


def get_mqtt_config() -> MqttConfig:
    return MqttConfig(
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        username=settings.mqtt_username,
        password=settings.mqtt_password,
        tls_enabled=settings.mqtt_tls_enabled,
        tls_ca_cert=settings.mqtt_tls_ca_cert,
        tls_certfile=settings.mqtt_tls_certfile,
        tls_keyfile=settings.mqtt_tls_keyfile,
        tls_insecure=settings.mqtt_tls_insecure,
    )
