const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
if (!fs.existsSync(serverFile)) process.exit(0);

let server = fs.readFileSync(serverFile, "utf8");

// Route site-specific searches through the live page UI instead of Google.
if (!server.includes("[site-search-fix] contextual routing installed")) {
  const marker = "  if (websiteUrlMatch) {";
  const injection = `  // [site-search-fix] contextual routing installed
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
    const url = \`https://\${host}/\`;

    return {
      ...parsed,
      spokenResponse: \`Opening \${host}, finding its search box, and searching for \${query}.\`,
      spokenReply: \`Opening \${host}, finding its search box, and searching for \${query}.\`,
      action: {
        type: "MULTI_STEP_PLAN",
        description: \`Open \${host} and search the site for \${query}\`,
        multiStepPlan: {
          planTitle: \`Search \${host}\`,
          spokenIntro: \`I will open \${host}, analyze the live page, find its search box, and search for \${query}.\`,
          steps: [
            { stepNumber: 1, description: \`Open \${url}\`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
            { stepNumber: 2, description: "Analyze the live page and click its search box", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },
            { stepNumber: 3, description: \`Type \${query}\`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },
            { stepNumber: 4, description: "Submit the site search", actionType: "KEY_PRESS", params: { key: "ENTER" }, status: "pending", estimatedDurationMs: 300 }
          ],
          spokenCompletion: \`I searched \${host} for \${query}.\`,
          currentStepIndex: 0,
          status: "idle"
        }
      }
    };
  }

`;

  if (!server.includes(marker)) {
    throw new Error("[site-search-fix] Could not find websiteUrlMatch marker in server.ts");
  }

  server = server.replace(marker, injection + marker);
  fs.writeFileSync(serverFile, server, "utf8");
  console.log("[site-search-fix] contextual routing installed");
} else {
  console.log("[site-search-fix] already installed; skipped");
}
