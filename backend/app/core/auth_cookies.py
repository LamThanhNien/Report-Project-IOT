from __future__ import annotations

import secrets

from fastapi import Request, Response

from app.core.config import settings

ACCESS_TOKEN_COOKIE = "aifom_access_token"
REFRESH_TOKEN_COOKIE = "aifom_refresh_token"
CSRF_TOKEN_COOKIE = "aifom_csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"


def _cookie_kwargs(max_age: int, *, httponly: bool) -> dict:
    kwargs = {
        "max_age": max_age,
        "path": "/",
        "httponly": httponly,
        "secure": settings.auth_cookie_secure,
        "samesite": settings.auth_cookie_samesite,
    }
    if settings.auth_cookie_domain:
        kwargs["domain"] = settings.auth_cookie_domain
    return kwargs


def get_bearer_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return None


def get_access_token_from_request(request: Request) -> str | None:
    return get_bearer_token(request) or request.cookies.get(ACCESS_TOKEN_COOKIE)


def get_refresh_token_from_request(request: Request) -> str | None:
    return request.cookies.get(REFRESH_TOKEN_COOKIE)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        ACCESS_TOKEN_COOKIE,
        access_token,
        **_cookie_kwargs(settings.jwt_expire_minutes * 60, httponly=True),
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE,
        refresh_token,
        **_cookie_kwargs(settings.auth_refresh_cookie_days * 24 * 60 * 60, httponly=True),
    )
    response.set_cookie(
        CSRF_TOKEN_COOKIE,
        new_csrf_token(),
        **_cookie_kwargs(settings.auth_refresh_cookie_days * 24 * 60 * 60, httponly=False),
    )


def clear_auth_cookies(response: Response) -> None:
    for name, httponly in (
        (ACCESS_TOKEN_COOKIE, True),
        (REFRESH_TOKEN_COOKIE, True),
        (CSRF_TOKEN_COOKIE, False),
    ):
        kwargs = {
            "path": "/",
            "httponly": httponly,
            "secure": settings.auth_cookie_secure,
            "samesite": settings.auth_cookie_samesite,
        }
        if settings.auth_cookie_domain:
            kwargs["domain"] = settings.auth_cookie_domain
        response.delete_cookie(name, **kwargs)


def csrf_tokens_match(request: Request) -> bool:
    cookie_token = request.cookies.get(CSRF_TOKEN_COOKIE)
    header_token = request.headers.get(CSRF_HEADER_NAME)
    if not cookie_token or not header_token:
        return False
    return secrets.compare_digest(cookie_token, header_token)
