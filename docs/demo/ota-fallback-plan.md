# OTA Fallback Plan

Live OTA requires a physical ESP32 that is flashed, configured and registered.
Prepare a spare board before the demo. See [firmware setup](../esp32_firmware_setup.md)
and [LAN/mDNS setup](../esp32_physical_demo_mdns.md).

## Job remains at `sent`

Check that the ESP32 is online and uses the same registered UID as the OTA job.
Inspect serial logs for MQTT connection and subscription to `devices/{uid}/ota`.
The firmware starts this subscription through `ota_client_start()` and restores
subscriptions after reconnect. Check MQTT credentials and broker logs if it
cannot connect. After restoring connectivity, create a new OTA job.

## Broker unavailable or publish failed

Check API and broker logs before retrying. If Mosquitto is stopped:

```bash
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml start mosquitto
```

Once the broker is reachable, create a new job. Keep the failed job for its
error history.

## Firmware download fails

The firmware URL must be reachable from the ESP32 network. Configure the
API's device-facing base URL in `.env`, using the actual exposed API port:

```env
DEVICE_API_BASE_URL=http://aifom.local:8000
```

Use the host's LAN IP if hostname resolution is unavailable. A device cannot
resolve Docker service names such as `api`, and `localhost` refers to the
board itself. Apply the environment change by recreating the API service,
then inspect the new job's URL and device serial log:

```bash
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml up -d api
```

## Checksum, image or partition failure

Inspect the device's `error_code` and message. Rebuild/upload a compatible
ESP32 binary and confirm file size, SHA-256 and partition capacity before
creating another job. Do not retry a known incompatible image unchanged.

## Device returns to an older image after reboot

Inspect serial logs and the running firmware version. The reference firmware
calls `ota_client_mark_running_valid()` during startup after initializing
MQTT and telemetry; this confirms an image pending verification when the
bootloader rollback configuration is enabled. Recover a failing build with
USB flashing or a prepared spare board.

A device's `success` report is emitted before reboot in the reference OTA
client. Verify the post-reboot version and connection separately.

## Board unavailable or recovery takes too long

Show firmware metadata and existing OTA job history, state which live checks
could not be completed, and continue with another connected board if available.
The demo seed creates accounts/workspace only; it does not create firmware,
OTA jobs or telemetry. Do not present a `sent` job as a completed update.
