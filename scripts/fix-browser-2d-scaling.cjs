"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "electron", "main.cjs");
const serverPath = path.join(repoRoot, "server.ts");
const appPath = path.join(repoRoot, "src", "App.tsx");
const backupPath = `${mainPath}.browser-2d-backup`;

if (!fs.existsSync(mainPath)) throw new Error(`[browser-2d-scaling] Missing target file: ${mainPath}`);

const source = fs.readFileSync(mainPath, "utf8");
const browserMarker = "// [browser-2d-scaling-v3]";
const clickThroughMarker = "// [browser-2d-clickthrough-v3]";
const navFixMarker = "// [browser-2d-nav-fix-v4]";
let next = source;

if (!next.includes(browserMarker)) {
  const detectStart = next.indexOf("async function detectWebpage(");
  if (detectStart < 0) throw new Error("[browser-2d-scaling] detectWebpage() was not found. Refusing to modify files.");
  const lookupMatch = /(?:const|let|var)\s+info\s*=\s*await\s+getActiveWindowInfo\(\);/.exec(next.slice(detectStart));
  const lookupStart = lookupMatch ? detectStart + lookupMatch.index : -1;
  const maximizeToken = "await maximizeWindow(info.hwnd);";
  const lookupEnd = lookupStart >= 0 ? next.indexOf(maximizeToken, lookupStart) : -1;
  const nextFunction = next.indexOf("async function ", lookupStart + 1);
  if (lookupStart < 0 || lookupEnd < 0 || (nextFunction >= 0 && lookupEnd > nextFunction)) throw new Error("[browser-2d-scaling] Could not safely locate the detectWebpage active-window lookup. Refusing to modify files.");
  const lineStart = next.lastIndexOf("\n", lookupStart) + 1;
  const originalBlock = next.slice(lineStart, lookupEnd + maximizeToken.length);
  if (!/getActiveWindowInfo\(\)/.test(originalBlock) || !/maximizeWindow\(info\.hwnd\)/.test(originalBlock)) throw new Error("[browser-2d-scaling] Current detectWebpage active-window block is structurally different. Refusing to modify files.");
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
  next = next.slice(0, lineStart) + replacement + next.slice(lookupEnd + maximizeToken.length);
}

if (!next.includes(navFixMarker)) {
  const staleMarker = "// [direct-site-open-v3]";
  const staleStart = next.indexOf(staleMarker);
  if (staleStart >= 0) {
    const debugToken = "  console.log(`[DEBUG ACTION] action=";
    const debugStart = next.indexOf(debugToken, staleStart);
    if (debugStart < 0) throw new Error("[browser-2d-scaling] Could not locate the canonical desktop-action log after the stale URL handler.");
    const replacement = `  // [browser-2d-nav-fix-v4]
  // Direct URL handling is implemented by the canonical NAVIGATE_URL branch
  // below. Never return early here, or named Chrome/Brave/Edge requests would
  // silently fall back to the Windows default browser.
`;
    next = next.slice(0, staleStart) + replacement + next.slice(debugStart);
  } else {
    next = next.replace(/(async function executeDesktopAction\(action, params = \{\}\) \{\n)/, `$1  // [browser-2d-nav-fix-v4] canonical NAVIGATE_URL handler is authoritative.\n`);
  }
}

if (!next.includes(clickThroughMarker)) {
  const layoutStart = next.indexOf('ipcMain.on("magic-window-layout", (event, overlayMode) => {');
  const overlayStart = layoutStart >= 0 ? next.indexOf('  if (overlayMode) {', layoutStart) : -1;
  if (layoutStart < 0 || overlayStart < 0) throw new Error("[browser-2d-scaling] Current magic-window-layout block does not match the checked-in source. Refusing to modify files.");
  const replacement = `  // [browser-2d-clickthrough-v3]
  // The 2.5D avatar is visual only. Forward mouse events so the browser below
  // remains the real interaction target.
  window.setIgnoreMouseEvents(overlayMode, { forward: true });
  window.setAlwaysOnTop(overlayMode, "screen-saver");

`;
  next = next.slice(0, overlayStart) + replacement + next.slice(overlayStart);
}

if (next !== source) {
  if (!fs.existsSync(backupPath)) fs.copyFileSync(mainPath, backupPath);
  fs.writeFileSync(mainPath, next, "utf8");
  try { execFileSync(process.execPath, ["--check", mainPath], { stdio: "pipe" }); }
  catch (error) {
    fs.copyFileSync(backupPath, mainPath);
    throw new Error(`[browser-2d-scaling] Modified main.cjs failed Node syntax validation; original restored. ${error?.message || error}`);
  }
}

if (fs.existsSync(serverPath)) {
  const serverSource = fs.readFileSync(serverPath, "utf8");
  const serverMarker = "// [browser-2d-browser-param-v4]";
  if (!serverSource.includes(serverMarker)) {
    const navBlock = /if \(actionType === "NAVIGATE_URL"\) \{[\s\S]*?normalized\.params = \{ url \};\n    \}/;
    if (!navBlock.test(serverSource)) throw new Error("[browser-2d-scaling] Could not locate NAVIGATE_URL validation block in server.ts.");
    const patched = serverSource.replace(navBlock, `if (actionType === "NAVIGATE_URL") {
      // [browser-2d-browser-param-v4]
      const url = String(normalized.params.url || "").trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Planner URL is invalid.");
      }
      if (!/^https?:$/.test(parsedUrl.protocol) || url.length > 2048) {
        throw new Error("Planner URL is not allowed.");
      }
      const browserRaw = String(normalized.params.browser || normalized.params.browserName || "").trim().toLowerCase();
      const browser = browserRaw.replace(/\\s+browser$/i, "");
      const allowedBrowsers = new Set(["", "browser", "chrome", "google chrome", "brave", "brave browser", "edge", "microsoft edge", "opera", "opera browser", "vivaldi", "vivaldi browser"]);
      if (!allowedBrowsers.has(browser)) throw new Error(`Planner browser is not allowed: \${browser}.`);
      normalized.params = { url, ...(browser ? { browser } : {}) };
    }`);
    fs.writeFileSync(serverPath, patched, "utf8");
  }
}

if (fs.existsSync(appPath)) {
  const appSource = fs.readFileSync(appPath, "utf8");
  const appMarker = "// [browser-2d-vision-mode-v4]";
  if (!appSource.includes(appMarker)) {
    const target = `    if (normalizedType === "VISION_CLICK_TARGET") {
      const frame = await VisionService.captureScreenFrame();`;
    if (!appSource.includes(target)) throw new Error("[browser-2d-scaling] Could not locate VISION_CLICK_TARGET capture block in App.tsx.");
    const replacement = `    if (normalizedType === "VISION_CLICK_TARGET") {
      // [browser-2d-vision-mode-v4]
      // Enter the small click-through 2.5D assistant view before capturing the
      // browser. This keeps the assistant out of the page controls and makes
      // the screenshot/coordinate map represent the real browser surface.
      console.log("[VISION CLICK TARGET] enabling 2.5D browser interaction mode");
      setAvatarMode("2d");
      setExperienceMode("model");
      await new Promise((resolve) => setTimeout(resolve, 650));
      const frame = await VisionService.captureScreenFrame();`;
    fs.writeFileSync(appPath, appSource.replace(target, replacement), "utf8");
  }
}

console.log("[browser-2d-scaling] browser targeting + named-browser routing + 2.5D vision mode applied and syntax-validated");
