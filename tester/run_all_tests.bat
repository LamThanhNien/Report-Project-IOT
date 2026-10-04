@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  AIFOM — Full Test Suite
echo  Date: %date% %time%
echo ============================================================
echo.

set PASS_COUNT=0
set FAIL_COUNT=0

:: ── API Tests ──────────────────────────────────────────────────────────────
echo [1/3] Running API tests...
call run_api_tests.bat
if !ERRORLEVEL! == 0 (
    set /a PASS_COUNT+=1
    echo [OK] API tests passed.
) else (
    set /a FAIL_COUNT+=1
    echo [FAIL] API tests failed.
)
echo.

:: ── MQTT Tests ─────────────────────────────────────────────────────────────
echo [2/3] Running MQTT tests...
call run_mqtt_tests.bat
if !ERRORLEVEL! == 0 (
    set /a PASS_COUNT+=1
    echo [OK] MQTT tests passed.
) else (
    set /a FAIL_COUNT+=1
    echo [FAIL] MQTT tests failed.
)
echo.

:: ── E2E Tests ──────────────────────────────────────────────────────────────
echo [3/3] Running E2E tests...
call run_e2e_tests.bat
if !ERRORLEVEL! == 0 (
    set /a PASS_COUNT+=1
    echo [OK] E2E tests passed.
) else (
    set /a FAIL_COUNT+=1
    echo [FAIL] E2E tests failed.
)
echo.

:: ── Summary ────────────────────────────────────────────────────────────────
echo ============================================================
echo  Test Suite Summary
echo ============================================================
echo  Groups passed : !PASS_COUNT! / 3
echo  Groups failed : !FAIL_COUNT! / 3
echo.
echo  Reports:
echo    API   : tester\reports\api_report.html
echo    MQTT  : tester\reports\mqtt_report.html
echo    E2E   : tester\reports\playwright-report\index.html
echo ============================================================

if !FAIL_COUNT! GTR 0 (
    exit /b 1
)
exit /b 0
