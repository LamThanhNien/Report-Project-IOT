import os
import time
import hashlib
from pathlib import Path

TEMP_DIR = Path(__file__).parent.parent / "temp"
TEMP_DIR.mkdir(exist_ok=True)

# All generated records use this prefix so they can be identified/skipped safely.
PREFIX = "TEST_"


def unique_suffix() -> str:
    return str(int(time.time() * 1000))[-6:]


def test_device_uid() -> str:
    return f"{PREFIX}esp32-{unique_suffix()}"


def test_tenant_name() -> str:
    return f"{PREFIX}Tenant-{unique_suffix()}"


def test_tenant_slug() -> str:
    return f"test-tenant-{unique_suffix()}"


def test_plan_name() -> str:
    return f"{PREFIX}Plan-{unique_suffix()}"


def fake_firmware_bytes(size: int = 512) -> bytes:
    """Return a deterministic fake .bin file content."""
    header = b"\x00ESP\xE9"  # Fake ESP32 magic bytes
    body = os.urandom(max(0, size - len(header)))
    return header + body


def firmware_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_temp_firmware(name: str = "test_firmware.bin", size: int = 512) -> tuple[Path, bytes]:
    data = fake_firmware_bytes(size)
    path = TEMP_DIR / name
    path.write_bytes(data)
    return path, data
