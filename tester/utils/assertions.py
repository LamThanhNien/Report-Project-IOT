import uuid
import requests


def assert_status(response: requests.Response, expected: int, context: str = ""):
    msg = f"{context} — expected {expected}, got {response.status_code}.\nBody: {response.text[:500]}"
    assert response.status_code == expected, msg


def assert_json(response: requests.Response) -> dict | list:
    try:
        return response.json()
    except Exception:
        raise AssertionError(f"Response is not JSON: {response.text[:500]}")


def assert_fields(data: dict, *fields: str):
    missing = [f for f in fields if f not in data]
    assert not missing, f"Missing fields {missing} in response: {data}"


def assert_uuid(value: str, field: str = "id"):
    try:
        uuid.UUID(str(value))
    except ValueError:
        raise AssertionError(f"Field '{field}' is not a valid UUID: {value!r}")


def assert_non_empty_list(data, context: str = ""):
    assert isinstance(data, list), f"Expected list, got {type(data)} {context}"
    assert len(data) > 0, f"Expected non-empty list {context}"


def assert_list(data, context: str = ""):
    assert isinstance(data, list), f"Expected list, got {type(data)} {context}"


def assert_forbidden(response: requests.Response, context: str = ""):
    assert response.status_code in (403, 404), (
        f"{context} — expected 403/404 (access denied), got {response.status_code}.\n"
        f"Body: {response.text[:400]}"
    )
