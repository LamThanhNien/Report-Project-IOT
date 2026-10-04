from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session, joinedload

from app.modules.devices.model import Device
from app.modules.devices.repository import get_device_by_uid
from app.modules.telemetry.model import Telemetry
from app.modules.telemetry.schema import TelemetryCreate

# ─── Blynk-style Aggregation Whitelist ─────────────────────────────────────────
# These maps are the ONLY values that ever reach SQL — never interpolate raw
# client strings into queries.
_AGG_FUNC_MAP: dict[str, str] = {"avg": "AVG", "min": "MIN", "max": "MAX"}
_BUCKET_MAP: dict[str, str] = {
    "6h": "1 minute",
    "1d": "5 minutes",
    "1w": "1 hour",
    "1m": "1 day",
}
_RANGE_DELTA: dict[str, timedelta] = {
    "6h": timedelta(hours=6),
    "1d": timedelta(hours=24),
    "1w": timedelta(days=7),
    "1m": timedelta(days=30),
}
# Maximum number of buckets for each range (set high enough to cover multi-metric series without truncation)
_LIMIT_MAP: dict[str, int] = {"6h": 2000, "1d": 2000, "1w": 2000, "1m": 2000}

TimeRangeLiteral = Literal["6h", "1d", "1w", "1m"]
AggregateLiteral = Literal["avg", "min", "max"]


def list_telemetry(
    db: Session,
    *,
    tenant_id: UUID | None = None,
    device_uid: str | None = None,
    metric_name: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Telemetry]:
    stmt = (
        select(Telemetry)
        .options(joinedload(Telemetry.device))
        .order_by(Telemetry.timestamp.desc(), Telemetry.created_at.desc())
    )
    if tenant_id is not None:
        stmt = stmt.join(Telemetry.device).where(Device.tenant_id == tenant_id)
    if device_uid:
        if tenant_id is None:
            stmt = stmt.join(Telemetry.device)
        stmt = stmt.where(Device.device_uid == device_uid)
    if metric_name:
        stmt = stmt.where(Telemetry.metric_name == metric_name)
    if from_time is not None:
        stmt = stmt.where(Telemetry.timestamp >= from_time)
    if to_time is not None:
        stmt = stmt.where(Telemetry.timestamp <= to_time)
    if offset:
        stmt = stmt.offset(offset)
    stmt = stmt.limit(limit)
    return list(db.scalars(stmt).all())


def create_telemetry(db: Session, payload: TelemetryCreate) -> Telemetry | None:
    device = get_device_by_uid(db, payload.device_uid)
    if device is None:
        return None

    telemetry = Telemetry(
        device_id=device.id,
        timestamp=payload.timestamp,
        metric_name=payload.metric_name,
        metric_value=payload.metric_value,
        unit=payload.unit,
        raw_payload=payload.raw_payload,
    )
    db.add(telemetry)
    db.commit()
    db.refresh(telemetry)
    telemetry.device = device
    return telemetry


def create_telemetry_metrics(
    db: Session,
    *,
    device_uid: str,
    timestamp,
    metrics: dict[str, float],
    raw_payload: dict | None = None,
) -> list[Telemetry]:
    device = get_device_by_uid(db, device_uid)
    if device is None:
        return []

    records: list[Telemetry] = []
    for metric_name, metric_value in metrics.items():
        telemetry = Telemetry(
            device_id=device.id,
            timestamp=timestamp,
            metric_name=metric_name,
            metric_value=float(metric_value),
            unit=None,
            raw_payload=raw_payload,
        )
        db.add(telemetry)
        records.append(telemetry)

    db.commit()
    for record in records:
        db.refresh(record)
        record.device = device
    return records


class TelemetryQueryResult:
    """Container for telemetry query results with aggregation metadata."""

    __slots__ = ("records", "aggregated", "grouping")

    def __init__(self, records: "list[Telemetry]", aggregated: bool, grouping: str | None = None):
        self.records = records
        self.aggregated = aggregated
        self.grouping = grouping


def list_telemetry_by_device_uid(
    db: Session,
    device_uid: str,
    *,
    metric_name: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
    time_range: TimeRangeLiteral | None = None,
    aggregate: AggregateLiteral = "avg",
) -> "list[Telemetry] | TelemetryQueryResult":
    """Query telemetry records for a device, optionally with Blynk-style time-bucket aggregation.

    When ``time_range`` is provided:
    - It **overrides** any ``from_time``/``to_time`` the caller passes (backward-compat — callers
      should not mix the two; a warning is not emitted here because the caller/router level
      already validates via the FastAPI ``Literal`` type).
    - ``limit`` is set to 2000 to ensure full coverage of the time range across all metrics.
    - Aggregation is performed with ``time_bucket`` on TimescaleDB (PostgreSQL only).
    - Returns a :class:`TelemetryQueryResult` with ``aggregated=True`` and ``grouping`` set.

    When ``time_range`` is absent:
    - Legacy behaviour is preserved (raw rows, ORDER BY timestamp DESC, caller-supplied limit).
    - Returns a plain ``list[Telemetry]`` so existing callers are unaffected.
    """
    device = get_device_by_uid(db, device_uid)
    if device is None:
        return []

    # ── Resolve time range parameters ──────────────────────────────────────────
    if time_range is not None:
        if (
            time_range not in _BUCKET_MAP
            or time_range not in _RANGE_DELTA
            or time_range not in _LIMIT_MAP
        ):
            raise ValueError(f"Invalid time_range parameter: {time_range}")
        if aggregate not in _AGG_FUNC_MAP:
            raise ValueError(f"Invalid aggregate parameter: {aggregate}")

        # time_range takes full precedence over any caller-supplied from_time/to_time
        now_utc = datetime.now(timezone.utc)
        from_time = now_utc - _RANGE_DELTA[time_range]
        to_time = None  # always query up to now
        limit = max(limit, _LIMIT_MAP[time_range])  # ensure large enough limit for full time range
        bucket_interval = _BUCKET_MAP[time_range]
        agg_fn_sql = _AGG_FUNC_MAP[aggregate]
    else:
        bucket_interval = None
        agg_fn_sql = None

    is_pg = db.bind is not None and db.bind.dialect.name == "postgresql"

    # ── PostgreSQL + TimescaleDB path ───────────────────────────────────────────
    if is_pg and time_range is not None:
        import uuid as _uuid
        from sqlalchemy import text

        if bucket_interval not in set(_BUCKET_MAP.values()):
            raise ValueError(f"Invalid bucket_interval: {bucket_interval}")

        bucket_col = func.time_bucket(
            text(f"INTERVAL '{bucket_interval}'"), Telemetry.timestamp
        ).label("bucket")

        # Build SELECT: bucket, metric_name, {AVG|MIN|MAX}(metric_value)
        agg_expr = func.avg(Telemetry.metric_value)  # default fallback
        if agg_fn_sql == "AVG":
            agg_expr = func.avg(Telemetry.metric_value)
        elif agg_fn_sql == "MIN":
            agg_expr = func.min(Telemetry.metric_value)
        elif agg_fn_sql == "MAX":
            agg_expr = func.max(Telemetry.metric_value)

        stmt = select(
            bucket_col,
            Telemetry.metric_name,
            agg_expr.label("metric_value"),
        ).where(Telemetry.device_id == device.id)

        if metric_name:
            stmt = stmt.where(Telemetry.metric_name == metric_name)
        if from_time is not None:
            stmt = stmt.where(Telemetry.timestamp >= from_time)
        if to_time is not None:
            stmt = stmt.where(Telemetry.timestamp <= to_time)

        stmt = stmt.group_by(bucket_col, Telemetry.metric_name).order_by(bucket_col.asc())
        if offset:
            stmt = stmt.offset(offset)
        stmt = stmt.limit(limit)

        rows = db.execute(stmt).all()

        records: list[Telemetry] = []
        for r in rows:
            records.append(
                Telemetry(
                    id=_uuid.uuid4(),
                    device_id=device.id,
                    device=device,
                    timestamp=r.bucket,
                    metric_name=r.metric_name,
                    metric_value=float(r.metric_value),
                    unit=None,
                    raw_payload=None,
                    created_at=r.bucket,
                )
            )
        return TelemetryQueryResult(
            records=records,
            aggregated=True,
            grouping=bucket_interval,
        )

    # ── PostgreSQL legacy path (no time_range) OR SQLite fallback ──────────────
    if is_pg:
        # Legacy TimescaleDB 5-second micro-bucket path (previous behaviour kept for
        # callers that do not pass time_range — preserves backward compat).
        import uuid as _uuid
        from sqlalchemy import text

        bucket = func.time_bucket(text("INTERVAL '5 seconds'"), Telemetry.timestamp).label("bucket")
        stmt = select(
            bucket, Telemetry.metric_name, func.avg(Telemetry.metric_value).label("metric_value")
        ).where(Telemetry.device_id == device.id)
        if metric_name:
            stmt = stmt.where(Telemetry.metric_name == metric_name)
        if from_time is not None:
            stmt = stmt.where(Telemetry.timestamp >= from_time)
        if to_time is not None:
            stmt = stmt.where(Telemetry.timestamp <= to_time)

        stmt = stmt.group_by(bucket, Telemetry.metric_name).order_by(bucket.asc())
        if offset:
            stmt = stmt.offset(offset)
        stmt = stmt.limit(limit)

        rows = db.execute(stmt).all()

        legacy_records: list[Telemetry] = []
        for r in rows:
            legacy_records.append(
                Telemetry(
                    id=_uuid.uuid4(),
                    device_id=device.id,
                    device=device,
                    timestamp=r.bucket,
                    metric_name=r.metric_name,
                    metric_value=float(r.metric_value),
                    unit=None,
                    raw_payload=None,
                    created_at=r.bucket,
                )
            )
        return legacy_records

    # SQLite fallback — used for unit tests; returns raw rows, no time_bucket available.
    stmt = (
        select(Telemetry)
        .options(joinedload(Telemetry.device))
        .where(Telemetry.device_id == device.id)
        .order_by(Telemetry.timestamp.asc())
    )
    if metric_name:
        stmt = stmt.where(Telemetry.metric_name == metric_name)
    if from_time is not None:
        if from_time.tzinfo is not None:
            from_time_naive = from_time.replace(tzinfo=None)
            stmt = stmt.where(
                (Telemetry.timestamp >= from_time) | (Telemetry.timestamp >= from_time_naive)
            )
        else:
            stmt = stmt.where(Telemetry.timestamp >= from_time)
    if to_time is not None:
        stmt = stmt.where(Telemetry.timestamp <= to_time)
    if offset:
        stmt = stmt.offset(offset)
    stmt = stmt.limit(limit)
    raw_records = list(db.scalars(stmt).all())

    if time_range is not None:
        # SQLite can't do time_bucket — return wrapper so frontend knows not to show badge
        return TelemetryQueryResult(records=raw_records, aggregated=False)
    return raw_records


def latest_telemetry_by_device_uid(db: Session, device_uid: str) -> list[Telemetry]:
    device = get_device_by_uid(db, device_uid)
    if device is None:
        return []

    subq = (
        select(Telemetry.metric_name, func.max(Telemetry.timestamp).label("max_timestamp"))
        .where(Telemetry.device_id == device.id)
        .group_by(Telemetry.metric_name)
        .subquery()
    )
    stmt = (
        select(Telemetry)
        .options(joinedload(Telemetry.device))
        .join(
            subq,
            and_(
                Telemetry.device_id == device.id,
                Telemetry.metric_name == subq.c.metric_name,
                Telemetry.timestamp == subq.c.max_timestamp,
            ),
        )
        .order_by(Telemetry.metric_name.asc())
    )
    return list(db.scalars(stmt).all())
