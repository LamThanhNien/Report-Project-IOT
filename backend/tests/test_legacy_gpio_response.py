import uuid

import pytest
from pydantic import ValidationError

from app.bounded_contexts.device_registry.presentation.platform_schemas import (
    DeviceModelCreate,
    DeviceModelResponse,
)


def payload(gpio):
    return {"id": uuid.uuid4(), "platform_id": uuid.uuid4(), "key": "legacy-esp32", "name": "ESP32", "gpio_pins_json": gpio}


def test_legacy_response_preserves_gpio_flags_without_exposing_reserved_outputs():
    pins = [
        {"gpio_num": 2, "digital_output": True, "is_bootstrapping": True},
        {"gpio_num": 6, "digital_output": True, "is_reserved": True},
    ]
    response = DeviceModelResponse.model_validate(payload(pins))
    assert response.gpio_pins_json["output_capable"] == [2]
    assert response.gpio_pins_json["reserved"] == [6]
    assert response.gpio_pins_json["bootstraps"] == [2]
    assert response.gpio_pins_json["pins"] == pins
    assert isinstance(pins, list), "Reading must not rewrite existing database data"


def test_existing_dictionary_is_preserved_and_null_response_is_empty():
    assert DeviceModelResponse.model_validate(
        payload({"max": 39, "output_capable": [2]})
    ).gpio_pins_json == {"max": 39, "output_capable": [2]}
    assert DeviceModelResponse.model_validate(payload(None)).gpio_pins_json == {}


def test_new_writes_still_require_current_gpio_dictionary_contract():
    with pytest.raises(ValidationError):
        DeviceModelCreate.model_validate(payload([{"gpio_num": 2}]))
