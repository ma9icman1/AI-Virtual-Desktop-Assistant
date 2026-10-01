const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
if (!fs.existsSync(serverFile)) process.exit(0);

let server = fs.readFileSync(serverFile, "utf8");
const marker = "  if (webSearchMatch) {";
const installedMarker = "// [contextual-site-search] generic site routing installed";

if (server.includes(installedMarker)) {
  console.log("[contextual-site-search] already installed; skipped");
  process.exit(0);
}

if (!server.includes(marker)) {
  console.log("[contextual-site-search] webSearchMatch marker changed; skipped safely");
  process.exit(0);
}

// Keep generated TypeScript as plain strings. Do not use nested template literals
// here: this repair script is itself JavaScript and nested backticks can break it.
const injection = [
  "  // [contextual-site-search] generic site routing installed",
  "  // Handle both explicit commands ('open wikipedia and search for magic') and",
  "  // vision-style transcripts ('Wikipedia search bar. Click it and type magic').",
  "  const siteAliasMap: Record<string, string> = { wikipedia: \"wikipedia.org\", roblox: \"roblox.com\", youtube: \"youtube.com\", amazon: \"amazon.com\", ebay: \"ebay.com\", reddit: \"reddit.com\", discord: \"discord.com\", facebook: \"facebook.com\", instagram: \"instagram.com\", tiktok: \"tiktok.com\", twitter: \"twitter.com\", x: \"x.com\" };",
  "  const siteSearchInstructionMatch = commandText.match(/^(?:please\\s+)?(?:open|go\\s+to|navigate\\s+to|visit|load|browse\\s+to)?\\s*((?:www\\.)?[a-z0-9-]+\\.[a-z]{2,}|wikipedia|roblox|youtube|amazon|ebay|reddit|discord|facebook|instagram|tiktok|twitter|x)\\s+(?:search\\s+(?:bar|box|field)|search|look\\s+up)[\\s\\S]*?\\b(?:type|enter|search)\\s+(?:for\\s+)?[\"']?(.+?)[\"']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?\\s*$/i);",
  "  const siteSearchNaturalMatch = commandText.match(/^(?:please\\s+)?(?:search|look\\s+up)\\s+(?:on|in|using)\\s*((?:www\\.)?[a-z0-9-]+\\.[a-z]{2,}|wikipedia|roblox|youtube|amazon|ebay|reddit|discord|facebook|instagram|tiktok|twitter|x)\\s+(?:for\\s+)?[\"']?(.+?)[\"']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?\\s*$/i);",
  "  const siteSearchMatch = siteSearchInstructionMatch || siteSearchNaturalMatch;",
  "  if (siteSearchMatch) {",
  "    const rawHost = String(siteSearchMatch[1]).replace(/^www\\./i, \"\").toLowerCase();",
  "    const host = siteAliasMap[rawHost] || rawHost;",
  "    const query = String(siteSearchMatch[2]).trim().replace(/[.!?]+$/g, \"\");",
  "    if (query) {",
  "      const url = \"https://\" + host + \"/\";",
  "      const spoken = \"Opening \" + host + \", finding its search box, and searching for \" + query + \".\";",
  "      return { ...parsed, spokenResponse: spoken, spokenReply: spoken, action: { type: \"MULTI_STEP_PLAN\", description: \"Search \" + host + \" for \" + query, multiStepPlan: { planTitle: \"Search \" + host, spokenIntro: spoken, steps: [",
  "        { stepNumber: 1, description: \"Open \" + url, actionType: \"NAVIGATE_URL\", params: { url }, status: \"pending\", estimatedDurationMs: 1200 },",
  "        { stepNumber: 2, description: \"Analyze the live page and click its search box\", actionType: \"VISION_CLICK_TARGET\", params: { targetLabel: \"search bar\" }, status: \"pending\", estimatedDurationMs: 900 },",
  "        { stepNumber: 3, description: \"Type \" + query, actionType: \"TYPE_INPUT\", params: { text: query }, status: \"pending\", estimatedDurationMs: 500 },",
  "        { stepNumber: 4, description: \"Submit the site search\", actionType: \"KEY_PRESS\", params: { key: \"ENTER\" }, status: \"pending\", estimatedDurationMs: 300 }",
  "      ], spokenCompletion: \"I searched \" + host + \" for \" + query + \".\", currentStepIndex: 0, status: \"idle\" } } };",
  "    }",
  "  }",
  "",
].join("\\n");

server = server.replace(marker, injection + marker);
fs.writeFileSync(serverFile, server, "utf8");
console.log("[contextual-site-search] generic site routing installed");