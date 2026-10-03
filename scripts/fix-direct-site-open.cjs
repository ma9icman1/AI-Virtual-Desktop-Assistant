const fs = require("fs");

function patchIfNeeded(file, marker, replacement, label) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("// [direct-site-open]")) {
    console.log(`[direct-site-open] ${label} already installed; skipped`);
    return false;
  }
  if (!text.includes(marker)) {
    console.log(`[direct-site-open] ${label} marker not present; skipped`);
    return false;
  }
  fs.writeFileSync(file, text.replace(marker, replacement + marker));
  console.log(`[direct-site-open] ${label} installed`);
  return true;
}

const serverMarker = String.raw`  const desktopVoiceShellMatch = message.match(/\b(?:run\s+(?:command|cmd|shell|terminal|powershell|script)|execute\s+(?:command|shell)|terminal\s+run)\s+["']?(.+?)["']?\s*$/i);`;
const serverPatch = String.raw`  // [direct-site-open]
  // Route simple website-opening voice commands deterministically.
  const directSiteOpenMatch = request.match(/^\s*(?:please\s+)?(?:open|launch|go\s+to|navigate\s+to|visit)\s+(roblox|youtube|amazon|ebay|reddit|discord|facebook|instagram|tiktok|twitter|x|wikipedia)(?:\.com|\.org)?(?:\s+(?:and\s+)?(?:log\s*in|login|sign\s*in|signin))?\s*[.!?]*\s*$/i);
  if (directSiteOpenMatch) {
    const directSiteAliases: Record<string, string> = {
      roblox: "roblox.com", youtube: "youtube.com", amazon: "amazon.com", ebay: "ebay.com",
      reddit: "reddit.com", discord: "discord.com", facebook: "facebook.com", instagram: "instagram.com",
      tiktok: "tiktok.com", twitter: "twitter.com", x: "x.com", wikipedia: "wikipedia.org",
    };
    const host = directSiteAliases[String(directSiteOpenMatch[1]).toLowerCase()];
    const url = "https://" + host + "/";
    return makePlan("Open " + host, "I will open " + host + " in your default browser.", [
      { stepNumber: 1, description: "Open " + url, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
    ], host + " is open.");
  }

`;

patchIfNeeded("server.ts", serverMarker, serverPatch, "server deterministic site routing");

console.log("[direct-site-open] complete");
