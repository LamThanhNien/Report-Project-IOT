> Historical document: current implementation scope is defined in [scope.md](scope.md). AI/TinyML, custom dashboard builder, public marketing and full monitoring have been removed.

# Changelog

## Unreleased — Phase 11: Web Admin UI redesign

Major rewrite of `apps/web-admin` from a minimal scaffold to a production-style
IoT fleet management console.

### Added

- **App shell**: responsive sidebar (collapsible) + topbar with search,
  environment badge, system-health indicator, notifications, theme toggle,
  user menu, breadcrumbs.
- **Dark mode** via `ThemeContext` (persisted in `localStorage`,
  `html.dark` class).
- **Reusable UI primitives** under `src/components/ui/`:
  `StatusBadge`, `MetricCard`, `Card`, `PageHeader`, `EmptyState`,
  `ErrorState`, `Spinner`, `Skeleton`, `DataTable`, `ConfirmDialog`,
  `Modal`, `Tabs`, `Timeline`, `HealthIndicator`, `FirmwareVersionBadge`.
- **Chart components** (`src/components/charts/`): `TelemetryChart`,
  `DonutChart`, `BarChart` — built on Recharts.
- **TanStack Query** for data fetching with auto-refresh (15–30s) on
  Dashboard / Devices / OTA / System.
- **Modules**:
  - `Dashboard` — KPI cards, status distribution, firmware distribution,
    telemetry trend, recent OTA, event timeline.
  - `Devices` — search / filter / sort / pagination / health score.
  - `DeviceDetail` — 6 tabs (Overview, Telemetry, OTA, Events, Config,
    TinyML), reboot/maintenance/copy/raw-JSON actions, inline OTA dispatch.
  - `Firmware` — list, channel badge, upload modal, OTA shortcut, download.
  - `OtaJobs` — campaign-style list with KPI cards.
  - `OtaWizard` — 4-step rollout wizard (firmware → devices → strategy →
    confirm) supporting single/selected/phased-10/phased-50/all.
  - `Telemetry` — fleet overview, time range filter (5m/1h/24h/7d),
    metric filter, per-device sparklines.
  - `Alerts` — derived alerts from offline devices + failed OTAs,
    severity filter, detail modal.
  - `Models` — TinyML registry (mock, marked TODO) with versions detail.
  - `System` — per-component health, Prometheus/Grafana links, env info.
  - `Settings` — general, OTA policy, groups, security, account tabs.
- **Login page** redesigned (two-column hero + form).
- **Vietnamese localization** of all user-facing copy.
- **README**: full module list, env vars, folder structure, limitations.

### Changed

- `src/services/apiClient.ts` — unchanged contract; tests updated for new
  fetch call shape.
- `src/services/otaApi.ts` — added `listOtaJobs(deviceUid?)`, `getOtaJob`,
  `createOtaCampaign(deviceUids[], firmwareId)`.
- `src/services/telemetryApi.ts` — supports `from_time/to_time/metric_name/limit/offset`.
- `src/services/deviceApi.ts` — added `getDeviceTelemetry`, `rebootDevice`,
  `setDeviceMaintenance` (UI-only mutations).
- `src/services/systemApi.ts` — new; composes `/health` + `/ready` into a
  per-component health view.
- `src/services/alertApi.ts` — new; derives alerts from devices + OTA jobs.
- `src/services/modelApi.ts` — new; mock TinyML registry.
- Routing moved from `/ota-jobs` → `/ota` (with redirect for back-compat).
- Removed dependency on `useFetch` hook for pages — replaced with TanStack
  Query (`useFetch.ts` still present, unused).

### Dependencies

Added: `@tanstack/react-query`, `recharts`, `lucide-react`, `clsx`,
`tailwind-merge`.

### Tests

- 9 vitest tests passing (6 `apiClient`, 3 `Devices`).
- TypeScript: `npm run typecheck` passes.
- Production build: `npm run build` passes (dist 764 kB / gzipped 223 kB).

### Known TODOs (backend integration)

Each mock/UI-only feature is tagged with `TODO(backend):` in source:

- Device reboot, maintenance flag, CPU/RAM/RSSI/uptime fields.
- Firmware `release_channel`, signature status, git SHA.
- Batch OTA + phased rollout endpoint, rollback.
- Persistent alerts table (currently composed client-side).
- TinyML model registry (`/api/v1/models/...`).
- Composite system-health endpoint returning per-component status.
- Settings persistence (currently UI state only).

---

## Earlier — Phase 1 to Phase 10

- Phase 2 — Device registration + MQTT telemetry ingestion
- Phase 3 — Firmware metadata + OTA backend
- Phase 4 — Real OTA flow (ESP32 OTA client + rollback)
- Phase 5 — Multi-device fleet simulator + telemetry filters/pagination
- Phase 6 — Anomaly detection (IsolationForest)
- Phase 7 — Demo preparation
- Phase 8 — Tests + quality checks
- Phase 9 — Observability (Prometheus + Grafana + structured logging)
- Phase 10 — Authentication & Security (JWT, RBAC, MQTT auth)
