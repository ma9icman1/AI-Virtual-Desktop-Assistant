const fs = require("fs");
const { execFileSync } = require("child_process");

const file = "electron/main.cjs";
const text = fs.readFileSync(file, "utf8");
const marker = "// [direct-site-open-v3]";

if (text.includes(marker)) {
  console.log("[direct-site-open] already installed; skipped");
  process.exit(0);
}

// Use the stable function entry point. Earlier versions tried to patch a
// specific LAUNCH_APP block, but other build-repair scripts can rewrite that
// block before this script runs. The function declaration and first display
// lookup are stable and are present in the current source.
const anchor = `async function executeDesktopAction(action, params = {}) {\n  console.log(\`[DEBUG ACTION] action=\${JSON.stringify(action)} params=\${JSON.stringify(params)}\`);\n`;
if (!text.includes(anchor)) {
  throw new Error("[direct-site-open] required executeDesktopAction entry anchor is missing");
}

const patch = `  ${marker}\n  // Open website URLs directly through Electron/Windows instead of treating\n  // them as application names or sending them to web search.\n  if (action === "NAVIGATE_URL") {\n    const rawUrl = String(params.url || "").trim();\n    if (!rawUrl) throw new Error("NAVIGATE_URL requires a URL.");\n    let url;\n    try {\n      url = new URL(rawUrl);\n    } catch {\n      throw new Error("Invalid URL: " + rawUrl);\n    }\n    if (!["http:", "https:"].includes(url.protocol)) {\n      throw new Error("Only HTTP and HTTPS URLs are allowed.");\n    }\n    const errorMessage = await shell.openExternal(url.toString());\n    if (errorMessage) {\n      throw new Error("Windows could not open the default browser: " + errorMessage);\n    }\n    await new Promise((resolve) => setTimeout(resolve, 500));\n    if (desktopPermission === "one_action") desktopPermission = "none";\n    return { ok: true, verified: true, launched: true, process: "default-browser", url: url.toString() };\n  }\n`;

const updated = text.replace(anchor, anchor + patch);
fs.writeFileSync(file, updated);

// Validate the exact generated Electron source before allowing npm build to continue.
try {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
} catch {
  throw new Error("[direct-site-open] electron/main.cjs syntax validation failed after patching");
}

console.log("[direct-site-open] NAVIGATE_URL execution installed and syntax validated");
