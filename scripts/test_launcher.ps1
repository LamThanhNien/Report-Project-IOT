$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "run-aifom.ps1"), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Launcher parse failed" }
$frontendFunction = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Start-FrontendWindow" }, $true)
$frontendWindow = $frontendFunction.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Start-CommandWindow" }, $true)
if (-not $frontendWindow -or -not ($frontendWindow.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -eq "Visible" })) { throw "Frontend launcher must open a visible log window" }
$startupFrontend = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Start-FrontendWindow" }, $false)
$startupLogs = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Open-LogsWindows" -and $node.Extent.Text -match "RespectToggles" }, $false)
$startupHealth = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Wait-HttpEndpoint" }, $false)
if (-not $startupFrontend -or -not $startupLogs -or -not $startupHealth -or $startupFrontend.Extent.StartOffset -gt $startupHealth.Extent.StartOffset -or $startupLogs.Extent.StartOffset -gt $startupHealth.Extent.StartOffset) { throw "Log windows must open before backend health checks and demo seeding" }
$names = @("Start-CommandWindow", "Read-EnvFile", "Get-ConfigValue", "Get-Toggle", "Ensure-FrontendEnvFile")
foreach ($functionAst in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    if ($functionAst.Name -in $names) { Invoke-Expression $functionAst.Extent.Text }
}
# Substitute only process creation: verify visibility without opening test windows.
function Start-Process { param($FilePath, $WindowStyle, $WorkingDirectory, $ArgumentList) $script:RecordedStyle = $WindowStyle }
$script:RepoRoot = Join-Path $repo ".tmp/launcher-tests"
New-Item -ItemType Directory -Force $script:RepoRoot | Out-Null
Start-CommandWindow -Title "Test logs" -Command "echo test" -Visible
if ($script:RecordedStyle -ne "Normal") { throw "User-requested logs must be visible" }
Start-CommandWindow -Title "Background" -Command "echo test"
if ($script:RecordedStyle -ne "Hidden") { throw "Background helpers must remain hidden" }
Set-Content (Join-Path $script:RepoRoot ".env") "AIFOM_TEST_TOGGLE=0"
if (Get-Toggle -Name "AIFOM_TEST_TOGGLE" -Default "1") { throw "Toggle ignored .env" }
$front = Join-Path $script:RepoRoot "frontend"
New-Item -ItemType Directory -Force $front | Out-Null
Set-Content (Join-Path $front ".env") @("VITE_DEMO_ADMIN_EMAIL=stale", "CUSTOM_SETTING=keep", "VITE_DEMO_ENGINEER_EMAIL=retired@aifom.local", "VITE_DEMO_ENGINEER_PASSWORD=test-only-retired", "VITE_DEMO_ENGINEER_PASSWORD_HINT=test-only-retired")
Ensure-FrontendEnvFile -FrontendDir $front -ApiPort "8123" -EnvMap @{
    ADMIN_SEED_PASSWORD = "must-never-copy-real-admin"
    VITE_DEMO_ADMIN_EMAIL = "demo-admin@aifom.local"
    VITE_DEMO_ADMIN_PASSWORD = "test-only-password"
    VITE_DEMO_VIEWER_EMAIL = "demo-viewer@aifom.local"
    VITE_DEMO_VIEWER_PASSWORD = "test-only-viewer"
    VITE_DEMO_ENGINEER_EMAIL = "retired@aifom.local"
    VITE_DEMO_ENGINEER_PASSWORD = "test-only-retired"
}
$values = Read-EnvFile -Path (Join-Path $front ".env")
if ($values.VITE_API_BASE_URL -ne "http://localhost:8123" -or $values.VITE_DEMO_ADMIN_EMAIL -ne "demo-admin@aifom.local" -or $values.CUSTOM_SETTING -ne "keep" -or $values.VITE_DEMO_VIEWER_EMAIL -ne "demo-viewer@aifom.local") { throw "Frontend env synchronization failed" }
if ((Get-Content (Join-Path $front ".env") -Raw).Contains("must-never-copy-real-admin")) { throw "Real admin leaked to frontend" }
if (@($values.Keys | Where-Object { $_ -like 'VITE_DEMO_ENGINEER_*' }).Count) { throw "Retired account keys must not reach frontend" }
Write-Host "PASS: launcher parsing, visible logs, hidden helpers, .env toggles and demo-account synchronization"
