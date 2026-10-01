$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$package = Join-Path $root "package.json"
$badScript = Join-Path $root "scripts\fix-contextual-site-search.cjs"
$packageBackup = Join-Path $root "package.json.backup-before-contextual-skip-v3"
$serverBackup = Join-Path $root ("server.ts.backup-before-build-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

Write-Host ""
Write-Host "=== ma9icAI Windows Build Workaround v3 ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $package)) { throw "package.json not found" }
if (-not (Test-Path $badScript)) { throw "scripts\fix-contextual-site-search.cjs not found" }

Copy-Item $package $packageBackup -Force
Copy-Item ".\server.ts" $serverBackup -Force

try {
    # Read package.json without changing its structure, then remove only the
    # known-bad contextual repair command from scripts.build.
    $raw = [System.IO.File]::ReadAllText($package)
    $pkg = $raw | ConvertFrom-Json

    $pkg.scripts.build = $pkg.scripts.build -replace ' && node scripts/fix-contextual-site-search\.cjs', ''

    # IMPORTANT: PowerShell Set-Content commonly writes a UTF-8 BOM.
    # Vite/Rolldown's JSON loader rejects that BOM in package/config JSON.
    $json = $pkg | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText(
        $package,
        $json,
        [System.Text.UTF8Encoding]::new($false)
    )

    # Verify package.json is valid JSON and has no UTF-8 BOM.
    $bytes = [System.IO.File]::ReadAllBytes($package)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "package.json still contains a UTF-8 BOM"
    }
    [void]([System.IO.File]::ReadAllText($package) | ConvertFrom-Json)

    Write-Host "Disabled fix-contextual-site-search.cjs in the build chain." -ForegroundColor Yellow
    Write-Host "package.json written as UTF-8 WITHOUT BOM." -ForegroundColor Green
    Write-Host ""

    # Start from clean source.
    git restore --source=origin/main -- server.ts

    Write-Host "Building Windows NSIS + portable..." -ForegroundColor Cyan
    npm run desktop:build

    if ($LASTEXITCODE -ne 0) {
        throw "Windows build failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "Release files:" -ForegroundColor Green
    Get-ChildItem ".\release" -Filter "*.exe" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
}
finally {
    if (Test-Path $packageBackup) {
        # Restore exact original bytes.
        [System.IO.File]::Copy($packageBackup, $package, $true)
        Remove-Item $packageBackup -Force
    }

    Write-Host ""
    Write-Host "Restored package.json exactly." -ForegroundColor DarkGray
    Write-Host "Server backup: $serverBackup" -ForegroundColor DarkGray
}
