import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, OperationalError

from app.db.session import SessionLocal
from app.bounded_contexts.identity.infrastructure.persistence.token_blacklist import (
    BlacklistedToken,
)
from app.core.metrics import TOKEN_CLEANUP

logger = logging.getLogger(__name__)


class TokenCleanupTask:
    """Manages hourly/periodic cleanup of expired blacklisted tokens.

    Ensures single-instance execution via PostgreSQL advisory lock and sets
    a database statement timeout.
    """

    def __init__(self, interval_seconds: int = 3600, statement_timeout_ms: int = 5000):
        self.interval_seconds = interval_seconds
        self.statement_timeout_ms = statement_timeout_ms
        self._lock_id = 2026061901
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        """Starts the periodic background cleanup loop. Idempotent."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Token blacklist cleanup background task started.")

    async def stop(self) -> None:
        """Cancels and awaits the background task safely. Idempotent."""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                # Wait for cancellation within a bounded timeout of 5 seconds
                await asyncio.wait_for(self._task, timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            self._task = None
            logger.info("Token blacklist cleanup background task stopped.")

    async def _run_loop(self) -> None:
        # Run immediately on startup
        try:
            await asyncio.to_thread(self.run_once)
        except Exception:
            logger.exception("Initial startup token cleanup run failed.")

        while self._running:
            try:
                # Await the configured interval
                await asyncio.sleep(self.interval_seconds)
            except asyncio.CancelledError:
                logger.info("Token cleanup loop cancelled during sleep.")
                raise

            if not self._running:
                break

            try:
                await asyncio.to_thread(self.run_once)
            except Exception:
                logger.exception("Periodic token cleanup run failed.")

    def run_once(self) -> int:
        """Runs the token cleanup process once.

        Acquires pg advisory lock, sets statement timeout, deletes expired tokens,
        and records logs and metrics.
        """
        from app.core.tenant_context import tenant_context

        with tenant_context(bypass_rls=True):
            db = SessionLocal()
            try:
                # Set statement timeout for safety
                db.execute(text(f"SET LOCAL statement_timeout = {self.statement_timeout_ms}"))

                # Try to acquire transaction-scoped advisory lock
                lock_acquired = db.scalar(
                    text(f"SELECT pg_try_advisory_xact_lock({self._lock_id})")
                )
                if not lock_acquired:
                    logger.info(
                        "Token cleanup skipped: advisory lock already held by another instance."
                    )
                    TOKEN_CLEANUP.labels(outcome="advisory_lock_skipped").inc()
                    return 0

                # Delete expired tokens
                now = datetime.now(timezone.utc)
                deleted_count = (
                    db.query(BlacklistedToken)
                    .filter(BlacklistedToken.expires_at < now)
                    .delete(synchronize_session=False)
                )

                db.commit()

                if deleted_count > 0:
                    logger.info(f"Cleaned up {deleted_count} expired blacklisted token(s).")
                    TOKEN_CLEANUP.labels(outcome="cleanup_succeeded").inc()
                else:
                    logger.debug("No expired blacklisted tokens found to clean.")
                    TOKEN_CLEANUP.labels(outcome="no_expired_tokens").inc()

                return deleted_count

            except (DBAPIError, OperationalError, Exception) as exc:
                try:
                    db.rollback()
                except Exception:
                    pass
                logger.warning(
                    f"Blacklisted token cleanup failed: {exc.__class__.__name__}", exc_info=True
                )
                TOKEN_CLEANUP.labels(outcome="cleanup_failed").inc()
                raise
            finally:
                db.close()
