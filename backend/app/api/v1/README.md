# API v1

Versioned REST routers. Keep routers thin: validate input, call module services, and return documented response schemas.

When adding or changing endpoints, include OpenAPI metadata that API Docs Management can surface:

- `summary`
- `description`
- `response_model` when returning a body
- explicit `status_code` for create/delete or non-200 success cases
- `responses={...}` for expected error cases

The admin API catalog is available at `/api/v1/admin/api-docs` and is backed by the live FastAPI OpenAPI schema plus metadata overrides.
