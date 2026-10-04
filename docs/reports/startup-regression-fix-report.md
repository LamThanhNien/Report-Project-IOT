# Startup Regression Fix Report

**Date**: 2026-06-01
**Issue**: `run-aifom.bat` fails — mosquitto unhealthy → dependency chain fails

---

## Root Cause

Two issues combined to break the Mosquitto healthcheck:

### 1. ACL denied `$SYS/#` to backend user (code/config fix)

The Mosquitto healthcheck subscribes to `$SYS/broker/uptime` using the `aifom_backend` user:
```
mosquitto_sub -h 127.0.0.1 -C 1 -t '$$SYS/broker/uptime' -u $${MQTT_ADMIN_USER} -P $${MQTT_ADMIN_PASSWORD} -W 3
```

But the ACL file only granted `$SYS/#` read to the `aifom_device` user, not `aifom_backend`. The healthcheck timed out (ExitCode 27) on every attempt, marking mosquitto as unhealthy.

### 2. Stale Mosquitto passwd file (local environment issue)

The `docker-entrypoint.sh` only generated the passwd file if it didn't already exist:
```sh
if [ ! -f "$PASSWD_FILE" ]; then
    # generate...
fi
```

If the Docker volume already contained a passwd file from a previous run with different credentials, the entrypoint would skip regeneration. The `.env` had `MQTT_DEVICE_PASSWORD=aifom_backend_pass` but the passwd file had a hash from the old `aifom_device_pass` credential. The `aifom_device` user couldn't authenticate.

---

## Changes Made

### Code/Config Fixes

| File | Change |
|---|---|
| `infrastructure/mosquitto/config/acl` | Added `topic read $SYS/#` to `aifom_backend` user (healthcheck needs it) |
| `infrastructure/mosquitto/docker-entrypoint.sh` | Always regenerate passwd file from env vars (prevents stale credential mismatch) |
| `tester/mqtt/test_mqtt_connection.py` | Changed loopback topic to `aifom/devices/test_loopback/telemetry` (ACL-compliant) |

### Local Environment State

The `tester/.env` had `MQTT_PASSWORD=aifom_device_pass` but the main `.env` has `MQTT_DEVICE_PASSWORD=aifom_backend_pass`. This was already fixed in the previous session but the stale Docker volume had the old passwd file.

---

## Commands Run

### Reproduce
```
docker compose --env-file .env -p aifom -f infrastructure/docker-compose.dev.yml -f infrastructure/docker-compose.observability.yml up -d
```
Result: `dependency failed to start: container aifom-mosquitto-1 is unhealthy`

### Diagnose
```
docker inspect aifom-mosquitto-1 --format "{{json .State.Health}}"
```
Result: `{"Status":"unhealthy","FailingStreak":39,"Log":[{"ExitCode":27,"Output":"Timed out"}]}`

```
docker exec aifom-mosquitto-1 mosquitto_sub -h 127.0.0.1 -C 1 -t '$SYS/broker/uptime' -u aifom_backend -P aifom_backend_pass -W 3
```
Result: `Timed out` (ExitCode 27) — ACL denied

```
docker exec aifom-mosquitto-1 mosquitto_pub -h 127.0.0.1 -t 'test/ping' -m 'hello' -u aifom_device -P aifom_backend_pass
```
Result: `Connection Refused: not authorised` — stale passwd hash

### Fix
```
docker compose --env-file .env -p aifom -f infrastructure/docker-compose.dev.yml -f infrastructure/docker-compose.observability.yml down
docker compose --env-file .env -p aifom -f infrastructure/docker-compose.dev.yml -f infrastructure/docker-compose.observability.yml up -d
```

### Validation
```
docker compose --env-file .env -p aifom -f infrastructure/docker-compose.dev.yml -f infrastructure/docker-compose.observability.yml ps
```
Result: All 6 containers running, 4 healthy (mosquitto, postgres, minio, api)

```
curl http://localhost:8000/health  → {"status":"ok","service":"aifom-api"}
curl http://localhost:8000/ready   → {"status":"ready","service":"aifom-api"}
```

```
python -m pytest mqtt/test_mqtt_connection.py -v → 4/4 passed
```

---

## Local Action Required

**None for fresh installs.** The entrypoint now always regenerates the passwd file.

**For existing environments with stale volumes:** Just run `run-aifom.bat` — the updated entrypoint will regenerate the passwd file automatically on next container start.

If you want a completely clean slate:
```
docker compose --env-file .env -p aifom -f infrastructure/docker-compose.dev.yml -f infrastructure/docker-compose.observability.yml down
docker volume rm aifom_mosquitto_data  # optional: clear stale mosquitto data
run-aifom.bat
```

---

## Before/After

| Metric | Before | After |
|---|---|---|
| `run-aifom.bat` | FAIL (mosquitto unhealthy) | PASS (all healthy) |
| Mosquitto healthcheck | Timed out (ExitCode 27) | Passes (117 seconds uptime) |
| Device user auth | Connection Refused | Connected successfully |
| MQTT tests | 0/4 (no connection) | 4/4 passed |
| API health | N/A (dependency chain failed) | healthy + ready |
