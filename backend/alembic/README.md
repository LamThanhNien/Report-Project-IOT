# Alembic

Database migration workspace. `versions/0001_initial_schema.py` is the development
baseline squashed from the original `0001`-`0030` chain. It preserves the final
schema, PostgreSQL/TimescaleDB operations, and platform/model seed data.

Add new immutable revisions after `0001` when schema changes are implemented.
Databases created with the retired revision chain must be recreated; do not stamp
an old schema directly to this baseline.
