@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  AIFOM - Comprehensive System Test
echo  Date: %date% %time%
echo ============================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    pause
    exit /b 1
)

python -c "import requests" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing dependencies...
    pip install -r requirements.txt
)

if not exist reports mkdir reports

echo [INFO] Running comprehensive system tests...
echo [INFO] Target: %API_BASE_URL%
echo.

python run_full_test.py %*
set EXIT_CODE=%ERRORLEVEL%

echo.
if !EXIT_CODE! == 0 (
    echo [PASS] All system tests passed.
) else (
    echo [FAIL] Some tests failed. See reports\system_test_report.html
)

echo.
echo Report: tester\reports\system_test_report.html
echo ============================================================
exit /b !EXIT_CODE!
