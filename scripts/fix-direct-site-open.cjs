const fs = require("fs");
const { execFileSync } = require("child_process");

const file = "electron/main.cjs";
const text = fs.readFileSync(file, "utf8");
const marker = "// [direct-site-open-v3]";

if (text.includes(marker)) {
  console.log("[direct-site-open] already installed; skipped");
  process.exit(0);
}

const anchor = `async function executeDesktopAction(action, params = {}) {`;

if (!text.includes(anchor)) {
  throw new Error("[direct-site-open] required executeDesktopAction function anchor is missing");
}

const patch = `  ${marker}
  // Open website URLs directly through Electron/Windows instead of treating
  // them as application names or sending them to web search.
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, launched: true, process: "default-browser", url: url.toString() };
  }
`;

const updated = text.replace(anchor, anchor + "\n" + patch);
fs.writeFileSync(file, updated);

try {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
} catch {
  throw new Error("[direct-site-open] electron/main.cjs syntax validation failed after patching");
}

console.log("[direct-site-open] NAVIGATE_URL execution installed and syntax validated");
