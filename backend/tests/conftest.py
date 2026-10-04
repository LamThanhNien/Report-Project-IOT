import os


# Configure test-only secrets before application modules are imported. Production
# code contains no pytest/module-based secret-validation bypass.
import slowapi

original_init = slowapi.Limiter.__init__


def mock_limiter_init(self, *args, **kwargs):
    kwargs["enabled"] = False
    original_init(self, *args, **kwargs)


slowapi.Limiter.__init__ = mock_limiter_init

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET", "0123456789abcdef" * 4)
os.environ.setdefault("JWT_REFRESH_SECRET", "fedcba9876543210" * 4)
os.environ.setdefault("OTA_TOKEN_SECRET", "00112233445566778899aabbccddeeff" * 2)
os.environ.setdefault("OTA_TOKEN_EXPIRE_MINUTES", "15")
os.environ.setdefault("MQTT_USERNAME", "aifom-test-api")
os.environ.setdefault("MQTT_PASSWORD", "aifom-test-password")

from app import main as app_main  # noqa: E402

# Prevent background threads from starting during any tests.
app_main.mqtt_subscriber.start = lambda: None
app_main.mqtt_subscriber.stop = lambda: None
app_main.device_presence_monitor.start = lambda: None
app_main.device_presence_monitor.stop = lambda: None
