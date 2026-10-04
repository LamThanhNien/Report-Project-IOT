# Infrastructure

Development and production infrastructure use Docker Compose.
All compose commands assume you are at the repo root and have a
populated `.env` (copy `.env.example` if you don't).

```
infrastructure/
├── docker-compose.dev.yml            # base dev stack: postgres, mosquitto, minio, api
├── docker-compose.prod.yml           # TLS and container hardening
├── postgres/                         # init SQL + TimescaleDB bootstrap
├── mosquitto/                        # authenticated broker config
├── minio/                            # placeholders (minio is configured via env vars)
├── k8s/                              # optional K3s manifests (not yet wired up)
└── docker/                           # auxiliary Dockerfiles, if any
```

## Dev stack

```bash
make dev-up        # docker compose ... -f infrastructure/docker-compose.dev.yml up -d
make dev-down
make dev-build     # rebuild backend image
make logs          # follow container logs
```

Backend at <http://localhost:8000>, Mosquitto at `localhost:${MQTT_HOST_PORT:-1883}`,
MinIO console at <http://localhost:9001>.

## Runtime checks

The API exposes `/health` for liveness and `/ready` for dependency readiness.
Use `make logs` for API and broker diagnostics. The default stack contains
four services: PostgreSQL/TimescaleDB, MinIO, Mosquitto, and the API.

## Validate compose

```bash
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml config -q
```

## K3s

`infrastructure/k8s/` is scaffolded but not yet operational. The current target
is docker-compose; K3s is on the optional roadmap (see `docs/scope.md`).
