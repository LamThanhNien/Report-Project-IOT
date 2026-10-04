"""Firmware OTA infrastructure — MQTT OTA publisher adapter.

Wraps app.services.mqtt_publisher for OTA request publishing.
"""

from app.services import mqtt_publisher


class MqttOtaPublisherAdapter:
    """Adapter wrapping mqtt_publisher for OTA command publishing."""

    @staticmethod
    def publish_ota_request(device_uid: str, payload: dict) -> None:
        """Publish an OTA request to the device's OTA topic."""
        mqtt_publisher.publish_ota_request(device_uid, payload)
