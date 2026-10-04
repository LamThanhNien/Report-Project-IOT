#!/usr/bin/env python3
"""Discover AIFOM MQTT services over mDNS and optionally test TCP connectivity."""

from __future__ import annotations

import argparse
import socket
import sys
import time
from dataclasses import dataclass

try:
    from zeroconf import IPVersion, ServiceBrowser, ServiceInfo, Zeroconf
except Exception:  # noqa: BLE001
    print(
        "[AIFOM][mDNS] Missing dependency 'zeroconf'. Install with: pip install zeroconf",
        file=sys.stderr,
    )
    raise


MQTT_SERVICE_TYPES = ("_aifom-mqtt._tcp.local.", "_mqtt._tcp.local.")


@dataclass(frozen=True)
class DiscoveredService:
    service_type: str
    name: str
    ip: str
    port: int
    server: str


class MqttServiceListener:
    def __init__(self, zc: Zeroconf, timeout_ms: int) -> None:
        self.zc = zc
        self.timeout_ms = timeout_ms
        self.results: dict[str, DiscoveredService] = {}

    def add_service(self, zc: Zeroconf, service_type: str, name: str) -> None:
        self._record(service_type, name)

    def update_service(self, zc: Zeroconf, service_type: str, name: str) -> None:
        self._record(service_type, name)

    def remove_service(self, zc: Zeroconf, service_type: str, name: str) -> None:
        return None

    def _record(self, service_type: str, name: str) -> None:
        info = self.zc.get_service_info(service_type, name, timeout=self.timeout_ms)
        if info is None:
            return
        discovered = to_discovered_service(service_type, name, info)
        if discovered is not None:
            self.results[name] = discovered


def to_discovered_service(
    service_type: str,
    name: str,
    info: ServiceInfo,
) -> DiscoveredService | None:
    addresses = info.parsed_addresses(IPVersion.V4Only)
    if not addresses:
        return None
    return DiscoveredService(
        service_type=service_type,
        name=name,
        ip=addresses[0],
        port=info.port,
        server=info.server or "",
    )


def tcp_check(ip: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Check AIFOM MQTT mDNS discovery")
    parser.add_argument("--timeout", type=float, default=5.0, help="Discovery timeout in seconds")
    parser.add_argument("--tcp-check", action="store_true", help="Test TCP connection to discovered broker")
    parser.add_argument("--tcp-timeout", type=float, default=3.0, help="TCP check timeout in seconds")
    args = parser.parse_args()

    zc = Zeroconf(ip_version=IPVersion.V4Only)
    listener = MqttServiceListener(zc, timeout_ms=1000)
    browsers = [ServiceBrowser(zc, service_type, listener) for service_type in MQTT_SERVICE_TYPES]

    try:
        print("[AIFOM][mDNS] Discovering MQTT services:")
        for service_type in MQTT_SERVICE_TYPES:
            print(f"  - {service_type}")

        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            if listener.results:
                break
            time.sleep(0.2)

        # Keep browser references alive until after the wait.
        _ = browsers

        if not listener.results:
            print("[AIFOM][mDNS] No MQTT mDNS service found.")
            print("[AIFOM][mDNS] Check UDP 5353 firewall rules and Wi-Fi multicast/client isolation.")
            return 1

        print("[AIFOM][mDNS] Discovered MQTT services:")
        for item in listener.results.values():
            print(f"  - {item.name}")
            print(f"    type  : {item.service_type}")
            print(f"    server: {item.server}")
            print(f"    target: {item.ip}:{item.port}")
            if args.tcp_check:
                status = "OK" if tcp_check(item.ip, item.port, args.tcp_timeout) else "FAILED"
                print(f"    tcp   : {status}")
        return 0
    finally:
        zc.close()


if __name__ == "__main__":
    raise SystemExit(main())
