# AIFOM Network Diagnostics
# Checks Docker, ports, mDNS publisher, firewall, and network config.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_aifom_network.ps1

$ErrorActionPreference = "Continue"
$script:Warnings = 0
$script:Errors = 0

function Write-Check {
    param([string]$Message)
    Write-Host "[CHECK] $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK]   $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [WARN] $Message" -ForegroundColor Yellow
    $script:Warnings++
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
    $script:Errors++
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO] $Message" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AIFOM Network Diagnostics" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Docker
Write-Check "Docker status"
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if ($dockerVersion) {
        Write-Ok "Docker Engine $dockerVersion"
    } else {
        Write-Fail "Docker Engine not responding. Start Docker Desktop."
    }
} catch {
    Write-Fail "Docker not found or not in PATH."
}

# 2. Docker containers
Write-Check "Docker containers"
try {
    $containers = docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>$null
    if ($containers) {
        foreach ($line in $containers) {
            Write-Info $line
        }
        if ($containers -match "mosquitto") {
            Write-Ok "Mosquitto container running"
        } else {
            Write-Warn "Mosquitto container NOT running. Start with: run-aifom.bat"
        }
        if ($containers -match "api") {
            Write-Ok "API container running"
        } else {
            Write-Warn "API container NOT running. Start with: run-aifom.bat"
        }
    } else {
        Write-Warn "No containers running. Start with: run-aifom.bat"
    }
} catch {
    Write-Warn "Could not list containers."
}

# 3. Port checks
Write-Check "Port 1883 (MQTT)"
$mqttListening = netstat -ano 2>$null | Select-String ":1883\s.*LISTEN"
if ($mqttListening) {
    Write-Ok "Port 1883 is LISTENING"
    foreach ($line in $mqttListening) {
        Write-Info $line.ToString().Trim()
    }
} else {
    Write-Fail "Port 1883 NOT listening. MQTT broker may not be running."
}

Write-Check "Port 8000 (API)"
$apiListening = netstat -ano 2>$null | Select-String ":8000\s.*LISTEN"
if ($apiListening) {
    Write-Ok "Port 8000 is LISTENING"
} else {
    Write-Warn "Port 8000 NOT listening. API may not be running."
}

# 4. LAN IP detection
Write-Check "Active LAN IPv4 address"
try {
    $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.InterfaceAlias -notmatch "Loopback" -and
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notmatch "^172\.(1[6-9]|2[0-9]|3[0-1])\." -and
        $_.PrefixOrigin -ne "WellKnown"
    } | Select-Object -First 1).IPAddress
    if ($lanIp) {
        Write-Ok "LAN IP: $lanIp"
    } else {
        Write-Warn "Could not auto-detect LAN IP. Pass --host-ip to mDNS publisher."
    }
} catch {
    Write-Info "Could not detect LAN IP (Get-NetIPAddress not available)."
    Write-Info "The mDNS publisher will auto-detect via socket fallback."
}

# 5. Python / zeroconf
Write-Check "Python and zeroconf"
$pythonExe = "python"
if ($env:AIFOM_PYTHON) { $pythonExe = $env:AIFOM_PYTHON }

try {
    $pyVersion = & $pythonExe --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Python: $pyVersion"
    } else {
        Write-Warn "Python not found at '$pythonExe'. Set AIFOM_PYTHON in .env."
    }
} catch {
    Write-Warn "Python not found at '$pythonExe'."
}

try {
    $zconfVersion = & $pythonExe -c "import zeroconf; print(zeroconf.__version__)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "zeroconf installed: $zconfVersion"
    } else {
        Write-Warn "zeroconf not installed. Install: pip install zeroconf"
    }
} catch {
    Write-Warn "zeroconf not installed. Install: pip install zeroconf"
}

# 6. mDNS publisher script
Write-Check "mDNS publisher script"
$mdnsScript = Join-Path $PSScriptRoot "aifom_mdns_publisher.py"
if (Test-Path -LiteralPath $mdnsScript) {
    Write-Ok "Found: $mdnsScript"
} else {
    Write-Fail "Not found: $mdnsScript"
}

# 7. mDNS publisher running check
Write-Check "mDNS publisher process (running check)"
$mdnsProc = Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmdLine -match "aifom_mdns_publisher"
    } catch { $false }
}
if ($mdnsProc) {
    Write-Ok "mDNS publisher is running (PID: $($mdnsProc.Id))"
} else {
    Write-Warn "mDNS publisher does NOT appear to be running."
    Write-Info "Start with: run-aifom.bat mdns-start"
    Write-Info "Or:        scripts\start_mdns_publisher.bat"
}

# 8. UDP 5353 check
Write-Check "UDP 5353 (mDNS) port"
$mdnsListening = netstat -ano 2>$null | Select-String ":5353\s"
if ($mdnsListening) {
    Write-Ok "UDP 5353 has active sockets (mDNS likely working)"
} else {
    Write-Info "No UDP 5353 sockets found (publisher may not be running)."
}

# 9. Firewall rules check
Write-Check "Windows Firewall rules for AIFOM"
$fwRules = Get-NetFirewallRule -DisplayName "AIFOM*" -ErrorAction SilentlyContinue
if ($fwRules) {
    foreach ($rule in $fwRules) {
        Write-Ok "Firewall rule: $($rule.DisplayName) [$($rule.Direction)] [$($rule.Action)]"
    }
} else {
    Write-Warn "No AIFOM firewall rules found."
    Write-Info "Suggested commands (run as Administrator):"
    Write-Info '  netsh advfirewall firewall add rule name="AIFOM mDNS" dir=in action=allow protocol=UDP localport=5353'
    Write-Info '  netsh advfirewall firewall add rule name="AIFOM mDNS out" dir=out action=allow protocol=UDP localport=5353'
    Write-Info '  netsh advfirewall firewall add rule name="AIFOM MQTT" dir=in action=allow protocol=TCP localport=1883'
    Write-Info '  netsh advfirewall firewall add rule name="AIFOM API" dir=in action=allow protocol=TCP localport=8000'
}

# 10. MQTT TCP connectivity test
Write-Check "MQTT TCP connectivity (localhost:1883)"
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("localhost", 1883)
    $tcp.Close()
    Write-Ok "TCP connection to localhost:1883 succeeded"
} catch {
    Write-Fail "Cannot connect to localhost:1883. Mosquitto may not be running."
}

if ($lanIp) {
    Write-Check "MQTT TCP connectivity ($lanIp`:1883)"
    try {
        $tcp2 = New-Object System.Net.Sockets.TcpClient
        $tcp2.Connect($lanIp, 1883)
        $tcp2.Close()
        Write-Ok "TCP connection to $lanIp`:1883 succeeded"
    } catch {
        Write-Warn "Cannot connect to $lanIp`:1883. Check firewall rules."
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Warnings: $($script:Warnings)" -ForegroundColor $(if ($script:Warnings -gt 0) { "Yellow" } else { "Green" })
Write-Host "  Errors:   $($script:Errors)" -ForegroundColor $(if ($script:Errors -gt 0) { "Red" } else { "Green" })

if ($script:Errors -gt 0) {
    Write-Host ""
    Write-Host "  Fix the errors above before testing ESP32 MQTT discovery." -ForegroundColor Red
} elseif ($script:Warnings -gt 0) {
    Write-Host ""
    Write-Host "  Review warnings above. ESP32 discovery may still work." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "  All checks passed. ESP32 MQTT discovery should work." -ForegroundColor Green
}

Write-Host ""
Write-Host "  Quick commands:" -ForegroundColor Gray
Write-Host "    run-aifom.bat mdns-start     # start mDNS publisher" -ForegroundColor Gray
Write-Host "    run-aifom.bat mdns-check     # verify mDNS discovery" -ForegroundColor Gray
Write-Host "    run-aifom.bat                # start full stack + mDNS" -ForegroundColor Gray
Write-Host ""
