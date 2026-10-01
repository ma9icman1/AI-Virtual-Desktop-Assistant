# ma9icAI server.ts brace fix
# Run this from the project directory.
$ErrorActionPreference = "Stop"

$server = Join-Path $PWD "server.ts"
if (-not (Test-Path $server)) {
    throw "server.ts was not found in $PWD"
}

$backup = Join-Path $PWD ("server.ts.backup-before-brace-fix-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
Copy-Item $server $backup -Force

# Find the first closing brace that makes the top-level brace depth negative.
$lines = Get-Content $server
$depth = 0
$badLine = $null

foreach ($lineNumber in 1..$lines.Count) {
    $line = $lines[$lineNumber - 1]

    # Strip strings/comments approximately so braces inside them don't count.
    $clean = [regex]::Replace($line, '`[^`]*`|"(?:\\.|[^"\\])*"|''(?:\\.|[^''\\])*''|//.*', '')
    $opens = ([regex]::Matches($clean, '\{')).Count
    $closes = ([regex]::Matches($clean, '\}')).Count

    $depth += $opens - $closes

    if ($depth -lt 0) {
        $badLine = $lineNumber
        break
    }
}

if ($null -eq $badLine) {
    Write-Host "No unmatched closing brace found."
    Write-Host "Backup: $backup"
    exit 1
}

Write-Host "Removing unmatched closing brace at server.ts line $badLine"
Write-Host "Original: $($lines[$badLine - 1])"

$lines = @($lines)
$lines = $lines[0..($badLine - 2)] + $lines[$badLine..($lines.Count - 1)]
Set-Content -Path $server -Value $lines -Encoding utf8

Write-Host ""
Write-Host "FIXED server.ts"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Testing esbuild..."

& npx esbuild .\server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile="$env:TEMP\ma9icAI-server-test.cjs"

if ($LASTEXITCODE -ne 0) {
    Copy-Item $backup $server -Force
    throw "esbuild test failed. server.ts was restored from backup."
}

Write-Host ""
Write-Host "SUCCESS: server.ts parses and bundles."
Write-Host "Backup kept at: $backup"
Write-Host "Now run: npm run build"
