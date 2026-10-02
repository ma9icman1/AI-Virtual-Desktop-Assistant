$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$server = Join-Path $root "server.ts"
$backup = "$server.backup-before-site-search-repair-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $server $backup -Force
Write-Host "Backup: $backup"

$text = Get-Content $server -Raw

# Remove duplicate/generated site-search blocks between the first search-field matcher
# and the webSearchMatch block, then leave one clean implementation.
$startMarker = '  const siteSearchCommandMatch = commandText.match('
$webMarker = '  if (webSearchMatch) {'

$first = $text.IndexOf($startMarker)
$web = $text.IndexOf($webMarker)

if ($first -lt 0 -or $web -lt 0 -or $web -le $first) {
    throw "Could not locate the generated site-search block."
}

$cleanBlock = @'
  const siteSearchCommandMatch = commandText.match(
    /^(?:please\s+)?(?:open|go\s+to|navigate\s+to|visit|load|browse\s+to)\s+(roblox(?:\.com)?|youtube(?:\.com)?|amazon(?:\.com)?|ebay(?:\.com)?|reddit(?:\.com)?|discord(?:\.com)?|facebook(?:\.com)?|instagram(?:\.com)?|tiktok(?:\.com)?|twitter(?:\.com)?|x(?:\.com)?)\s+(?:and\s+)?(?:search|look\s+up)\s+(?:on\s+)?(?:for\s+)?["']?(.+?)["']?(?:\s+(?:and\s+)?(?:press|hit)\s+enter)?$/i
  );
  const searchSiteCommandMatch = commandText.match(
    /^(?:please\s+)?(?:search|look\s+up)\s+(?:on|in|using)\s+(roblox(?:\.com)?|youtube(?:\.com)?|amazon(?:\.com)?|ebay(?:\.com)?|reddit(?:\.com)?|discord(?:\.com)?|facebook(?:\.com)?|instagram(?:\.com)?|tiktok(?:\.com)?|twitter(?:\.com)?|x(?:\.com)?)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+(?:and\s+)?(?:press|hit)\s+enter)?$/i
  );

  const siteSearchMatch = siteSearchCommandMatch || searchSiteCommandMatch;

  if (siteSearchMatch) {
    const host = String(siteSearchMatch[1]).replace(/\.com$/i, "") + ".com";
    const query = String(siteSearchMatch[2]).trim().replace(/[.!?]+$/g, "");
    const url = "https://" + host + "/";
    const spoken = "Opening " + host + ", finding its search box, and searching for " + query + ".";

    return {
      ...parsed,
      spokenResponse: spoken,
      spokenReply: spoken,
      action: {
        type: "MULTI_STEP_PLAN",
        description: "Open " + host + " and search the site for " + query,
        multiStepPlan: {
          planTitle: "Search " + host,
          spokenIntro: spoken,
          steps: [
            { stepNumber: 1, description: "Open " + url, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
            { stepNumber: 2, description: "Analyze the live page and click its search box", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },
            { stepNumber: 3, description: "Type " + query, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },
            { stepNumber: 4, description: "Submit the site search", actionType: "KEY_PRESS", params: { key: "ENTER" }, status: "pending", estimatedDurationMs: 300 }
          ],
          spokenCompletion: "I searched " + host + " for " + query + ".",
          currentStepIndex: 0,
          status: "idle"
        }
      }
    };
  }

'@

$text = $text.Substring(0, $first) + $cleanBlock + $text.Substring($web)

# Remove any duplicate closing brace immediately before the function's expected end is handled by
# syntax validation below; don't blindly alter unrelated braces.

Set-Content $server $text -Encoding UTF8
Write-Host "Cleaned duplicate site-search routing."

# Syntax check only first.
& npx esbuild .\server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist\server-syntax-check.cjs
if ($LASTEXITCODE -ne 0) {
    throw "Syntax check failed. Backup remains at $backup"
}

Write-Host ""
Write-Host "SUCCESS: server.ts parses."
Write-Host "Now building Windows installer + portable EXE..."
npm run desktop:build
if ($LASTEXITCODE -ne 0) {
    throw "Windows build failed. server.ts syntax is OK. Backup: $backup"
}

Write-Host ""
Write-Host "BUILD SUCCESSFUL."
Write-Host "Check the release folder for the NSIS installer and portable EXE."
Write-Host "Backup: $backup"
