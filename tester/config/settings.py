import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@aifom.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

TENANT1_EMAIL = os.getenv("TENANT1_EMAIL", "tenant1@aifom.local")
TENANT1_PASSWORD = os.getenv("TENANT1_PASSWORD", "")

TENANT2_EMAIL = os.getenv("TENANT2_EMAIL", "tenant2@aifom.local")
TENANT2_PASSWORD = os.getenv("TENANT2_PASSWORD", "")

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_TIMEOUT = int(os.getenv("MQTT_TIMEOUT", "10"))

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))

VALID_OTA_STATUSES = {
    "pending",
    "sent",
    "accepted",
    "downloading",
    "flashing",
    "rebooting",
    "success",
    "failed",
}
