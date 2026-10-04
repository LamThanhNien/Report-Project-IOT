"""Pagination helpers.

Provides a generic paginated response wrapper and cursor/offset helpers.
Framework-agnostic — no FastAPI or Pydantic imports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class Page(Generic[T]):
    """A page of results with metadata."""

    items: list[T] = field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20
    has_next: bool = False
    has_prev: bool = False

    @property
    def total_pages(self) -> int:
        if self.page_size <= 0:
            return 0
        return (self.total + self.page_size - 1) // self.page_size

    @classmethod
    def from_query(
        cls,
        items: list[T],
        total: int,
        page: int = 1,
        page_size: int = 20,
    ) -> Page[T]:
        return cls(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            has_next=(page * page_size) < total,
            has_prev=page > 1,
        )


def clamp_page_size(value: int, minimum: int = 1, maximum: int = 100) -> int:
    """Clamp page size to a reasonable range."""
    return max(minimum, min(maximum, value))
