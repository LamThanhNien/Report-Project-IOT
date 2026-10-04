"""Legacy compatibility alias for app.bounded_contexts.firmware_ota.presentation.firmware_schemas.

Implementation moved to app.bounded_contexts.firmware_ota.presentation.firmware_schemas. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module("app.bounded_contexts.firmware_ota.presentation.firmware_schemas")
sys.modules[__name__] = _target_module
