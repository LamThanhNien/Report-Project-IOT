# Historical API documentation metadata

The custom API documentation portal and its endpoints have been removed. This
package keeps only the `ApiDocOverride` ORM definition needed by historical
Alembic metadata. FastAPI's built-in `/docs`, `/redoc`, and `/openapi.json` are
available for current API contracts. Existing override records are not deleted.
