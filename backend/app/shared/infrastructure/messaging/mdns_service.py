"""mDNS service registration for MQTT broker discovery.

When enabled, registers `_aifom-mqtt._tcp.local` so ESP32 devices can
discover the broker automatically via mDNS.

Requires ``zeroconf`` (pip install zeroconf) and the backend must be
able to see the host network (e.g. ``network_mode: host`` in Docker
or running directly on the host).

Implementation note: zeroconf>=0.130 raises EventLoopBlocked when the
synchronous Zeroconf() is used inside an asyncio event loop (e.g.
FastAPI lifespan).  We therefore run the entire Zeroconf lifecycle in a
dedicated daemon thread so the event loop is never blocked.

IP resolution order (important for Docker deployments):
1. ``MDNS_HOST_IP`` env var — explicit override, set this when running in
   Docker so the LAN IP of the host is advertised instead of the container IP.
2. ``DEVICE_MQTT_HOST`` env var — if it resolves to a routable LAN IP
   (not 127.x or 172.x Docker bridge), it is used.
3. Best-effort UDP socket trick — works on the host but returns the
   container IP inside Docker.
"""

import logging
import os
import socket
import threading

logger = logging.getLogger(__name__)

_MDNS_SERVICE_TYPE = "_aifom-mqtt._tcp.local."
_MDNS_SERVICE_NAME = "aifom-broker._aifom-mqtt._tcp.local."


def _get_local_ip() -> str:
    """Return the best LAN IP to advertise in mDNS records.

    Resolution order:
    1. MDNS_HOST_IP env var (explicit override for Docker environments).
    2. DEVICE_MQTT_HOST env var resolved to an IP if it's a hostname.
    3. UDP socket trick (returns container IP inside Docker — fallback only).
    """
    # 1. Explicit override — most reliable when running inside Docker
    override = os.environ.get("MDNS_HOST_IP", "").strip()
    if override:
        try:
            socket.inet_aton(override)  # validate it's a real IPv4 address
            return override
        except OSError:
            logger.warning("MDNS_HOST_IP=%r is not a valid IPv4 address — ignoring", override)

    # 2. Try to resolve DEVICE_MQTT_HOST if it looks like a hostname / IP
    device_host = os.environ.get("DEVICE_MQTT_HOST", "").strip()
    if device_host and device_host not in ("aifom.local", "localhost"):
        try:
            resolved = socket.gethostbyname(device_host)
            # Reject loopback and Docker bridge IPs
            if not resolved.startswith("127.") and not resolved.startswith("172."):
                return resolved
        except Exception:
            pass

    # 3. UDP socket trick — works on host, returns container IP inside Docker
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


class MDNSService:
    """Registers the MQTT broker as an mDNS service on the LAN.

    Uses a background daemon thread so the FastAPI asyncio event loop is
    never blocked.  zeroconf>=0.130 requires this pattern.
    """

    def __init__(self, port: int = 1883) -> None:
        self._port = port
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._running = False

    # ------------------------------------------------------------------
    # Thread target — runs the Zeroconf lifecycle synchronously
    # ------------------------------------------------------------------

    def _run(self, ip_bytes: bytes, local_ip: str) -> None:
        try:
            from zeroconf import ServiceInfo, Zeroconf
        except ImportError:
            logger.warning("zeroconf not installed — mDNS registration disabled")
            return

        info = ServiceInfo(
            _MDNS_SERVICE_TYPE,
            _MDNS_SERVICE_NAME,
            addresses=[ip_bytes],
            port=self._port,
            properties={"service": "aifom", "protocol": "mqtt"},
            server="aifom.local.",
        )

        zc = Zeroconf()
        try:
            zc.register_service(info)
            logger.info("mDNS registered %s at %s:%d", _MDNS_SERVICE_NAME, local_ip, self._port)
            # Block until stop() sets the event.
            self._stop_event.wait()
            zc.unregister_service(info)
            logger.info("mDNS service unregistered")
        except Exception:
            logger.exception("mDNS registration failed")
        finally:
            try:
                zc.close()
            except Exception:
                logger.exception("mDNS zeroconf close failed")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self) -> None:
        local_ip = _get_local_ip()
        if local_ip.startswith("127."):
            logger.warning("Loopback IP detected — mDNS registration skipped")
            return

        try:
            ip_bytes = socket.inet_aton(local_ip)
        except OSError:
            logger.warning("Invalid IP %s — mDNS registration skipped", local_ip)
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(ip_bytes, local_ip),
            daemon=True,
            name="mdns-service",
        )
        self._thread.start()
        self._running = True

    def stop(self) -> None:
        if not self._running:
            return
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        self._running = False
