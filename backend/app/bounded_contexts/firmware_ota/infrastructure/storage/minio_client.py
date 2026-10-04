import logging
from functools import lru_cache
from io import BytesIO

from minio import Minio
from minio.error import S3Error

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def get_minio_client() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


def ensure_firmware_bucket() -> None:
    client = get_minio_client()
    bucket = settings.minio_bucket_firmware
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            logger.info("MinIO created bucket=%s", bucket)
    except S3Error as exc:
        logger.exception("MinIO bucket ensure failed bucket=%s code=%s", bucket, exc.code)
        raise


def put_firmware_object(
    object_key: str, data: bytes, content_type: str = "application/octet-stream"
) -> None:
    client = get_minio_client()
    client.put_object(
        settings.minio_bucket_firmware,
        object_key,
        BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


def get_firmware_object_stream(object_key: str):
    """Return the raw urllib3 response — caller is responsible for close()/release_conn()."""
    client = get_minio_client()
    return client.get_object(settings.minio_bucket_firmware, object_key)


def remove_firmware_object(object_key: str) -> None:
    client = get_minio_client()
    try:
        client.remove_object(settings.minio_bucket_firmware, object_key)
    except S3Error:
        logger.exception("MinIO remove_object failed object_key=%s", object_key)
