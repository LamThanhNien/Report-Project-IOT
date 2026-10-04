@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  AIFOM - MQTT Tests
echo ============================================================

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    pause
    exit /b 1
)

python -c "import paho.mqtt.client" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing tester dependencies...
    pip install -r requirements.txt
)

if not exist .env (
    copy .env.example .env >nul
)

echo [INFO] Preparing seeded test data...
call seed_test_data.bat
if errorlevel 1 (
    echo [ERROR] Could not prepare seed data.
    exit /b 1
)

echo.
echo [INFO] Running MQTT tests...
echo [INFO] Broker: %MQTT_HOST%:%MQTT_PORT% (default localhost:1883)
echo.

python -m pytest mqtt\ -v --tb=short ^
    --html=reports\mqtt_report.html --self-contained-html ^
    -p no:warnings 2>&1

set EXIT_CODE=%ERRORLEVEL%

echo.
if !EXIT_CODE! == 0 (
    echo [PASS] All MQTT tests passed.
) else (
    echo [FAIL] Some MQTT tests failed. See reports\mqtt_report.html
)

echo.
echo ============================================================
exit /b !EXIT_CODE!
