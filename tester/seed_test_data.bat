@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
set "COMPOSE_FILE=%REPO_ROOT%\infrastructure\docker-compose.dev.yml"
set "ENV_FILE=%REPO_ROOT%\.env"
set "PROJECT_FLAG="

if /I "%SKIP_SEED%"=="1" (
    echo [INFO] SKIP_SEED=1, skipping seed step.
    exit /b 0
)

if not exist "%ENV_FILE%" (
    if exist "%REPO_ROOT%\.env.example" (
        copy "%REPO_ROOT%\.env.example" "%ENV_FILE%" >nul
    )
)

if not exist "%COMPOSE_FILE%" (
    echo [ERROR] Compose file not found: %COMPOSE_FILE%
    exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is required for seed scripts.
    exit /b 1
)

if not "%AIFOM_COMPOSE_PROJECT%"=="" (
    set "PROJECT_FLAG=-p %AIFOM_COMPOSE_PROJECT%"
)

if "%PROJECT_FLAG%"=="" (
    docker compose --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" exec -T api python -V >nul 2>&1
    if errorlevel 1 (
        docker compose -p aifom --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" exec -T api python -V >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] API service is not running in docker compose project.
            echo [ERROR] Start stack first, or set AIFOM_COMPOSE_PROJECT.
            exit /b 1
        ) else (
            set "PROJECT_FLAG=-p aifom"
        )
    )
)

echo [INFO] Seeding test data from scripts\seed_*.py ...

docker compose %PROJECT_FLAG% --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" exec -T api python /workspace/scripts/seed_admin.py
if errorlevel 1 (
    echo [ERROR] seed_admin failed.
    exit /b 1
)

docker compose %PROJECT_FLAG% --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" exec -T api python /workspace/scripts/seed_demo.py --api-base http://localhost:8000
if errorlevel 1 (
    echo [ERROR] seed_demo failed.
    exit /b 1
)

docker compose %PROJECT_FLAG% --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" exec -T api python /workspace/scripts/seed_tenant_demo.py
if errorlevel 1 (
    echo [ERROR] seed_tenant_demo failed.
    exit /b 1
)

echo [INFO] Seed data is ready.
exit /b 0
