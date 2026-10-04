"""In-process pub/sub bus for device status changes.

Bridges sync MQTT worker threads to async SSE handlers.  Thread-safe
``publish()`` from any thread; async ``subscribe()`` yields events
filtered by tenant_id.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, AsyncGenerator, TypedDict

logger = logging.getLogger(__name__)


class DeviceStatusEvent(TypedDict):
    device_uid: str
    tenant_id: str
    status: str
    last_seen_at: str | None
    timestamp: str


_SENTINEL: Any = object()  # signals subscriber to stop


class DeviceStatusEventBus:
    """Thread-safe fan-out bus: one publish → many per-tenant subscribers."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── lifecycle ──────────────────────────────────────────────────────

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def stop(self) -> None:
        """Send sentinel to every subscriber so SSE generators exit."""
        with self._lock:
            for queues in self._subscribers.values():
                for q in queues:
                    try:
                        q.put_nowait(_SENTINEL)
                    except asyncio.QueueFull:
                        pass

    # ── publish (called from sync MQTT worker threads) ────────────────

    def publish(self, event: DeviceStatusEvent) -> None:
        tenant_id = event["tenant_id"]
        with self._lock:
            queues = list(self._subscribers.get(tenant_id, []))
        if not queues:
            return
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        for q in queues:
            try:
                loop.call_soon_threadsafe(q.put_nowait, event)
            except RuntimeError:
                # loop is closed or queue is full — drop silently
                pass

    # ── subscribe (async, called from SSE handler) ────────────────────

    async def subscribe(self, tenant_id: str) -> AsyncGenerator[DeviceStatusEvent, None]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            self._subscribers.setdefault(tenant_id, []).append(queue)
        try:
            while True:
                event = await queue.get()
                if event is _SENTINEL:
                    break
                yield event
        finally:
            with self._lock:
                tenant_queues = self._subscribers.get(tenant_id, [])
                if queue in tenant_queues:
                    tenant_queues.remove(queue)
                if not tenant_queues:
                    self._subscribers.pop(tenant_id, None)


device_status_bus = DeviceStatusEventBus()
