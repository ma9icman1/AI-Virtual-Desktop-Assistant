"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "electron", "main.cjs");
const backupPath = `${mainPath}.browser-2d-backup`;

if (!fs.existsSync(mainPath)) {
  throw new Error(`[browser-2d-scaling] Missing target file: ${mainPath}`);
}

const source = fs.readFileSync(mainPath, "utf8");
const browserMarker = "// [browser-2d-scaling-v3]";
const clickThroughMarker = "// [browser-2d-clickthrough-v3]";
let next = source;

// This script is intentionally idempotent. If the current version is already
// patched, it performs no write at all. The target discovery below is scoped
// to detectWebpage so earlier computer-agent/runtime edits do not make this
// patch depend on one exact copy of the surrounding source.
if (!next.includes(browserMarker)) {
  const detectStart = next.indexOf("async function detectWebpage(");
  if (detectStart < 0) {
    throw new Error("[browser-2d-scaling] detectWebpage() was not found. Refusing to modify files.");
  }

  const lookupStart = next.indexOf("getActiveWindowInfo()", detectStart);
  const lookupEnd = lookupStart >= 0
    ? next.indexOf("await maximizeWindow(info.hwnd);", lookupStart)
    : -1;

  if (lookupStart < 0 || lookupEnd < 0 || lookupEnd > next.indexOf("async function ", lookupStart + 1)) {
    throw new Error(
      "[browser-2d-scaling] Could not safely locate the detectWebpage browser lookup. Refusing to modify files."
    );
  }

  const lineStart = next.lastIndexOf("\n", lookupStart) + 1;
  const originalBlock = next.slice(lineStart, lookupEnd + "await maximizeWindow(info.hwnd);".length);

  if (!/getActiveWindowInfo\(\)/.test(originalBlock) ||
      !/browserProcesses\.has\(process\)/.test(originalBlock) ||
      !/maximizeWindow\(info\.hwnd\)/.test(originalBlock)) {
    throw new Error(
      "[browser-2d-scaling] Current detectWebpage browser lookup is structurally different. Refusing to modify files."
    );
  }

  const replacement = `    // [browser-2d-scaling-v3]
    // The 2.5D avatar can be the foreground Electron window. Do not let that
    // steal browser detection. Prefer the foreground browser, then locate a
    // visible browser window by process and use its real HWND/PID.
    let info = await getActiveWindowInfo();
    let process = normalizeProcessName(info.process);

    if (!browserProcesses.has(process) || Number(info.hwnd) <= 0) {
      const browserNames = Array.from(browserProcesses).map((name) => "'" + name + "'").join(",");
      const browserWindowScript = [
        "$names = @(" + browserNames + ")",
        "$windows = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $names -contains $_.ProcessName.ToLowerInvariant() } | Sort-Object StartTime -Descending",
        "$target = $windows | Select-Object -First 1",
        "if ($target) { [pscustomobject]@{ hwnd=[int64]$target.MainWindowHandle; pid=[int]$target.Id; process=[string]$target.ProcessName; title=[string]$target.MainWindowTitle } | ConvertTo-Json -Compress }",
      ].join("\\n");
      const browserWindowRaw = await runPowerShell(browserWindowScript).catch(() => "");
      try {
        const browserWindow = JSON.parse(browserWindowRaw || "{}");
        if (Number(browserWindow.hwnd) > 0) {
          info = browserWindow;
          process = normalizeProcessName(browserWindow.process);
        }
      } catch {}
    }

    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {
      await maximizeWindow(info.hwnd);`;

  next = next.slice(0, lineStart) + replacement + next.slice(lookupEnd + "await maximizeWindow(info.hwnd);".length);
}

if (!next.includes(clickThroughMarker)) {
  const layoutStart = next.indexOf('ipcMain.on("magic-window-layout", (event, overlayMode) => {');
  const overlayStart = layoutStart >= 0
    ? next.indexOf('  if (overlayMode) {', layoutStart)
    : -1;

  if (layoutStart < 0 || overlayStart < 0) {
    throw new Error(
      "[browser-2d-scaling] Current magic-window-layout block does not match the checked-in source. Refusing to modify files."
    );
  }

  const replacement = `  // [browser-2d-clickthrough-v3]
  // The 2.5D avatar is visual only. Forward mouse events so the browser below
  // remains the real interaction target.
  window.setIgnoreMouseEvents(overlayMode, { forward: true });
  window.setAlwaysOnTop(overlayMode, "screen-saver");

`;
  next = next.slice(0, overlayStart) + replacement + next.slice(overlayStart);
}

if (next !== source) {
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(mainPath, backupPath);
  }

  // Write only after every expected target was found. Then syntax-check the
  // resulting file; restore the backup automatically if validation fails.
  fs.writeFileSync(mainPath, next, "utf8");
  try {
    execFileSync(process.execPath, ["--check", mainPath], { stdio: "pipe" });
  } catch (error) {
    fs.copyFileSync(backupPath, mainPath);
    throw new Error(
      `[browser-2d-scaling] Modified main.cjs failed Node syntax validation; original restored. ${error?.message || error}`
    );
  }
}

console.log("[browser-2d-scaling] browser targeting + 2.5D click-through applied and syntax-validated");
