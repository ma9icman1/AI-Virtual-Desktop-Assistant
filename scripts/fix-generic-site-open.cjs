"use strict";

const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "server.ts");
if (!fs.existsSync(file)) process.exit(0);

let text = fs.readFileSync(file, "utf8");
const marker = "// [generic-site-open-v1] deterministic common-site routing";
if (text.includes(marker)) {
  console.log("[generic-site-open] already installed; skipped");
  process.exit(0);
}

const anchor = "  const websiteUrlMatch = commandText.match(";
if (!text.includes(anchor)) {
  throw new Error("[generic-site-open] websiteUrlMatch anchor missing; refusing to patch server.ts");
}

const block = `  ${marker}
  // Bare site names must open the requested site instead of falling through to
  // the generic web-search path. SEARCH_WEB remains Google-backed intentionally.
  const commonSiteAliases: Record<string, string> = {
    youtube: "https://www.youtube.com",
    "youtube.com": "https://www.youtube.com",
    amazon: "https://www.amazon.com",
    "amazon.com": "https://www.amazon.com",
    wikipedia: "https://www.wikipedia.org",
    "wikipedia.org": "https://www.wikipedia.org",
    reddit: "https://www.reddit.com",
    "reddit.com": "https://www.reddit.com",
    discord: "https://discord.com",
    "discord.com": "https://discord.com",
    instagram: "https://www.instagram.com",
    "instagram.com": "https://www.instagram.com",
    facebook: "https://www.facebook.com",
    "facebook.com": "https://www.facebook.com",
    tiktok: "https://www.tiktok.com",
    "tiktok.com": "https://www.tiktok.com",
    x: "https://x.com",
    twitter: "https://x.com",
    "twitter.com": "https://x.com",
  };
  const bareCommonSiteMatch = commandText.match(/^(?:please\\s+)?(?:open|go\\s+to|visit|load|browse\\s+to|navigate\\s+to)\\s+([a-z0-9.-]+)(?:\\s+website)?$/i);
  if (bareCommonSiteMatch) {
    const key = String(bareCommonSiteMatch[1] || "").toLowerCase();
    const url = commonSiteAliases[key];
    if (url) {
      return {
        ...parsed,
        spokenResponse: "Opening " + key + ".",
        spokenReply: "Opening " + key + ".",
        action: {
          type: "MULTI_STEP_PLAN",
          description: "Open " + url,
          multiStepPlan: {
            planTitle: "Open " + key,
            spokenIntro: "I will open " + url + " in your default browser.",
            steps: [
              { stepNumber: 1, description: "Open " + url, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1500 }
            ],
            spokenCompletion: key + " is open.",
            currentStepIndex: 0,
            status: "idle"
          }
        }
      };
    }
  }
`;

text = text.replace(anchor, block + "  " + anchor.trimStart());
fs.writeFileSync(file, text, "utf8");
console.log("[generic-site-open] deterministic common-site routing installed");
