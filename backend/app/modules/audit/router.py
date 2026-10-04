"""Legacy compatibility alias for app.shared.presentation.audit_router.

Implementation moved to app.shared.presentation.audit_router. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module("app.shared.presentation.audit_router")
sys.modules[__name__] = _target_module
