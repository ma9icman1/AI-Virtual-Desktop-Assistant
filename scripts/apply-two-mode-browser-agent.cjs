const fs = require("fs");
const path = require("path");

const root = process.cwd();
const mainPath = path.join(root, "electron", "main.cjs");
const preloadPath = path.join(root, "electron", "preload.cjs");
const appPath = path.join(root, "src", "App.tsx");
const serverPath = path.join(root, "server.ts");
const cssPath = path.join(root, "src", "index.css");

function read(file) {
  if (!fs.existsSync(file)) throw new Error("[two-mode-cdp] Missing " + file);
  return fs.readFileSync(file, "utf8");
}

function write(file, text) {
  fs.writeFileSync(file, text, "utf8");
}

function insertOnce(text, marker, insertion, label) {
  if (text.includes(insertion)) return text;
  const i = text.indexOf(marker);
  if (i < 0) throw new Error("[two-mode-cdp] Marker missing: " + label);
  return text.slice(0, i) + insertion + text.slice(i);
}

let main = read(mainPath);

if (!main.includes('require("./browser-control.cjs")')) {
  main = main.replace(
    'const http = require("http");\n',
    'const http = require("http");\nconst browserControl = require("./browser-control.cjs");\n'
  );
}

if (!main.includes("const activeDesktopChildren = new Set();")) {
  main = main.replace(
    "let desktopKilled = false;\n",
    "let desktopKilled = false;\nconst activeDesktopChildren = new Set();\n"
  );
}

const browserAction =
`  if (["BROWSER_NAVIGATE", "BROWSER_GET_PAGE", "BROWSER_CLICK_TEXT", "BROWSER_TYPE", "BROWSER_SCREENSHOT"].includes(action)) {
    const browser = String(params.browser || "chrome").trim().toLowerCase();
    if (!["chrome", "brave", "edge"].includes(browser)) {
      throw new Error("Browser mode supports Chrome, Brave, and Edge only.");
    }
    const executable = resolveBrowserExecutable(browser);
    if (!executable) throw new Error("Could not find " + browser + ".");
    const base = {
      browser,
      executable,
      appDataDir: app.getPath("userData"),
      url: String(params.url || "about:blank")
    };
    if (action === "BROWSER_NAVIGATE") {
      return await browserControl.navigate({ ...base, url: String(params.url || "") });
    }
    if (action === "BROWSER_GET_PAGE") return await browserControl.getPage(base);
    if (action === "BROWSER_CLICK_TEXT") {
      return await browserControl.clickText({
        ...base,
        text: params.text || params.targetLabel
      });
    }
    if (action === "BROWSER_TYPE") {
      return await browserControl.typeInto({
        ...base,
        text: params.text,
        targetLabel: params.targetLabel
      });
    }
    return await browserControl.screenshot(base);
  }

`;

if (!main.includes('["BROWSER_NAVIGATE", "BROWSER_GET_PAGE"')) {
  main = insertOnce(
    main,
    "  const display = screen.getPrimaryDisplay();",
    browserAction,
    "browser action router"
  );
}

const permissionBlock =
`    desktopPermission = level;
    desktopKilled = level === "deny";`;

if (
  main.includes(permissionBlock) &&
  !main.includes("browserControl.resume();")
) {
  main = main.replace(
    permissionBlock,
    permissionBlock +
      '\n    if (level === "deny" || level === "none") browserControl.stopAll("Desktop control permission revoked.");\n    else browserControl.resume();'
  );
}

const killBlock =
`  desktopKilled = true;
  desktopPermission = "none";`;

if (
  main.includes(killBlock) &&
  !main.includes("activeDesktopChildren.forEach")
) {
  main = main.replace(
    killBlock,
    killBlock +
      '\n  for (const child of activeDesktopChildren) { try { child.kill("SIGKILL"); } catch {} }\n' +
      '  activeDesktopChildren.clear();\n' +
      '  browserControl.stopAll("Emergency stop triggered by user.");'
  );
}

const shortcutMarker =
`  globalShortcut.register("CommandOrControl+Alt+Escape", () => {`;

if (!main.includes('globalShortcut.register("CommandOrControl+Shift+S"')) {
  const shortcuts =
`  globalShortcut.register("CommandOrControl+Shift+S", () => {
    desktopKilled = true;
    desktopPermission = "none";
    for (const child of activeDesktopChildren) {
      try { child.kill("SIGKILL"); } catch {}
    }
    activeDesktopChildren.clear();
    browserControl.stopAll("Global STOP shortcut.");
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("desktop-control-killed", {
          reason: "Global STOP shortcut (Ctrl+Shift+S)."
        });
      }
    });
  });

  globalShortcut.register("CommandOrControl+Shift+H", async () => {
    try {
      const result = await captureDesktopRegion({
        x: 0,
        y: 0,
        width: AI_SCREEN_WIDTH,
        height: 720
      });

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("desktop-help-screenshot", result);
        }
      });
    } catch (error) {
      console.warn("[HELP MODE]", error?.message || error);
    }
  });

`;

  main = insertOnce(
    main,
    shortcutMarker,
    shortcuts,
    "global computer-agent shortcuts"
  );
}

if (!main.includes("globalShortcut.unregisterAll();")) {
  main = main.replace(
    'app.on("before-quit", (event) => {\n',
    'app.on("before-quit", (event) => {\n  globalShortcut.unregisterAll();\n'
  );
}

write(mainPath, main);

let preload = read(preloadPath);

if (!preload.includes("onHelpScreenshot")) {
  preload = preload.replace(
    "  onEmergencyStop: (callback) => {",
`  onHelpScreenshot: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop-help-screenshot", listener);
    return () => ipcRenderer.removeListener("desktop-help-screenshot", listener);
  },
  onEmergencyStop: (callback) => {`
  );
}

write(preloadPath, preload);

let app = read(appPath);

write(appPath, app);

let server = read(serverPath);

if (!server.includes('"BROWSER_NAVIGATE"')) {
  const marker = "const PLANNER_ACTION_TYPES = new Set([";
  const start = server.indexOf(marker);
  const end = start >= 0 ? server.indexOf("]);", start) : -1;

  if (start >= 0 && end >= 0) {
    server =
      server.slice(0, end) +
      ',\n  "BROWSER_NAVIGATE", "BROWSER_GET_PAGE", "BROWSER_CLICK_TEXT", "BROWSER_TYPE", "BROWSER_SCREENSHOT"' +
      server.slice(end);
  }
}

write(serverPath, server);

let css = read(cssPath);

if (!css.includes(".ma9ic-brand-kill")) {
  css += `

/* computer-agent two-mode STOP control */
.ma9ic-brand-kill {
  width: 42px;
  height: 42px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 12px;
}

.ma9ic-brand-kill:hover .ma9ic-brand-logo {
  filter: drop-shadow(0 0 16px rgba(255,55,95,.95));
  transform: scale(1.04);
}

.ma9ic-brand-kill:active .ma9ic-brand-logo {
  transform: scale(.96);
}

.ma9ic-brand-title-btn {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
`;
}

write(cssPath, css);

console.log("[two-mode-cdp] repaired successfully");

