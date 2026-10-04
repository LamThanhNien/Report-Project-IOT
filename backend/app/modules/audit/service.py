"""Legacy compatibility alias for app.shared.application.audit_service.

Implementation moved to app.shared.application.audit_service. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module("app.shared.application.audit_service")
sys.modules[__name__] = _target_module
