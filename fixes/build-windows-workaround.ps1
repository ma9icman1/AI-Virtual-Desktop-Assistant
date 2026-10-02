$ErrorActionPreference = "Stop"

# ma9icAI Windows build workaround:
# scripts/fix-contextual-site-search.cjs currently corrupts server.ts by
# adding an extra closing brace. This script temporarily disables that
# one repair script, builds the Windows app, then restores it.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$badScript = Join-Path $root "scripts\fix-contextual-site-search.cjs"
$disabledScript = Join-Path $root "scripts\fix-contextual-site-search.cjs.disabled"

Write-Host ""
Write-Host "=== ma9icAI Windows Build Workaround ===" -ForegroundColor Cyan
Write-Host "Project: $root"
Write-Host ""

if (-not (Test-Path $badScript)) {
    throw "Could not find $badScript"
}

# Backup current server.ts before the build scripts modify it.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$serverBackup = Join-Path $root "server.ts.backup-before-build-$stamp"
Copy-Item (Join-Path $root "server.ts") $serverBackup -Force
Write-Host "Backup: $serverBackup" -ForegroundColor DarkGray

# Temporarily disable only the known-bad script.
if (Test-Path $disabledScript) {
    Remove-Item $disabledScript -Force
}
Rename-Item $badScript $disabledScript
Write-Host "Temporarily disabled: fix-contextual-site-search.cjs" -ForegroundColor Yellow

try {
    Write-Host ""
    Write-Host "Running Windows desktop build..." -ForegroundColor Cyan
    npm run desktop:build

    if ($LASTEXITCODE -ne 0) {
        throw "npm run desktop:build failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host ""
    Write-Host "Check the release folder for:" -ForegroundColor Green
    Write-Host "  release\*.exe"
    Write-Host ""
}
finally {
    # Always restore the repair script, even if the build fails.
    if (Test-Path $badScript) {
        Remove-Item $badScript -Force
    }
    if (Test-Path $disabledScript) {
        Rename-Item $disabledScript $badScript
    }
    Write-Host "Restored: scripts\fix-contextual-site-search.cjs" -ForegroundColor DarkGray
}

Write-Host "Done." -ForegroundColor Cyan
