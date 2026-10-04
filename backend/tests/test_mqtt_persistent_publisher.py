import json
from unittest.mock import MagicMock, patch
import paho.mqtt.client as mqtt

from app.shared.infrastructure.messaging.mqtt_publisher import (
    MqttPublisherClient,
    get_persistent_mqtt_client,
    publish_channel_command,
    publish_custom_topic,
    publish_device_command,
    publish_ota_request,
)


def test_persistent_client_singleton():
    client1 = get_persistent_mqtt_client()
    client2 = get_persistent_mqtt_client()
    assert client1 is client2


def test_publisher_disconnected_by_default():
    client = MqttPublisherClient()
    assert not client.is_connected


def test_publisher_fallback_when_disconnected():
    client = MqttPublisherClient()
    assert client.publish("test/topic", "payload") is False
    assert client.publish_multiple([{"topic": "test/topic", "payload": "p"}]) is False


def test_publisher_publish_when_connected():
    client = MqttPublisherClient()
    client._connected = True
    mock_paho = MagicMock()
    mock_info = MagicMock()
    mock_info.rc = mqtt.MQTT_ERR_SUCCESS
    mock_paho.publish.return_value = mock_info
    client._client = mock_paho

    assert client.is_connected
    res = client.publish("test/topic", "payload", qos=1, retain=False)
    assert res is True
    mock_paho.publish.assert_called_once_with("test/topic", payload="payload", qos=1, retain=False)


def test_publisher_publish_multiple_when_connected():
    client = MqttPublisherClient()
    client._connected = True
    mock_paho = MagicMock()
    mock_info = MagicMock()
    mock_info.rc = mqtt.MQTT_ERR_SUCCESS
    mock_paho.publish.return_value = mock_info
    client._client = mock_paho

    msgs = [
        {"topic": "t1", "payload": "p1", "qos": 1, "retain": False},
        {"topic": "t2", "payload": "p2", "qos": 1, "retain": False},
    ]
    res = client.publish_multiple(msgs)
    assert res is True
    assert mock_paho.publish.call_count == 2


def test_publish_functions_use_persistent_client(monkeypatch):
    client = get_persistent_mqtt_client()
    published_messages = []

    def fake_publish(topic, payload, qos=1, retain=False):
        published_messages.append((topic, payload))
        return True

    monkeypatch.setattr(client, "publish", fake_publish)

    publish_ota_request("dev-1", {"job_id": "job-123"})
    assert len(published_messages) == 1
    assert published_messages[0][0] == "devices/dev-1/ota"
    payload = json.loads(published_messages[0][1])
    assert payload["job_id"] == "job-123"
    assert "correlation_id" in payload

    publish_channel_command("dev-1", "v1", 42)
    assert len(published_messages) == 2
    assert published_messages[1] == ("devices/dev-1/commands/ch_v1", "42")

    publish_custom_topic("custom/topic", {"key": "val"})
    assert len(published_messages) == 3
    assert published_messages[2][0] == "custom/topic"


def test_publish_functions_fallback_to_paho_single_when_disconnected(monkeypatch):
    client = get_persistent_mqtt_client()
    monkeypatch.setattr(client, "publish", lambda *args, **kwargs: False)

    with patch("paho.mqtt.publish.single") as mock_single:
        publish_channel_command("dev-2", "v2", "1")
        assert mock_single.called
        args, kwargs = mock_single.call_args
        assert args[0] == "devices/dev-2/commands/ch_v2"
        assert kwargs["payload"] == "1"
