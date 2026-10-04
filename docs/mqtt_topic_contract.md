# MQTT Topic Contract

## Overview
This document enumerates the **current** MQTT topic contract used by AIFOM. All topics follow the pattern `devices/{device_uid}/...` where `{device_uid}` is the unique identifier of a device. The broker‑layer enforces per‑device isolation using the Mosquitto ACL pattern with `username = device_uid`.

---

## Topics
| Topic (template) | Direction | Typical Payload | QoS | Retain | ACL (production) |
|-------------------|-----------|----------------|-----|--------|-------------------|
| `devices/{device_uid}/telemetry` | Device → Backend | Telemetry JSON | 0 | No | `pattern write devices/%u/telemetry` |
| `devices/{device_uid}/telemetry/ch_v{pin}` | Device → Backend | Raw string value (e.g. `"26.5"`) | 0 | No | `pattern write devices/%u/telemetry/ch_v+` |
| `devices/{device_uid}/status` | Device → Backend | Status object | 0 | No | `pattern write devices/%u/status` |
| `devices/{device_uid}/heartbeat` | Device → Backend | Simple heartbeat (empty) | 0 | No | `pattern write devices/%u/heartbeat` |
| `devices/{device_uid}/events` | Device → Backend | Event data (JSON) | 0 | No | `pattern write devices/%u/events` |
| `devices/{device_uid}/commands` | Backend → Device | Command JSON | 1 | Optional | `pattern read devices/%u/commands` |
| `devices/{device_uid}/commands/ch_v{pin}` | Backend → Device | Raw string value (e.g. `"1"`) | 1 | Optional | `pattern read devices/%u/commands/ch_v+` |
| `devices/{device_uid}/ota` | Backend → Device | OTA trigger (JSON) | 1 | Optional | `pattern read devices/%u/ota` |
| `devices/{device_uid}/ota/status` | Device → Backend | OTA result/status JSON | 0 | No | `pattern write devices/%u/ota/status` |

---

## ACL Principles (Production)
* **Deny‑by‑default** – any operation not explicitly allowed is denied.
* **Per‑device isolation** – each device authenticates with `username = device_uid`. The ACL `pattern` directives ensure a device can only read/write its own topics.
* **Backend service account** – `aifom_backend` has minimal read/write rights needed for telemetry aggregation, command delivery, and OTA handling (see `acl.prod`).
* **Shared demo user** – `aifom_device` must **never** appear in production ACL or password files.

---

## Tenant Isolation
Tenant isolation is enforced **at the application layer** (database checks in the `device_registry` bounded context). The broker does not embed tenant identifiers in topic names for this release.

---

## Future Work (RFC)
A possible future redesign could move to a hierarchical contract `tenant/{tenantId}/device/{deviceId}/...` to enable broker‑level tenant isolation. This is **out of scope** for the current remediation.

---

## Maintenance
* When adding new device‑side topics, update this document **and** add a corresponding `pattern` line in `acl.prod`.
* Run `graphify update .` after any ACL change to keep the knowledge graph current.

---

## Local Verification (SEC-04)
To verify the MQTT Access Control List (ACL) configuration locally using the test broker fixture, execute:

```bash
docker compose -f tester/mqtt/docker-compose.acl.yml up -d
cd backend
uv run pytest -q tests/test_mqtt_acl_matrix.py
cd ..
docker compose -f tester/mqtt/docker-compose.acl.yml down
```
