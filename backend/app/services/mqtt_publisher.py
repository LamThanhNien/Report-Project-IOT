"""Legacy compatibility alias for app.shared.infrastructure.messaging.mqtt_publisher.

Implementation moved to app.shared.infrastructure.messaging.mqtt_publisher. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module("app.shared.infrastructure.messaging.mqtt_publisher")
sys.modules[__name__] = _target_module
