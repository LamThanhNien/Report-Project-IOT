#!/usr/bin/env bash
# Generate Mosquitto password file for AIFOM local development.
#
# Usage:
#   bash scripts/generate_mqtt_passwords.sh
#
# This creates infrastructure/mosquitto/config/passwd with default users:
#   - aifom_backend  (for the FastAPI backend subscriber)
#   - aifom_device   (for ESP32 devices — use per-device creds in production)
#
# The password file is .gitignored. Never commit real credentials.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASSWD_FILE="$PROJECT_ROOT/infrastructure/mosquitto/config/passwd"

# Check if mosquitto_passwd is available
if ! command -v mosquitto_passwd &>/dev/null; then
    echo "ERROR: mosquitto_passwd not found."
    echo "Install Mosquitto client tools or create the password file manually:"
    echo "  mosquitto_passwd -c $PASSWD_FILE aifom_backend"
    echo ""
    echo "For Docker-based development, you can use:"
    echo "  docker run --rm -v \"$PROJECT_ROOT/infrastructure/mosquitto/config:/config\" "
    echo "    eclipse-mosquitto:2 mosquitto_passwd -c /config/passwd aifom_backend"
    exit 1
fi

echo "Generating Mosquitto password file at: $PASSWD_FILE"
echo ""

# Create with backend user
read -rsp "Enter password for 'aifom_backend' (backend subscriber): " BACKEND_PASS
echo ""
read -rsp "Enter password for 'aifom_device' (device connections): " DEVICE_PASS
echo ""

mosquitto_passwd -c "$PASSWD_FILE" aifom_backend <<< "$BACKEND_PASS"
mosquitto_passwd -b "$PASSWD_FILE" aifom_device "$DEVICE_PASS"

echo ""
echo "Password file created: $PASSWD_FILE"
echo "Users: aifom_backend, aifom_device"
echo ""
echo "Update your .env with:"
echo "  MQTT_USERNAME=aifom_backend"
echo "  MQTT_PASSWORD=<your-backend-password>"
echo ""
echo "For ESP32 firmware, set in sdkconfig.defaults.local:"
echo "  CONFIG_AIFOM_MQTT_USERNAME=\"aifom_device\""
echo "  CONFIG_AIFOM_MQTT_PASSWORD=\"<your-device-password>\""
