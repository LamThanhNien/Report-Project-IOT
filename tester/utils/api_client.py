import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import requests
from config.settings import API_BASE_URL, REQUEST_TIMEOUT


class ApiClient:
    """Thin wrapper around requests.Session for the AIFOM API."""

    def __init__(self, base_url: str = API_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        # Do NOT set Content-Type on the session — requests sets it automatically
        # for json= (application/json) and files= (multipart/form-data).
        # A session-level Content-Type blocks multipart uploads because
        # requests.PreparedRequest.prepare_content_type() skips setting it when
        # the header already exists.

    def set_token(self, token: str):
        self.session.headers["Authorization"] = f"Bearer {token}"

    def clear_token(self):
        self.session.headers.pop("Authorization", None)

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def get(self, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        return self.session.get(self._url(path), **kwargs)

    def post(self, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        return self.session.post(self._url(path), **kwargs)

    def put(self, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        return self.session.put(self._url(path), **kwargs)

    def patch(self, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        return self.session.patch(self._url(path), **kwargs)

    def delete(self, path: str, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        return self.session.delete(self._url(path), **kwargs)

    def upload_file(self, path: str, file_field: str, file_bytes: bytes,
                    filename: str, extra_fields: dict = None) -> requests.Response:
        files = {file_field: (filename, file_bytes, "application/octet-stream")}
        data = extra_fields or {}
        # Pass files= and data= without any explicit Content-Type header so
        # requests can set multipart/form-data with the correct boundary.
        return self.session.post(
            self._url(path),
            files=files,
            data=data,
            timeout=REQUEST_TIMEOUT,
        )
