param(
    [Parameter(Position = 0)]
    [string]$Action = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:RepoRoot = Split-Path -Parent $PSCommandPath
Set-Location -Path $script:RepoRoot

$script:ProjectCore = "aifom"
$script:ComposeDev = "infrastructure/docker-compose.dev.yml"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ""
    Write-Host "[AIFOM] $Message" -ForegroundColor Cyan
}

function Test-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$IgnoreErrors,
        [switch]$PassThruExitCode,
        [string]$ErrorMessage
    )
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $IgnoreErrors) {
        if ($ErrorMessage) {
            throw "$ErrorMessage (exit code: $exitCode)"
        }
        $argText = ($Arguments -join " ")
        throw "Command failed (exit code: $exitCode): $FilePath $argText"
    }
    if ($PassThruExitCode) {
        return $exitCode
    }
}

function Start-CommandWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Command,
        [string]$WorkingDirectory = $script:RepoRoot,
        [switch]$Visible
    )
    $windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
    Start-Process -FilePath "cmd.exe" -WindowStyle $windowStyle -WorkingDirectory $WorkingDirectory -ArgumentList @("/k", "title $Title && $Command") | Out-Null
}

function Wait-HttpEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 30,
        [int]$IntervalSeconds = 2
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "[OK]   $Name is reachable at $Url"
                return $true
            }
        } catch {
        }
        Start-Sleep -Seconds $IntervalSeconds
    }

    Write-Warning "$Name did not become reachable within $TimeoutSeconds seconds: $Url"
    return $false
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectName,
        [Parameter(Mandatory = $true)][string[]]$ComposeFiles,
        [Parameter(Mandatory = $true)][string[]]$ComposeArgs,
        [switch]$IgnoreErrors,
        [string]$ErrorMessage
    )
    $envFile = Join-Path $script:RepoRoot ".env"
    $args = @("compose", "--env-file", $envFile, "-p", $ProjectName)
    foreach ($file in $ComposeFiles) {
        $args += @("-f", $file)
    }
    $args += $ComposeArgs
    Invoke-NativeCommand -FilePath "docker" -Arguments $args -IgnoreErrors:$IgnoreErrors -ErrorMessage $ErrorMessage
}

function Read-EnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    $data = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $data
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            $data[$key] = $value.Trim("'").Trim('"')
        }
    }
    return $data
}

function Get-ConfigValue {
    param(
        [Parameter(Mandatory = $true)][hashtable]$EnvMap,
        [Parameter(Mandatory = $true)][string]$Key,
        [string]$Default = ""
    )
    $processValue = [Environment]::GetEnvironmentVariable($Key)
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return $processValue
    }
    if ($EnvMap.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$EnvMap[$Key])) {
        return [string]$EnvMap[$Key]
    }
    return $Default
}

function Get-Toggle {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Default = "1"
    )
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = Get-ConfigValue -EnvMap (Read-EnvFile -Path (Join-Path $script:RepoRoot ".env")) -Key $Name -Default $Default
    }
    return -not ($value -match "^(0|false|no|off)$")
}

function Get-IntConfigValue {
    param(
        [Parameter(Mandatory = $true)][hashtable]$EnvMap,
        [Parameter(Mandatory = $true)][string]$Key,
        [int]$Default
    )
    $raw = Get-ConfigValue -EnvMap $EnvMap -Key $Key -Default ([string]$Default)
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed)) {
        return $parsed
    }
    return $Default
}

function Ensure-EnvFile {
    if (Test-Path -LiteralPath ".env") {
        return
    }

    if (-not (Test-Path -LiteralPath ".env.example")) {
        throw "Missing .env and .env.example. Run this script from the AIFOM project root."
    }

    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "[INFO] Created .env from .env.example"
}

function Sync-EnvFileDefaults {
    param(
        [Parameter(Mandatory = $true)][string]$EnvPath,
        [Parameter(Mandatory = $true)][string]$ExamplePath
    )
    if (-not (Test-Path -LiteralPath $EnvPath) -or -not (Test-Path -LiteralPath $ExamplePath)) {
        return
    }

    $current = Read-EnvFile -Path $EnvPath
    $missingLines = @()
    foreach ($line in Get-Content -LiteralPath $ExamplePath) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            if (-not $current.ContainsKey($key)) {
                $missingLines += $line
            }
        }
    }

    if ($missingLines.Count -gt 0) {
        Add-Content -LiteralPath $EnvPath -Value ""
        Add-Content -LiteralPath $EnvPath -Value "# Added by run-aifom.ps1 from .env.example for local compatibility"
        Add-Content -LiteralPath $EnvPath -Value $missingLines
        Write-Host "[INFO] Added $($missingLines.Count) missing .env key(s) from .env.example"
    }
}

function Ensure-FrontendEnvFile {
    param(
        [Parameter(Mandatory = $true)][string]$FrontendDir,
        [Parameter(Mandatory = $true)][hashtable]$EnvMap,
        [Parameter(Mandatory = $true)][string]$ApiPort
    )
    $frontendEnvPath = Join-Path $FrontendDir ".env"
    $updates = @{ VITE_API_BASE_URL = "http://localhost:$ApiPort" }
    foreach ($role in @("ADMIN", "TENANT", "VIEWER")) {
        foreach ($suffix in @("EMAIL", "PASSWORD", "PASSWORD_HINT")) {
            $key = "VITE_DEMO_${role}_${suffix}"
            $value = Get-ConfigValue -EnvMap $EnvMap -Key $key
            if ($value -and $value -notmatch "^REPLACE_|^Configure ") { $updates[$key] = $value }
        }
    }
    $lines = if (Test-Path -LiteralPath $frontendEnvPath) { @(Get-Content -LiteralPath $frontendEnvPath | Where-Object { $_ -notmatch '^\s*VITE_DEMO_ENGINEER_(EMAIL|PASSWORD|PASSWORD_HINT)\s*=' }) } else { @() }
    $seen = @{}
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*([^=]+)=') {
            $key = $matches[1].Trim()
            if ($updates.ContainsKey($key)) { $lines[$i] = "$key=$($updates[$key])"; $seen[$key] = $true }
        }
    }
    foreach ($key in $updates.Keys) {
        if (-not $seen.ContainsKey($key)) { $lines += "$key=$($updates[$key])" }
    }
    $newContent = ($lines -join "`n") + "`n"
    $oldContent = if (Test-Path -LiteralPath $frontendEnvPath) { [IO.File]::ReadAllText($frontendEnvPath) } else { "" }
    if ($newContent -ne $oldContent) {
        [IO.File]::WriteAllText($frontendEnvPath, $newContent, [Text.UTF8Encoding]::new($false))
        Write-Host "[INFO] Synced frontend API and configured local demo accounts"
    }
}

function Get-CoreComposeFiles {
    return @($script:ComposeDev)
}

function Validate-ComposeFiles {
    if (-not (Test-Path -LiteralPath $script:ComposeDev)) {
        throw "Required compose file not found: $script:ComposeDev"
    }

    $coreFiles = Get-CoreComposeFiles
    Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreFiles -ComposeArgs @("config", "--quiet") -ErrorMessage "Core compose config validation failed"

}

function Assert-DockerReady {
    if (-not (Test-CommandExists -Name "docker")) {
        throw "Docker is not installed or not in PATH."
    }

    $null = Invoke-NativeCommand -FilePath "docker" -Arguments @("compose", "version") -ErrorMessage "Docker Compose plugin is not available"

    & docker info 1>$null 2>$null
    if (-not $?) {
        throw "Docker Engine is not running. Start Docker Desktop and retry."
    }
}

function Get-DockerPublishedPortOwners {
    param([Parameter(Mandatory = $true)][int]$Port)

    $containerIds = @(& docker ps --filter "publish=$Port" --format "{{.ID}}")
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Docker containers publishing host port $Port."
    }
    $containerIds = @($containerIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($containerIds.Count -eq 0) {
        return @()
    }

    $inspectJson = & docker inspect @containerIds
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Docker owner(s) of host port $Port."
    }
    return @($inspectJson | ConvertFrom-Json)
}

function Test-ComposeConfigMatchesWorkspace {
    param([Parameter(Mandatory = $true)]$Container)

    $labels = $Container.Config.Labels
    $configFiles = [string]$labels.'com.docker.compose.project.config_files'
    if ([string]::IsNullOrWhiteSpace($configFiles)) {
        return $false
    }

    $expectedPath = [IO.Path]::GetFullPath((Join-Path $script:RepoRoot $script:ComposeDev))
    foreach ($configFile in $configFiles.Split(',')) {
        if ([string]::IsNullOrWhiteSpace($configFile)) {
            continue
        }
        try {
            $candidatePath = [IO.Path]::GetFullPath($configFile.Trim())
            if ($candidatePath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        } catch {
        }
    }
    return $false
}

function Resolve-CorePortConflicts {
    param([Parameter(Mandatory = $true)][hashtable]$Settings)

    $portSettings = [ordered]@{
        POSTGRES_HOST_PORT = "PostgreSQL"
        MQTT_HOST_PORT = "Mosquitto"
        MINIO_HOST_PORT = "MinIO API"
        MINIO_CONSOLE_HOST_PORT = "MinIO console"
        API_HOST_PORT = "AIFOM API"
    }
    $legacyProjects = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

    foreach ($entry in $portSettings.GetEnumerator()) {
        $port = [int]$Settings[$entry.Key]
        foreach ($container in @(Get-DockerPublishedPortOwners -Port $port)) {
            $labels = $container.Config.Labels
            $project = [string]$labels.'com.docker.compose.project'
            $containerName = ([string]$container.Name).TrimStart('/')
            if ($project.Equals($script:ProjectCore, [StringComparison]::OrdinalIgnoreCase)) {
                continue
            }
            if (Test-ComposeConfigMatchesWorkspace -Container $container) {
                $null = $legacyProjects.Add($project)
                Write-Host "[INFO] Legacy AIFOM stack '$project' owns port $port ($($entry.Value)) via $containerName."
                continue
            }
            throw "Host port $port ($($entry.Value)) is already published by unrelated Docker container '$containerName' (project '$project'). Stop that container or change $($entry.Key) in .env."
        }
    }

    foreach ($project in $legacyProjects) {
        Write-Step "Removing legacy AIFOM Compose stack '$project'"
        Invoke-Compose -ProjectName $project -ComposeFiles @($script:ComposeDev) -ComposeArgs @("down", "--remove-orphans") -ErrorMessage "Failed to remove legacy AIFOM Compose stack '$project'"
        Write-Host "[OK]   Legacy stack '$project' removed; named volumes were preserved."
    }

    if ($legacyProjects.Count -gt 0) {
        Write-Step "Resetting failed core containers after port recovery"
        Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles @($script:ComposeDev) -ComposeArgs @("rm", "--stop", "--force") -ErrorMessage "Failed to reset AIFOM core containers after port recovery"
        Write-Host "[OK]   Core containers reset; named volumes were preserved."
    }

    foreach ($entry in $portSettings.GetEnumerator()) {
        $port = [int]$Settings[$entry.Key]
        $dockerOwners = @(Get-DockerPublishedPortOwners -Port $port)
        $foreignDockerOwners = @($dockerOwners | Where-Object {
            $project = [string]$_.Config.Labels.'com.docker.compose.project'
            -not $project.Equals($script:ProjectCore, [StringComparison]::OrdinalIgnoreCase)
        })
        if ($foreignDockerOwners.Count -gt 0) {
            $ownerNames = ($foreignDockerOwners | ForEach-Object { ([string]$_.Name).TrimStart('/') }) -join ', '
            throw "Host port $port ($($entry.Value)) remains occupied by Docker container(s): $ownerNames."
        }
        if ($dockerOwners.Count -gt 0) {
            continue
        }

        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
            $processNames = @($processIds | ForEach-Object {
                $process = Get-Process -Id $_ -ErrorAction SilentlyContinue
                if ($process) { "$($process.ProcessName) (PID $_)" } else { "PID $_" }
            }) -join ', '
            throw "Host port $port ($($entry.Value)) is already used by $processNames. Stop that process or change $($entry.Key) in .env."
        }
    }
}

function Start-FrontendWindow {
    param(
        [Parameter(Mandatory = $true)][string]$WebPort,
        [Parameter(Mandatory = $true)][hashtable]$EnvMap,
        [Parameter(Mandatory = $true)][string]$ApiPort
    )
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $frontendDir = Join-Path $script:RepoRoot "frontend"
    if (-not (Test-Path -LiteralPath $frontendDir)) {
        Write-Warning "frontend directory not found. Skipping frontend startup."
        return
    }
    Ensure-FrontendEnvFile -FrontendDir $frontendDir -EnvMap $EnvMap -ApiPort $ApiPort
    Write-Host "[INFO] Frontend env ready in $($timer.ElapsedMilliseconds) ms"
    $listeners = @(Get-NetTCPConnection -LocalPort ([int]$WebPort) -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        try {
            $packageUrl = "http://localhost:$WebPort/@fs/$($frontendDir.Replace('\', '/'))/package.json"
            $packageResponse = Invoke-WebRequest -UseBasicParsing -Uri $packageUrl -TimeoutSec 5
            if ($packageResponse.Content -match '"name"\s*:\s*"aifom-web-admin"') {
                Write-Host "[OK]   Reusing the running AIFOM frontend on port $WebPort."
                return
            }
        } catch { }
        throw "Frontend port $WebPort is occupied. Stop its owner or change WEB_HOST_PORT; no process was stopped."
    }

    if (-not (Test-CommandExists -Name "npm")) {
        Write-Warning "npm not found in PATH. Skipping frontend startup."
        return
    }

    $nodeModulesPath = Join-Path $frontendDir "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModulesPath)) {
        Write-Step "Installing frontend dependencies (npm install)"
        Push-Location $frontendDir
        try {
            Invoke-NativeCommand -FilePath "npm" -Arguments @("install") -ErrorMessage "npm install failed"
        } catch {
            Write-Warning "Frontend dependencies install failed. Skipping frontend startup."
            return
        } finally {
            Pop-Location
        }
    }
    Write-Host "[INFO] Frontend dependency check completed in $($timer.ElapsedMilliseconds) ms"

    $viteBin = Join-Path $frontendDir "node_modules\vite\bin\vite.js"
    if (Test-Path -LiteralPath $viteBin) {
        $frontendCommand = "set WEB_HOST_PORT=$WebPort && node node_modules\vite\bin\vite.js --host 0.0.0.0 --port $WebPort --strictPort"
    } else {
        Write-Warning "Vite CLI not found in node_modules. Falling back to npm run dev."
        $frontendCommand = "set WEB_HOST_PORT=$WebPort && npm run dev -- --port $WebPort --strictPort"
    }
    Start-CommandWindow -Title "AIFOM Frontend Logs" -Command $frontendCommand -WorkingDirectory $frontendDir -Visible
    if (-not (Wait-HttpEndpoint -Name "Frontend" -Url "http://localhost:$WebPort" -TimeoutSeconds 15)) {
        throw "Frontend did not start. Check Node/Vite output and WEB_HOST_PORT."
    }
    Write-Host "[OK]   Frontend is reachable after $($timer.ElapsedMilliseconds) ms."
}

function Open-LogsWindows {
    param(
        [Parameter(Mandatory = $true)][string[]]$CoreComposeFiles,
        [switch]$RespectToggles
    )
    $openApi = $true
    $openMqtt = $true
    if ($RespectToggles) {
        $openApi = Get-Toggle -Name "AUTO_OPEN_API_LOGS" -Default "1"
        $openMqtt = Get-Toggle -Name "AUTO_OPEN_MQTT_LOGS" -Default "1"
    }

    $coreFileFlags = ""
    foreach ($file in $CoreComposeFiles) {
        $coreFileFlags += " -f $file"
    }
    $coreCommandPrefix = "docker compose --env-file .env -p $script:ProjectCore$coreFileFlags"

    if ($openApi) {
        Start-CommandWindow -Title "AIFOM API Logs" -Command "$coreCommandPrefix logs --tail 80 -f api" -Visible
    }
    if ($openMqtt) {
        Start-CommandWindow -Title "AIFOM MQTT Logs" -Command "$coreCommandPrefix logs --tail 80 -f mosquitto" -Visible
    }
}

function Invoke-SeedScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string[]]$CoreComposeFiles,
        [string[]]$Arguments = @()
    )
    Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $CoreComposeFiles -ComposeArgs (@("exec", "-T", "api", "python", $ScriptPath) + $Arguments)
}

function Invoke-SeedDefaults {
    param(
        [Parameter(Mandatory = $true)][string[]]$CoreComposeFiles
    )
    Write-Step "Seeding defaults and dedicated local demo data/accounts"
    Invoke-SeedScript -ScriptPath "/workspace/scripts/seed_admin.py" -CoreComposeFiles $CoreComposeFiles
    Invoke-SeedScript -ScriptPath "/workspace/scripts/reset_service_plans.py" -CoreComposeFiles $CoreComposeFiles
    Invoke-SeedScript -ScriptPath "/workspace/scripts/seed_demo.py" -CoreComposeFiles $CoreComposeFiles
}

function Show-Status {
    param(
        [Parameter(Mandatory = $true)][string[]]$CoreComposeFiles
    )
    Write-Step "Core stack status ($script:ProjectCore)"
    Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $CoreComposeFiles -ComposeArgs @("ps")

}

function Invoke-MdnsPublisher {
    param(
        [Parameter(Mandatory = $true)][string]$Hostname,
        [Parameter(Mandatory = $true)][string]$MqttPort,
        [string]$HostIp
    )
    Write-Step "Starting host-side MQTT mDNS publisher"
    Write-Host "[AIFOM] Services : _aifom-mqtt._tcp.local, _mqtt._tcp.local"
    Write-Host "[AIFOM] Hostname : $Hostname"
    Write-Host "[AIFOM] MQTT port: $MqttPort"
    Write-Host "[WARN] Allow UDP 5353 inbound/outbound and TCP 1883 inbound in Windows Firewall."
    Write-Host "[WARN] Docker mDNS is unreliable on Windows; keep this publisher on the host."
    $args = @("scripts/aifom_mdns_publisher.py", "--hostname", $Hostname, "--mqtt-port", $MqttPort)
    if (-not [string]::IsNullOrWhiteSpace($HostIp)) {
        $args += @("--host-ip", $HostIp)
    }
    Invoke-NativeCommand -FilePath $script:PythonExe -Arguments $args -ErrorMessage "mDNS MQTT publisher failed"
}

function Invoke-MdnsCheck {
    Write-Step "Checking MQTT mDNS discovery"
    Write-Host "[AIFOM] Looking for _aifom-mqtt._tcp.local and _mqtt._tcp.local"
    Write-Host "[WARN] If discovery fails, check UDP 5353 and Wi-Fi multicast/client isolation."
    Invoke-NativeCommand -FilePath $script:PythonExe -Arguments @("scripts/check_mdns_mqtt.py", "--tcp-check") -ErrorMessage "mDNS MQTT discovery check failed"
}

function Show-Summary {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Settings
    )
    $apiUrl = "http://localhost:$($Settings.API_HOST_PORT)"
    $webUrl = "http://localhost:$($Settings.WEB_HOST_PORT)"
    $minioUrl = "http://localhost:$($Settings.MINIO_HOST_PORT)"
    $minioConsoleUrl = "http://localhost:$($Settings.MINIO_CONSOLE_HOST_PORT)"

    Write-Host ""
    Write-Host "==================== AIFOM URLs ===================="
    Write-Host "API       : $apiUrl"
    Write-Host "Frontend  : $webUrl"
    Write-Host "Device API: $($Settings.DEVICE_API_BASE_URL)"
    Write-Host "Device MQTT: $($Settings.DEVICE_MQTT_HOST):$($Settings.DEVICE_MQTT_PORT)"
    Write-Host "MQTT port : $($Settings.MQTT_HOST_PORT)"
    Write-Host "MinIO API : $minioUrl"
    Write-Host "MinIO UI  : $minioConsoleUrl"
    Write-Host ""
    Write-Host "Admin account: ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in .env"
    Write-Host "Demo accounts: expand 'Tai khoan demo' on the development login page; Use fills email/password."
    Write-Host "Demo accounts: run seed-demo; connect physical devices to receive telemetry."
    Write-Host ""
    Write-Host "Quick commands:"
    Write-Host "run-aifom.bat                # start"
    Write-Host "run-aifom.bat start-seed     # start + seed local demo data and accounts"
    Write-Host "run-aifom.bat rebuild        # rebuild images then start"
    Write-Host "run-aifom.bat status         # show running containers"
    Write-Host "run-aifom.bat logs           # open API/MQTT log windows"
    Write-Host "run-aifom.bat stop           # stop containers"
    Write-Host "run-aifom.bat down           # remove containers/networks"
    Write-Host "run-aifom.bat seed-admin     # seed admin user"
    Write-Host "run-aifom.bat seed-demo      # seed local demo data and accounts"
    Write-Host "run-aifom.bat mdns-start     # publish MQTT mDNS services from host"
    Write-Host "run-aifom.bat mdns-check     # discover MQTT mDNS services and test TCP"
    Write-Host "===================================================="
}

function Show-UsageAndExit {
    Write-Host "Usage: run-aifom.bat [start-seed|rebuild|stop|down|logs|status|seed-admin|seed-demo|mdns-start|mdns-check]"
    exit 1
}

try {
    $command = if ([string]::IsNullOrWhiteSpace($Action)) { "start" } else { $Action.Trim().ToLowerInvariant() }
    $supported = @("start", "start-seed", "rebuild", "stop", "down", "logs", "status", "seed-admin", "seed-demo", "mdns-start", "mdns-check")
    if ($command -notin $supported) {
        Show-UsageAndExit
    }

    Write-Step "Preparing environment"
    Ensure-EnvFile
    Sync-EnvFileDefaults -EnvPath ".env" -ExamplePath ".env.example"

    $envMap = Read-EnvFile -Path ".env"
    $script:PythonExe = Get-ConfigValue -EnvMap $envMap -Key "AIFOM_PYTHON" -Default "python"
    $mdnsHostname = Get-ConfigValue -EnvMap $envMap -Key "AIFOM_MDNS_HOSTNAME" -Default "aifom.local"
    $mdnsHostIp = Get-ConfigValue -EnvMap $envMap -Key "AIFOM_MDNS_HOST_IP" -Default ""
    $mdnsMqttPort = Get-ConfigValue -EnvMap $envMap -Key "AIFOM_MQTT_PORT" -Default ""
    if ([string]::IsNullOrWhiteSpace($mdnsMqttPort)) {
        $mdnsMqttPort = Get-ConfigValue -EnvMap $envMap -Key "MQTT_HOST_PORT" -Default "1883"
    }
    if ($command -eq "mdns-start") {
        Invoke-MdnsPublisher -Hostname $mdnsHostname -MqttPort $mdnsMqttPort -HostIp $mdnsHostIp
        exit 0
    }
    if ($command -eq "mdns-check") {
        Invoke-MdnsCheck
        exit 0
    }

    Write-Step "Checking Docker"
    Assert-DockerReady

    Write-Step "Validating compose files"
    Validate-ComposeFiles

    $coreComposeFiles = Get-CoreComposeFiles

    $settings = @{
        POSTGRES_HOST_PORT = Get-ConfigValue -EnvMap $envMap -Key "POSTGRES_HOST_PORT" -Default "5432"
        API_HOST_PORT = Get-ConfigValue -EnvMap $envMap -Key "API_HOST_PORT" -Default "8000"
        WEB_HOST_PORT = Get-ConfigValue -EnvMap $envMap -Key "WEB_HOST_PORT" -Default "5173"
        MQTT_HOST_PORT = Get-ConfigValue -EnvMap $envMap -Key "MQTT_HOST_PORT" -Default "1883"
        DEVICE_MQTT_HOST = Get-ConfigValue -EnvMap $envMap -Key "DEVICE_MQTT_HOST" -Default "aifom.local"
        DEVICE_MQTT_PORT = Get-ConfigValue -EnvMap $envMap -Key "DEVICE_MQTT_PORT" -Default "1883"
        DEVICE_API_BASE_URL = Get-ConfigValue -EnvMap $envMap -Key "DEVICE_API_BASE_URL" -Default "http://aifom.local:8000"
        MINIO_HOST_PORT = Get-ConfigValue -EnvMap $envMap -Key "MINIO_HOST_PORT" -Default "9000"
        MINIO_CONSOLE_HOST_PORT = Get-ConfigValue -EnvMap $envMap -Key "MINIO_CONSOLE_HOST_PORT" -Default "9001"
        API_HEALTH_TIMEOUT_SECONDS = Get-IntConfigValue -EnvMap $envMap -Key "AIFOM_API_HEALTH_TIMEOUT_SECONDS" -Default 15
        API_READY_TIMEOUT_SECONDS = Get-IntConfigValue -EnvMap $envMap -Key "AIFOM_API_READY_TIMEOUT_SECONDS" -Default 15
    }
    $seedAfterStart = $false

    if ($command -in @("start", "start-seed", "rebuild")) {
        Write-Step "Checking host port ownership"
        Resolve-CorePortConflicts -Settings $settings
    }

    switch ($command) {
        "status" {
            Show-Status -CoreComposeFiles $coreComposeFiles
            exit 0
        }
        "logs" {
            Write-Step "Opening API and MQTT logs windows"
            Open-LogsWindows -CoreComposeFiles $coreComposeFiles
            exit 0
        }
        "stop" {
            Write-Step "Stopping core stack"
            Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreComposeFiles -ComposeArgs @("stop")
            Write-Host "[OK]   Stopped."
            exit 0
        }
        "down" {
            Write-Step "Removing core containers/networks"
            Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreComposeFiles -ComposeArgs @("down")
            Write-Host "[OK]   Removed containers/networks (images and volumes preserved)."
            exit 0
        }
        "seed-admin" {
            Write-Step "Seeding admin user and standard service plans"
            Invoke-SeedScript -ScriptPath "/workspace/scripts/seed_admin.py" -CoreComposeFiles $coreComposeFiles
            Invoke-SeedScript -ScriptPath "/workspace/scripts/reset_service_plans.py" -CoreComposeFiles $coreComposeFiles
            exit 0
        }
        "seed-demo" {
            Invoke-SeedDefaults -CoreComposeFiles $coreComposeFiles
            exit 0
        }
        "start-seed" {
            Write-Step "Starting core stack (no rebuild)"
            Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreComposeFiles -ComposeArgs @("up", "-d", "--remove-orphans")
            $seedAfterStart = $true
        }
        "rebuild" {
            Write-Step "Rebuilding core images"
            Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreComposeFiles -ComposeArgs @("build")
            Write-Step "Starting core stack"
            Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreComposeFiles -ComposeArgs @("up", "-d", "--remove-orphans")
        }
        default {
            Write-Step "Starting core stack (no rebuild)"
            Invoke-Compose -ProjectName $script:ProjectCore -ComposeFiles $coreComposeFiles -ComposeArgs @("up", "-d", "--remove-orphans")
        }
    }

    if (-not $seedAfterStart) {
        $seedAfterStart = Get-Toggle -Name "AIFOM_AUTO_SEED_DEMO" -Default "0"
    }

    Write-Step "Opening optional log windows"
    Open-LogsWindows -CoreComposeFiles $coreComposeFiles -RespectToggles

    Write-Step "Starting frontend in separate window"
    Start-FrontendWindow -WebPort $settings.WEB_HOST_PORT -EnvMap $envMap -ApiPort $settings.API_HOST_PORT

    Write-Step "Starting mDNS publisher in separate window"
    $mdnsScript = Join-Path $script:RepoRoot "scripts\start_mdns_publisher.bat"
    if (Test-Path -LiteralPath $mdnsScript) {
        Start-CommandWindow -Title "AIFOM mDNS Publisher" -Command $mdnsScript
        Write-Host "[OK]   mDNS publisher started (aifom.local)"
    } else {
        Write-Warning "mDNS publisher script not found: $mdnsScript"
    }

    Write-Step "Running health checks"
    $apiUrl = "http://localhost:$($settings.API_HOST_PORT)"

    # Fast check: /health responds immediately (no startup-task dependency).
    $apiHealthy = Wait-HttpEndpoint -Name "API /health" -Url "$apiUrl/health" -TimeoutSeconds $settings.API_HEALTH_TIMEOUT_SECONDS -IntervalSeconds 2

    if (-not $apiHealthy) {
        Write-Warning "API health check failed. The API container may have crashed."
        Write-Host "[HINT] Run 'run-aifom.bat logs' to inspect API container logs." -ForegroundColor Yellow
        Write-Host "[HINT] Common cause: insecure JWT_SECRET or OTA_TOKEN_SECRET in .env file." -ForegroundColor Yellow
    }

    # Deep check: /ready confirms all startup tasks completed (migrations, seeding, etc.).
    # Shorter timeout — if /health passed, /ready should follow within seconds.
    $apiReady = Wait-HttpEndpoint -Name "API /ready" -Url "$apiUrl/ready" -TimeoutSeconds $settings.API_READY_TIMEOUT_SECONDS -IntervalSeconds 2
    if (-not $apiReady) {
        Write-Warning "API is not ready. Database migrations may have failed or the DB may be behind."
        Write-Host "[HINT] Run 'run-aifom.bat logs' and look for '[STARTUP] Alembic upgrade head failed'." -ForegroundColor Yellow
    }

    if ($seedAfterStart -and $apiReady) {
        try {
            Write-Step "Seeding local demo data and accounts after startup"
            Invoke-SeedDefaults -CoreComposeFiles $coreComposeFiles
        } catch {
            Write-Warning "Seeding defaults failed: $($_.Exception.Message)"
        }
    }

    $envMap = Read-EnvFile -Path ".env"
    # Demo seeding may update local credentials; keep the running frontend env in sync.
    Ensure-FrontendEnvFile -FrontendDir (Join-Path $script:RepoRoot "frontend") -EnvMap $envMap -ApiPort $settings.API_HOST_PORT
    Show-Status -CoreComposeFiles $coreComposeFiles
    Show-Summary -Settings $settings

    exit 0
} catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
