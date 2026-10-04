# Docker Compose

`docker-compose.dev.yml` is the local development stack. It keeps plaintext
MQTT on 1883 and source-code mounts so the ESP32 physical demo and backend
reload loop keep working.

Included services:

- `api`
- `postgres`
- `mosquitto`
- `minio`

Run from the repository root:

```bash
make dev-up
```

Frontend runtime runs on the host through the Windows launcher or `npm run dev`.

`docker-compose.prod.yml` is the hardened production-oriented stack:

- MQTT listens on TLS port 8883.
- MinIO runs with HTTPS certificates.
- API runs without the broad workspace mount, with resource limits,
  dropped capabilities, `no-new-privileges`, read-only root filesystem, and
  `/tmp` tmpfs.

Run production mode from the repository root:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f infrastructure/docker-compose.prod.yml up -d --build
```
