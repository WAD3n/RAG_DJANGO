<#
.SYNOPSIS
    Starts the full RAG for Documents stack.
.PARAMETER Build
    Rebuild Docker images before starting.
.PARAMETER Down
    Stop and remove all containers.
.PARAMETER CreateUser
    After the backend starts, run the wizard to create the first user account.
.EXAMPLE
    .\start.ps1               # start (no rebuild)
    .\start.ps1 -Build        # start with image rebuild
    .\start.ps1 -CreateUser   # start and create the first account
    .\start.ps1 -Down         # stop everything
#>
param(
    [switch]$Build,
    [switch]$Down,
    [switch]$CreateUser
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

$env:DOCKER_BUILDKIT          = '0'
$env:COMPOSE_DOCKER_CLI_BUILD = '0'

$infra         = "$root\docker-compose.yml"
$backend       = "$root\backend\docker-compose.yml"
$frontend      = "$root\frontend\docker-compose.yml"
$observability = "$root\observability\docker-compose.yml"

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    [OK]  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!!]  $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "          $msg" -ForegroundColor DarkGray }

if ($Down) {
    Write-Step "Stopping all containers..."
    docker compose -f $observability down
    docker compose -f $frontend      down
    docker compose -f $backend       down
    docker compose -f $infra         down
    Write-OK "All containers stopped."
    exit 0
}

Write-Step "Checking Docker..."
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Err "Docker is not running. Start Docker Desktop and try again."
    exit 1
}
Write-OK "Docker is running."

Write-Step "Starting infrastructure (PostgreSQL, MinIO, Kafka)..."
docker compose -f $infra up -d
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to start infrastructure."; exit 1 }

Write-Info "Waiting for services to become healthy (max. 120 s)..."
$timeout = 120; $elapsed = 0; $ready = $false
do {
    Start-Sleep 5; $elapsed += 5
    $ps = docker compose -f $infra ps 2>&1 | Out-String
    if ($ps -notmatch 'starting' -and $ps -notmatch 'unhealthy') { $ready = $true }
    Write-Info "  $elapsed s / $timeout s"
} until ($ready -or $elapsed -ge $timeout)

if ($ready) { Write-OK "Infrastructure ready." }
else { Write-Warn "Healthcheck timeout - continuing anyway." }

Write-Step "Starting observability (Grafana, Loki, Prometheus, cAdvisor, DCGM)..."
if ($Build) {
    docker compose -f $observability up -d --build
} else {
    docker compose -f $observability up -d
}
if ($LASTEXITCODE -ne 0) { Write-Warn "Failed to start observability - continuing." }
else { Write-OK "Observability started." }

Write-Step "Starting backend (API + Consumer)..."
if ($Build) {
    docker compose -f $backend up -d --build
} else {
    docker compose -f $backend up -d
}
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to start backend."; exit 1 }
Write-OK "Backend started."

if ($CreateUser) {
    Write-Step "Creating user account..."
    Write-Info "Waiting for the API to be ready (max. 60 s)..."
    $apiReady = $false
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep 5
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:8000/api/stats" -Method GET -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { $apiReady = $true; break }
        } catch {}
    }
    if ($apiReady) {
        $username = Read-Host "  Username"
        $password = Read-Host "  Password" -AsSecureString
        $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
        $script = "from django.contrib.auth.models import User; User.objects.filter(username='$username').exists() or User.objects.create_superuser('$username','','$plainPwd'); print('OK')"
        docker compose -f $backend exec api python manage.py shell -c $script
        if ($LASTEXITCODE -eq 0) { Write-OK "Account '$username' ready." }
        else { Write-Warn "Failed to create account. Use: docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser" }
    } else {
        Write-Warn "API is not responding - skipping account creation."
    }
}

Write-Step "Starting frontend (Next.js)..."
if ($Build) {
    docker compose -f $frontend up -d --build
} else {
    docker compose -f $frontend up -d
}
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to start frontend."; exit 1 }
Write-OK "Frontend started."

$line = "=" * 58
Write-Host ""
Write-Host $line -ForegroundColor Cyan
Write-Host "  RAG for Documents  --  Stack started" -ForegroundColor Cyan
Write-Host $line -ForegroundColor Cyan
Write-Host "  Frontend     : " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor White
Write-Host "  Backend API  : " -NoNewline; Write-Host "http://localhost:8000/api/" -ForegroundColor White
Write-Host "  MinIO UI     : " -NoNewline; Write-Host "http://localhost:9001  (minioadmin / minioadmin)" -ForegroundColor White
Write-Host "  PostgreSQL   : " -NoNewline; Write-Host "localhost:5432  database: ragdocs / ragdocs" -ForegroundColor White
Write-Host "  Grafana      : " -NoNewline; Write-Host "http://localhost:3001  (admin / admin)" -ForegroundColor White
Write-Host "  Prometheus   : " -NoNewline; Write-Host "http://localhost:9090" -ForegroundColor White
Write-Host $line -ForegroundColor Cyan
Write-Host ""
Write-Host "  First run? Create an account:" -ForegroundColor DarkGray
Write-Host "    docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Backend logs   : docker compose -f backend\docker-compose.yml logs -f" -ForegroundColor DarkGray
Write-Host "  Stop           : .\start.ps1 -Down" -ForegroundColor DarkGray
Write-Host ""
