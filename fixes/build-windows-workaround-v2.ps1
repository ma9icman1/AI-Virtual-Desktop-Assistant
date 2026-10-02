$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$package = Join-Path $root "package.json"
$badScript = Join-Path $root "scripts\fix-contextual-site-search.cjs"
$packageBackup = Join-Path $root "package.json.backup-before-contextual-skip"
$serverBackup = Join-Path $root ("server.ts.backup-before-build-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

Write-Host ""
Write-Host "=== ma9icAI Windows Build Workaround v2 ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $package)) { throw "package.json not found" }
if (-not (Test-Path $badScript)) { throw "scripts\fix-contextual-site-search.cjs not found" }

Copy-Item $package $packageBackup -Force
Copy-Item ".\server.ts" $serverBackup -Force

try {
    # Remove ONLY the known-bad contextual repair command from the build chain.
    # The script itself stays in place, so npm does not throw MODULE_NOT_FOUND.
    $pkg = Get-Content $package -Raw | ConvertFrom-Json
    $pkg.scripts.build = $pkg.scripts.build -replace ' && node scripts/fix-contextual-site-search\.cjs', ''
    $pkg | ConvertTo-Json -Depth 20 | Set-Content $package -Encoding UTF8

    Write-Host "Disabled only fix-contextual-site-search.cjs in the build chain." -ForegroundColor Yellow
    Write-Host "The actual script file was NOT deleted or renamed." -ForegroundColor DarkGray
    Write-Host ""

    # Restore a clean server.ts from origin/main before running the other repair scripts.
    git restore --source=origin/main -- server.ts

    Write-Host "Building Windows NSIS + portable..." -ForegroundColor Cyan
    npm run desktop:build

    if ($LASTEXITCODE -ne 0) {
        throw "Windows build failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host ""
    Write-Host "Installer / portable EXE should be in:" -ForegroundColor Green
    Write-Host "$root\release\" -ForegroundColor White
}
finally {
    # Always restore package.json exactly.
    if (Test-Path $packageBackup) {
        Copy-Item $packageBackup $package -Force
        Remove-Item $packageBackup -Force
    }

    Write-Host ""
    Write-Host "Restored package.json." -ForegroundColor DarkGray
    Write-Host "Server backup: $serverBackup" -ForegroundColor DarkGray
}
