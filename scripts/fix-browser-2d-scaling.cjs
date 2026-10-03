"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "electron", "main.cjs");
let source = fs.readFileSync(mainPath, "utf8");

const marker = "// [browser-2d-scaling-v1]";
const clickThroughMarker = "// [browser-2d-clickthrough-v1]";

if (!source.includes(marker)) {
  const old = [
    "  while (Date.now() - started < timeoutMs) {",
    "    const info = await getActiveWindowInfo();",
    "    const process = normalizeProcessName(info.process);",
    "",
    "    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {",
    "      await maximizeWindow(info.hwnd);",
  ].join("\n");

  const replacement = [
    "  while (Date.now() - started < timeoutMs) {",
    "    // [browser-2d-scaling-v1]",
    "    // The 2.5D Magic AI overlay can become the foreground window, so do not rely only on GetForegroundWindow().",
    "    // If the foreground window is not a supported browser, find the visible browser window by process and use it.",
    "    let info = await getActiveWindowInfo();",
    "    let process = normalizeProcessName(info.process);",
    "",
    "    if (!browserProcesses.has(process) || Number(info.hwnd) <= 0) {",
    "      const browserNames = Array.from(browserProcesses).map((name) => \"'\" + name + \"'\").join(\",\");",
    "      const browserWindowScript = [",
    "        \"$names = @(\" + browserNames + \")\",",
    "        \"$windows = Get-Process -ErrorAction SilentlyContinue | Where-Object {\",",
    "        \"  $_.MainWindowHandle -ne 0 -and $names -contains $_.ProcessName.ToLowerInvariant()\",",
    "        \"} | Sort-Object StartTime -Descending\",",
    "        \"$target = $windows | Select-Object -First 1\",",
    "        \"if ($target) {\",",
    "        \"  [pscustomobject]@{\",",
    "        \"    hwnd=[int64]$target.MainWindowHandle\",",
    "        \"    pid=[int]$target.Id\",",
    "        \"    process=[string]$target.ProcessName\",",
    "        \"    title=[string]$target.MainWindowTitle\",",
    "        \"  } | ConvertTo-Json -Compress\",",
    "        \"}\",",
    "      ].join(\"\\n\");",
    "      const browserWindowRaw = await runPowerShell(browserWindowScript).catch(() => \"\");",
    "      try {",
    "        const browserWindow = JSON.parse(browserWindowRaw || \"{}\");",
    "        if (Number(browserWindow.hwnd) > 0) {",
    "          info = browserWindow;",
    "          process = normalizeProcessName(browserWindow.process);",
    "        }",
    "      } catch {}",
    "    }",
    "",
    "    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {",
    "      await maximizeWindow(info.hwnd);",
    "      console.log(\"[WEB DETECT] using browser window after 2.5D overlay activation\", {",
    "        browser: process,",
    "        pid: info.pid,",
    "        hwnd: info.hwnd,",
    "      });",
  ].join("\n");

  if (!source.includes(old)) {
    throw new Error("Expected detectWebpage foreground-window block was not found.");
  }
  source = source.replace(old, replacement);
}

if (!source.includes(clickThroughMarker)) {
  const oldLayout = [
    'ipcMain.on("magic-window-layout", (event, overlayMode) => {',
    "  assertTrustedRenderer(event);",
    "  const window = BrowserWindow.fromWebContents(event.sender);",
    '  if (!window || typeof overlayMode !== "boolean") return;',
    "",
    "  if (overlayMode) {",
  ].join("\n");

  const newLayout = [
    'ipcMain.on("magic-window-layout", (event, overlayMode) => {',
    "  assertTrustedRenderer(event);",
    "  const window = BrowserWindow.fromWebContents(event.sender);",
    '  if (!window || typeof overlayMode !== "boolean") return;',
    "",
    "  // [browser-2d-clickthrough-v1]",
    "  // 2.5D is a visual overlay. Browser clicks must pass through to Chrome/Brave/Edge underneath.",
    "  window.setIgnoreMouseEvents(overlayMode, { forward: true });",
    '  window.setAlwaysOnTop(overlayMode, "screen-saver");',
    "",
    "  if (overlayMode) {",
  ].join("\n");

  if (!source.includes(oldLayout)) {
    throw new Error("Expected magic-window-layout block was not found.");
  }
  source = source.replace(oldLayout, newLayout);
}

fs.writeFileSync(mainPath, source, "utf8");
console.log("[browser-2d-scaling] browser window targeting + click-through applied");
