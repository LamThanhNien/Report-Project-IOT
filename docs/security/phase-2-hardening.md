# Phase 2 Security Hardening

Date: 2026-05-31

## Browser Auth

- Browser sessions use httpOnly cookies:
  - `aifom_access_token`
  - `aifom_refresh_token`
  - `aifom_csrf_token` (readable by the frontend for double-submit CSRF)
- Frontend API requests use `credentials: "include"`.
- Mutating frontend requests send `X-CSRF-Token` from `aifom_csrf_token`.
- Local CLI and tester flows can continue using `Authorization: Bearer <token>` while `AUTH_LEGACY_TOKEN_RESPONSE=true`.
- Production must set `AUTH_COOKIE_SECURE=true` and `AUTH_LEGACY_TOKEN_RESPONSE=false`.

Migration:

1. Deploy backend first with cookie auth enabled.
2. Deploy frontend after backend CORS allows credentials.
3. Existing browser `localStorage` tokens are deleted by the new frontend on startup.
4. Verify F5 refresh by loading `/auth/me` with cookies, then `/auth/refresh` if the access cookie expired.
5. Verify logout clears all auth cookies and frontend state.

## SSE Auth

`/api/v1/client/devices/status/stream` is now cookie-authenticated. JWTs must not be placed in URL query strings. Browser reconnect behavior remains native `EventSource` behavior:

```ts
new EventSource("/api/v1/client/devices/status/stream", { withCredentials: true })
```

## Firmware Signing Plan

Current OTA checksum validation remains unchanged. Phase 2 adds metadata columns so signed releases can be introduced without changing the ESP32 demo flow:

- `checksum_sha256`: existing SHA-256 digest of the firmware bytes.
- `signature_alg`: expected value `ed25519`.
- `signature_payload`: expected value `sha256`.
- `signature`: base64 Ed25519 signature over the lowercase hex `checksum_sha256`.
- `signing_key_id`: stable key identifier, for example `prod-ed25519-2026-q2`.

Proposed Ed25519 flow:

1. CI builds `firmware.bin`.
2. CI computes `sha256 = SHA256(firmware.bin)`.
3. CI signs the ASCII lowercase hex SHA-256 string with an offline Ed25519 private key.
4. CI uploads firmware plus `signature_alg=ed25519`, `signature_payload=sha256`, `signature`, and `signing_key_id`.
5. Backend stores metadata and continues returning checksum metadata.
6. Firmware downloads the binary, verifies SHA-256 first, then verifies the Ed25519 signature using a pinned public key.
7. On signature failure, firmware must reject the update and publish OTA failure status.

## MQTT TLS

Local development keeps `mqtt://aifom.local:1883` for ESP32 demos. Production should use `mqtts://...:8883`:

- Backend: `MQTT_TLS_ENABLED=true`, `MQTT_PORT=8883`, and a CA path in `MQTT_TLS_CA_CERT`.
- Mosquitto: `infrastructure/mosquitto/config/mosquitto.prod.conf`.
- Firmware: set `CONFIG_AIFOM_MQTT_SCHEME="mqtts"` and `CONFIG_AIFOM_MQTT_PORT=8883`.

The local mDNS publisher still defaults to 1883. For a TLS demo, run it with `--mqtt-port 8883`.

## MinIO TLS

Local development keeps `MINIO_SECURE=false` and HTTP health checks. Production uses `MINIO_SECURE=true`, MinIO HTTPS certificates mounted at `infrastructure/minio/certs`, and the production Compose health check over HTTPS.

## Containers

- `infrastructure/docker-compose.dev.yml` remains optimized for development with source mounts and local ports.
- `infrastructure/docker-compose.prod.yml` removes the broad source mount, adds resource limits, drops Linux capabilities for the API, uses `no-new-privileges`, runs the API filesystem read-only with `/tmp` tmpfs, and requires TLS-oriented environment settings.

Production start example:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f infrastructure/docker-compose.prod.yml up -d --build
```
