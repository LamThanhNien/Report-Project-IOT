"""Controlled JSON rule evaluator.

This module intentionally evaluates data-only JSON conditions. It never calls
eval, exec, user-provided functions, or arbitrary expressions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


MISSING = object()


@dataclass(frozen=True)
class ConditionResult:
    field: str
    operator: str
    data_type: str
    expected: Any
    actual: Any
    matched: bool

    def as_dict(self) -> dict[str, Any]:
        actual = None if self.actual is MISSING else self.actual
        return {
            "field": self.field,
            "operator": self.operator,
            "data_type": self.data_type,
            "expected": self.expected,
            "actual": actual,
            "matched": self.matched,
        }


def resolve_path(payload: dict[str, Any], path: str) -> Any:
    if not path:
        return MISSING
    current: Any = payload
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        return MISSING
    return current


def _coerce_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _coerce_boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return None


def evaluate_condition(payload: dict[str, Any], condition: dict[str, Any]) -> ConditionResult:
    field = str(condition.get("field", ""))
    operator = str(condition.get("operator", ""))
    data_type = str(condition.get("data_type", "number"))
    expected = condition.get("value")
    actual = resolve_path(payload, field)

    if actual is MISSING:
        matched = operator == "not_exists"
        return ConditionResult(field, operator, data_type, expected, actual, matched)
    if operator == "exists":
        return ConditionResult(field, operator, data_type, expected, actual, True)
    if operator == "not_exists":
        return ConditionResult(field, operator, data_type, expected, actual, False)

    if data_type == "number":
        left = _coerce_number(actual)
        right = _coerce_number(expected)
        if left is None or right is None:
            matched = False
        elif operator == ">":
            matched = left > right
        elif operator == ">=":
            matched = left >= right
        elif operator == "<":
            matched = left < right
        elif operator == "<=":
            matched = left <= right
        elif operator == "==":
            matched = left == right
        elif operator == "!=":
            matched = left != right
        else:
            matched = False
        return ConditionResult(field, operator, data_type, expected, actual, matched)

    if data_type == "boolean":
        left = _coerce_boolean(actual)
        right = _coerce_boolean(expected)
        if operator == "is_true":
            matched = left is True
        elif operator == "is_false":
            matched = left is False
        elif operator == "==":
            matched = left is not None and left == right
        elif operator == "!=":
            matched = left is not None and right is not None and left != right
        else:
            matched = False
        return ConditionResult(field, operator, data_type, expected, actual, matched)

    if data_type == "enum":
        expected_values = expected if isinstance(expected, list) else [expected]
        if operator == "in":
            matched = actual in expected_values
        elif operator == "not_in":
            matched = actual not in expected_values
        elif operator == "==":
            matched = actual == expected
        elif operator == "!=":
            matched = actual != expected
        else:
            matched = False
        return ConditionResult(field, operator, data_type, expected, actual, matched)

    actual_text = "" if actual is None else str(actual)
    expected_text = "" if expected is None else str(expected)
    if operator == "==":
        matched = actual_text == expected_text
    elif operator == "!=":
        matched = actual_text != expected_text
    elif operator == "contains":
        matched = expected_text in actual_text
    elif operator == "not_contains":
        matched = expected_text not in actual_text
    elif operator == "starts_with":
        matched = actual_text.startswith(expected_text)
    elif operator == "ends_with":
        matched = actual_text.endswith(expected_text)
    else:
        matched = False
    return ConditionResult(field, operator, data_type, expected, actual, matched)


def evaluate_conditions(
    payload: dict[str, Any],
    conditions: list[dict[str, Any]],
    logic: str = "and",
) -> tuple[bool, list[ConditionResult], list[ConditionResult], dict[str, Any]]:
    results = [evaluate_condition(payload, condition) for condition in conditions]
    if not results:
        return False, [], [], {}
    matched = all(r.matched for r in results) if logic == "and" else any(r.matched for r in results)
    passed = [r for r in results if r.matched]
    failed = [r for r in results if not r.matched]
    evaluated = {r.field: None if r.actual is MISSING else r.actual for r in results}
    return matched, passed, failed, evaluated
