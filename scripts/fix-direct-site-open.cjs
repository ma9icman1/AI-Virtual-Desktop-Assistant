const fs = require("fs");

const file = "server.ts";
const text = fs.readFileSync(file, "utf8");
const marker = "// [direct-site-open]";

if (text.includes(marker)) {
  console.log("[direct-site-open] already installed; skipped");
  process.exit(0);
}

const anchor = "  const request = message.toLowerCase();\n";
if (!text.includes(anchor)) {
  throw new Error("[direct-site-open] required normalizeDesktopIntent anchor is missing");
}

const patch = `  ${marker}\n  // Deterministic handling for common direct website-opening commands.\n  // This runs before the local model can reinterpret the request as a web search.\n  const directSiteOpenMatch = request.match(/^\\s*(?:please\\s+)?(?:open|launch|go\\s+to|navigate\\s+to|visit)\\s+(roblox|youtube|amazon|ebay|reddit|discord|facebook|instagram|tiktok|twitter|x|wikipedia)(?:\\.com|\\.org)?(?:\\s+(?:and\\s+)?(?:log\\s*in|login|sign\\s*in|signin))?\\s*[.!?]*\\s*$/i);\n  if (directSiteOpenMatch) {\n    const directSiteAliases: Record<string, string> = {\n      roblox: "roblox.com",\n      youtube: "youtube.com",\n      amazon: "amazon.com",\n      ebay: "ebay.com",\n      reddit: "reddit.com",\n      discord: "discord.com",\n      facebook: "facebook.com",\n      instagram: "instagram.com",\n      tiktok: "tiktok.com",\n      twitter: "twitter.com",\n      x: "x.com",\n      wikipedia: "wikipedia.org",\n    };\n    const host = directSiteAliases[String(directSiteOpenMatch[1]).toLowerCase()];\n    const url = \`https://\${host}/\`;\n    return {\n      ...parsed,\n      spokenResponse: \`Opening \${host}.\`,\n      action: {\n        type: "MULTI_STEP_PLAN",\n        description: \`Open \${host}\`,\n        multiStepPlan: {\n          planTitle: \`Open \${host}\`,\n          spokenIntro: \`I will open \${host} in your default browser.\`,\n          steps: [\n            {\n              stepNumber: 1,\n              description: \`Open \${url}\`,\n              actionType: "NAVIGATE_URL",\n              params: { url },\n              status: "pending",\n              estimatedDurationMs: 1200,\n            },\n          ],\n          spokenCompletion: \`\${host} is open.\`,\n          currentStepIndex: 0,\n          status: "idle",\n        },\n      },\n    };\n  }\n\n`;

fs.writeFileSync(file, text.replace(anchor, anchor + patch));
console.log("[direct-site-open] deterministic website routing installed");

// Fail the build immediately if the resulting server source is malformed.
const { execFileSync } = require("child_process");
try {
  execFileSync("npx", ["tsc", "--noEmit", "--pretty", "false", "--incremental", "false"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
} catch {
  throw new Error("[direct-site-open] TypeScript validation failed after patching server.ts");
}
