# Historical ML database metadata

AI/TinyML/MLOps endpoints, training, inference, artifact processing, and MQTT model
deployment have been removed from the project. This package retains only the
SQLAlchemy definitions imported by `app.main` and `alembic/env.py` so existing
migration history and databases continue to work. No ML dependency or model file
is loaded at runtime. Historical tables are preserved; no database data is dropped.
