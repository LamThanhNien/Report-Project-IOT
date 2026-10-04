from collections.abc import Generator
from contextlib import contextmanager
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql import text

from app.core.config import settings
from app.core.tenant_context import (
    current_tenant_id_context,
    bypass_rls_context,
    current_user_role_context,
)

db_url = settings.app_database_url or settings.database_url
engine = create_engine(db_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@event.listens_for(Session, "after_begin")
def set_tenant_context_in_pg(session, transaction, connection):
    if connection.dialect.name != "postgresql":
        return

    tenant_id = current_tenant_id_context.get()
    bypass_rls = bypass_rls_context.get()
    role = current_user_role_context.get()

    if tenant_id:
        connection.execute(
            text("SET LOCAL app.current_tenant_id = :tenant_id"),
            {"tenant_id": str(tenant_id)},
        )
    else:
        connection.execute(text("SET LOCAL app.current_tenant_id = ''"))

    if bypass_rls:
        connection.execute(text("SET LOCAL app.bypass_rls = 'true'"))
    else:
        connection.execute(text("SET LOCAL app.bypass_rls = 'false'"))

    connection.execute(
        text("SET LOCAL app.current_user_role = :role"),
        {"role": role},
    )


def sync_tenant_context_in_pg(session: Session) -> None:
    """Explicitly synchronize the current Python context variables to PostgreSQL.

    Must be called if context changes after the transaction has already begun,
    because the after_begin event will not fire again.
    """
    if not hasattr(session, "execute"):
        return

    bind = getattr(session, "bind", None)
    if bind and bind.dialect.name != "postgresql":
        return

    tenant_id = current_tenant_id_context.get()
    bypass_rls = bypass_rls_context.get()
    role = current_user_role_context.get()

    if tenant_id:
        session.execute(
            text("SET LOCAL app.current_tenant_id = :tenant_id"),
            {"tenant_id": str(tenant_id)},
        )
    else:
        session.execute(text("SET LOCAL app.current_tenant_id = ''"))

    if bypass_rls:
        session.execute(text("SET LOCAL app.bypass_rls = 'true'"))
    else:
        session.execute(text("SET LOCAL app.bypass_rls = 'false'"))

    session.execute(
        text("SET LOCAL app.current_user_role = :role"),
        {"role": role},
    )


def _session_transaction_started(session: Session) -> bool:
    in_transaction = getattr(session, "in_transaction", None)
    if in_transaction is None:
        return True
    return bool(in_transaction())


@contextmanager
def postgres_rls_bypass(session: Session) -> Generator[None, None, None]:
    """Temporarily enable PostgreSQL RLS bypass for the current transaction.

    ContextVar updates alone do not affect PostgreSQL after a transaction has
    begun. This helper synchronizes the bypass flag immediately and always
    restores the prior PostgreSQL context before returning control to callers.
    """
    token_bypass = bypass_rls_context.set(True)
    if _session_transaction_started(session):
        sync_tenant_context_in_pg(session)
    try:
        yield
    finally:
        bypass_rls_context.reset(token_bypass)
        if _session_transaction_started(session):
            sync_tenant_context_in_pg(session)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
