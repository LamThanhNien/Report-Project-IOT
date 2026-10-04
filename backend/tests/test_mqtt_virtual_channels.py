from app.shared.infrastructure.messaging import mqtt_publisher, mqtt_topics


def test_virtual_channel_topics_are_canonical() -> None:
    assert mqtt_topics.telemetry_channel_topic("esp32-1", "v2") == "devices/esp32-1/telemetry/ch_v2"
    assert (
        mqtt_topics.telemetry_channel_topic("esp32-1", "ch_v2") == "devices/esp32-1/telemetry/ch_v2"
    )
    assert (
        mqtt_topics.commands_channel_topic("esp32-1", "ch_v255")
        == "devices/esp32-1/commands/ch_v255"
    )


def test_virtual_channel_topic_parser_normalizes_canonical_channel() -> None:
    assert mqtt_topics.parse_device_topic("devices/esp32-1/telemetry/ch_v2") == (
        "esp32-1",
        "telemetry/ch_v2",
    )
    assert mqtt_topics.parse_device_topic("devices/esp32-1/commands/ch_v255") == (
        "esp32-1",
        "commands/ch_v255",
    )


def test_physical_channel_topics_remain_unchanged() -> None:
    assert (
        mqtt_topics.telemetry_channel_topic("esp32-1", "gpio_2")
        == "devices/esp32-1/telemetry/ch_gpio_2"
    )
    assert mqtt_topics.parse_device_topic("devices/esp32-1/telemetry/ch_gpio_2") == (
        "esp32-1",
        "telemetry/ch_gpio_2",
    )


def test_virtual_write_publishes_canonical_channel_topic(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def publish_channel(device_uid: str, channel: str, value: str) -> None:
        captured.update(device_uid=device_uid, channel=channel, value=value)

    monkeypatch.setattr(mqtt_publisher, "publish_channel_command", publish_channel)

    mqtt_publisher.publish_device_command(
        "esp32-1",
        {"command": "virtual_write", "target": "v2", "value": True},
    )

    assert captured == {"device_uid": "esp32-1", "channel": "v2", "value": "1"}


def test_virtual_channel_telemetry_invokes_rules_with_mapped_aliases(monkeypatch) -> None:
    import uuid
    from types import SimpleNamespace
    from app.shared.infrastructure.messaging import mqtt_subscriber
    from app.bounded_contexts.rule_engine.application.use_cases import RuleEngineUseCases

    device_uid = "esp32-1"
    device_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()

    device = SimpleNamespace(
        id=device_id,
        device_uid=device_uid,
        project_id=project_id,
        status="online",
    )
    mapping = SimpleNamespace(tenant_id=tenant_id)

    current_ds = SimpleNamespace(alias="d", name="Độ ẩm")

    # Mocks
    db_calls = []

    class DummyDb:
        def scalar(self, stmt):
            db_calls.append(stmt)
            stmt_str = str(stmt)
            if "tenant_device_mappings" in stmt_str:
                return mapping
            elif "tenant_datastreams" in stmt_str:
                return current_ds
            return None

    def fake_get_device_by_uid(db, uid):
        return device

    def fake_touch_device(db, uid, **kwargs):
        return device

    rule_eval_payloads = []

    def fake_evaluate_rules(self, tid, dev, payload):
        rule_eval_payloads.append(payload)
        return []

    monkeypatch.setattr(
        mqtt_subscriber.device_repository, "get_device_by_uid", fake_get_device_by_uid
    )
    monkeypatch.setattr(mqtt_subscriber.device_repository, "touch_device", fake_touch_device)
    monkeypatch.setattr(
        RuleEngineUseCases, "evaluate_enabled_rules_for_telemetry", fake_evaluate_rules
    )
    monkeypatch.setattr(
        mqtt_subscriber.MQTTSubscriber, "_emit_device_status_event", lambda *args: None
    )

    subscriber = mqtt_subscriber.MQTTSubscriber()

    # 1. Test alias mapping (d -> humidity)
    subscriber._handle_channel_telemetry(DummyDb(), device_uid, "v4", b"85.5")
    assert len(rule_eval_payloads) == 1
    payload1 = rule_eval_payloads[0]
    assert payload1["value"] == 85.5
    assert payload1["d"] == 85.5
    assert payload1["humidity"] == 85.5

    # 2. Test name-based mapping (lux -> light)
    current_ds = SimpleNamespace(alias="lux_sensor", name="Cảm biến ánh sáng")
    subscriber._handle_channel_telemetry(DummyDb(), device_uid, "v5", b"450.0")
    assert len(rule_eval_payloads) == 2
    payload2 = rule_eval_payloads[1]
    assert payload2["value"] == 450.0
    assert payload2["lux_sensor"] == 450.0
    assert payload2["light"] == 450.0
