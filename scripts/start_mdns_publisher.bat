@echo off
setlocal
cd /d "%~dp0.."

set "AIFOM_MDNS_HOSTNAME=%AIFOM_MDNS_HOSTNAME%"
if "%AIFOM_MDNS_HOSTNAME%"=="" set "AIFOM_MDNS_HOSTNAME=aifom.local"
set "AIFOM_MDNS_HOST_IP=%AIFOM_MDNS_HOST_IP%"
set "MQTT_PORT=%MQTT_PORT%"
set "MQTT_HOST_PORT=%MQTT_HOST_PORT%"
set "DEVICE_MQTT_PORT=%DEVICE_MQTT_PORT%"

if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" (
      if /i "%%A"=="AIFOM_MDNS_HOSTNAME" if "%AIFOM_MDNS_HOSTNAME%"=="" set "AIFOM_MDNS_HOSTNAME=%%B"
      if /i "%%A"=="AIFOM_MDNS_HOST_IP" if "%AIFOM_MDNS_HOST_IP%"=="" set "AIFOM_MDNS_HOST_IP=%%B"
      if /i "%%A"=="MQTT_PORT" if "%MQTT_PORT%"=="" set "MQTT_PORT=%%B"
      if /i "%%A"=="MQTT_HOST_PORT" if "%MQTT_HOST_PORT%"=="" set "MQTT_HOST_PORT=%%B"
      if /i "%%A"=="DEVICE_MQTT_PORT" if "%DEVICE_MQTT_PORT%"=="" set "DEVICE_MQTT_PORT=%%B"
      if /i "%%A"=="AIFOM_MQTT_PORT" if "%AIFOM_MQTT_PORT%"=="" set "AIFOM_MQTT_PORT=%%B"
    )
  )
)

set "AIFOM_MQTT_PORT=%AIFOM_MQTT_PORT%"
if "%MQTT_PORT%"=="" set "MQTT_PORT=1883"
if "%MQTT_HOST_PORT%"=="" set "MQTT_HOST_PORT=%MQTT_PORT%"
if "%DEVICE_MQTT_PORT%"=="" set "DEVICE_MQTT_PORT=%MQTT_PORT%"
if "%AIFOM_MQTT_PORT%"=="" set "AIFOM_MQTT_PORT=%DEVICE_MQTT_PORT%"
if "%DEVICE_MQTT_PORT%"=="%MQTT_PORT%" if not "%MQTT_HOST_PORT%"=="%MQTT_PORT%" set "AIFOM_MQTT_PORT=%MQTT_HOST_PORT%"
set "AIFOM_PYTHON=%AIFOM_PYTHON%"
if "%AIFOM_PYTHON%"=="" set "AIFOM_PYTHON=python"

echo [AIFOM] Starting host-side mDNS MQTT publisher for physical ESP32 demo
echo [AIFOM] Hostname : %AIFOM_MDNS_HOSTNAME%
echo [AIFOM] MQTT     : _aifom-mqtt._tcp.local and _mqtt._tcp.local on port %AIFOM_MQTT_PORT%
echo.
echo [WARN] Allow UDP 5353 inbound/outbound and TCP %AIFOM_MQTT_PORT% inbound in Windows Firewall.
echo [WARN] ESP32 and PC must be on the same LAN; guest Wi-Fi/client isolation can block mDNS.
echo.

if "%AIFOM_MDNS_HOST_IP%"=="" (
  "%AIFOM_PYTHON%" scripts\aifom_mdns_publisher.py --hostname %AIFOM_MDNS_HOSTNAME% --mqtt-port %AIFOM_MQTT_PORT%
) else (
  "%AIFOM_PYTHON%" scripts\aifom_mdns_publisher.py --hostname %AIFOM_MDNS_HOSTNAME% --host-ip %AIFOM_MDNS_HOST_IP% --mqtt-port %AIFOM_MQTT_PORT%
)
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] mDNS publisher exited with code %EXIT_CODE%.
  echo [HINT] Install dependency if needed: pip install zeroconf
)
exit /b %EXIT_CODE%
