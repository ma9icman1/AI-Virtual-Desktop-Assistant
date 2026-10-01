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

// Do not use nested template literals here. This script itself is JavaScript,
// while the generated code is TypeScript, so nested backticks were causing the
// repair script to fail before it could modify server.ts.
const injection = [
  "  // [contextual-site-search] generic site routing installed",
  "  // Keep commands such as 'open wikipedia and search for magic' on the named site.",
  "  const genericSiteSearchMatch = commandText.match(/^(?:please\\s+)?(?:open|go\\s+to|navigate\\s+to|visit|load|browse\\s+to)\\s+(?:https?:\\/\\/)?((?:www\\.)?[a-z0-9-]+(?:\\.[a-z]{2,})?|wikipedia|roblox|youtube|amazon|ebay|reddit|discord|facebook|instagram|tiktok|twitter|x)\\b[\\s\\S]*?(?:search\\s+bar|search\\s+box|search\\s+field|search\\s+input|find\\s+(?:the\\s+)?search)[\\s\\S]*?\\b(?:type|enter)\\s+(?:for\\s+)?[\"']?(.+?)[\"']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?\\s*$/i);",
  "  if (genericSiteSearchMatch) {",
  "    const aliases: Record<string, string> = { wikipedia: \"wikipedia.org\", roblox: \"roblox.com\", youtube: \"youtube.com\", amazon: \"amazon.com\", ebay: \"ebay.com\", reddit: \"reddit.com\", discord: \"discord.com\", facebook: \"facebook.com\", instagram: \"instagram.com\", tiktok: \"tiktok.com\", twitter: \"twitter.com\", x: \"x.com\" };",
  "    const rawHost = String(genericSiteSearchMatch[1]).replace(/^www\\./i, \"\");",
  "    const host = aliases[rawHost.toLowerCase()] || rawHost;",
  "    const query = String(genericSiteSearchMatch[2]).trim().replace(/[.!?]+$/g, \"\");",
  "    const url = \"https://\" + host + \"/\";",
  "    const spoken = \"Opening \" + host + \", finding its search box, and searching for \" + query + \".\";",
  "    return { ...parsed, spokenResponse: spoken, spokenReply: spoken, action: { type: \"MULTI_STEP_PLAN\", description: \"Search \" + host + \" for \" + query, multiStepPlan: { planTitle: \"Search \" + host, spokenIntro: \"I will open \" + host + \", analyze the live page, find its search box, and search for \" + query + \".\", steps: [",
  "      { stepNumber: 1, description: \"Open \" + url, actionType: \"NAVIGATE_URL\", params: { url }, status: \"pending\", estimatedDurationMs: 1200 },",
  "      { stepNumber: 2, description: \"Analyze the live page and click its search box\", actionType: \"VISION_CLICK_TARGET\", params: { targetLabel: \"search bar\" }, status: \"pending\", estimatedDurationMs: 900 },",
  "      { stepNumber: 3, description: \"Type \" + query, actionType: \"TYPE_INPUT\", params: { text: query }, status: \"pending\", estimatedDurationMs: 500 },",
  "      { stepNumber: 4, description: \"Submit the site search\", actionType: \"KEY_PRESS\", params: { key: \"ENTER\" }, status: \"pending\", estimatedDurationMs: 300 }",
  "    ], spokenCompletion: \"I searched \" + host + \" for \" + query + \".\", currentStepIndex: 0, status: \"idle\" } } };",
  "  }",
  "",
].join("\\n");

server = server.replace(marker, injection + marker);
fs.writeFileSync(serverFile, server, "utf8");
console.log("[contextual-site-search] generic site routing installed");
