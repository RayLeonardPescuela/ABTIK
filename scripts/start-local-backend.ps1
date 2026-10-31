# =============================================================================
# ABTIK — one-command local backend test
# =============================================================================
# Starts Docker + the local Supabase stack, applies BOTH migrations to a fresh
# database, then runs the PASS/FAIL verification suite.
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
  Write-Host '[1/4] Starting Docker Desktop...'
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
  Write-Host '[1/4] Docker engine already running.'
}

# --- 2. start the local Supabase stack ---------------------------------------
Write-Host '[2/4] Starting Supabase stack (first run downloads images)...'
supabase start

# --- 3. apply migrations onto a fresh database --------------------------------
Write-Host '[3/4] Applying migrations to a fresh local database...'
supabase db reset

# --- 4. run the verification suite --------------------------------------------
Write-Host '[4/4] Running the verification suite (expect PASS ... ALL CHECKS PASSED):'
Write-Host ''
supabase db query --local --file supabase\tests\verify_ride_flow.sql
