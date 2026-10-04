"""
Root conftest — pre-warm the auth token cache at import time.

Test files such as test_03_tenant_isolation.py call ``tenant1_client()``
at module level during pytest collection.  Without a pre-warmed cache
each of those calls makes a ``POST /api/v1/auth/login`` request, which
quickly exhausts the 5/minute rate limit on the login endpoint.

By importing and calling ``admin_token()`` / ``tenant1_token()`` here
(at import time, before any test module is collected) we ensure the
``_token_cache`` dict in ``utils.auth`` is populated, and all subsequent
``admin_client()`` / ``tenant1_client()`` calls reuse the cached token
instead of hitting the login endpoint again.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from utils.auth import admin_token, tenant1_token  # noqa: E402

# Warm the cache — one login call per user, shared across the entire run.
admin_token()
tenant1_token()
