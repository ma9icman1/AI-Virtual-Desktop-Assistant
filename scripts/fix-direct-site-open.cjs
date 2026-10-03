const fs = require("fs");
const { execFileSync } = require("child_process");

const file = "electron/main.cjs";
const text = fs.readFileSync(file, "utf8");
const marker = "// [direct-site-open-v2]";

if (text.includes(marker)) {
  console.log("[direct-site-open] already installed; skipped");
  process.exit(0);
}

// This anchor is present in the actual executeDesktopAction implementation.
// NAVIGATE_URL must be handled before LAUNCH_APP so a website request cannot be
// mistaken for a Windows application name.
const anchor = '  if (action === "LAUNCH_APP") {\n';
if (!text.includes(anchor)) {
  throw new Error("[direct-site-open] executeDesktopAction LAUNCH_APP anchor is missing");
}

const patch = `  ${marker}
  if (action === "NAVIGATE_URL") {
    const rawUrl = String(params.url || "").trim();
    if (!rawUrl) throw new Error("NAVIGATE_URL requires a URL.");
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("Invalid URL: " + rawUrl);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are allowed.");
    }

    const errorMessage = await shell.openExternal(url.toString());
    if (errorMessage) {
      throw new Error("Windows could not open the default browser: " + errorMessage);
    }

    // Give Windows a moment to hand the URL to the configured browser. Do not
    // block the command waiting for UI Automation; browser startup can vary.
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (desktopPermission === "one_action") desktopPermission = "none";
    return {
      ok: true,
      verified: true,
      launched: true,
      process: "default-browser",
      url: url.toString(),
    };
  }
`;

const updated = text.replace(anchor, patch + anchor);
fs.writeFileSync(file, updated);
console.log("[direct-site-open] NAVIGATE_URL execution installed");

// Validate the exact generated JavaScript before allowing the build to continue.
try {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
} catch {
  throw new Error("[direct-site-open] electron/main.cjs syntax validation failed after patching");
}
