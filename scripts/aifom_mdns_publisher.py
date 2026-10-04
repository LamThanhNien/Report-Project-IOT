#!/usr/bin/env python3
"""Advertise AIFOM MQTT services over mDNS from the host machine.

Run this on the Windows/Linux host, not inside Docker. Docker networking on
desktop OSes is not a reliable place to publish LAN multicast records.
"""

from __future__ import annotations

import argparse
import socket
import sys
import time
from dataclasses import dataclass

try:
    from zeroconf import IPVersion, ServiceInfo, Zeroconf
except Exception:  # noqa: BLE001
    print(
        "[AIFOM][mDNS] Missing dependency 'zeroconf'. Install with: pip install zeroconf",
        file=sys.stderr,
    )
    raise


MQTT_SERVICE_TYPES = ("_aifom-mqtt._tcp.local.", "_mqtt._tcp.local.")


@dataclass(frozen=True)
class AdvertiseConfig:
    hostname: str
    host_ip: str
    mqtt_port: int
    instance: str


def _is_excluded_ip(ip: str) -> bool:
    """Return True for loopback, Docker bridge, WSL, and other virtual adapter IPs."""
    if ip.startswith("127."):
        return True
    # Docker bridge default range
    if ip.startswith("172.17.") or ip.startswith("172.18.") or ip.startswith("172.19."):
        return True
    # Common WSL2 range
    if ip.startswith("172.") and ip.endswith(".1"):
        return True
    # Hyper-V default switch
    if ip.startswith("192.168.") and ip.endswith(".1"):
        return True
    # VMware NAT defaults
    if ip.startswith("192.168.56.") or ip.startswith("192.168.137."):
        return True
    return False


def pick_local_ipv4() -> str:
    """Best-effort LAN IPv4 detection without depending on DNS.

    Prefers the interface that can reach the internet (UDP trick) to avoid
    picking Docker bridge, WSL, or other virtual adapter IPs.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        if ip and not _is_excluded_ip(ip):
            return ip
    except OSError:
        pass
    finally:
        sock.close()

    try:
        for candidate in socket.gethostbyname_ex(socket.gethostname())[2]:
            if candidate and not _is_excluded_ip(candidate):
                return candidate
    except OSError:
        pass

    raise RuntimeError(
        "Could not detect a LAN IPv4 address. Pass --host-ip with this host's current LAN IP "
        "(e.g. --host-ip 192.168.1.89)."
    )


def normalize_hostname(value: str) -> str:
    host = value.strip().rstrip(".")
    if not host:
        host = "aifom.local"
    if not host.endswith(".local"):
        host = f"{host}.local"
    return f"{host}."


def validate_ipv4(value: str) -> str:
    try:
        socket.inet_aton(value)
    except OSError as exc:
        raise argparse.ArgumentTypeError(f"Invalid IPv4 address: {value}") from exc
    return value


def build_service_info(service_type: str, cfg: AdvertiseConfig) -> ServiceInfo:
    return ServiceInfo(
        service_type,
        f"{cfg.instance}.{service_type}",
        addresses=[socket.inet_aton(cfg.host_ip)],
        port=cfg.mqtt_port,
        properties={"role": "mqtt"},
        server=normalize_hostname(cfg.hostname),
    )


def parse_args() -> AdvertiseConfig:
    parser = argparse.ArgumentParser(description="AIFOM MQTT mDNS publisher")
    parser.add_argument("--host-ip", type=validate_ipv4, help="LAN IPv4 address to advertise")
    parser.add_argument("--mqtt-port", type=int, default=1883, help="MQTT broker port")
    parser.add_argument("--hostname", default="aifom.local", help="mDNS hostname to advertise")
    parser.add_argument("--instance", default="AIFOM MQTT", help="mDNS service instance name")
    parser.add_argument("--host", dest="hostname_alias", help=argparse.SUPPRESS)
    args = parser.parse_args()

    hostname = args.hostname_alias or args.hostname
    host_ip = args.host_ip or pick_local_ipv4()
    return AdvertiseConfig(
        hostname=hostname,
        host_ip=host_ip,
        mqtt_port=args.mqtt_port,
        instance=args.instance,
    )


def main() -> int:
    cfg = parse_args()
    services = [build_service_info(service_type, cfg) for service_type in MQTT_SERVICE_TYPES]
    zc = Zeroconf(ip_version=IPVersion.V4Only)

    try:
        for service in services:
            zc.register_service(service)

        print("[AIFOM][mDNS] MQTT publisher running on host")
        print(f"[AIFOM][mDNS] Advertised hostname : {normalize_hostname(cfg.hostname)}")
        print(f"[AIFOM][mDNS] Advertised LAN IP   : {cfg.host_ip}")
        print(f"[AIFOM][mDNS] Advertised MQTT port: {cfg.mqtt_port}")
        print("[AIFOM][mDNS] Advertised services:")
        for service in services:
            print(f"  - {service.name} -> {cfg.host_ip}:{service.port}")
        print("[AIFOM][mDNS] Keep this window open. Press Ctrl+C to stop.")
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n[AIFOM][mDNS] Stopping publisher...")
    finally:
        for service in services:
            try:
                zc.unregister_service(service)
            except Exception:  # noqa: BLE001
                pass
        zc.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
