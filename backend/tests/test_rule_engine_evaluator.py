from app.bounded_contexts.rule_engine.domain.evaluator import (
    MISSING,
    evaluate_conditions,
    resolve_path,
)


def test_rule_engine_evaluates_dynamic_nested_field_paths() -> None:
    payload = {
        "soil_moisture": 24,
        "freezer": {"temp": -8},
        "machine_state": "running",
        "door_open": True,
    }

    matched, passed, failed, evaluated = evaluate_conditions(
        payload,
        [
            {"field": "soil_moisture", "operator": "<", "value": 30, "data_type": "number"},
            {"field": "freezer.temp", "operator": "<=", "value": -5, "data_type": "number"},
            {
                "field": "machine_state",
                "operator": "in",
                "value": ["running", "idle"],
                "data_type": "enum",
            },
            {"field": "door_open", "operator": "is_true", "value": None, "data_type": "boolean"},
        ],
        "and",
    )

    assert matched is True
    assert len(passed) == 4
    assert failed == []
    assert evaluated["freezer.temp"] == -8


def test_rule_engine_reports_failed_and_missing_conditions_without_eval() -> None:
    payload = {"inference": {"score": 0.42}, "compressor_status": "running"}

    matched, passed, failed, evaluated = evaluate_conditions(
        payload,
        [
            {"field": "inference.score", "operator": ">", "value": 0.9, "data_type": "number"},
            {"field": "custom.any_nested_field", "operator": "not_exists", "data_type": "string"},
        ],
        "and",
    )

    assert matched is False
    assert len(passed) == 1
    assert len(failed) == 1
    assert evaluated["inference.score"] == 0.42
    assert resolve_path(payload, "__import__('os').system('whoami')") is MISSING
