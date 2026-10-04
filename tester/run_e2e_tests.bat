@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  AIFOM - Frontend E2E Tests (Playwright)
echo ============================================================

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node.js 18+ and try again.
    pause
    exit /b 1
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

cd e2e

if not exist node_modules (
    echo [INFO] Installing Playwright dependencies...
    npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    npx playwright install chromium
)

echo.
echo [INFO] Running Playwright tests...
echo [INFO] Frontend URL: %FRONTEND_URL% (default http://localhost:5173)
echo.

npx playwright test --reporter=list 2>&1

set EXIT_CODE=%ERRORLEVEL%
cd ..

echo.
if !EXIT_CODE! == 0 (
    echo [PASS] All E2E tests passed.
) else (
    echo [FAIL] Some E2E tests failed.
    echo [INFO] View HTML report: npx playwright show-report tester\reports\playwright-report
)

echo ============================================================
exit /b !EXIT_CODE!
