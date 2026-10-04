"""Multi-platform device support models.

DevicePlatform: SDK/toolchain level (esp32_espidf, esp8266_arduino, rp2040_pico_w, etc.)
DeviceModel: Specific hardware boards within a platform (Generic ESP32, NodeMCU ESP8266, etc.)
CapabilityTemplate: Reusable capability definitions per device model (gpio, relay, sensor, etc.)
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class DevicePlatform(Base):
    """SDK/toolchain level platform definition.

    Each platform represents a firmware SDK/toolchain combination:
    - esp32_espidf: ESP32 with ESP-IDF
    - esp8266_arduino: ESP8266 with Arduino framework
    - arduino_wifi: Generic Arduino WiFi boards
    - rp2040_pico_w: Raspberry Pi Pico W
    - linux_gateway: Linux-based WiFi gateway
    """

    __tablename__ = "device_platforms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sdk_toolchain: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Capability flags — what this platform can do
    wifi_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    supports_mqtt: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    supports_ota: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    supports_gpio_config: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    supports_tinyml: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    models = relationship("DeviceModel", back_populates="platform", cascade="all, delete-orphan")


class DeviceModel(Base):
    """Specific hardware board within a platform.

    Examples:
    - Generic ESP32 (platform: esp32_espidf)
    - NodeMCU ESP8266 (platform: esp8266_arduino)
    - Raspberry Pi Pico W (platform: rp2040_pico_w)
    """

    __tablename__ = "device_models"
    __table_args__ = (UniqueConstraint("platform_id", "key", name="uq_platform_model_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_platforms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # GPIO pin configuration for this specific board
    # Schema: {"min": 0, "max": 39, "reserved": [6,7,8,9,10,11], "bootstraps": [0,1,3,5,12],
    #          "output_capable": [0,1,2,3,4,5,12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33]}
    gpio_pins_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Default capabilities that devices of this model should have
    # Schema: [{"capability_key": "relay_1", "capability_type": "relay", "label": "Relay 1",
    #           "gpio_pin": 25, "command_name": "set_relay", "telemetry_state_key": "relay_1_state"}]
    default_capabilities_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    platform = relationship("DevicePlatform", back_populates="models")
    capability_templates = relationship(
        "CapabilityTemplate", back_populates="device_model", cascade="all, delete-orphan"
    )


class CapabilityTemplate(Base):
    """Reusable capability definition for a device model.

    Templates define what capabilities a device model supports out of the box.
    When a device is registered with a model, these templates can be used to
    auto-populate the device's capabilities.
    """

    __tablename__ = "capability_templates"
    __table_args__ = (
        UniqueConstraint("device_model_id", "capability_key", name="uq_model_capability_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_models.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    capability_key: Mapped[str] = mapped_column(String(128), nullable=False)
    capability_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    gpio_pin: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel: Mapped[str | None] = mapped_column(String(64), nullable=True)
    command_name: Mapped[str] = mapped_column(String(64), nullable=False)
    telemetry_state_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_bindable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    device_model = relationship("DeviceModel", back_populates="capability_templates")
