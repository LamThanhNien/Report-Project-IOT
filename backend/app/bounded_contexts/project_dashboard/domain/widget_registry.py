from __future__ import annotations

from collections.abc import Mapping
from typing import Any

CONTROL_WIDGET_TYPES: set[str] = {
    "toggle_switch",
    "push_button",
    "momentary_button",
    "slider_control",
    "knob_dial_control",
    "numeric_input",
    "dropdown_command_selector",
    "segmented_control",
    "color_picker",
    "direction_pad_joystick",
    "stepper_control",
    "schedule_button_timer",
    # Legacy ids.
    "switch",
    "button",
}

DISPLAY_WIDGET_TYPES: set[str] = {
    "text_value",
    "number_card",
    "led_indicator",
    "icon_status",
    "battery_indicator",
    "signal_strength_wifi_rssi",
    "progress_bar",
    "thermometer",
    "humidity_card",
    "circular_gauge",
    "linear_gauge",
    "multi_value_card",
    "device_online_status",
    "last_seen_card",
    "gauge_widget",
    # Legacy ids.
    "text",
    "led",
    "gauge",
}

CHART_WIDGET_TYPES: set[str] = {
    "line_chart",
    "area_chart",
    "bar_chart",
    "donut_pie_chart",
    "sparkline",
    "realtime_mini_chart",
    "historical_telemetry_chart",
    "telemetry_chart",
    "multi_telemetry_chart",
    # Legacy ids.
    "chart",
}

STATUS_WIDGET_TYPES: set[str] = {
    "alarm_badge",
    "threshold_alert_card",
    "boolean_status_card",
    "error_state_card",
    "firmware_update_status",
    "ota_job_status",
    # Legacy ids.
    "status_card",
}

UTILITY_WIDGET_TYPES: set[str] = {
    "label_text_block",
    "divider",
    "image_card",
    "group_box_panel",
    "markdown_note",
    "device_info_card",
    "project_info_card",
}

ALL_WIDGET_TYPES: set[str] = (
    CONTROL_WIDGET_TYPES
    | DISPLAY_WIDGET_TYPES
    | CHART_WIDGET_TYPES
    | STATUS_WIDGET_TYPES
    | UTILITY_WIDGET_TYPES
)

# Keep the identifiers used by older projects readable while making all
# compatibility and configuration decisions against one canonical id.  The
# database is intentionally not rewritten by this map; it is only applied when
# validating or normalising a payload.
WIDGET_TYPE_ALIASES: dict[str, str] = {
    "switch": "toggle_switch",
    "button": "push_button",
    "text": "text_value",
    "led": "led_indicator",
    "gauge": "gauge_widget",
    "circular_gauge": "gauge_widget",
    "linear_gauge": "gauge_widget",
    "chart": "telemetry_chart",
    "line_chart": "telemetry_chart",
    "area_chart": "telemetry_chart",
    "bar_chart": "telemetry_chart",
    "historical_telemetry_chart": "telemetry_chart",
    "status_card": "device_online_status",
}

STATIC_WIDGET_TYPES: set[str] = {
    "label_text_block",
    "divider",
    "image_card",
    "group_box_panel",
    "markdown_note",
    "project_info_card",
}

BOOLEAN_CONTROL_WIDGET_TYPES: set[str] = {
    "toggle_switch",
    "push_button",
    "momentary_button",
    "schedule_button_timer",
}

NUMERIC_CONTROL_WIDGET_TYPES: set[str] = {
    "slider_control",
    "knob_dial_control",
    "numeric_input",
    "stepper_control",
}

OPTION_CONTROL_WIDGET_TYPES: set[str] = {
    "dropdown_command_selector",
    "segmented_control",
}

NUMERIC_TELEMETRY_WIDGET_TYPES: set[str] = {
    "number_card",
    "battery_indicator",
    "signal_strength_wifi_rssi",
    "progress_bar",
    "thermometer",
    "humidity_card",
    "circular_gauge",
    "linear_gauge",
    "multi_value_card",
    "gauge_widget",
    "threshold_alert_card",
    "ota_job_status",
}

BOOLEAN_TELEMETRY_WIDGET_TYPES: set[str] = {
    "led_indicator",
    "icon_status",
    "device_online_status",
    "alarm_badge",
    "boolean_status_card",
}

TEXT_TELEMETRY_WIDGET_TYPES: set[str] = {"text_value"}

_DATA_TYPES = {"integer", "double", "string", "boolean"}


def canonical_widget_type(widget_type: str) -> str:
    """Return the registry id used for semantic validation.

    Unknown ids are returned unchanged so the caller can still report the
    normal schema validation error for them.
    """

    return WIDGET_TYPE_ALIASES.get(str(widget_type), str(widget_type))


# Widgets that can trigger device commands.
COMMAND_WIDGET_TYPES: set[str] = set(CONTROL_WIDGET_TYPES)

# Widgets that require a bound device context.
DEVICE_REQUIRED_WIDGET_TYPES: set[str] = ALL_WIDGET_TYPES - {
    "label_text_block",
    "divider",
    "image_card",
    "group_box_panel",
    "markdown_note",
    "project_info_card",
}

# Widgets that are expected to surface live/feedback state.
FEEDBACK_REQUIRED_WIDGET_TYPES: set[str] = (
    CONTROL_WIDGET_TYPES | DISPLAY_WIDGET_TYPES | CHART_WIDGET_TYPES | STATUS_WIDGET_TYPES
) - {
    "push_button",
    "button",
    "direction_pad_joystick",
    "schedule_button_timer",
    "device_online_status",
    "last_seen_card",
}


def is_command_widget(widget_type: str) -> bool:
    return canonical_widget_type(widget_type) in {
        canonical_widget_type(item) for item in COMMAND_WIDGET_TYPES
    }


def widget_requires_device(widget_type: str) -> bool:
    return canonical_widget_type(widget_type) not in STATIC_WIDGET_TYPES


def widget_requires_feedback(widget_type: str) -> bool:
    canonical = canonical_widget_type(widget_type)
    return canonical in {canonical_widget_type(item) for item in FEEDBACK_REQUIRED_WIDGET_TYPES}


def widget_requires_virtual_binding(widget_type: str) -> bool:
    """Whether the MVP intentionally disallows a physical binding."""

    canonical = canonical_widget_type(widget_type)
    return canonical == "multi_telemetry_chart" or (
        canonical in CONTROL_WIDGET_TYPES and canonical not in BOOLEAN_CONTROL_WIDGET_TYPES
    )


def widget_datastream_data_types(widget_type: str) -> set[str] | None:
    """Return the datastream value types accepted by a widget.

    ``None`` means the widget has no specialised value-type contract (for
    example a legacy status card that derives its value from device state).
    """

    canonical = canonical_widget_type(widget_type)
    if canonical in BOOLEAN_CONTROL_WIDGET_TYPES:
        return {"boolean"}
    if canonical in NUMERIC_CONTROL_WIDGET_TYPES:
        return {"integer", "double"}
    if canonical in OPTION_CONTROL_WIDGET_TYPES:
        return set(_DATA_TYPES)
    if canonical in CHART_WIDGET_TYPES or canonical in NUMERIC_TELEMETRY_WIDGET_TYPES:
        return {"integer", "double"}
    if canonical in BOOLEAN_TELEMETRY_WIDGET_TYPES:
        return {"boolean"}
    if canonical in TEXT_TELEMETRY_WIDGET_TYPES:
        return {"string", "integer", "double"}
    return None


def widget_datastream_directions(widget_type: str) -> set[str] | None:
    """Return directions accepted by a datastream binding."""

    canonical = canonical_widget_type(widget_type)
    if canonical in CONTROL_WIDGET_TYPES:
        return {"command", "bidirectional"}
    if canonical in (DISPLAY_WIDGET_TYPES | CHART_WIDGET_TYPES | STATUS_WIDGET_TYPES):
        return {"telemetry", "bidirectional"}
    return None


def validate_datastream_compatibility(
    widget_type: str,
    data_type: str,
    direction: str,
) -> None:
    """Raise ``ValueError`` with an actionable message for an invalid bind."""

    canonical = canonical_widget_type(widget_type)
    allowed_directions = widget_datastream_directions(canonical)
    if allowed_directions is not None and direction not in allowed_directions:
        expected = ", ".join(sorted(allowed_directions))
        raise ValueError(
            f"Datastream direction '{direction}' is not compatible with "
            f"widget '{canonical}'; expected {expected}"
        )
    allowed_types = widget_datastream_data_types(canonical)
    if allowed_types is not None and data_type not in allowed_types:
        expected = ", ".join(sorted(allowed_types))
        raise ValueError(
            f"Datastream data_type '{data_type}' is not compatible with "
            f"widget '{canonical}'; expected {expected}"
        )


_TIME_RANGE_ALIASES = {
    "15m": "live",
    "24h": "1d",
    "7d": "1w",
}
_CANONICAL_TIME_RANGES = {"live", "6h", "1d", "1w", "1m"}
_CANONICAL_CHART_TYPES = {"line", "area", "bar"}
_CANONICAL_CURVE_TYPES = {"monotone", "linear", "step"}
_CANONICAL_AGGREGATIONS = {"avg", "min", "max"}


def _normalise_enum(
    config: dict[str, Any],
    key: str,
    allowed: set[str],
    *,
    aliases: dict[str, str] | None = None,
) -> None:
    if key not in config or config[key] is None:
        return
    value = str(config[key]).strip().lower()
    value = (aliases or {}).get(value, value)
    if value not in allowed:
        raise ValueError(f"config.{key} must be one of {', '.join(sorted(allowed))}")
    config[key] = value


def _normalise_number(config: dict[str, Any], key: str) -> float | int | None:
    if key not in config or config[key] is None or config[key] == "":
        return None
    value = config[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"config.{key} must be a number")
    return value


def normalize_widget_config(widget_type: str, config: Any) -> dict[str, Any]:
    """Normalize and validate semantic widget configuration at the API edge.

    Legacy field spellings and telemetry aliases remain in the document, but
    canonical ``timeRange`` and ``aggregation`` values are written so a later
    save converges on one representation.
    """

    normalized = normalize_widget_document(config)
    canonical = canonical_widget_type(widget_type)

    # Keep old snake_case documents readable while introducing canonical keys.
    if "chartType" not in normalized and "chart_type" in normalized:
        normalized["chartType"] = normalized["chart_type"]
    if "curveType" not in normalized and "curve_type" in normalized:
        normalized["curveType"] = normalized["curve_type"]
    if "timeRange" not in normalized and "time_range" in normalized:
        normalized["timeRange"] = normalized["time_range"]

    if canonical in CHART_WIDGET_TYPES:
        _normalise_enum(normalized, "chartType", _CANONICAL_CHART_TYPES)
        _normalise_enum(normalized, "curveType", _CANONICAL_CURVE_TYPES)
        _normalise_enum(
            normalized,
            "timeRange",
            _CANONICAL_TIME_RANGES,
            aliases=_TIME_RANGE_ALIASES,
        )
        _normalise_enum(
            normalized,
            "aggregation",
            _CANONICAL_AGGREGATIONS,
            aliases={"latest": "avg"},
        )

    minimum = _normalise_number(normalized, "min")
    maximum = _normalise_number(normalized, "max")
    if minimum is not None and maximum is not None and minimum > maximum:
        raise ValueError("config.min must be less than or equal to config.max")

    step = _normalise_number(normalized, "step")
    if step is not None and step <= 0:
        raise ValueError("config.step must be greater than 0")

    decimal_places = _normalise_number(normalized, "decimalPlaces")
    if decimal_places is not None and (
        not isinstance(decimal_places, int) or not 0 <= decimal_places <= 6
    ):
        raise ValueError("config.decimalPlaces must be an integer between 0 and 6")

    refresh = _normalise_number(normalized, "refreshIntervalSeconds")
    if refresh is not None and (not isinstance(refresh, int) or not 5 <= refresh <= 300):
        raise ValueError("config.refreshIntervalSeconds must be an integer between 5 and 300")

    max_points = _normalise_number(normalized, "maxDataPoints")
    if max_points is not None and (not isinstance(max_points, int) or not 10 <= max_points <= 500):
        raise ValueError("config.maxDataPoints must be an integer between 10 and 500")

    condition = normalized.get("thresholdCondition", normalized.get("threshold_condition"))
    if condition is not None:
        condition = str(condition).strip().lower()
        if condition not in {"above", "below"}:
            raise ValueError("config.thresholdCondition must be 'above' or 'below'")
        normalized["thresholdCondition"] = condition
    else:
        condition = "above"

    warning = _normalise_number(normalized, "warningThreshold")
    danger = _normalise_number(normalized, "dangerThreshold")
    if warning is not None and danger is not None:
        if condition == "above" and warning > danger:
            raise ValueError(
                "config.warningThreshold must be less than or equal to "
                "config.dangerThreshold when condition is above"
            )
        if condition == "below" and warning < danger:
            raise ValueError(
                "config.warningThreshold must be greater than or equal to "
                "config.dangerThreshold when condition is below"
            )

    return normalized


def normalize_widget_document(value: Any) -> dict[str, Any]:
    """
    Normalize widget config/layout/binding payloads to plain JSON-like dicts.
    """
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ValueError("widget document must be an object")
    return _normalize_obj(dict(value))


def _normalize_obj(obj: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, raw in obj.items():
        normalized[str(key)] = _normalize_value(raw)
    return normalized


def _normalize_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _normalize_obj(dict(value))
    if isinstance(value, list):
        return [_normalize_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    # Keep unknown scalar-ish values deterministic.
    return str(value)
