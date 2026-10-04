"""Legacy compatibility alias for app.bounded_contexts.firmware_ota.infrastructure.storage.minio_client.

Implementation moved to app.bounded_contexts.firmware_ota.infrastructure.storage.minio_client. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module(
    "app.bounded_contexts.firmware_ota.infrastructure.storage.minio_client"
)
sys.modules[__name__] = _target_module
