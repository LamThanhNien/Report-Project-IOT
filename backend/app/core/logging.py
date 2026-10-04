import contextvars
import json
import logging
from datetime import datetime, timezone

correlation_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "correlation_id", default=None
)


def get_correlation_id() -> str | None:
    return correlation_id_ctx.get()


class _JsonFormatter(logging.Formatter):
    """Structured JSON logs for production (stdout → log aggregator)."""

    def format(self, record: logging.LogRecord) -> str:
        data: dict = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        for key in ("device_uid", "job_id", "topic_type", "status", "role", "tenant_id"):
            val = record.__dict__.get(key)
            if val is not None:
                data[key] = val

        corr_id = correlation_id_ctx.get()
        if corr_id:
            data["correlation_id"] = corr_id

        return json.dumps(data, default=str)


class _DevFormatter(logging.Formatter):
    """Human-readable single-line format for development CMD output."""

    _ABBR = {"DEBUG": "D", "INFO": "I", "WARNING": "W", "ERROR": "E", "CRITICAL": "C"}

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        abbr = self._ABBR.get(record.levelname, record.levelname[0])
        msg = record.getMessage()
        if record.exc_info:
            msg += "\n" + self.formatException(record.exc_info)

        corr_id = correlation_id_ctx.get()
        prefix = f" [{corr_id}]" if corr_id else ""
        return f"{ts} {abbr}{prefix} {msg}"


def configure_logging() -> None:
    from app.core.config import settings  # late import to avoid circular

    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)

    handler = logging.StreamHandler()
    if settings.app_env == "production":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(_DevFormatter())

    # Preserve pytest handlers to avoid breaking caplog in tests
    root.handlers = [h for h in root.handlers if h.__class__.__module__.startswith("_pytest")]
    root.addHandler(handler)

    # Suppress noisy third-party loggers
    for noisy in ("uvicorn.access", "httpx", "multipart"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
