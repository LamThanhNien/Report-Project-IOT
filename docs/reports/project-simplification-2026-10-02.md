# Project simplification — 2026-10-02

WORKFLOW: scoped feature removal with regression verification and Git publication.
STATUS: implementation completed; final verification recorded below.
RISK LEVEL: cross-component removal; retained operation/security contracts preserved.

## Acceptance criteria

Remove active AI/TinyML/MLOps, custom page/widget builder, marketing website, advanced reports/health scoring, custom API docs portal, commercial management UI and Prometheus/Grafana/MLflow services. Preserve registration/presence, telemetry, Automation, Command, firmware/OTA and their dependencies.

## Implementation

- Removed feature routes, page components, MQTT ML processing, firmware/simulator ML hooks and ML dependencies.
- Replaced configurable dashboards with fixed device/status views.
- Kept basic project/workspace, device bindings, datastreams and capabilities for retained workflows.
- Kept tenant ownership, security/permissions, quotas and read-only onboarding plan selection. No authorization expansion.
- Kept permission-safe platform engineer operational support for existing accounts.
- Kept historical Alembic/ORM metadata and database data. No volume deletion or migration rewrite.
- Core startup uses API, PostgreSQL/TimescaleDB, Mosquitto and MinIO; removes obsolete services in the same Compose project with --remove-orphans.
- Seed defaults insert missing profiles without deleting existing plans, changing quotas or rebinding tenants.
- Updated current README, scope, architecture, demo and test guides. Other audit/thesis documents are historical.

## Independent reviews

Sessions: `/root/backend_slim`, `/root/frontend_slim`, `/root/infra_firmware_slim`, `/root/integration_review`.

Production import, OpenAPI generation, mapper configuration and FK metadata resolution succeeded. Operational endpoints and MQTT Automation/ACK/OTA handlers remain. AST checks confirmed unchanged firmware/OTA/command implementations; `firmware_ota`, `command_center`, `rule_engine` and Alembic have no implementation diff.

Review findings corrected: stale ML publisher, admin-project operational alert title/metric shape, null quota profile misleadingly labeled default, stale datastream widget blocker and missing explicit tzdata after removal of pandas.

## Verification and limits

Focused backend checks cover scope, onboarding profile preservation, device details, Automation, MQTT virtual channels/webhooks/publisher, OTA governance/download security/simulator contract, tenant permissions and operational alerts. Compose dev/prod, PowerShell syntax and simulator syntax/CLI checks passed. Frontend typecheck/build and component tests are recorded in the final verification below.

Full backend suite was attempted. Tests requiring PostgreSQL cannot run with Docker engine unavailable. These failures also expose existing test cleanup leaks. An existing OTA test-double defect (`FakeQuery.first` absent) reproduces independently with unchanged OTA source. Offline final gate excludes those explicitly classified tests; exclusion is not a runtime integration pass.

Docker Desktop launch was attempted, but the Linux engine endpoint was unavailable. No actual container/database/volume was changed. ESP-IDF/PlatformIO tooling and physical board were unavailable; firmware build/flash and hardware OTA are unverified.

Node-RED is stated in the original topic requirement but is not integrated into the existing repository; this change does not add it.

### Final verification

- Backend offline gate: 424 passed, 1 skipped, 3 deselected. PostgreSQL-dependent files and the independently reproduced OTA test-double defect were explicitly excluded; results are saved locally in `.pytest-report/backend-offline-final.xml`.
- Frontend: 26 test files, 93 tests passed; TypeScript check and final production build passed (2,707 transformed modules).
- Backend Python compilation and scoped Ruff checks passed.
- Development/production Compose configuration, launcher PowerShell parsing and simulator checks passed.
- Graph synchronization completed: 8,140 nodes, 18,705 edges. Traversal confirms retained Automation and OTA UI/API links. SQL extraction dependency and ESP-IDF macro parsing limit graph completeness; graph results supplement source/test review.
- Git whitespace check passed. No retained core migration, firmware OTA component or backend Automation/Command/OTA implementation changes.

## Git publication

Origin: https://github.com/LamThanhNien/Report-Project-IOT.git. Original remote retained as `aifom-source`.

Exactly one new commit is created after implementation and verification, then the current `master` branch is pushed to the empty destination. Existing Git history is retained. Local credentials, caches, generated reports and unrelated untracked thesis documents are excluded.
