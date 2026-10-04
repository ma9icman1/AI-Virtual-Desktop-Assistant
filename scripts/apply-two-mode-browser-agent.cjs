const fs = require("fs");
const path = require("path");

const root = process.cwd();
const mainPath = path.join(root, "electron", "main.cjs");
const preloadPath = path.join(root, "electron", "preload.cjs");
const appPath = path.join(root, "src", "App.tsx");
const serverPath = path.join(root, "server.ts");

function read(file) { if (!fs.existsSync(file)) throw new Error("[two-mode-cdp] Missing " + file); return fs.readFileSync(file, "utf8"); }
function write(file, text) { fs.writeFileSync(file, text, "utf8"); }
function insertOnce(text, marker, insertion, label) { if (text.includes(insertion)) return text; const i=text.indexOf(marker); if(i<0) throw new Error("[two-mode-cdp] Marker missing: "+label); return text.slice(0,i)+insertion+text.slice(i); }

let main = read(mainPath);
if (!main.includes('require("./browser-control.cjs")')) main = main.replace('const http = require("http");\n', 'const http = require("http");\nconst browserControl = require("./browser-control.cjs");\n');
if (!main.includes("const activeDesktopChildren = new Set();")) main = main.replace("let desktopKilled = false;\n", "let desktopKilled = false;\nconst activeDesktopChildren = new Set();\n");

if (!main.includes("activeDesktopChildren.add(child)")) {
  main = main.replace(
    '    execFile(\n      "powershell.exe",',
    '    const child = execFile(\n      "powershell.exe",'
  );
  const callbackNeedle = '      (error, stdout, stderr) => {\n';
  if (main.includes(callbackNeedle)) main = main.replace(callbackNeedle, callbackNeedle + '        activeDesktopChildren.delete(child);\n');
  const closeNeedle = '    );\n  });\n}\n\nfunction normalizeProcessName';
  if (main.includes(closeNeedle)) main = main.replace(closeNeedle, '    );\n    activeDesktopChildren.add(child);\n    child.once("error", () => activeDesktopChildren.delete(child));\n  });\n}\n\nfunction normalizeProcessName');
}

const browserAction = "  if ([\"BROWSER_NAVIGATE\", \"BROWSER_GET_PAGE\", \"BROWSER_CLICK_TEXT\", \"BROWSER_TYPE\", \"BROWSER_SCREENSHOT\"].includes(action)) {\n" +
  "    const browser = String(params.browser || \"chrome\").trim().toLowerCase();\n" +
  "    if (![\"chrome\", \"brave\", \"edge\"].includes(browser)) throw new Error(\"Browser mode supports Chrome, Brave, and Edge only.\");\n" +
  "    const executable = resolveBrowserExecutable(browser);\n" +
  "    if (!executable) throw new Error(\"Could not find \" + browser + \".\");\n" +
  "    const base = { browser, executable, appDataDir: app.getPath(\"userData\"), url: String(params.url || \"about:blank\") };\n" +
  "    if (action === \"BROWSER_NAVIGATE\") return await browserControl.navigate({ ...base, url: String(params.url || \"\") });\n" +
  "    if (action === \"BROWSER_GET_PAGE\") return await browserControl.getPage(base);\n" +
  "    if (action === \"BROWSER_CLICK_TEXT\") return await browserControl.clickText({ ...base, text: params.text || params.targetLabel });\n" +
  "    if (action === \"BROWSER_TYPE\") return await browserControl.typeInto({ ...base, text: params.text, targetLabel: params.targetLabel });\n" +
  "    return await browserControl.screenshot(base);\n" +
  "}\n\n";
if (!main.includes('["BROWSER_NAVIGATE", "BROWSER_GET_PAGE"')) main = insertOnce(main, "  const display = screen.getPrimaryDisplay();", browserAction, "browser action router");

const permissionBlock = "    desktopPermission = level;\n    desktopKilled = level === \"deny\";";
if (main.includes(permissionBlock) && !main.includes("browserControl.resume();")) main = main.replace(permissionBlock, permissionBlock + '\n    if (level === "deny" || level === "none") browserControl.stopAll("Desktop control permission revoked.");\n    else browserControl.resume();');

const killBlock = "  desktopKilled = true;\n  desktopPermission = \"none\";";
if (main.includes(killBlock) && !main.includes("activeDesktopChildren.forEach")) main = main.replace(killBlock, killBlock + '\n  for (const child of activeDesktopChildren) { try { child.kill("SIGKILL"); } catch {} }\n  activeDesktopChildren.clear();\n  browserControl.stopAll("Emergency stop triggered by user.");');

if (!main.includes('globalShortcut.register("CommandOrControl+Shift+S"')) {
  const shortcuts = "  globalShortcut.register(\"CommandOrControl+Shift+S\", () => {\n" +
    "    desktopKilled = true; desktopPermission = \"none\";\n" +
    "    for (const child of activeDesktopChildren) { try { child.kill(\"SIGKILL\"); } catch {} }\n" +
    "    activeDesktopChildren.clear(); browserControl.stopAll(\"Global STOP shortcut.\");\n" +
    "    BrowserWindow.getAllWindows().forEach((win) => { if (!win.isDestroyed()) win.webContents.send(\"desktop-control-killed\", { reason: \"Global STOP shortcut (Ctrl+Shift+S).\" }); });\n" +
    "  });\n\n" +
    "  globalShortcut.register(\"CommandOrControl+Shift+H\", async () => {\n" +
    "    try { const result = await captureDesktopRegion({ x:0, y:0, width:AI_SCREEN_WIDTH, height:720 }); BrowserWindow.getAllWindows().forEach((win) => { if (!win.isDestroyed()) win.webContents.send(\"desktop-help-screenshot\", result); }); } catch (error) { console.warn(\"[HELP MODE]\", error?.message || error); }\n" +
    "  });\n\n";
  main = insertOnce(main, "  createWindow();", shortcuts, "global computer-agent shortcuts");
}
if (!main.includes("globalShortcut.unregisterAll();")) main = main.replace("app.on(\"before-quit\",", "globalShortcut.unregisterAll();\n\napp.on(\"before-quit\",");
write(mainPath, main);

let preload = read(preloadPath);
if (!preload.includes("onHelpScreenshot")) preload = preload.replace("  onEmergencyStop: (callback) => {", "  onHelpScreenshot: (callback) => {\n    const listener = (_event, payload) => callback(payload);\n    ipcRenderer.on(\"desktop-help-screenshot\", listener);\n    return () => ipcRenderer.removeListener(\"desktop-help-screenshot\", listener);\n  },\n  onEmergencyStop: (callback) => {");
write(preloadPath, preload);

let app = read(appPath);
if (!app.includes("onHelpScreenshot")) {
  const helpEffect = "  useEffect(() => {\n" +
    "    const cleanup = (window as any).magicDesktop?.onHelpScreenshot?.((payload: any) => {\n" +
    "      if (!payload?.image) return;\n" +
    "      setVisionThumbnail(payload.image);\n" +
    "      setIsVisionModalOpen(true);\n" +
    "      setVoiceNotice(\"Help mode screenshot ready. Tell me what you need.\");\n" +
    "    });\n" +
    "    return () => cleanup?.();\n" +
    "  }, []);\n\n";
  app = insertOnce(app, "  useEffect(() => {\n    const cleanup = (window as any).magicDesktop?.onEmergencyStop?.", helpEffect, "help screenshot listener");
}

const brandMarker = '<button type="button" onClick={() => setIsSettingsOpen(true)} className="ma9ic-brand" title="Open assistant settings">';
if (app.includes(brandMarker) && !app.includes('title="STOP ma9icAI"')) {
  app = app.replace(brandMarker, '<div className="ma9ic-brand">');
  app = app.replace('<img src="/ui/ma9icai-logo.png" alt="ma9icAI" className="ma9ic-brand-logo" />', '<button type="button" onClick={handleStopDesktopControl} className="ma9ic-brand-kill" title="STOP ma9icAI" aria-label="STOP ma9icAI"><img src="/ui/ma9icai-logo.png" alt="STOP ma9icAI" className="ma9ic-brand-logo" /></button>');
  app = app.replace('<div className="ma9ic-brand-title">ma9icAI</div>', '<button type="button" onClick={() => setIsSettingsOpen(true)} className="ma9ic-brand-title-btn" title="Open assistant settings"><span className="ma9ic-brand-title">ma9icAI</span></button>');
  app = app.replace("              </div>\n            </button>\n            <div className=\"ma9ic-header-tagline\">", "              </div>\n            </div>\n            <div className=\"ma9ic-header-tagline\">");
}

const executeMapMarker = '      WAIT: { action: "WAIT", params: { ms: params.ms || params.estimatedDurationMs || 500 } },';
if (!app.includes("BROWSER_NAVIGATE:")) app = app.replace(executeMapMarker, executeMapMarker + '\n      BROWSER_NAVIGATE: { action: "BROWSER_NAVIGATE", params: { browser: params.browser, url: params.url || params.parameter || "" } },\n      BROWSER_GET_PAGE: { action: "BROWSER_GET_PAGE", params: { browser: params.browser } },\n      BROWSER_CLICK_TEXT: { action: "BROWSER_CLICK_TEXT", params: { browser: params.browser, targetLabel: params.targetLabel || params.text || "" } },\n      BROWSER_TYPE: { action: "BROWSER_TYPE", params: { browser: params.browser, targetLabel: params.targetLabel, text: params.text || params.parameter || "" } },\n      BROWSER_SCREENSHOT: { action: "BROWSER_SCREENSHOT", params: { browser: params.browser } },');
write(appPath, app);

let server = read(serverPath);
if (!server.includes('"BROWSER_NAVIGATE"')) {
  const marker = "const PLANNER_ACTION_TYPES = new Set(["; const start = server.indexOf(marker); const end = start >= 0 ? server.indexOf("]);", start) : -1;
  if (start >= 0 && end >= 0) server = server.slice(0,end) + ',\n  "BROWSER_NAVIGATE", "BROWSER_GET_PAGE", "BROWSER_CLICK_TEXT", "BROWSER_TYPE", "BROWSER_SCREENSHOT"' + server.slice(end);
}
const promptMarker = '- "VISION_CLICK_TARGET": { "targetLabel": string, "targetIntent": "optional intent such as login" }';
if (server.includes(promptMarker) && !server.includes('"BROWSER_NAVIGATE": { "browser"')) server = server.replace(promptMarker, promptMarker + '\n- "BROWSER_NAVIGATE": { "browser": "chrome" | "brave" | "edge", "url": string }\n- "BROWSER_GET_PAGE": { "browser": "chrome" | "brave" | "edge" }\n- "BROWSER_CLICK_TEXT": { "browser": "chrome" | "brave" | "edge", "targetLabel": string }\n- "BROWSER_TYPE": { "browser": "chrome" | "brave" | "edge", "targetLabel": string, "text": string }\n- "BROWSER_SCREENSHOT": { "browser": "chrome" | "brave" | "edge" }');
const plannerList = '- "VISION_CLICK_TARGET": { "targetLabel": string, "targetIntent": "optional intent such as login" } (use for visually/semantically clicking a live webpage control)';
if (server.includes(plannerList) && !server.includes("Prefer BROWSER_*")) server = server.replace(plannerList, plannerList + '\nPrefer BROWSER_* for browser tasks. Use VISION_CLICK_TARGET only when CDP cannot complete the browser task or the page is not accessible through browser automation.');
write(serverPath, server);
console.log("[two-mode-cdp] applied two-mode browser, stop, and help workflow");