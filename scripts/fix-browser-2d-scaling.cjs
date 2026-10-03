"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "electron", "main.cjs");
const source = fs.readFileSync(mainPath, "utf8");

const marker = "// [browser-2d-scaling-v1]";
if (source.includes(marker)) {
  console.log("[browser-2d-scaling] already applied");
  process.exit(0);
}

const old = `  while (Date.now() - started < timeoutMs) {\n    const info = await getActiveWindowInfo();\n    const process = normalizeProcessName(info.process);\n\n    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {\n      await maximizeWindow(info.hwnd);`;

const replacement = `  while (Date.now() - started < timeoutMs) {\n    // [browser-2d-scaling-v1]\n    // The 2.5D Magic AI overlay is intentionally always-on-top. Once it is\n    // resized into model mode it becomes the foreground window, so using only\n    // GetForegroundWindow() can make us inspect Magic AI instead of the browser.\n    // Find the visible browser window by process as a fallback, then maximize\n    // that real browser window before UI Automation/vision reads its page.\n    let info = await getActiveWindowInfo();\n    let process = normalizeProcessName(info.process);\n\n    if (!browserProcesses.has(process) || Number(info.hwnd) <= 0) {\n      const browserNames = Array.from(browserProcesses).map((name) => `'${name}'`).join(",");\n      const browserWindowScript = `\n$names = @(${browserNames})\n$windows = Get-Process -ErrorAction SilentlyContinue | Where-Object {\n  $_.MainWindowHandle -ne 0 -and $names -contains $_.ProcessName.ToLowerInvariant()\n} | Sort-Object StartTime -Descending\n$target = $windows | Select-Object -First 1\nif ($target) {\n  [pscustomobject]@{\n    hwnd=[int64]$target.MainWindowHandle\n    pid=[int]$target.Id\n    process=[string]$target.ProcessName\n    title=[string]$target.MainWindowTitle\n  } | ConvertTo-Json -Compress\n}\n`;\n      const browserWindowRaw = await runPowerShell(browserWindowScript).catch(() => "");\n      try {\n        const browserWindow = JSON.parse(browserWindowRaw || "{}");\n        if (Number(browserWindow.hwnd) > 0) {\n          info = browserWindow;\n          process = normalizeProcessName(browserWindow.process);\n        }\n      } catch {}\n    }\n\n    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {\n      await maximizeWindow(info.hwnd);\n      console.log("[WEB DETECT] using browser window after 2.5D overlay activation", {\n        browser: process,\n        pid: info.pid,\n        hwnd: info.hwnd,\n      });`;

if (!source.includes(old)) {
  throw new Error("Expected detectWebpage foreground-window block was not found.");
}

const updated = source.replace(old, replacement);
fs.writeFileSync(mainPath, updated, "utf8");
console.log("[browser-2d-scaling] patched electron/main.cjs");
