"""Legacy compatibility alias for app.shared.infrastructure.persistence.audit_models.

Implementation moved to app.shared.infrastructure.persistence.audit_models. Keep this path temporarily for tests,
seed scripts, and external callers. Do not add new behavior here.
"""

from importlib import import_module
import sys

_target_module = import_module("app.shared.infrastructure.persistence.audit_models")
sys.modules[__name__] = _target_module
