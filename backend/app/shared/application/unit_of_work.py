"""Unit of Work interface.

The Unit of Work pattern ensures that a set of operations are committed
as a single transaction.  Infrastructure adapters provide the concrete
implementation (e.g. SQLAlchemy-based).

This module defines only the abstract interface — no ORM dependencies.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class UnitOfWork(ABC):
    """Abstract Unit of Work.

    Usage:
        async with uow:
            uow.devices.add(device)
            uow.telemetry.save(record)
            # auto-commits on clean exit, auto-rolls-back on exception
    """

    @abstractmethod
    def __enter__(self) -> UnitOfWork: ...

    @abstractmethod
    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None: ...

    @abstractmethod
    def commit(self) -> None: ...

    @abstractmethod
    def rollback(self) -> None: ...
