from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.bounded_contexts.device_registry.infrastructure import repositories as device_repository
from app.bounded_contexts.device_registry.presentation.schemas import DeviceCreate
from app.bounded_contexts.project_dashboard.infrastructure import repositories
from app.bounded_contexts.project_dashboard.presentation.schemas import DatastreamCreate


def test_datastream_accepts_boolean_direction_and_default() -> None:
    payload = DatastreamCreate(
        project_id=uuid4(), name="Enabled", pin=1, data_type="boolean", default_value="true"
    )

    assert payload.direction == "bidirectional"
    assert payload.data_type == "boolean"


@pytest.mark.parametrize(
    "payload",
    [
        {"data_type": "boolean", "default_value": "1"},
        {"data_type": "string", "min_value": 0},
        {"data_type": "integer", "default_value": "1.5"},
        {"data_type": "double", "min_value": 2, "max_value": 1},
    ],
)
def test_datastream_rejects_invalid_contract(payload: dict) -> None:
    with pytest.raises(ValueError):
        DatastreamCreate(project_id=uuid4(), name="Value", pin=1, **payload)


def test_virtual_value_checks_type_and_range() -> None:
    datastream = SimpleNamespace(data_type="integer", min_value=1, max_value=3)

    repositories._validate_virtual_value(datastream, 2)
    with pytest.raises(HTTPException, match="integer"):
        repositories._validate_virtual_value(datastream, True)
    with pytest.raises(HTTPException, match="above"):
        repositories._validate_virtual_value(datastream, 4)


def test_manifest_only_restricts_virtual_channels_when_present() -> None:
    device = SimpleNamespace(last_status_payload={"capabilities": [{"channel": "v2"}]})

    repositories._validate_manifest_virtual_channel(device, "v2")
    with pytest.raises(HTTPException, match="not advertised"):
        repositories._validate_manifest_virtual_channel(device, "v3")
    repositories._validate_manifest_virtual_channel(SimpleNamespace(last_status_payload={}), "v3")


def test_device_model_derives_platform_and_hardware_model() -> None:
    model = SimpleNamespace(id=uuid4(), platform_id=uuid4(), name="ESP32 DevKit")

    class Db:
        def get(self, cls, model_id):
            return model if model_id == model.id else None

    payload = DeviceCreate(device_uid="node-1", name="Node", device_model_id=model.id)
    data = device_repository._device_data_with_model(Db(), payload)

    assert data["device_model_id"] == model.id
    assert data["platform_id"] == model.platform_id
    assert data["hardware_model"] == "ESP32 DevKit"
