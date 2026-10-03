const fs = require("fs");

function patch(file, marker, replacement, label) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("// [direct-site-open]")) return false;
  if (!text.includes(marker)) throw new Error(`[direct-site-open] marker missing for ${label}`);
  fs.writeFileSync(file, text.replace(marker, replacement + marker));
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

patch("server.ts", serverMarker, serverPatch, "server deterministic site routing");

const electronMarker = '    // Browser requests delegate to Windows so the configured default browser is always used.\n';
const electronPatch = String.raw`    // [direct-site-open]
    // Hand the URL directly to Windows and verify the browser handoff.
    if (browserAliases.has(requested)) {
      const requestedUrl = String(params.url || params.site || "").trim();
      const url = /^https?:\/\//i.test(requestedUrl) ? requestedUrl : "https://www.google.com/";
      const errorMessage = await shell.openExternal(url);
      if (errorMessage) throw new Error(\`Windows could not open the default browser: \${errorMessage}\`);
      const expectedHost = normalizedHostname(url);
      const webpage = await detectWebpage({ timeoutMs: 10000, intervalMs: 300, expectedHost }).catch(() => ({ detected: false, browser: "", title: "", url: "" }));
      if (desktopPermission === "one_action") desktopPermission = "none";
      return { ok: true, verified: Boolean(webpage.detected), launched: true, process: "default-browser", requested, url, webpage };
    }

`;

patch("electron/main.cjs", electronMarker, electronPatch, "electron default browser launch");

console.log("[direct-site-open] direct website launch routing is installed.");
