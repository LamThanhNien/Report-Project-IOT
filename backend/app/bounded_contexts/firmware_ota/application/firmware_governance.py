import base64
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.exceptions import InvalidSignature
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_campaign_models import (
    OtaCampaign,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.core.config import settings
from app.modules.firmware.model import FirmwareVersion
from app.shared.infrastructure.persistence.settings_models import SystemSettings

logger = logging.getLogger(__name__)


def _default_development_signing_key_path() -> Path:
    workspace = Path("/workspace")
    root = workspace if workspace.is_dir() else Path.cwd()
    return root / ".local" / "keys" / "firmware-signing-ed25519.pem"


def _load_signing_private_key() -> tuple[Ed25519PrivateKey, Path]:
    configured_path = settings.firmware_signing_private_key_path.strip()
    if configured_path:
        path = Path(configured_path)
        if not path.is_file():
            raise RuntimeError("Configured firmware signing key is unavailable")
    else:
        if settings.app_env.lower() in {"production", "prod"}:
            raise RuntimeError("Firmware signing key is not configured")
        path = _default_development_signing_key_path()
        if not path.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            generated_key = Ed25519PrivateKey.generate()
            key_bytes = generated_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            try:
                with path.open("xb") as key_file:
                    key_file.write(key_bytes)
                os.chmod(path, 0o600)
                logger.warning("Generated local development firmware signing key at %s", path)
            except FileExistsError:
                # Another request created the same persistent development key.
                pass

    private_key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(private_key, Ed25519PrivateKey):
        raise RuntimeError("Firmware signing key must be an Ed25519 private key")
    return private_key, path


def sign_firmware(db: Session, firmware: FirmwareVersion) -> FirmwareVersion:
    if not firmware.checksum_sha256:
        raise ValueError("Firmware has no SHA-256 checksum to sign")
    private_key, path = _load_signing_private_key()
    signature = private_key.sign(firmware.checksum_sha256.encode("ascii"))
    public_pem = (
        private_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("ascii")
    )
    firmware.signature = base64.b64encode(signature).decode("ascii")
    firmware.signature_alg = "Ed25519"
    firmware.signature_payload = firmware.checksum_sha256
    firmware.signing_key_id = settings.firmware_signing_key_id or path.stem
    firmware.signing_public_key = public_pem
    firmware.signed_at = datetime.now(timezone.utc)
    if firmware.release_channel == "stable":
        firmware.verification_required = True
    db.commit()
    db.refresh(firmware)
    return firmware


def verify_firmware_signature_metadata(firmware: FirmwareVersion) -> bool:
    """Cryptographically verify stored Ed25519 metadata against the checksum."""
    if not all(
        (
            firmware.checksum_sha256,
            firmware.signature,
            firmware.signature_alg == "Ed25519",
            firmware.signing_public_key,
        )
    ):
        return False
    try:
        public_key = serialization.load_pem_public_key(firmware.signing_public_key.encode("ascii"))
        public_key.verify(
            base64.b64decode(firmware.signature, validate=True),
            firmware.checksum_sha256.encode("ascii"),
        )
    except (ValueError, TypeError, InvalidSignature):
        return False
    return True


def protection_reasons(db: Session, firmware: FirmwareVersion, newest_ids: set[UUID]) -> list[str]:
    reasons = []
    if firmware.is_active:
        reasons.append("active")
    if firmware.release_channel == "stable":
        reasons.append("stable_release")
    if firmware.id in newest_ids:
        reasons.append("minimum_versions_per_target")
    if db.scalar(
        select(OtaCampaign.id).where(OtaCampaign.firmware_version_id == firmware.id).limit(1)
    ):
        reasons.append("campaign_history")
    if db.scalar(select(OtaJob.id).where(OtaJob.firmware_version_id == firmware.id).limit(1)):
        reasons.append("ota_job_history")
    return reasons


def retention_plan(db: Session) -> dict:
    policy = db.get(SystemSettings, 1) or SystemSettings(id=1)
    records = list(
        db.scalars(
            select(FirmwareVersion).order_by(
                FirmwareVersion.target_device_type, FirmwareVersion.created_at.desc()
            )
        ).all()
    )
    newest_ids: set[UUID] = set()
    seen: dict[str, int] = {}
    for firmware in records:
        count = seen.get(firmware.target_device_type, 0)
        if count < policy.firmware_min_versions_per_target:
            newest_ids.add(firmware.id)
        seen[firmware.target_device_type] = count + 1
    cutoff = datetime.now(timezone.utc) - timedelta(days=policy.firmware_retention_days)
    candidates = []
    protected = []
    for firmware in records:
        reasons = protection_reasons(db, firmware, newest_ids)
        item = {
            "id": str(firmware.id),
            "version": firmware.version,
            "target_device_type": firmware.target_device_type,
            "reasons": reasons,
        }
        if firmware.created_at and firmware.created_at < cutoff and not reasons:
            candidates.append(item)
        elif reasons:
            protected.append(item)
    return {
        "retention_days": policy.firmware_retention_days,
        "minimum_versions_per_target": policy.firmware_min_versions_per_target,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "protected": protected,
    }
