@echo off
setlocal
cd /d "%~dp0.."

set "AIFOM_PYTHON=%AIFOM_PYTHON%"
if "%AIFOM_PYTHON%"=="" set "AIFOM_PYTHON=python"

echo [AIFOM] Checking MQTT mDNS service discovery
echo [AIFOM] Expected services:
echo   - _aifom-mqtt._tcp.local
echo   - _mqtt._tcp.local
echo.

echo [WARN] If checks fail:
echo - ensure PC and ESP32 are on same Wi-Fi
echo - allow UDP 5353 inbound/outbound and TCP 1883 inbound through Windows Firewall
echo - guest Wi-Fi, dorm Wi-Fi, or AP/client isolation may block multicast mDNS
echo.

"%AIFOM_PYTHON%" scripts\check_mdns_mqtt.py --tcp-check
exit /b %ERRORLEVEL%
