"""Firmware OTA infrastructure — MinIO storage adapter.

Wraps app.services.minio_client for firmware artifact storage.
"""

from app.services import minio_client


class MinioStorageAdapter:
    """Adapter wrapping minio_client for firmware storage operations."""

    @staticmethod
    def ensure_bucket() -> None:
        """Ensure the firmware bucket exists."""
        minio_client.ensure_firmware_bucket()

    @staticmethod
    def put_object(
        object_key: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> None:
        """Upload a firmware artifact to MinIO."""
        minio_client.put_firmware_object(object_key, data, content_type=content_type)

    @staticmethod
    def get_object_stream(object_key: str):
        """Get a streaming response for a firmware artifact."""
        return minio_client.get_firmware_object_stream(object_key)

    @staticmethod
    def remove_object(object_key: str) -> None:
        """Remove a firmware artifact from MinIO."""
        minio_client.remove_firmware_object(object_key)
