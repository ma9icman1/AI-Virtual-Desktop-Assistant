# ma9icAI Windows build fix v7
# Run from the ma9icAIv1-main project directory.
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$package = Join-Path $root "package.json"
$server = Join-Path $root "server.ts"

if (-not (Test-Path $package)) { throw "package.json not found. Run this from the project root." }
if (-not (Test-Path $server)) { throw "server.ts not found. Run this from the project root." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageBackup = Join-Path $root "package.json.backup-before-v7-$stamp"
$serverBackup = Join-Path $root "server.ts.backup-before-v7-$stamp"
$release = Join-Path $root "release-v7"

Copy-Item $package $packageBackup -Force
Copy-Item $server $serverBackup -Force

try {
    Write-Host "=== ma9icAI build fix v7 ===" -ForegroundColor Cyan
    Write-Host "The brace heuristic is NOT being used." -ForegroundColor Yellow

    # Start from the known-good repository version instead of trying to
    # delete individual braces from a corrupted server.ts.
    $clean = (& git show "origin/main:server.ts") -join "`r`n"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($clean)) {
        throw "Could not read origin/main:server.ts. Backup: $serverBackup"
    }

    [System.IO.File]::WriteAllText(
        $server,
        $clean,
        [System.Text.UTF8Encoding]::new($false)
    )

    # Disable only the known-bad repair script that was adding the extra
    # closing brace. Leave the script file itself untouched.
    $packageText = [System.IO.File]::ReadAllText(
        $package,
        [System.Text.UTF8Encoding]::new($false)
    )

    $packageText = $packageText.Replace(
        "node scripts/fix-contextual-site-search.cjs && ",
        ""
    )
    $packageText = $packageText.Replace(
        "node scripts/fix-contextual-site-search.cjs &&",
        ""
    )
    $packageText = $packageText.Replace(
        "node scripts/fix-contextual-site-search.cjs",
        ""
    )

    [System.IO.File]::WriteAllText(
        $package,
        $packageText,
        [System.Text.UTF8Encoding]::new($false)
    )

    # Clean build output and stop processes that can lock Electron output.
    Get-Process electron,electron-builder -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    Remove-Item (Join-Path $root "dist") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $release -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "Running npm run build..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }

    Write-Host "Packaging Windows NSIS + portable..." -ForegroundColor Cyan
    npx electron-builder --win nsis portable --config.directories.output="$release"
    if ($LASTEXITCODE -ne 0) {
        throw "electron-builder failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "Output: $release" -ForegroundColor Green
}
finally {
    if (Test-Path $packageBackup) {
        Copy-Item $packageBackup $package -Force
        Remove-Item $packageBackup -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path $serverBackup) {
        Copy-Item $serverBackup $server -Force
        Remove-Item $serverBackup -Force -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "Restored package.json and server.ts exactly." -ForegroundColor DarkGreen
    Write-Host "Original server backup: $serverBackup" -ForegroundColor DarkGray
}
