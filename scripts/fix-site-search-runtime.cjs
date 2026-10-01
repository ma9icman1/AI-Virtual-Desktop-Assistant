const fs = require("fs");
const path = require("path");

const root = process.cwd();
const serverFile = path.join(root, "server.ts");
const appFile = path.join(root, "src", "App.tsx");

// Normalize generated Enter actions. Older site-search plans used "~" as a
// placeholder for Enter, which reaches the native key handler literally.
if (fs.existsSync(serverFile)) {
  let server = fs.readFileSync(serverFile, "utf8");
  const before = server;
  server = server.replace(/params:\s*\{\s*key:\s*["']~["']\s*\}/g, 'params: { key: "ENTER" }');
  server = server.replace(/key:\s*["']~["']/g, 'key: "ENTER"');
  if (server !== before) {
    fs.writeFileSync(serverFile, server, "utf8");
    console.log("[site-search-runtime] normalized site-search Enter key");
  } else {
    console.log("[site-search-runtime] Enter key already normalized");
  }
}

// Strengthen the live-screen vision prompt. This is deliberately a prompt-only
// repair: do not splice a large JavaScript block into App.tsx because that can
// leave the tail of a ternary expression behind and break the Vite parser.
if (fs.existsSync(appFile)) {
  let app = fs.readFileSync(appFile, "utf8");
  const oldPrompt = 'Identify the exact visible clickable input/control matching this target. Return detectedElements with label, type, boundingBox, and center coordinates in screenshot pixels. Prefer the search box/search bar when the target mentions search. Do not guess coordinates.';
  const newPrompt = 'Identify the exact visible clickable control matching the target in the CURRENT SCREENSHOT. Return detectedElements with label, type, boundingBox, and center coordinates in the ACTUAL SCREENSHOT PIXEL COORDINATE SYSTEM. If the target is a search bar, return only the site/page search input, not the browser toolbar, address bar, logo, menu, or arbitrary text. Do not return normalized 0-1 or 0-1000 coordinates. Do not guess coordinates. Never use a point near the top-left corner such as (0,0) unless the target is visibly there.';
  if (app.includes(oldPrompt)) {
    app = app.replace(oldPrompt, newPrompt);
    fs.writeFileSync(appFile, app, "utf8");
    console.log("[site-search-runtime] strengthened vision prompt");
  } else {
    console.log("[site-search-runtime] vision prompt already updated or not found");
  }
}

console.log("[site-search-runtime] complete");
