@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  AIFOM - API Tests
echo ============================================================

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.11+ and try again.
    pause
    exit /b 1
)

python -c "import pytest" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing tester dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

if not exist .env (
    echo [WARN] .env not found - using defaults from .env.example
    copy .env.example .env >nul
)

echo [INFO] Preparing seeded test data...
call seed_test_data.bat
if errorlevel 1 (
    echo [ERROR] Could not prepare seed data.
    exit /b 1
)

echo.
echo [INFO] Running API tests...
echo [INFO] Target: %API_BASE_URL%
echo.

python -m pytest api\ -v --tb=short ^
    --html=reports\api_report.html --self-contained-html ^
    -p no:warnings 2>&1

set EXIT_CODE=%ERRORLEVEL%

echo.
if !EXIT_CODE! == 0 (
    echo [PASS] All API tests passed.
) else (
    echo [FAIL] Some API tests failed. See reports\api_report.html
)

echo.
echo Report saved to: tester\reports\api_report.html
echo ============================================================
exit /b !EXIT_CODE!
