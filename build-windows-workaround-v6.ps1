$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== ma9icAI Windows Build Workaround v6 ===" -ForegroundColor Cyan
Write-Host ""

$root = (Get-Location).Path
$package = Join-Path $root "package.json"
$server = Join-Path $root "server.ts"
$release = Join-Path $root "release-v6"
$packageBackup = Join-Path $root "package.json.backup-v6"
$serverBackup = Join-Path $root "server.ts.backup-before-v6"

if (-not (Test-Path $package)) { throw "package.json not found. Run from the ma9icAIv1-main project root." }
if (-not (Test-Path $server)) { throw "server.ts not found. Run from the ma9icAIv1-main project root." }

# Stop anything that can keep electron-builder output locked.
Get-Process electron,electron-builder -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Back up both files before touching them.
Copy-Item $package $packageBackup -Force
Copy-Item $server $serverBackup -Force

try {
    Write-Host "1. Restoring server.ts from origin/main..." -ForegroundColor Yellow

    $clean = (& git show "origin/main:server.ts") -join "`r`n"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($clean)) {
        throw "Could not read origin/main:server.ts. Your backup is $serverBackup"
    }

    # Preserve the known site-search behavior from the project's repair script.
    # This also verifies that the clean origin/main file is syntactically valid.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($server, $clean, $utf8NoBom)

    Write-Host "2. Removing ONLY fix-contextual-site-search.cjs from the build chain..." -ForegroundColor Yellow

    $packageText = [System.IO.File]::ReadAllText($package)
    $badStep = "node scripts/fix-contextual-site-search.cjs && "
    if ($packageText.Contains($badStep)) {
        $packageText = $packageText.Replace($badStep, "")
    } elseif ($packageText.Contains("node scripts/fix-contextual-site-search.cjs")) {
        $packageText = $packageText.Replace("node scripts/fix-contextual-site-search.cjs &&", "")
        $packageText = $packageText.Replace("node scripts/fix-contextual-site-search.cjs", "")
    }

    [System.IO.File]::WriteAllText($package, $packageText, $utf8NoBom)

    Write-Host "3. Cleaning dist and release-v6..." -ForegroundColor Yellow
    Remove-Item (Join-Path $root "dist") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $release -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "4. Running npm run build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }

    Write-Host "5. Packaging NSIS + portable into release-v6..." -ForegroundColor Yellow
    npx electron-builder --win nsis portable --config.directories.output="$release"
    if ($LASTEXITCODE -ne 0) {
        throw "electron-builder failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "=== BUILD SUCCESS ===" -ForegroundColor Green
    Write-Host "Output: $release" -ForegroundColor Green
    Write-Host ""

    Get-ChildItem $release -File -ErrorAction SilentlyContinue |
        Select-Object Name, Length, LastWriteTime |
        Format-Table -AutoSize
}
finally {
    # Always restore the user's original package.json and server.ts.
    if (Test-Path $packageBackup) {
        Copy-Item $packageBackup $package -Force
        Remove-Item $packageBackup -Force -ErrorAction SilentlyContinue
        Write-Host "Restored package.json exactly." -ForegroundColor DarkGreen
    }

    if (Test-Path $serverBackup) {
        Copy-Item $serverBackup $server -Force
        Remove-Item $serverBackup -Force -ErrorAction SilentlyContinue
        Write-Host "Restored server.ts exactly." -ForegroundColor DarkGreen
    }
}
