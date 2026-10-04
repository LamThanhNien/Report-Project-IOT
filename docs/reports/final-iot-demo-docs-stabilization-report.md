# Final IoT/Demo/Docs Stabilization Report

**Date**: 2026-06-01
**Branch**: release/final-3-days
**Scope**: IoT simulators, demo documentation, seed scripts, mDNS tools, defense preparation

---

## Executive Summary

Stabilization pass focused on documentation accuracy, demo reliability, and
defense preparation. No production code was modified. Changes are limited to
docs, iot/README, and the top-level README.

| Category | Status |
|----------|--------|
| Demo script | ✅ Fixed MQTT topic references |
| Demo checklist | ✅ Added simulator fallback section |
| Simulator fallback guide | ✅ Created |
| OTA fallback plan | ✅ Created |
| Defense questions | ✅ Created |
| Top-level README | ✅ Created |
| MQTT topic consistency | ✅ Aligned docs with code |

---

## Changed Files

| File | Change | Reason |
|------|--------|--------|
| `README.md` | **Created** | Missing top-level README; added quick-start, architecture, commands, credentials |
| `docs/demo/demo-script.md` | Fixed MQTT topics | Changed `aifom/devices/` → `devices/` to match actual backend code |
| `docs/demo/demo-data.md` | Fixed MQTT topic | Changed `aifom/devices/` → `devices/` |
| `docs/demo/demo-checklist.md` | Added simulator fallback section | Added checklist items for simulator-based demo |
| `docs/demo/troubleshooting.md` | Added cross-references | Links to new simulator-fallback and ota-fallback-plan docs |
| `docs/demo/simulator-fallback.md` | **Created** | Guide for using fleet/single simulator when ESP32 unavailable |
| `docs/demo/ota-fallback-plan.md` | **Created** | OTA failure scenarios and recovery procedures |
| `docs/thesis/defense-questions.md` | **Created** | 25+ anticipated defense questions with answers |
| `iot/README.md` | Updated MQTT contract | Added topic table with direction/QoS/description |

---

## MQTT Topic Alignment

### Issue Found
The demo-script.md and demo-data.md referenced topics with `aifom/devices/`
prefix (e.g., `aifom/devices/esp32-demo-001/telemetry`), but the actual
backend code uses `devices/` as the primary prefix.

### Backend Topic Structure (from `mqtt_topics.py`)
- **Primary**: `devices/{uid}/telemetry`, `devices/{uid}/status`, `devices/{uid}/ota`
- **Legacy**: `aifom/devices/{uid}/telemetry` (still accepted for backward compatibility)

### Simulator Topic Structure (from `simulate_fleet.py`)
- Uses `devices/{uid}/telemetry` (correct, matches primary)

### Fix Applied
Updated all demo documentation to use the primary `devices/` prefix.
Added notes about legacy `aifom/devices/` backward compatibility.

---

## New Documentation

### 1. Top-level README.md
- Quick start with `run-aifom.bat start-seed`
- Architecture diagram
- User roles table
- Project structure
- Demo flow summary
- Key commands table
- Links to all major docs

### 2. Simulator Fallback Guide (`docs/demo/simulator-fallback.md`)
- Single device simulator usage
- Fleet simulator usage with all options
- Three demo options (fleet, single, continuous)
- Verification steps
- Simulator vs real ESP32 comparison table
- Troubleshooting section

### 3. OTA Fallback Plan (`docs/demo/ota-fallback-plan.md`)
- 6 failure scenarios with fixes
- Quick recovery script
- Option to skip OTA in demo if broken
- Audience-facing explanations for each failure

### 4. Defense Questions (`docs/thesis/defense-questions.md`)
- 25+ questions organized by topic:
  - System Architecture (3 questions)
  - MQTT and Device Communication (4 questions)
  - OTA Updates (3 questions)
  - Security (4 questions)
  - Frontend and UX (2 questions)
  - Testing (2 questions)
  - IoT and Edge Computing (3 questions)
  - Deployment and Operations (2 questions)
  - Limitations and Future Work (2 questions)
  - Demo-Specific (2 questions)
- Each answer includes references to code/docs

---

## Manual Verification

### 1. README.md
- Open `README.md` in a markdown viewer
- Verify all links point to existing files
- Verify credentials match `.env.example` defaults

### 2. Demo Script Topics
- Search `docs/demo/demo-script.md` for `aifom/devices` — should find 0 matches
- Search for `devices/` — should find correct topic references

### 3. Simulator Fallback
- Run `make demo-simulate` — should complete with `publish errors: 0`
- Check API log for `MQTT telemetry stored` lines
- Open frontend, verify device count increases

### 4. OTA Fallback Plan
- Read `docs/demo/ota-fallback-plan.md`
- Verify all referenced commands work:
  - `docker compose ps mosquitto`
  - `curl http://localhost:8000/health`

### 5. Defense Questions
- Read `docs/thesis/defense-questions.md`
- Verify referenced files exist:
  - `docs/adr/ADR-001-modular-monolith.md`
  - `tester/api/test_03_tenant_isolation.py`
  - `scripts/aifom_mdns_publisher.py`

---

## Remaining Risks

### P0 Risks (Demo-Blocking)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Docker not running | Stack won't start | Check Docker Desktop before demo |
| Port conflicts | Containers fail to bind | `netstat -ano \| findstr LISTENING` |
| JWT secret insecure | Backend refuses to start | Use `.env.example` defaults or generate new |
| MQTT broker down | No telemetry/OTA | `docker compose start mosquitto` |
| Frontend not built | No web UI | `cd frontend && npm install && npm run dev` |

### P1 Risks (Demo-Impairing)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Simulator not connecting | No telemetry data | Check MQTT port, use `--mqtt-host localhost` |
| OTA stuck at `sent` | No OTA demo | Start simulator with `--simulate-ota` |
| Anomaly model not trained | 503 on anomaly endpoint | Run `make demo-simulate` then train model |
| mDNS not working | ESP32 can't find broker | Use simulator fallback, or hardcode IP |
| Seed script fails | No demo data | Re-run `run-aifom.bat seed-demo` |

### P2 Risks (Non-Blocking)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Grafana not provisioned | No dashboards | Use Prometheus UI directly |
| MLflow not configured | No ML tracking | Not needed for demo |
| E2E tests flaky | Test report shows failures | API/MQTT tests are reliable |

---

## What Was NOT Changed

Per CLAUDE.md rules:
- ❌ No backend production code modified
- ❌ No frontend production code modified
- ❌ No firmware rewritten
- ❌ No MQTT topics changed
- ❌ No legacy modules deleted
- ❌ No DDD migration forced
- ❌ No new features added

---

## Files Not Modified (Verified Stable)

| File | Status | Notes |
|------|--------|-------|
| `scripts/seed_admin.py` | Stable | Idempotent, works correctly |
| `scripts/seed_demo.py` | Stable | Idempotent, handles 409 gracefully |
| `scripts/seed_tenant_demo.py` | Stable | Creates plans, tenants, users, capabilities |
| `iot/simulator/simulate_device.py` | Stable | Single device simulator, OTA support |
| `iot/simulator/simulate_fleet.py` | Stable | Fleet simulator, OTA + anomaly injection |
| `scripts/aifom_mdns_publisher.py` | Stable | mDNS publisher, auto-detects LAN IP |
| `scripts/check_mdns_mqtt.py` | Stable | mDNS discovery checker |
| `run-aifom.ps1` | Stable | Full launcher, all actions working |
| `Makefile` | Stable | All demo targets working |

---

## Recommendations for Demo Day

1. **Run `run-aifom.bat start-seed` 10 minutes before the demo** — allows
   time for Docker startup, health checks, and seeding.

2. **Keep `make logs` running** — makes telemetry/OTA moments visible.

3. **Have the simulator ready** — `make demo-simulate` in a separate terminal
   as a fallback if the ESP32 is unstable.

4. **Pre-train the anomaly model** — run `make demo-simulate` then train
   before the demo so the anomaly endpoint returns data immediately.

5. **Keep `docs/demo/troubleshooting.md` open** — quick reference for
   common failure modes.

6. **Test the full demo flow once** — run through `docs/demo/demo-script.md`
   end-to-end before the actual presentation.
