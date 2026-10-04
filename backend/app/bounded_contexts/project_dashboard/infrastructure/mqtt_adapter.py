"""Project Dashboard infrastructure — MQTT device command adapter.

Wraps app.services.mqtt_publisher for device command publishing.
"""

from app.services import mqtt_publisher


class MqttDeviceCommandAdapter:
    """Adapter wrapping mqtt_publisher for device command publishing."""

    @staticmethod
    def publish_device_command(device_uid: str, payload: dict) -> None:
        """Publish a device command to the device's commands topic."""
        mqtt_publisher.publish_device_command(device_uid, payload)
