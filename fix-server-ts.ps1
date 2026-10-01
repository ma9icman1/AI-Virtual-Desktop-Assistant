# fix-server-ts.ps1
# Run from the ma9icAIv1-main project directory.
# Creates a backup, removes the duplicate site-search blocks added to server.ts,
# fixes the accidental "~" keypress, then runs esbuild to verify syntax.

$ErrorActionPreference = "Stop"

$server = Join-Path (Get-Location) "server.ts"
if (-not (Test-Path $server)) {
    throw "server.ts was not found. Run this script from the ma9icAIv1-main directory."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$server.backup-$stamp"
Copy-Item $server $backup -Force
Write-Host "Backup created: $backup"

$text = Get-Content $server -Raw

# Remove the three overlapping site-search implementations that were added
# immediately after visibleInputMatch. This leaves the original routing intact.
$pattern = '(?s)\r?\n\s*// \[site-search-fix\].*?(?=\r?\n\s*if \(websiteUrlMatch\))'
$text = [regex]::Replace($text, $pattern, '', 1)

$pattern = '(?s)\r?\n\s*const websiteSearchMatch = commandText\.match\(.*?(?=\r?\n\s*if \(webSearchMatch\))'
$text = [regex]::Replace($text, $pattern, '', 1)

$pattern = '(?s)\r?\n\s*const contextualSiteSearchMatch = commandText\.match\(.*?(?=\r?\n\s*if \(webSearchMatch\))'
$text = [regex]::Replace($text, $pattern, '', 1)

$pattern = '(?s)\r?\n\s*// \[contextual-site-search\].*?(?=\r?\n\s*if \(webSearchMatch\))'
$text = [regex]::Replace($text, $pattern, '', 1)

# Fix the accidental search-submit key.
$text = $text -replace 'actionType: "KEY_PRESS", params: \{ key: "~" \}', 'actionType: "KEY_PRESS", params: { key: "ENTER" }'

Set-Content $server $text -Encoding utf8

Write-Host "server.ts cleaned."

# Syntax/bundle check.
$out = Join-Path (Get-Location) "dist\server-syntax-check.cjs"
npx esbuild .\server.ts --bundle --platform=node --format=cjs --packages=external --outfile=$out

if ($LASTEXITCODE -ne 0) {
    Write-Error "esbuild still failed. Your backup is: $backup"
    exit 1
}

Write-Host ""
Write-Host "SUCCESS: server.ts now parses and bundles."
Write-Host "Backup: $backup"
Write-Host "Check:  $out"
