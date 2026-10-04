#!/usr/bin/env bash
# rotate_mqtt_certs.sh - Rotate Mosquitto TLS certificates and reload the broker
# This script assumes the new certificates are placed in ./mosquitto/certs before execution.
# It copies them into the Docker volume (if using volume) or mounts and triggers a broker reload.
set -euo pipefail

CERT_DIR="$(dirname "$0")/../mosquitto/certs"
# Verify required files exist
for f in ca.crt server.crt server.key; do
  if [[ ! -f "$CERT_DIR/$f" ]]; then
    echo "Error: $f not found in $CERT_DIR"
    exit 1
  fi
done

# Copy certificates into the Mosquitto container (assuming Docker Compose name 'mosquitto')
CONTAINER="$(docker compose -f ../infrastructure/docker-compose.prod.yml ps -q mosquitto)"
if [[ -z "$CONTAINER" ]]; then
  echo "Mosquitto container not running. Exiting."
  exit 1
fi

echo "Copying certificates into container $CONTAINER"
for f in ca.crt server.crt server.key; do
  docker cp "$CERT_DIR/$f" "$CONTAINER:/mosquitto/certs/$f"
done

echo "Reloading Mosquitto configuration"
# Send SIGHUP to reload TLS certs
docker exec "$CONTAINER" sh -c "kill -HUP $(cat /var/run/mosquitto.pid)"

echo "Certificate rotation completed."

