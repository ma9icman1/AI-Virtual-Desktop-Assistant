"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "electron", "main.cjs");
let source = fs.readFileSync(mainPath, "utf8");

const browserMarker = "// [browser-2d-scaling-v2]";
const clickThroughMarker = "// [browser-2d-clickthrough-v2]";

// The browser detector used to trust GetForegroundWindow(). That is wrong when
// the 2.5D avatar is the foreground Electron window. Replace that lookup with
// a browser-process fallback, while retaining the normal foreground fast path.
if (!source.includes(browserMarker)) {
  const old = `    const info = await getActiveWindowInfo();\n    const process = normalizeProcessName(info.process);\n\n    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {\n      await maximizeWindow(info.hwnd);`;

  const replacement = `    // [browser-2d-scaling-v2]\n    // The 2.5D overlay can become the foreground Electron window. Prefer the\n    // foreground browser when available, otherwise locate the visible browser\n    // window directly by process so vision/UI detection targets the real page.\n    let info = await getActiveWindowInfo();\n    let process = normalizeProcessName(info.process);\n\n    if (!browserProcesses.has(process) || Number(info.hwnd) <= 0) {\n      const browserNames = Array.from(browserProcesses).map((name) => \"'\" + name + \"'\").join(\",\");\n      const browserWindowScript = [\n        \"$names = @(\" + browserNames + \")\",\n        \"$windows = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $names -contains $_.ProcessName.ToLowerInvariant() } | Sort-Object StartTime -Descending\",\n        \"$target = $windows | Select-Object -First 1\",\n        \"if ($target) { [pscustomobject]@{ hwnd=[int64]$target.MainWindowHandle; pid=[int]$target.Id; process=[string]$target.ProcessName; title=[string]$target.MainWindowTitle } | ConvertTo-Json -Compress }\",\n      ].join(\"\\n\");\n      const browserWindowRaw = await runPowerShell(browserWindowScript).catch(() => \"\");\n      try {\n        const browserWindow = JSON.parse(browserWindowRaw || \"{}\");\n        if (Number(browserWindow.hwnd) > 0) {\n          info = browserWindow;\n          process = normalizeProcessName(browserWindow.process);\n        }\n      } catch {}\n    }\n\n    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {\n      await maximizeWindow(info.hwnd);`;

  if (!source.includes(old)) {
    throw new Error("Expected current detectWebpage browser lookup was not found; source layout has changed.");
  }
  source = source.replace(old, replacement);
}

// Make the avatar window click-through while it is in 2.5D overlay mode. This
// keeps browser controls clickable underneath the visual avatar.
if (!source.includes(clickThroughMarker)) {
  const old = `ipcMain.on("magic-window-layout", (event, overlayMode) => {\n  assertTrustedRenderer(event);\n  const window = BrowserWindow.fromWebContents(event.sender);\n  if (!window || typeof overlayMode !== "boolean") return;\n\n  if (overlayMode) {`;

  const replacement = `ipcMain.on("magic-window-layout", (event, overlayMode) => {\n  assertTrustedRenderer(event);\n  const window = BrowserWindow.fromWebContents(event.sender);\n  if (!window || typeof overlayMode !== "boolean") return;\n\n  // [browser-2d-clickthrough-v2]\n  // 2.5D is a visual overlay. Let mouse events reach the browser underneath.\n  window.setIgnoreMouseEvents(overlayMode, { forward: true });\n  window.setAlwaysOnTop(overlayMode, "screen-saver");\n\n  if (overlayMode) {`;

  if (!source.includes(old)) {
    throw new Error("Expected current magic-window-layout block was not found; source layout has changed.");
  }
  source = source.replace(old, replacement);
}

fs.writeFileSync(mainPath, source, "utf8");
console.log("[browser-2d-scaling] browser targeting + 2.5D click-through applied");
