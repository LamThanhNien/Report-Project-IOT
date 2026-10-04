"""
Development-only debug log endpoint.
Accepts log entries from the browser and prints them to the terminal.
Active only when APP_ENV != "production".
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

router = APIRouter()
_limiter = Limiter(key_func=get_remote_address)

# Fields that must never be logged even if the frontend accidentally sends them
_MASKED = {
    "password",
    "confirmpassword",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "cookie",
    "secret",
    "api_key",
    "private_key",
}


def _mask(data: Any, depth: int = 0) -> Any:
    if depth > 5 or not isinstance(data, dict):
        return data
    return {
        k: "***MASKED***" if k.lower() in _MASKED else _mask(v, depth + 1) for k, v in data.items()
    }


class _LogEntry(BaseModel):
    category: str = ""
    message: str = ""
    data: dict = {}


@router.post("/log", include_in_schema=False)
@_limiter.limit("30/minute")
async def receive_debug_log(entry: _LogEntry, request: Request) -> dict:
    if settings.app_env != "development":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    safe_data = _mask(entry.data)
    line = f"{entry.category} {entry.message}".strip()
    if safe_data:
        # Append any extra data fields not already embedded in the message
        extras = "  " + "  ".join(
            f'{k}="{v}"' for k, v in safe_data.items() if str(v) not in entry.message
        )
        if extras.strip():
            line += extras
    print(line, flush=True)
    return {"status": "ok"}
