#!/bin/sh
# Mosquitto entrypoint — generates password file from environment variables
# if it does not already exist.
#
# Environment variables:
#   MQTT_ADMIN_USER
#   MQTT_ADMIN_PASSWORD
#   MQTT_DEVICE_USER
#   MQTT_DEVICE_PASSWORD

PASSWD_FILE="/mosquitto/config/passwd"
ACL_FILE="/mosquitto/config/acl"

# Always regenerate the password file from environment variables.
# This ensures credentials stay in sync with .env even after password changes.
if [ "${MQTT_PASSWORD_FILE_MANAGED_EXTERNALLY:-false}" = "true" ]; then
    if [ ! -r "$PASSWD_FILE" ]; then
        echo "[mqtt-entrypoint] externally managed password file is missing" >&2
        exit 1
    fi
    echo "[mqtt-entrypoint] Using externally managed per-device password file"
else
    : "${MQTT_ADMIN_USER:?MQTT_ADMIN_USER is required}"
    : "${MQTT_ADMIN_PASSWORD:?MQTT_ADMIN_PASSWORD is required}"
    : "${MQTT_DEVICE_USER:?MQTT_DEVICE_USER is required}"
    : "${MQTT_DEVICE_PASSWORD:?MQTT_DEVICE_PASSWORD is required}"

    echo "[mqtt-entrypoint] Generating development password file: $PASSWD_FILE"
    rm -f "$PASSWD_FILE"
    mosquitto_passwd -c -b "$PASSWD_FILE" "$MQTT_ADMIN_USER" "$MQTT_ADMIN_PASSWORD"
    mosquitto_passwd -b "$PASSWD_FILE" "$MQTT_DEVICE_USER" "$MQTT_DEVICE_PASSWORD"
    chmod 0700 "$PASSWD_FILE"
    chown mosquitto:mosquitto "$PASSWD_FILE" 2>/dev/null || true
    echo "[mqtt-entrypoint] Development users created: $MQTT_ADMIN_USER, $MQTT_DEVICE_USER"
fi
chmod 0700 "$ACL_FILE" 2>/dev/null || true
chown mosquitto:mosquitto "$ACL_FILE" 2>/dev/null || true

# Start Mosquitto
exec mosquitto -c /mosquitto/config/mosquitto.conf
