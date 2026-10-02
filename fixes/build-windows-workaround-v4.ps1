param(
    [switch]$KeepPackageChanges
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== ma9icAI Windows Build Workaround v4 ===" -ForegroundColor Cyan
Write-Host ""

$root = (Get-Location).Path
$packagePath = Join-Path $root "package.json"
$contextualScript = "scripts/fix-contextual-site-search.cjs"
$releaseDir = Join-Path $root "release-v4"

if (-not (Test-Path $packagePath)) {
    throw "package.json was not found in $root"
}

# Stop processes that commonly lock electron-builder output.
Get-Process electron,electron-builder -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Remove stale v4 output so electron-builder does not have to rename over
# an existing/locked win-unpacked directory.
Remove-Item $releaseDir -Recurse -Force -ErrorAction SilentlyContinue

$backup = "$packagePath.backup-before-v4-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $packagePath $backup -Force

try {
    $raw = [System.IO.File]::ReadAllText($packagePath, [System.Text.UTF8Encoding]::new($false))
    $pkg = $raw | ConvertFrom-Json

    if (-not $pkg.scripts.build) {
        throw "package.json does not contain scripts.build"
    }

    # The diagnostic proved this script is the one that corrupts server.ts.
    # Remove only that command from the build chain.
    $pkg.scripts.build = [regex]::Replace(
        [string]$pkg.scripts.build,
        '(?:^|&&\s*)node\s+scripts/fix-contextual-site-search\.cjs(?=\s*&&|$)',
        '',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    $pkg.scripts.build = [regex]::Replace($pkg.scripts.build, '\s*&&\s*&&', ' &&')
    $pkg.scripts.build = $pkg.scripts.build.Trim()

    # Use a fresh output directory to avoid the Electron-builder EPERM rename
    # against release\win-unpacked.
    if ($pkg.build) {
        $pkg.build.directories = $pkg.build.directories
        if (-not $pkg.build.directories) {
            $pkg.build | Add-Member -NotePropertyName directories -NotePropertyValue ([pscustomobject]@{})
        }
        $pkg.build.directories.output = "release-v4"
    } else {
        throw "package.json does not contain the Electron Builder 'build' configuration"
    }

    $json = $pkg | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText(
        $packagePath,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host "Temporarily removed $contextualScript from scripts.build." -ForegroundColor Yellow
    Write-Host "Temporarily changed Electron Builder output to release-v4." -ForegroundColor Yellow
    Write-Host ""

    # Restore the known-good server.ts before building. The build chain is
    # responsible for its other intended repairs.
    git restore --source=origin/main -- server.ts

    Write-Host "Running Windows NSIS + portable build..." -ForegroundColor Cyan
    npm run desktop:build

    if ($LASTEXITCODE -ne 0) {
        throw "npm run desktop:build failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "BUILD SUCCEEDED." -ForegroundColor Green
    Write-Host "Output directory: $releaseDir" -ForegroundColor Green
    Write-Host ""
    Write-Host "Look for the NSIS installer and portable EXE inside release-v4." -ForegroundColor Green
}
finally {
    if (-not $KeepPackageChanges) {
        Copy-Item $backup $packagePath -Force
        Write-Host "Restored package.json exactly." -ForegroundColor DarkGray
    } else {
        Write-Host "Kept temporary package.json changes because -KeepPackageChanges was supplied." -ForegroundColor Yellow
    }
}
