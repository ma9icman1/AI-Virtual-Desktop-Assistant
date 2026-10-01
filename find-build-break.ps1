$ErrorActionPreference = "Continue"

$server = Join-Path $PSScriptRoot "server.ts"
$dist = Join-Path $PSScriptRoot "dist\step-check.cjs"

Write-Host ""
Write-Host "=== ma9icAI build repair diagnostic ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Getting clean server.ts from origin/main..." -ForegroundColor Yellow
$clean = git show origin/main:server.ts 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not read server.ts from origin/main."
    exit 1
}

$scripts = @(
    "scripts/fix-wakeword.cjs",
    "scripts/fix-desktop-actions.cjs",
    "scripts/repair-desktop-actions.cjs",
    "scripts/fix-type-input.cjs",
    "scripts/fix-multi-action.cjs",
    "scripts/fix-focus-verification.cjs",
    "scripts/fix-vision-click-v2.cjs",
    "scripts/fix-site-search.cjs",
    "scripts/fix-site-search-runtime.cjs",
    "scripts/fix-contextual-site-search.cjs"
)

foreach ($script in $scripts) {
    Write-Host ""
    Write-Host "Testing: $script" -ForegroundColor Cyan

    Set-Content -Path $server -Value $clean -Encoding UTF8

    node (Join-Path $PSScriptRoot $script)

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Repair script itself failed: $script" -ForegroundColor Red
        continue
    }

    & npx esbuild server.ts `
        --bundle `
        --platform=node `
        --format=cjs `
        --packages=external `
        --outfile=$dist 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "FOUND THE BAD SCRIPT:" -ForegroundColor Red
        Write-Host "$script" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "server.ts was broken by this script." -ForegroundColor Red

        Set-Content -Path $server -Value $clean -Encoding UTF8
        exit 2
    }

    Write-Host "OK: $script" -ForegroundColor Green
}

Set-Content -Path $server -Value $clean -Encoding UTF8

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "ALL REPAIR SCRIPTS PASSED INDIVIDUALLY" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
