# AIFOM Demo Troubleshooting

Known failure modes and fixes. Skim before the demo; have this file open
in a side tab during.

**Related guides**:
- [ESP32 setup](../esp32_firmware_setup.md) — building and flashing a physical board
- [`ota-fallback-plan.md`](ota-fallback-plan.md) — OTA failure recovery procedures

## Stack won't start

**Symptom**: `make demo-up` exits with a Postgres health-check failure.

- Postgres needs ~5–10 s on first boot to initialise TimescaleDB. Retry
  `make demo-up` once.
- If a previous run left a corrupt volume:
  ```bash
  make demo-down
  docker compose --env-file .env -f infrastructure/docker-compose.dev.yml down -v
  make demo-up
  ```
- Port 5432, 1883, 8000, 9000 must be free. Check with
  `netstat -ano | findstr LISTENING` (Windows) and stop the offender.

## Seed step fails

Run `run-aifom.bat seed-demo` after the API/database stack is ready. This creates
dedicated accounts and a workspace; it does not launch devices or publish
telemetry. Inspect command output for database/migration errors and verify
`APP_ENV=development`. Existing accounts/data are preserved by the seed.

## Frontend (web-admin) won't connect

**Symptom**: pages render but every API call fails with a CORS error in
DevTools.

- `.env` must include the frontend origin in `CORS_ALLOW_ORIGINS`
  (default already covers `localhost:5173` / `127.0.0.1:5173`). Restart
  the api container after editing.
- If you load the dev UI from a non-default origin (e.g. an Ngrok URL),
  add it to `CORS_ALLOW_ORIGINS` and `docker compose restart api`.

## Telemetry not appearing

Check that the physical ESP32 is connected to Wi-Fi/MQTT, uses the registered
UID and publishes to `devices/{uid}/telemetry`. Confirm tenant/project ownership
when viewing telemetry. Unregistered UIDs are ignored by the backend.

Inspect API and broker logs with `run-aifom.bat logs`, plus the ESP32 serial
monitor. Verify broker credentials and the actual MQTT host port in `.env`.
The demo seed provides accounts/workspace only and creates no telemetry.

## ESP32 cannot reach the broker

**Symptom**: `monitor` output shows `WIFI_EVENT_STA_START` and
`got IP …`, but no `MQTT_EVENT_CONNECTED`.

### Step 1: Check mDNS publisher is running

The ESP32 discovers MQTT via mDNS. The host-side mDNS publisher must be
running on your Windows machine (not inside Docker):

```bat
scripts\start_mdns_publisher.bat
```

Verify discovery works from the host:

```bat
scripts\check_mdns.bat
```

### Step 2: Check sdkconfig.defaults.local

Ensure `sdkconfig.defaults.local` does NOT hardcode an IP:

```ini
# CORRECT — use mDNS discovery
CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY=y
CONFIG_AIFOM_MDNS_HOST="aifom.local"
CONFIG_AIFOM_MQTT_PORT=1883

# WRONG — do not hardcode IP
# CONFIG_AIFOM_MQTT_HOST="192.168.x.x"
```

After changing, reconfigure and reflash:

```bash
idf.py reconfigure && idf.py build && idf.py -p COM5 flash monitor
```

### Step 3: Check firewall

Windows Firewall must allow:
- UDP 5353 (mDNS multicast, inbound + outbound)
- TCP 1883 (MQTT broker, inbound)

```powershell
# Check if MQTT port is listening
netstat -ano | findstr :1883

# Add firewall rules (run as Administrator)
netsh advfirewall firewall add rule name="AIFOM mDNS" dir=in action=allow protocol=UDP localport=5353
netsh advfirewall firewall add rule name="AIFOM MQTT" dir=in action=allow protocol=TCP localport=1883
```

### Step 4: Check network

- ESP32 and PC must be on the same Wi-Fi network (not guest network)
- Guest Wi-Fi, dorm Wi-Fi, or AP isolation can block multicast/mDNS
- Test with a phone hotspot if mDNS fails on shared/public Wi-Fi

### Step 5: Run full diagnostics

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_aifom_network.ps1
```

### Legacy: direct IP (last resort)

Only if mDNS cannot work on your network, set a direct IP in
`sdkconfig.defaults.local`:

```ini
CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY=n
CONFIG_AIFOM_MQTT_HOST="192.168.x.x"
```

This requires reflashing whenever the host IP changes.

## OTA download, checksum or reboot failure

Follow the [physical OTA recovery guide](ota-fallback-plan.md). Confirm
`DEVICE_API_BASE_URL` is reachable from the board, inspect the device error
code, and verify compatible firmware plus its running version after reboot.

## "demo-reset" fails

- The Makefile target runs `psql` inside the postgres container. If the
  stack is down, start it first (`make dev-up`). If a column doesn't yet
  exist (e.g. running the truncate against an old database that predates
  recent migrations), `make demo-down`, drop volumes
  (`docker compose ... down -v`), then `make demo-up`.

## Resetting a real ESP32 to a known state

If a flashed ESP32 misbehaves and is publishing under an unexpected UID:

```bash
cd iot/firmware
idf.py -p <PORT> erase-flash
idf.py -p <PORT> flash monitor
```

`erase-flash` clears NVS too — the UID will be re-derived from the chip
MAC on next boot. If `CONFIG_AIFOM_DEVICE_UID` is pinned, that pinned UID
is what you'll see.
