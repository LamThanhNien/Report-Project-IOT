import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

_COMPILE_TIMEOUT_SECONDS = 120
_SAFE_SKETCH_NAME = re.compile(r"[^A-Za-z0-9_-]")


class CompilerError(Exception):
    pass


def is_available() -> bool:
    cli = settings.arduino_cli_path
    return settings.allow_host_source_firmware_compile and bool(cli) and os.path.isfile(cli)


def validate_board_fqbn(board_fqbn: str) -> str:
    fqbn = (board_fqbn or "").strip()
    allowed = settings.source_firmware_allowed_fqbn_set
    if not fqbn or fqbn not in allowed:
        raise CompilerError("Board target is not allowed for source compilation.")
    return fqbn


def _compile_root() -> Path:
    root = (Path(tempfile.gettempdir()) / "aifom-arduino-compile").resolve()
    system_tmp = Path(tempfile.gettempdir()).resolve()
    if os.path.commonpath([str(root), str(system_tmp)]) != str(system_tmp):
        raise CompilerError("Compiler workspace is invalid.")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    return root


def _safe_child(parent: Path, *parts: str) -> Path:
    parent_resolved = parent.resolve()
    child = parent_resolved.joinpath(*parts).resolve()
    if os.path.commonpath([str(child), str(parent_resolved)]) != str(parent_resolved):
        raise CompilerError("Compiler workspace path is invalid.")
    return child


def _safe_sketch_name(name: str = "sketch") -> str:
    safe = _SAFE_SKETCH_NAME.sub("_", name.strip())[:64]
    return safe or "sketch"


def compile_ino(source_code: str, board_fqbn: str = "esp32:esp32:esp32") -> bytes:
    """Compile Arduino .ino source and return the firmware .bin bytes."""
    if not settings.enable_source_firmware_compile:
        raise CompilerError("Source firmware compilation is disabled on this server.")
    if not settings.allow_host_source_firmware_compile:
        raise CompilerError("Host source firmware compilation is not allowed on this server.")
    fqbn = validate_board_fqbn(board_fqbn)
    cli = settings.arduino_cli_path
    if not cli:
        raise CompilerError("Arduino CLI is not configured for source compilation.")
    if not os.path.isfile(cli):
        raise CompilerError("Arduino CLI is not available on this server.")

    root = _compile_root()
    tmp_path = Path(tempfile.mkdtemp(prefix="job-", dir=str(root))).resolve()
    if os.path.commonpath([str(tmp_path), str(root)]) != str(root):
        raise CompilerError("Compiler workspace path is invalid.")

    try:
        sketch_dir = _safe_child(tmp_path, _safe_sketch_name("sketch"))
        sketch_dir.mkdir(mode=0o700)
        sketch_path = _safe_child(sketch_dir, f"{sketch_dir.name}.ino")
        sketch_path.write_text(source_code, encoding="utf-8")

        out_dir = _safe_child(tmp_path, "build")
        out_dir.mkdir(mode=0o700)

        cmd = [cli, "compile", "--fqbn", fqbn, "--output-dir", str(out_dir), str(sketch_dir)]
        logger.info("[COMPILER] start fqbn=%s", fqbn)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=_COMPILE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            logger.warning("[COMPILER] timeout fqbn=%s after=%ss", fqbn, _COMPILE_TIMEOUT_SECONDS)
            raise CompilerError("Compilation timed out.") from exc

        if result.returncode != 0:
            err_msg = (result.stderr or result.stdout or "Unknown compilation error").strip()
            logger.warning("[COMPILER] failed fqbn=%s rc=%s", fqbn, result.returncode)
            raise CompilerError(f"Compilation failed:\n{err_msg}")

        bin_files = sorted(out_dir.glob("*.bin"), key=lambda p: p.stat().st_size, reverse=True)
        if not bin_files:
            raise CompilerError("Compilation finished but no firmware binary was produced.")

        binary = bin_files[0].read_bytes()
        chk = hashlib.sha256(binary).hexdigest()
        logger.info("[COMPILER] done fqbn=%s size=%d sha256=%s", fqbn, len(binary), chk[:12])
        return binary
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)
