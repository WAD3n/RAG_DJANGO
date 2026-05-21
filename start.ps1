<#
.SYNOPSIS
    Uruchamia pelny stack RAG dla Dokumentow.
.PARAMETER Build
    Przebuduj obrazy Docker przed uruchomieniem.
.PARAMETER Down
    Zatrzymaj i usun wszystkie kontenery.
.PARAMETER CreateUser
    Po starcie backendu uruchom kreator pierwszego konta uzytkownika.
.EXAMPLE
    .\start.ps1               # uruchom (bez przebudowy)
    .\start.ps1 -Build        # uruchom z przebudowa obrazow
    .\start.ps1 -CreateUser   # uruchom i utworz pierwsze konto
    .\start.ps1 -Down         # zatrzymaj wszystko
#>
param(
    [switch]$Build,
    [switch]$Down,
    [switch]$CreateUser
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

# BuildKit sends the project path as a gRPC header (ASCII-only).
# Paths with non-ASCII chars (e.g. Polish letters) cause a parse error on Windows.
$env:DOCKER_BUILDKIT          = '0'
$env:COMPOSE_DOCKER_CLI_BUILD = '0'

$infra    = "$root\docker-compose.yml"
$backend  = "$root\backend\docker-compose.yml"
$frontend = "$root\frontend\docker-compose.yml"

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    [OK]  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!!]  $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "          $msg" -ForegroundColor DarkGray }

# ── Tryb zatrzymywania ────────────────────────────────────────────────────────
if ($Down) {
    Write-Step "Zatrzymywanie wszystkich kontenerow..."
    docker compose -f $frontend down
    docker compose -f $backend  down
    docker compose -f $infra    down
    Write-OK "Wszystkie kontenery zatrzymane."
    exit 0
}

# ── Sprawdzenie Dockera ───────────────────────────────────────────────────────
Write-Step "Sprawdzanie Dockera..."
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Err "Docker nie dziala. Uruchom Docker Desktop i sprobuj ponownie."
    exit 1
}
Write-OK "Docker dziala."

# ── 1. Infrastruktura (PostgreSQL, MinIO, Kafka) ──────────────────────────────
Write-Step "Uruchamianie infrastruktury (PostgreSQL, MinIO, Kafka)..."
docker compose -f $infra up -d
if ($LASTEXITCODE -ne 0) { Write-Err "Blad startu infrastruktury."; exit 1 }

Write-Info "Czekam az serwisy beda healthy (maks. 120 s)..."
$timeout = 120; $elapsed = 0; $ready = $false
do {
    Start-Sleep 5; $elapsed += 5
    $ps = docker compose -f $infra ps 2>&1 | Out-String
    if ($ps -notmatch 'starting' -and $ps -notmatch 'unhealthy') { $ready = $true }
    Write-Info "  $elapsed s / $timeout s"
} until ($ready -or $elapsed -ge $timeout)

if ($ready) { Write-OK "Infrastruktura gotowa." }
else        { Write-Warn "Timeout healthcheck — kontynuuje mimo to." }

# ── 2. Backend (API + Kafka Consumer) ────────────────────────────────────────
Write-Step "Uruchamianie backendu (API + Consumer)..."
if ($Build) {
    docker compose -f $backend up -d --build
} else {
    docker compose -f $backend up -d
}
if ($LASTEXITCODE -ne 0) { Write-Err "Blad startu backendu."; exit 1 }
Write-OK "Backend uruchomiony."

# ── 3. Opcjonalne: tworzenie pierwszego uzytkownika ───────────────────────────
if ($CreateUser) {
    Write-Step "Tworzenie konta uzytkownika..."
    Write-Info "Czekam az API bedzie gotowe (maks. 60 s)..."
    $apiReady = $false
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep 5
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:8000/api/stats" -Method GET -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { $apiReady = $true; break }
        } catch {}
    }
    if ($apiReady) {
        $username = Read-Host "  Login"
        $password = Read-Host "  Haslo" -AsSecureString
        $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
        $script = "from django.contrib.auth.models import User; User.objects.filter(username='$username').exists() or User.objects.create_superuser('$username','','$plainPwd'); print('OK')"
        docker compose -f $backend exec api python manage.py shell -c $script
        if ($LASTEXITCODE -eq 0) { Write-OK "Konto '$username' gotowe." }
        else                     { Write-Warn "Nie udalo sie utworzyc konta. Uzyj: docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser" }
    } else {
        Write-Warn "API nie odpowiada — pomijam tworzenie konta."
    }
}

# ── 4. Frontend (Next.js) ─────────────────────────────────────────────────────
Write-Step "Uruchamianie frontendu (Next.js)..."
if ($Build) {
    docker compose -f $frontend up -d --build
} else {
    docker compose -f $frontend up -d
}
if ($LASTEXITCODE -ne 0) { Write-Err "Blad startu frontendu."; exit 1 }
Write-OK "Frontend uruchomiony."

# ── Podsumowanie ──────────────────────────────────────────────────────────────
$line = "=" * 58
Write-Host ""
Write-Host $line -ForegroundColor Cyan
Write-Host "  RAG dla Dokumentow  --  Stack uruchomiony" -ForegroundColor Cyan
Write-Host $line -ForegroundColor Cyan
Write-Host "  Frontend     : " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor White
Write-Host "  Backend API  : " -NoNewline; Write-Host "http://localhost:8000/api/" -ForegroundColor White
Write-Host "  MinIO UI     : " -NoNewline; Write-Host "http://localhost:9001  (minioadmin / minioadmin)" -ForegroundColor White
Write-Host "  PostgreSQL   : " -NoNewline; Write-Host "localhost:5432  baza: ragdocs / ragdocs" -ForegroundColor White
Write-Host $line -ForegroundColor Cyan
Write-Host ""
Write-Host "  Pierwsze uruchomienie? Utworz konto:" -ForegroundColor DarkGray
Write-Host "    docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Logi backendu  : docker compose -f backend\docker-compose.yml logs -f" -ForegroundColor DarkGray
Write-Host "  Zatrzymaj      : .\start.ps1 -Down" -ForegroundColor DarkGray
Write-Host ""
