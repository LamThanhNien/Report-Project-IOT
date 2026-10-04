from __future__ import annotations

import re


_VIRTUAL_CHANNEL = re.compile(r"v(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$")


def normalize_virtual_channel(channel: str) -> str | None:
    """Return canonical ``vN`` channel, accepting its MQTT ``ch_vN`` form."""
    candidate = channel[3:] if channel.startswith("ch_") else channel
    return candidate if _VIRTUAL_CHANNEL.fullmatch(candidate) else None


def device_topic_base(device_uid: str) -> str:
    return f"devices/{device_uid}"


def telemetry_topic(device_uid: str) -> str:
    return f"{device_topic_base(device_uid)}/telemetry"


def telemetry_channel_topic(device_uid: str, channel: str) -> str:
    canonical = normalize_virtual_channel(channel)
    return f"{device_topic_base(device_uid)}/telemetry/ch_{canonical or channel}"


def status_topic(device_uid: str) -> str:
    return f"{device_topic_base(device_uid)}/status"


def events_topic(device_uid: str) -> str:
    return f"{device_topic_base(device_uid)}/events"


def commands_topic(device_uid: str) -> str:
    return f"{device_topic_base(device_uid)}/commands"


def commands_channel_topic(device_uid: str, channel: str) -> str:
    canonical = normalize_virtual_channel(channel)
    return f"{device_topic_base(device_uid)}/commands/ch_{canonical or channel}"


def ota_topic(device_uid: str) -> str:
    return f"{device_topic_base(device_uid)}/ota"


def ota_status_topic(device_uid: str) -> str:
    return f"{device_topic_base(device_uid)}/ota/status"












def parse_device_topic(topic: str) -> tuple[str, str] | None:
    parts = topic.split("/")

    # New convention: devices/{uid}/...
    if len(parts) >= 3 and parts[0] == "devices":
        device_uid = parts[1]
        if len(parts) == 3 and parts[2] in {
            "telemetry",
            "status",
            "events",
            "commands",
            "ota",
            "heartbeat",
        }:
            return device_uid, parts[2]
        if len(parts) == 4 and parts[2] == "telemetry" and parts[3].startswith("ch_"):
            canonical = normalize_virtual_channel(parts[3])
            return device_uid, f"telemetry/ch_{canonical or parts[3][3:]}"
        if len(parts) == 4 and parts[2] == "commands" and parts[3].startswith("ch_"):
            canonical = normalize_virtual_channel(parts[3])
            return device_uid, f"commands/ch_{canonical or parts[3][3:]}"
        if len(parts) == 4 and parts[2] == "ota" and parts[3] == "status":
            return device_uid, "ota_status"
        return None

    # Legacy compatibility: aifom/devices/{uid}/...
    if len(parts) >= 4 and parts[0] == "aifom" and parts[1] == "devices":
        device_uid = parts[2]
        if len(parts) == 4 and parts[3] in {"telemetry", "status", "events"}:
            return device_uid, parts[3]
        if len(parts) == 4 and parts[3] == "heartbeat":
            return device_uid, "status"
        if len(parts) == 5 and parts[3] == "ota" and parts[4] in {"result", "status"}:
            return device_uid, "ota_status"
        if len(parts) == 5 and parts[3] == "ota" and parts[4] == "request":
            return device_uid, "ota"
        return None

    return None
