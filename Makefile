.PHONY: dev-up dev-down dev-build logs api-shell db-shell mqtt-test demo-up demo-down demo-seed demo-reset test test-api test-web lint format seed-admin seed-all

COMPOSE=docker compose --env-file .env -f infrastructure/docker-compose.dev.yml

dev-up:
	powershell -NoProfile -Command "if (!(Test-Path .env)) { Copy-Item .env.example .env }"
	$(COMPOSE) up -d --remove-orphans

dev-down:
	$(COMPOSE) down

dev-build:
	powershell -NoProfile -Command "if (!(Test-Path .env)) { Copy-Item .env.example .env }"
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

api-shell:
	$(COMPOSE) exec api sh

db-shell:
	$(COMPOSE) exec postgres psql -U aifom -d aifom

mqtt-test:
	$(COMPOSE) exec mosquitto mosquitto_pub -h localhost -t devices/test/status -m "{\"status\":\"ok\"}"

# ---------- Demo (graduation evaluation) ----------

seed-admin:
	$(COMPOSE) exec api python /workspace/scripts/seed_admin.py
	$(COMPOSE) exec api python /workspace/scripts/reset_service_plans.py

seed-all: seed-admin

demo-up:
	powershell -NoProfile -Command "if (!(Test-Path .env)) { Copy-Item .env.example .env }"
	$(COMPOSE) up -d --remove-orphans
	$(COMPOSE) exec api python /workspace/scripts/seed_admin.py
	$(COMPOSE) exec api python /workspace/scripts/reset_service_plans.py

demo-down:
	$(COMPOSE) down

demo-seed: seed-admin

# Truncate operational tables but keep devices + firmware so re-seeding is fast.
demo-reset:
	$(COMPOSE) exec postgres psql -U aifom -d aifom -c \
	  "TRUNCATE telemetry, ota_jobs RESTART IDENTITY CASCADE;"

# ---------- Alembic migrations ----------

# Apply all pending migrations (runs inside the api container).
migrate:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && alembic upgrade head"

# Show current migration version.
migrate-current:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && alembic current"

# Create a new autogenerate migration (provide MSG="description").
MSG ?= "auto migration"
migrate-new:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && alembic revision --autogenerate -m '$(MSG)'"

# Stamp an existing database as fully migrated (use after upgrading from create_all).
migrate-stamp:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && alembic stamp head"

# ---------- Tests & Quality ----------

# Run all test suites (default: api only; extend as needed).
test: test-api

# Run backend pytest suite inside the running api container.
# All tests are offline (no real Postgres/MQTT/MinIO needed).
test-api:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && pip install -e '.[dev]' -q && pytest tests/ -q"

# Run frontend Vitest suite on the host.
# Prerequisite: cd frontend && npm install
test-web:
	cd frontend && npm run test

# Ruff lint check (exit 1 on any violation).
lint:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && ruff check app/ tests/"

# Ruff auto-format (modifies files in place).
format:
	$(COMPOSE) exec api sh -c "cd /workspace/backend && ruff format app/ tests/"
