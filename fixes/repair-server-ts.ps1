# repair-server-ts.ps1
# Run from the ma9icAIv1-main project directory.
# This repairs server.ts from the known-good origin/main version,
# then adds ONE clean site-search handler and fixes the ENTER key.
$ErrorActionPreference = "Stop"

$server = Join-Path (Get-Location) "server.ts"
if (-not (Test-Path $server)) {
    throw "server.ts was not found. Run this from the ma9icAIv1-main directory."
}

# Backup whatever is currently there before touching it.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$server.backup-before-repair-$stamp"
Copy-Item $server $backup -Force
Write-Host "Backup created: $backup"

# Start from the known-good origin/main version. The earlier clean origin/main
# build successfully bundled, so this avoids trying to untangle broken braces.
$clean = (& git show "origin/main:server.ts") -join "`r`n"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($clean)) {
    throw "Could not read origin/main:server.ts. Your backup is: $backup"
}

# Fix the accidental "~" search-submit key if it exists in origin/main/current text.
$clean = $clean -replace 'actionType: "KEY_PRESS", params: \{ key: "~" \}', 'actionType: "KEY_PRESS", params: { key: "ENTER" }'

# One clean site-search handler. Insert it immediately before websiteUrlMatch.
$siteSearchBlock = @'
  // Deterministic site-search command handling.
  // Examples:
  //   "open roblox and search for simulator"
  //   "search youtube for funny cats"
  const siteSearchCommandMatch = commandText.match(
    /^(?:please\s+)?(?:open|go\s+to|navigate\s+to|visit|load|browse\s+to)\s+(wikipedia(?:\.org)?|roblox(?:\.com)?|youtube(?:\.com)?|amazon(?:\.com)?|ebay(?:\.com)?|reddit(?:\.com)?|discord(?:\.com)?|facebook(?:\.com)?|instagram(?:\.com)?|tiktok(?:\.com)?|twitter(?:\.com)?|x(?:\.com)?)\s+(?:and\s+)?(?:search|look\s+up)\s+(?:on\s+)?(?:for\s+)?["']?(.+?)["']?(?:\s+(?:and\s+)?(?:press|hit)\s+enter)?[.!?]?\s*$/i
  );

  const searchSiteCommandMatch = commandText.match(
    /^(?:please\s+)?(?:search|look\s+up)\s+(?:on|in|using)\s+(wikipedia(?:\.org)?|roblox(?:\.com)?|youtube(?:\.com)?|amazon(?:\.com)?|ebay(?:\.com)?|reddit(?:\.com)?|discord(?:\.com)?|facebook(?:\.com)?|instagram(?:\.com)?|tiktok(?:\.com)?|twitter(?:\.com)?|x(?:\.com)?)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+(?:and\s+)?(?:press|hit)\s+enter)?[.!?]?\s*$/i
  );

  const siteSearchMatch = siteSearchCommandMatch || searchSiteCommandMatch;

  if (siteSearchMatch) {
    const aliases: Record<string, string> = {
      wikipedia: "wikipedia.org",
      "wikipedia.org": "wikipedia.org",
      roblox: "roblox.com",
      "roblox.com": "roblox.com",
      youtube: "youtube.com",
      "youtube.com": "youtube.com",
      amazon: "amazon.com",
      "amazon.com": "amazon.com",
      ebay: "ebay.com",
      "ebay.com": "ebay.com",
      reddit: "reddit.com",
      "reddit.com": "reddit.com",
      discord: "discord.com",
      "discord.com": "discord.com",
      facebook: "facebook.com",
      "facebook.com": "facebook.com",
      instagram: "instagram.com",
      "instagram.com": "instagram.com",
      tiktok: "tiktok.com",
      "tiktok.com": "tiktok.com",
      twitter: "twitter.com",
      "twitter.com": "twitter.com",
      x: "x.com",
      "x.com": "x.com"
    };

    const rawSite = String(siteSearchMatch[1]).toLowerCase();
    const host = aliases[rawSite] || rawSite;
    const query = String(siteSearchMatch[2]).trim().replace(/[.!?]+$/g, "");
    const url = "https://" + host + "/";

    if (query) {
      const spoken = `Opening ${host}, finding its search box, and searching for ${query}.`;
      return {
        ...parsed,
        spokenResponse: spoken,
        spokenReply: spoken,
        action: {
          type: "MULTI_STEP_PLAN",
          description: `Search ${host} for ${query}`,
          multiStepPlan: {
            planTitle: `Search ${host}`,
            spokenIntro: spoken,
            steps: [
              { stepNumber: 1, description: `Open ${url}`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
              { stepNumber: 2, description: "Analyze the live page and click its search box", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },
              { stepNumber: 3, description: `Type ${query}`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },
              { stepNumber: 4, description: "Submit the site search", actionType: "KEY_PRESS", params: { key: "ENTER" }, status: "pending", estimatedDurationMs: 300 }
            ],
            spokenCompletion: `I searched ${host} for ${query}.`,
            currentStepIndex: 0,
            status: "idle"
          }
        }
      };
    }
  }

'@

$marker = '  if (websiteUrlMatch) {'
if (-not $clean.Contains($marker)) {
    throw "Could not find the websiteUrlMatch routing point in origin/main/server.ts. Your backup is: $backup"
}

$clean = $clean.Replace($marker, $siteSearchBlock + $marker)

Set-Content $server $clean -Encoding utf8
Write-Host "server.ts rebuilt cleanly from origin/main and repaired."

# Verify syntax/bundle.
$out = Join-Path (Get-Location) "dist\server-syntax-check.cjs"
npx esbuild .\server.ts --bundle --platform=node --format=cjs --packages=external --outfile=$out

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "REPAIR FAILED. Restoring your previous server.ts..." -ForegroundColor Red
    Copy-Item $backup $server -Force
    Write-Host "Restored from: $backup"
    exit 1
}

Write-Host ""
Write-Host "SUCCESS: server.ts parses and bundles." -ForegroundColor Green
Write-Host "Backup of previous server.ts: $backup"
Write-Host "Syntax check: $out"
