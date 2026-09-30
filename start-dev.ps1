# ============================================================
#  start-dev.ps1 - local dev launcher (no Docker)
#  Stack: PostgreSQL 18 + Redis (WSL or Windows) + Fastify + Vite
#  Save as UTF-8. Run: powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
# ============================================================

[CmdletBinding()]
param(
    [switch]$SkipMigrations,
    [switch]$SkipMinIO,
    [switch]$NoBrowser,
    [string]$PgPassword
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

# ---------- Settings ----------
$ApiDir   = Join-Path $Root "apps\api"
$WebDir   = Join-Path $Root "apps\web"
$ApiPort  = 3000
$WebPort  = 5173
$PgUser   = "postgres"
$PgDb     = "ulybka"
$RedisExe = "C:\redis\redis-server.exe"

# ---------- Pretty output ----------
function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Magenta }
function Info($m) { Write-Host "    $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    [!!] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "    [XX] $m" -ForegroundColor Red }

function Test-PortBusy($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
}

function Find-PgBin {
    $base = "C:\Program Files\PostgreSQL"
    if (-not (Test-Path $base)) { return $null }
    $versions = Get-ChildItem $base -Directory |
        Where-Object { $_.Name -match '^\d+$' } |
        Sort-Object { [int]$_.Name } -Descending
    foreach ($v in $versions) {
        $psql = Join-Path $v.FullName "bin\psql.exe"
        if (Test-Path $psql) { return (Join-Path $v.FullName "bin") }
    }
    return $null
}

function Get-WslDistro {
    try {
        $out = wsl -l -q 2>$null
        if (-not $out) { return $null }
        $distro = ($out | Where-Object { $_ -and $_ -notmatch 'docker-desktop' } | Select-Object -First 1)
        if ($distro) { return $distro.Trim() }
    } catch {}
    return $null
}

# ============================================================
#  STEP 1 - PostgreSQL
# ============================================================
Write-Step 1 "PostgreSQL"

$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pgService) {
    Fail "PostgreSQL service not found. Install PostgreSQL first."
    exit 1
}
if ($pgService.Status -ne "Running") {
    Warn "Starting service $($pgService.Name) (UAC may pop up)..."
    Start-Process powershell -Verb RunAs -ArgumentList "-Command Start-Service '$($pgService.Name)'" -Wait
    Start-Sleep -Seconds 3
}
$pgService = Get-Service $pgService.Name
if ($pgService.Status -ne "Running") { Fail "PostgreSQL did not start."; exit 1 }
Ok "Service $($pgService.Name) is running"

$PgBin = Find-PgBin
if (-not $PgBin) { Fail "psql.exe not found. Install PostgreSQL."; exit 1 }
Ok "Found PostgreSQL at $PgBin"

$psql = Join-Path $PgBin "psql.exe"

if (-not $PgPassword) {
    $sec = Read-Host "    Password for PostgreSQL user '$PgUser'" -AsSecureString
    $PgPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$env:PGPASSWORD = $PgPassword

# Check DB
$exists = & $psql -U $PgUser -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$PgDb'" 2>$null
if ($exists.Trim() -ne "1") {
    Warn "Database '$PgDb' not found, creating..."
    & $psql -U $PgUser -h localhost -c "CREATE DATABASE $PgDb;" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Failed to create database."; Remove-Item Env:\PGPASSWORD; exit 1 }
}
Ok "Database '$PgDb' is ready"
Remove-Item Env:\PGPASSWORD

# ============================================================
#  STEP 2 - Redis (Windows build)
# ============================================================
Write-Step 2 "Redis"

$RedisExe = "C:\redis\redis-server.exe"
$RedisCli = "C:\redis\redis-cli.exe"
$redisOk = $false

# 1. Проверяем, отвечает ли уже запущенный Redis
if (Test-Path $RedisCli) {
    try {
        $resp = & $RedisCli ping 2>$null
        if ($resp -match "PONG") {
            Ok "Redis already running"
            $redisOk = $true
        }
    } catch {}
}

# 2. Если не отвечает - запускаем
if (-not $redisOk -and (Test-Path $RedisExe)) {
    Info "Starting Redis from $RedisExe"
    Start-Process -FilePath $RedisExe -WindowStyle Minimized
    Start-Sleep -Seconds 2
    try {
        $resp = & $RedisCli ping 2>$null
        if ($resp -match "PONG") {
            Ok "Redis started"
            $redisOk = $true
        }
    } catch {}
}

if (-not $redisOk) {
    Warn "Redis not available. Backend may fail."
    Warn "Check that $RedisExe exists and redis-cli.exe is next to it."
}

# ============================================================
#  STEP 3 - MinIO (optional)
# ============================================================
Write-Step 3 "MinIO"
if ($SkipMinIO) {
    Info "Skipped (flag)"
} else {
    $minioExe = Join-Path $Root "minio.exe"
    if (Test-Path $minioExe) {
        if (-not (Get-Process -Name "minio" -ErrorAction SilentlyContinue)) {
            $dataDir = Join-Path $Root "minio-data"
            if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
            $env:MINIO_ROOT_USER = "minioadmin"
            $env:MINIO_ROOT_PASSWORD = "minioadmin"
            Start-Process -FilePath $minioExe `
                -ArgumentList "server `"$dataDir`" --console-address :9001" `
                -WindowStyle Minimized
            Start-Sleep -Seconds 2
            Ok "MinIO started (http://localhost:9001)"
        } else {
            Ok "MinIO already running"
        }
    } else {
        Warn "minio.exe not found, skipped"
    }
}

# ============================================================
#  STEP 4 - .env for API
# ============================================================
Write-Step 4 "API .env"

$envPath = Join-Path $ApiDir ".env"
$envExample = Join-Path $ApiDir ".env.example"

if (-not (Test-Path $envPath)) {
    if (-not (Test-Path $envExample)) {
        Fail ".env.example not found at $envExample"
        exit 1
    }
    Copy-Item $envExample $envPath
    Warn "Created .env from .env.example"
    Warn "Open $envPath and set POSTGRES_PASSWORD, REDIS_PASSWORD='' and replace 'db'/'redis'/'minio' with 'localhost'"
    Warn "Then re-run this script."
    exit 0
}

# Patch hosts: db/redis/minio -> localhost
$content = Get-Content $envPath -Raw
$patched = $content `
    -replace '(?m)^(\s*[A-Z_]*HOST\s*=\s*)db\s*$',   '$1localhost' `
    -replace '(?m)^(\s*[A-Z_]*HOST\s*=\s*)redis\s*$', '$1localhost' `
    -replace '(?m)^(\s*[A-Z_]*ENDPOINT\s*=\s*)minio\s*$', '$1localhost'

if ($patched -ne $content) {
    Set-Content -Path $envPath -Value $patched -Encoding UTF8
    Ok "Patched .env: docker hosts -> localhost"
} else {
    Ok ".env already looks local"
}

# Set PostgreSQL password if user provided it
if ($PgPassword) {
    $c = Get-Content $envPath -Raw
    if ($c -match '(?m)^POSTGRES_PASSWORD\s*=') {
        $c = $c -replace '(?m)^POSTGRES_PASSWORD\s*=.*$', "POSTGRES_PASSWORD=$PgPassword"
    } else {
        $c += "`nPOSTGRES_PASSWORD=$PgPassword`n"
    }
    Set-Content -Path $envPath -Value $c -Encoding UTF8
    Ok "POSTGRES_PASSWORD written to .env"
}

# Empty REDIS_PASSWORD (Windows Redis has no auth)
$c = Get-Content $envPath -Raw
if ($c -match '(?m)^REDIS_PASSWORD\s*=.*$') {
    $c = $c -replace '(?m)^REDIS_PASSWORD\s*=.*$', 'REDIS_PASSWORD='
    Set-Content -Path $envPath -Value $c -Encoding UTF8
    Ok "REDIS_PASSWORD cleared (Windows Redis has no auth)"
}

# ============================================================
#  STEP 5 - .env.local for Web
# ============================================================
Write-Step 5 "Web .env.local"
$webEnv = Join-Path $WebDir ".env.local"
$line = "VITE_API_URL=http://localhost:$ApiPort"
if (-not (Test-Path $webEnv) -or ((Get-Content $webEnv -Raw) -notmatch [regex]::Escape($line))) {
    Set-Content -Path $webEnv -Value $line -Encoding UTF8
    Ok "Written: $line"
} else {
    Ok "Already set"
}

# ============================================================
#  STEP 6 - Migrations
# ============================================================
Write-Step 6 "DB migrations"
if ($SkipMigrations) {
    Info "Skipped (flag)"
} else {
    Push-Location $ApiDir
    try {
        npm run db:migrate
        if ($LASTEXITCODE -ne 0) { Warn "Migrations failed (see above)" } else { Ok "Migrations OK" }
    } finally { Pop-Location }
}

# ============================================================
#  STEP 7 - Start API
# ============================================================
Write-Step 7 "Backend (Fastify)"
if (Test-PortBusy $ApiPort) {
    Warn "Port $ApiPort busy - backend probably already running"
} else {
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$ApiDir'; `$host.UI.RawUI.WindowTitle='API (ulybka)'; npm run dev"
    ) -WindowStyle Normal
    Start-Sleep -Seconds 4
    Ok "Backend launched in window 'API (ulybka)'"
}

# ============================================================
#  STEP 8 - Start Web
# ============================================================
Write-Step 8 "Frontend (Vite)"
if (Test-PortBusy $WebPort) {
    Warn "Port $WebPort busy - frontend probably already running"
} else {
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$WebDir'; `$host.UI.RawUI.WindowTitle='WEB (ulybka)'; npm run dev"
    ) -WindowStyle Normal
    Start-Sleep -Seconds 4
    Ok "Frontend launched in window 'WEB (ulybka)'"
}

# ============================================================
#  STEP 9 - Open browser
# ============================================================
Write-Step 9 "Ready"
if (-not $NoBrowser) { Start-Process "http://localhost:$WebPort/" }
Write-Host ""
Write-Host "  Frontend:  http://localhost:$WebPort/"  -ForegroundColor Gray
Write-Host "  Backend:   http://localhost:$ApiPort"   -ForegroundColor Gray
Write-Host "  MinIO:     http://localhost:9001"       -ForegroundColor Gray
Write-Host ""
Write-Host "  Stop: close 'API (ulybka)' and 'WEB (ulybka)' windows." -ForegroundColor Gray