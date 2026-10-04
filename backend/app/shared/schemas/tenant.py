from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TenantSummary(BaseModel):
    id: UUID
    name: str
    slug: str | None = None
    email: str | None = None

    model_config = ConfigDict(from_attributes=True)


def tenant_summary(tenant) -> TenantSummary | None:
    if tenant is None:
        return None
    return TenantSummary(
        id=tenant.id,
        name=tenant.name,
        slug=getattr(tenant, "slug", None),
        email=getattr(tenant, "email", None),
    )
