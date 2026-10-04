"""Legacy compatibility alias for app.bounded_contexts.device_registry.infrastructure.device_presence_monitor.

Implementation moved to app.bounded_contexts.device_registry.infrastructure.device_presence_monitor. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module(
    "app.bounded_contexts.device_registry.infrastructure.device_presence_monitor"
)
sys.modules[__name__] = _target_module
