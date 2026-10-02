$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$package = Join-Path $root "package.json"
$server = Join-Path $root "server.ts"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$buildRoot = "C:\ma9icAI-build"
$backupDir = Join-Path $root ".build-v8-backups-$stamp"

if (-not (Test-Path $package)) { throw "package.json not found. Run this from the project root." }
if (-not (Test-Path $server)) { throw "server.ts not found. Run this from the project root." }

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item $package (Join-Path $backupDir "package.json") -Force
Copy-Item $server (Join-Path $backupDir "server.ts") -Force

try {
    Write-Host "=== ma9icAI Windows Build Workaround v8 ===" -ForegroundColor Cyan

    $cleanServer = (& git show "origin/main:server.ts") -join "`r`n"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($cleanServer)) {
        throw "Could not read origin/main:server.ts"
    }
    [System.IO.File]::WriteAllText($server, $cleanServer, [System.Text.UTF8Encoding]::new($false))

    $pkg = [System.IO.File]::ReadAllText($package, [System.Text.UTF8Encoding]::new($false))
    $pkg = $pkg -replace 'node scripts/fix-contextual-site-search\.cjs\s*&&\s*', ''
    [System.IO.File]::WriteAllText($package, $pkg, [System.Text.UTF8Encoding]::new($false))

    Get-Process electron,electron-builder,app-builder,nsis -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    if (Test-Path $buildRoot) {
        Remove-Item $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

    Write-Host "Building application..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

    Write-Host "Packaging to $buildRoot ..." -ForegroundColor Cyan
    npx electron-builder --win nsis portable --config.directories.output="$buildRoot"
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }

    Write-Host ""
    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "Output: $buildRoot" -ForegroundColor Green
}
finally {
    Copy-Item (Join-Path $backupDir "package.json") $package -Force
    Copy-Item (Join-Path $backupDir "server.ts") $server -Force
    Write-Host "Restored package.json and server.ts exactly." -ForegroundColor DarkGreen
}
