# =============================================================================
# ABTIK — one-command local backend test
# =============================================================================
# Starts Docker + the local Supabase stack, applies BOTH migrations to a fresh
# database, runs the PASS/FAIL verification suite, then seeds the demo-mode
# accounts used by the presentation build (demo sign-in needs them).
#
#   .\scripts\start-local-backend.ps1
#
# Prerequisites (already installed on this machine):
#   - Docker Desktop   (winget install Docker.DockerDesktop)
#   - Supabase CLI     (npm i -g supabase)
#   - One reboot after enabling VirtualMachinePlatform (one-time, by Windows)
# =============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot\.."

if (-not (Test-Path 'supabase\config.toml')) {
  throw 'supabase/config.toml not found - run "supabase init" first.'
}

# --- 1. make sure the Docker engine is running -------------------------------
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $dockerExe)) { throw 'Docker Desktop is not installed.' }
  Write-Host '[1/5] Starting Docker Desktop...'
  Start-Process $dockerExe

  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 5
    docker info *> $null
  } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)

  if ($LASTEXITCODE -ne 0) {
    throw 'Docker engine did not come up within 3 minutes. Finish the pending Windows reboot, then re-run.'
  }
} else {
  Write-Host '[1/5] Docker engine already running.'
}

# --- 2. start the local Supabase stack ---------------------------------------
Write-Host '[2/5] Starting Supabase stack (first run downloads images)...'
supabase start
if ($LASTEXITCODE -ne 0) { throw 'supabase start failed - see output above.' }

# --- 3. apply migrations onto a fresh database --------------------------------
Write-Host '[3/5] Applying migrations to a fresh local database...'
supabase db reset
if ($LASTEXITCODE -ne 0) { throw 'Migration failed - see output above.' }

# --- 4. run the verification suite --------------------------------------------
Write-Host '[4/5] Running the verification suite (green = no FAIL lines)...'
supabase db query --local --file supabase\tests\verify_ride_flow.sql
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  throw 'Verification suite FAILED - see the FAIL ... message above.'
}

Write-Host ''
supabase db query --local "SELECT 'ALL CHECKS PASSED' AS verification"

# --- 5. seed demo-mode accounts (db reset above wipes them) -------------------
Write-Host '[5/5] Seeding demo-mode accounts...'
supabase db query --local --file scripts\seed-demo-accounts.sql
if ($LASTEXITCODE -ne 0) { throw 'Demo account seed failed - see output above.' }

Write-Host ''
Write-Host 'Local backend is ready:'
Write-Host '  API     http://127.0.0.1:54321   (use this + the anon key in .env)'
Write-Host '  Studio  http://127.0.0.1:54323   (browse tables, run SQL)'
Write-Host '  Demo    demo.passenger@abtik.local / demo.driver@abtik.local'
Write-Host '          password abtik-demo-2026  (or the one-tap buttons in-app)'
