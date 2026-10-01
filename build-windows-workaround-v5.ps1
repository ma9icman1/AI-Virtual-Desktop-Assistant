$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== ma9icAI Windows Build Workaround v5 ===" -ForegroundColor Cyan
Write-Host ""

$root = (Get-Location).Path
$package = Join-Path $root "package.json"
$release = Join-Path $root "release-v5"
$backup = Join-Path $root "package.json.backup-v5"

if (-not (Test-Path $package)) {
    throw "package.json not found. Run this from the ma9icAIv1-main project root."
}

# Stop anything that can keep electron-builder's output directory locked.
Get-Process electron,electron-builder -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Make an exact byte-for-byte package.json backup.
Copy-Item $package $backup -Force

try {
    Write-Host "1. Disabling only fix-contextual-site-search.cjs..." -ForegroundColor Yellow

    $text = [System.IO.File]::ReadAllText($package)

    $badStep = "node scripts/fix-contextual-site-search.cjs && "
    if ($text.Contains($badStep)) {
        $text = $text.Replace($badStep, "")
    } elseif ($text.Contains("node scripts/fix-contextual-site-search.cjs")) {
        $text = $text.Replace("node scripts/fix-contextual-site-search.cjs &&", "")
        $text = $text.Replace("node scripts/fix-contextual-site-search.cjs", "")
    } else {
        Write-Host "   Contextual site-search script already absent from build chain." -ForegroundColor DarkGray
    }

    # Write UTF-8 without BOM.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($package, $text, $utf8NoBom)

    Write-Host "2. Cleaning old build/output directories..." -ForegroundColor Yellow

    Remove-Item (Join-Path $root "dist") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $release -Recurse -Force -ErrorAction SilentlyContinue

    # Use a unique output directory so a locked/stale release\win-unpacked
    # cannot cause Electron Builder's EPERM rename failure.
    Write-Host "3. Running application build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }

    Write-Host "4. Packaging Windows NSIS + portable to release-v5..." -ForegroundColor Yellow

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
    # Restore the original package.json exactly.
    if (Test-Path $backup) {
        Copy-Item $backup $package -Force
        Remove-Item $backup -Force -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "Restored package.json exactly." -ForegroundColor DarkGreen
    }
}
