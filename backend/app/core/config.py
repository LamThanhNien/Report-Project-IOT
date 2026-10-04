import base64
import binascii
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from urllib.parse import urlsplit, urlunsplit

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_JWT_SECRETS = frozenset(
    {
        "changeme-replace-with-a-long-random-secret",
        "changeme",
        "secret",
        "jwt-secret",
        "your-secret-key",
        "super-secret",
        "password",
        "123456",
        "<your-32-char-random-secret>",
        "<your-32-char-random-refresh-secret>",
    }
)

_INSECURE_OTA_SECRETS = frozenset(
    {
        "changeme-ota-token-secret",
        "changeme",
        "secret",
        "ota-secret",
        "your-secret-key",
        "super-secret",
        "password",
        "123456",
        "replace_me_with_random_string",
    }
)

_ALLOWED_JWT_ALGORITHMS = frozenset({"HS256", "HS512"})
_HEX_SECRET_RE = re.compile(r"^[0-9a-fA-F]{64,}$")
_URLSAFE_B64_SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{43,}$")

logger = logging.getLogger(__name__)


def _is_encoded_32_byte_secret(value: str) -> bool:
    """Accept secrets encoded from at least 32 bytes as hex or URL-safe base64."""
    secret = value.strip()
    if _HEX_SECRET_RE.fullmatch(secret) and len(secret) % 2 == 0:
        return len(bytes.fromhex(secret)) >= 32
    if not _URLSAFE_B64_SECRET_RE.fullmatch(secret):
        return False
    try:
        decoded = base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4))
    except (ValueError, binascii.Error):
        return False
    return len(decoded) >= 32


class Settings(BaseSettings):
    app_name: str = "AIFOM API"
    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_host_port: int = Field(
        default=8000,
        validation_alias=AliasChoices("API_HOST_PORT"),
    )

    database_url: str = "postgresql+psycopg2://aifom:aifom_password@postgres:5432/aifom"
    app_database_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("APP_DATABASE_URL"),
    )

    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    mqtt_client_id: str = "aifom-api-subscriber"
    device_presence_check_interval_seconds: int = 5
    mqtt_host_port: int = Field(
        default=1883,
        validation_alias=AliasChoices("MQTT_HOST_PORT"),
    )

    # Device-facing MQTT address for ESP32/demo clients.
    # Supports legacy aliases for backward compatibility.
    device_mqtt_host: str = Field(
        default="aifom.local",
        validation_alias=AliasChoices("DEVICE_MQTT_HOST", "MQTT_PUBLIC_HOST", "AIFOM_MQTT_HOST"),
    )
    device_mqtt_port: int = Field(
        default=1883,
        validation_alias=AliasChoices("DEVICE_MQTT_PORT", "MQTT_PUBLIC_PORT", "AIFOM_MQTT_PORT"),
    )
    # Device-facing MQTT credentials — shared across all ESP32 devices for demo.
    # Must match MQTT_DEVICE_USER / MQTT_DEVICE_PASSWORD in .env and Mosquitto passwd.
    mqtt_device_user: str = Field(
        default="aifom_device",
        validation_alias=AliasChoices("MQTT_DEVICE_USER"),
    )
    mqtt_device_password: str = Field(
        default="",
        validation_alias=AliasChoices("MQTT_DEVICE_PASSWORD"),
    )

    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "aifom_minio"
    minio_secret_key: str = "aifom_minio_password"
    minio_bucket_firmware: str = "firmware"
    minio_secure: bool = False

    firmware_max_size_mb: int = 32
    # Optional Ed25519 PEM private key mounted at runtime; never commit the key.
    firmware_signing_private_key_path: str = ""
    firmware_signing_key_id: str = ""

    cors_allow_origins: str = ",".join(
        f"http://{host}:{port}"
        for port in (5173, 5174, 5175, 5176, 5177, 5178)
        for host in ("localhost", "127.0.0.1")
    )

    # Device-facing API base URL used in OTA payloads.
    # Keep this reachable from the physical ESP32 (not Docker-only hostnames).
    device_api_base_url: str = Field(
        default="http://aifom.local:8000",
        validation_alias=AliasChoices(
            "DEVICE_API_BASE_URL", "AIFOM_PUBLIC_BASE_URL", "OTA_DOWNLOAD_BASE_URL"
        ),
    )

    # JWT secrets are mandatory in every environment. Tests inject explicit,
    # isolated values before importing application modules.
    jwt_secret: str = ""
    jwt_refresh_secret: str = ""
    jwt_issuer: str = "aifom"
    jwt_audience: str = "aifom-client"
    jwt_algorithm: str = "HS256"
    jwt_migration_deadline: datetime | None = None
    # Access tokens are short-lived; the frontend refreshes them on 401.
    jwt_expire_minutes: int = 30

    # Browser auth cookies. Local development keeps Secure off so
    # http://localhost works; production config must enable it behind HTTPS.
    auth_cookie_secure: bool = False
    auth_cookie_samesite: str = "lax"
    auth_cookie_domain: str | None = None
    # Refresh-token JWT and browser refresh-cookie lifetime.
    auth_refresh_cookie_days: int = 7
    auth_legacy_token_response: bool = True

    # OTA download tokens — short-lived tokens for device firmware downloads.
    ota_token_secret: str = ""
    ota_token_expire_minutes: int = Field(default=15, ge=1, le=30)

    # MQTT TLS. Defaults preserve local ESP32/Mosquitto demos on mqtt://1883.
    mqtt_tls_enabled: bool = False
    mqtt_tls_ca_cert: str | None = None
    mqtt_tls_certfile: str | None = None
    mqtt_tls_keyfile: str | None = None
    mqtt_tls_insecure: bool = False

    # Device provisioning — shared secret for device self-registration.
    device_provisioning_secret: str = ""

    # Mosquitto passwd and container details for credential synchronization.
    mosquitto_container_name: str = "aifom-mosquitto-1"
    mosquitto_passwd_path: str = "/workspace/infrastructure/mosquitto/config/passwd"

    # Arduino CLI (optional) – set to the path of the arduino-cli binary to enable
    # server-side .ino compilation. Leave empty to disable (source-only upload mode).
    # Source firmware compilation executes an external compiler and is off by default.
    enable_source_firmware_compile: bool = False
    allow_host_source_firmware_compile: bool = False
    source_firmware_allowed_fqbns: str = "esp32:esp32:esp32"
    arduino_cli_path: str = Field(
        default="",
        validation_alias=AliasChoices("ARDUINO_CLI_PATH", "AIFOM_ARDUINO_CLI_PATH"),
    )

    # Logging controls
    log_level: str = "INFO"  # AIFOM_LOG_LEVEL: DEBUG | INFO | WARNING | ERROR
    log_http: bool = True  # AIFOM_LOG_HTTP: log one line per HTTP request
    log_healthchecks: bool = False  # AIFOM_LOG_HEALTHCHECKS: include /health /ready /metrics

    # Readiness dependencies
    require_mqtt_for_readiness: bool = False
    require_minio_for_readiness: bool = False
    readiness_component_timeout_seconds: float = Field(
        default=5.0,
        ge=0.1,
        le=30.0,
        validation_alias=AliasChoices(
            "READINESS_COMPONENT_TIMEOUT",
            "READINESS_COMPONENT_TIMEOUT_SECONDS",
        ),
    )
    readiness_overall_timeout_seconds: float = Field(
        default=20.0,
        ge=1.0,
        le=60.0,
        validation_alias=AliasChoices(
            "READINESS_OVERALL_TIMEOUT",
            "READINESS_OVERALL_TIMEOUT_SECONDS",
        ),
    )
    readiness_cache_ttl_seconds: float = Field(
        default=10.0,
        ge=0.0,
        le=60.0,
        validation_alias=AliasChoices("READINESS_CACHE_TTL", "READINESS_CACHE_TTL_SECONDS"),
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _validate_readiness_timeouts(self) -> "Settings":
        if self.readiness_overall_timeout_seconds < self.readiness_component_timeout_seconds:
            raise ValueError(
                "READINESS_OVERALL_TIMEOUT must be greater than or equal to "
                "READINESS_COMPONENT_TIMEOUT"
            )
        return self

    # Backward-compatible aliases for existing callers.
    @property
    def mqtt_public_host(self) -> str:
        return self.device_mqtt_host

    @property
    def mqtt_public_port(self) -> int:
        return self.device_mqtt_port

    @property
    def ota_download_base_url(self) -> str:
        return self.device_api_base_url

    @property
    def device_api_port(self) -> int:
        parsed = urlsplit(self.device_api_base_url)
        if parsed.port is not None:
            return parsed.port
        return 443 if parsed.scheme == "https" else 80

    @property
    def source_firmware_allowed_fqbn_set(self) -> set[str]:
        return {
            item.strip() for item in self.source_firmware_allowed_fqbns.split(",") if item.strip()
        }

    @model_validator(mode="after")
    def _align_device_mqtt_port_with_host_mapping(self) -> "Settings":
        """Keep ESP32-facing MQTT port aligned with Docker host mapping in dev.

        ``mqtt_port`` is the broker port seen from inside Docker. Physical
        ESP32 devices need the host-published port. If Docker remaps it, and
        the device-facing port was left at the internal broker port, publish
        the host mapping instead.
        """
        if (
            self.app_env not in {"production", "prod"}
            and self.mqtt_host_port != self.mqtt_port
            and self.device_mqtt_port == self.mqtt_port
        ):
            self.device_mqtt_port = self.mqtt_host_port
        return self

    @model_validator(mode="after")
    def _align_device_api_base_url_with_host_mapping(self) -> "Settings":
        """Keep ESP32-facing API URL aligned with Docker host port in dev."""
        if self.app_env in {"production", "prod"} or self.api_host_port == self.api_port:
            return self

        parsed = urlsplit(self.device_api_base_url)
        if parsed.port != self.api_port:
            return self

        host = parsed.hostname or "aifom.local"
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        netloc = host
        if parsed.username:
            userinfo = parsed.username
            if parsed.password:
                userinfo = f"{userinfo}:{parsed.password}"
            netloc = f"{userinfo}@{netloc}"
        netloc = f"{netloc}:{self.api_host_port}"
        self.device_api_base_url = urlunsplit(
            (
                parsed.scheme or "http",
                netloc,
                parsed.path.rstrip("/"),
                parsed.query,
                parsed.fragment,
            )
        )
        return self

    @model_validator(mode="after")
    def _validate_secrets(self) -> "Settings":
        """Fail fast if critical secrets or migration controls are unsafe."""
        jwt_secret = self.jwt_secret.strip()
        refresh_secret = self.jwt_refresh_secret.strip()
        if (
            not jwt_secret
            or not refresh_secret
            or jwt_secret.lower() in _INSECURE_JWT_SECRETS
            or refresh_secret.lower() in _INSECURE_JWT_SECRETS
            or not _is_encoded_32_byte_secret(jwt_secret)
            or not _is_encoded_32_byte_secret(refresh_secret)
        ):
            logger.critical(
                "SECURITY: JWT_SECRET and JWT_REFRESH_SECRET must be independent values "
                "encoded from at least 32 random bytes (64 hex characters or URL-safe base64). "
                'Generate each with: python -c "import secrets; print(secrets.token_hex(32))"'
            )
            sys.exit(1)
        if jwt_secret == refresh_secret:
            logger.critical("SECURITY: JWT_SECRET and JWT_REFRESH_SECRET must be different.")
            sys.exit(1)
        self.jwt_secret = jwt_secret
        self.jwt_refresh_secret = refresh_secret

        if self.jwt_migration_deadline is not None:
            deadline = self.jwt_migration_deadline
            if deadline.tzinfo is None or deadline.utcoffset() is None:
                logger.critical("SECURITY: JWT_MIGRATION_DEADLINE must include a timezone.")
                sys.exit(1)
            now = datetime.now(timezone.utc)
            deadline = deadline.astimezone(timezone.utc)
            max_deadline = now + timedelta(days=self.auth_refresh_cookie_days)
            if deadline <= now or deadline > max_deadline:
                logger.critical(
                    "SECURITY: JWT_MIGRATION_DEADLINE must be in the future and no later "
                    "than the configured refresh-token lifetime."
                )
                sys.exit(1)
            self.jwt_migration_deadline = deadline

        jwt_algorithm = self.jwt_algorithm.strip().upper()
        if jwt_algorithm not in _ALLOWED_JWT_ALGORITHMS:
            logger.critical(
                "SECURITY: JWT_ALGORITHM must be one of %s.",
                ", ".join(sorted(_ALLOWED_JWT_ALGORITHMS)),
            )
            sys.exit(1)
        self.jwt_algorithm = jwt_algorithm

        same_site = self.auth_cookie_samesite.strip().lower()
        if same_site not in {"lax", "strict", "none"}:
            logger.critical("SECURITY: AUTH_COOKIE_SAMESITE must be lax, strict, or none.")
            sys.exit(1)
        if same_site == "none" and not self.auth_cookie_secure:
            logger.critical("SECURITY: SameSite=None cookies require AUTH_COOKIE_SECURE=true.")
            sys.exit(1)
        self.auth_cookie_samesite = same_site

        if self.app_env in {"production", "prod"}:
            if not self.auth_cookie_secure:
                logger.critical("SECURITY: AUTH_COOKIE_SECURE=true is required in production.")
                sys.exit(1)
            if self.auth_legacy_token_response:
                logger.critical("SECURITY: AUTH_LEGACY_TOKEN_RESPONSE must be false in production.")
                sys.exit(1)

        # Validate OTA_TOKEN_SECRET
        ota_secret = self.ota_token_secret.strip()
        if (
            not ota_secret
            or ota_secret.lower() in _INSECURE_OTA_SECRETS
            or not _is_encoded_32_byte_secret(ota_secret)
        ):
            logger.critical(
                "SECURITY: OTA_TOKEN_SECRET must be encoded from at least 32 random bytes "
                "(64 hex characters or URL-safe base64)."
            )
            sys.exit(1)
        if ota_secret in {self.jwt_secret, self.jwt_refresh_secret}:
            logger.critical("SECURITY: OTA_TOKEN_SECRET must be independent from JWT secrets.")
            sys.exit(1)
        self.ota_token_secret = ota_secret

        if not (self.mqtt_username or "").strip() or not (self.mqtt_password or "").strip():
            logger.critical(
                "SECURITY: MQTT_USERNAME and MQTT_PASSWORD must be set. "
                "Create a local .env from .env.example and use strong MQTT credentials."
            )
            sys.exit(1)

        if self.app_env in {"production", "prod"} and not self.mqtt_tls_enabled:
            logger.critical("SECURITY: MQTT_TLS_ENABLED=true is required in production.")
            sys.exit(1)

        if self.app_env in {"production", "prod"} and not self.minio_secure:
            logger.critical("SECURITY: MINIO_SECURE=true is required in production.")
            sys.exit(1)

        if self.app_env in {"production", "prod"} and self.mqtt_device_user == "aifom_device":
            logger.critical("SECURITY: mqtt_device_user cannot be 'aifom_device' in production.")
            raise ValueError("mqtt_device_user cannot be 'aifom_device' in production.")

        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
