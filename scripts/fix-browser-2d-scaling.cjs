"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "electron", "main.cjs");
const serverPath = path.join(root, "server.ts");
const appPath = path.join(root, "src", "App.tsx");
const backupPath = `${mainPath}.browser-2d-backup`;

function syntaxCheck(file) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

if (!fs.existsSync(mainPath)) throw new Error(`[browser-2d-scaling] Missing target file: ${mainPath}`);

const source = fs.readFileSync(mainPath, "utf8");
let next = source;
const browserMarker = "// [browser-2d-scaling-v3]";
const clickThroughMarker = "// [browser-2d-clickthrough-v3]";
const navFixMarker = "// [browser-2d-nav-fix-v4]";

if (!next.includes(browserMarker)) {
  const detectStart = next.indexOf("async function detectWebpage(");
  if (detectStart < 0) throw new Error("[browser-2d-scaling] detectWebpage() not found.");
  const lookupMatch = /(?:const|let|var)\s+info\s*=\s*await\s+getActiveWindowInfo\(\);/.exec(next.slice(detectStart));
  if (!lookupMatch) throw new Error("[browser-2d-scaling] detectWebpage active-window lookup not found.");
  const lookupStart = detectStart + lookupMatch.index;
  const maximizeToken = "await maximizeWindow(info.hwnd);";
  const lookupEnd = next.indexOf(maximizeToken, lookupStart);
  const nextFunction = next.indexOf("async function ", lookupStart + 1);
  if (lookupEnd < 0 || (nextFunction >= 0 && lookupEnd > nextFunction)) throw new Error("[browser-2d-scaling] detectWebpage lookup block is structurally different.");
  const lineStart = next.lastIndexOf("\n", lookupStart) + 1;
  const replacement = [
    "    // [browser-2d-scaling-v3]",
    "    // Prefer a foreground browser, otherwise locate a visible browser window.",
    "    let info = await getActiveWindowInfo();",
    "    let process = normalizeProcessName(info.process);",
    "    if (!browserProcesses.has(process) || Number(info.hwnd) <= 0) {",
    "      const names = Array.from(browserProcesses).map((name) => \"'\" + name + \"'\").join(\",\");",
    "      const script = [",
    "        \"$names = @(\" + names + \")\",",
    "        \"$windows = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $names -contains $_.ProcessName.ToLowerInvariant() } | Sort-Object StartTime -Descending\",",
    "        \"$target = $windows | Select-Object -First 1\",",
    "        \"if ($target) { [pscustomobject]@{ hwnd=[int64]$target.MainWindowHandle; pid=[int]$target.Id; process=[string]$target.ProcessName; title=[string]$target.MainWindowTitle } | ConvertTo-Json -Compress }\",",
    "      ].join(\"\\n\");",
    "      const raw = await runPowerShell(script).catch(() => \"\");",
    "      try {",
    "        const candidate = JSON.parse(raw || \"{}\");",
    "        if (Number(candidate.hwnd) > 0) { info = candidate; process = normalizeProcessName(candidate.process); }",
    "      } catch {}",
    "    }",
    "    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {",
    "      await maximizeWindow(info.hwnd);",
  ].join("\n");
  next = next.slice(0, lineStart) + replacement + next.slice(lookupEnd + maximizeToken.length);
}

if (!next.includes(navFixMarker)) {
  const staleMarker = "// [direct-site-open-v3]";
  const staleStart = next.indexOf(staleMarker);
  if (staleStart >= 0) {
    const debugStart = next.indexOf("  console.log(`[DEBUG ACTION] action=", staleStart);
    if (debugStart < 0) throw new Error("[browser-2d-scaling] Canonical desktop-action log not found after stale URL handler.");
    next = next.slice(0, staleStart) + "  // [browser-2d-nav-fix-v4]\n  // Canonical NAVIGATE_URL handling is authoritative; do not return early here.\n" + next.slice(debugStart);
  } else {
    const fn = "async function executeDesktopAction(action, params = {}) {\n";
    if (next.includes(fn)) next = next.replace(fn, fn + "  // [browser-2d-nav-fix-v4] canonical NAVIGATE_URL handler is authoritative.\n");
  }
}

if (!next.includes(clickThroughMarker)) {
  const layoutStart = next.indexOf('ipcMain.on("magic-window-layout", (event, overlayMode) => {');
  const overlayStart = layoutStart >= 0 ? next.indexOf("  if (overlayMode) {", layoutStart) : -1;
  if (layoutStart < 0 || overlayStart < 0) throw new Error("[browser-2d-scaling] magic-window-layout block not found.");
  const replacement = [
    "  // [browser-2d-clickthrough-v3]",
    "  // The 2.5D avatar is visual only; forward pointer events to the browser below.",
    "  window.setIgnoreMouseEvents(overlayMode, { forward: true });",
    "  window.setAlwaysOnTop(overlayMode, \"screen-saver\");",
    "",
  ].join("\n");
  next = next.slice(0, overlayStart) + replacement + next.slice(overlayStart);
}

if (next !== source) {
  if (!fs.existsSync(backupPath)) fs.copyFileSync(mainPath, backupPath);
  fs.writeFileSync(mainPath, next, "utf8");
  try { syntaxCheck(mainPath); } catch (error) {
    fs.copyFileSync(backupPath, mainPath);
    throw new Error(`[browser-2d-scaling] main.cjs syntax validation failed; original restored. ${error?.message || error}`);
  }
}

if (fs.existsSync(serverPath)) {
  const serverSource = fs.readFileSync(serverPath, "utf8");
  const serverMarker = "// [browser-2d-browser-param-v4]";
  if (!serverSource.includes(serverMarker)) {
    const navBlock = /if \(actionType === [\"']NAVIGATE_URL[\"']\) \{[\s\S]*?normalized\.params\s*=\s*\{\s*url\s*\};\s*\}/;
    if (navBlock.test(serverSource)) {
      const replacement = [
        'if (actionType === "NAVIGATE_URL") {',
        "      // [browser-2d-browser-param-v4]",
        '      const url = String(normalized.params.url || "").trim();',
        "      let parsedUrl: URL;",
        "      try { parsedUrl = new URL(url); } catch { throw new Error(\"Planner URL is invalid.\"); }",
        '      if (!/^https?:$/.test(parsedUrl.protocol) || url.length > 2048) throw new Error("Planner URL is not allowed.");',
        '      const browserRaw = String(normalized.params.browser || normalized.params.browserName || "").trim().toLowerCase();',
        '      const browser = browserRaw.replace(/\\s+browser$/i, "");',
        '      const allowedBrowsers = new Set(["", "browser", "chrome", "google chrome", "brave", "brave browser", "edge", "microsoft edge", "opera", "opera browser", "vivaldi", "vivaldi browser"]);',
        '      if (!allowedBrowsers.has(browser)) throw new Error("Planner browser is not allowed: " + browser + ".");',
        '      normalized.params = { url, ...(browser ? { browser } : {}) };',
        "    }",
      ].join("\n");
      fs.writeFileSync(serverPath, serverSource.replace(navBlock, replacement), "utf8");
    } else {
      console.log("[browser-2d-scaling] server.ts has no legacy NAVIGATE_URL validation block; leaving server.ts unchanged.");
    }
  }
}

if (fs.existsSync(appPath)) {
  const appSource = fs.readFileSync(appPath, "utf8");
  const appMarker = "// [browser-2d-vision-mode-v4]";
  if (!appSource.includes(appMarker)) {
    const target = `    if (normalizedType === "VISION_CLICK_TARGET") {\n      const frame = await VisionService.captureScreenFrame();`;
    if (appSource.includes(target)) {
      const replacement = `    if (normalizedType === "VISION_CLICK_TARGET") {\n      // [browser-2d-vision-mode-v4]\n      console.log("[VISION CLICK TARGET] enabling 2.5D browser interaction mode");\n      setAvatarMode("2d");\n      setExperienceMode("model");\n      await new Promise((resolve) => setTimeout(resolve, 650));\n      const frame = await VisionService.captureScreenFrame();`;
      fs.writeFileSync(appPath, appSource.replace(target, replacement), "utf8");
    } else {
      console.log("[browser-2d-scaling] VISION_CLICK_TARGET capture block already differs; leaving App.tsx unchanged.");
    }
  }
}

console.log("[browser-2d-scaling] browser targeting + named-browser routing + 2.5D vision mode applied");
