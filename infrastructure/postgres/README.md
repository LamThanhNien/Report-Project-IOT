# PostgreSQL

Phase 1 uses a single TimescaleDB-enabled PostgreSQL container named `postgres`.

Initialization scripts live in `init/`. The API currently creates the MVP tables through SQLAlchemy on startup:

- `devices`
- `telemetry`

Alembic migrations can be introduced after the MVP endpoints stabilize.
