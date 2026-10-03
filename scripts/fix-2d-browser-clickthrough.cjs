"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "electron", "main.cjs");
let source = fs.readFileSync(mainPath, "utf8");

const marker = "// [browser-2d-clickthrough-v1]";
if (source.includes(marker)) {
  console.log("[browser-2d-clickthrough] already applied");
  process.exit(0);
}

const old = `ipcMain.on("magic-window-layout", (event, overlayMode) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || typeof overlayMode !== "boolean") return;

  if (overlayMode) {`;

const replacement = `ipcMain.on("magic-window-layout", (event, overlayMode) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || typeof overlayMode !== "boolean") return;

  // [browser-2d-clickthrough-v1]
  // The 2.5D avatar is a visual overlay, not the interaction surface for the
  // browser. Make the overlay window click-through while model mode is active
  // so vision-generated browser coordinates reach Chrome/Brave/Edge underneath.
  // Full application mode remains interactive.
  window.setIgnoreMouseEvents(overlayMode, { forward: true });
  window.setAlwaysOnTop(overlayMode, "screen-saver");

  if (overlayMode) {`;

if (!source.includes(old)) {
  throw new Error("Expected magic-window-layout block was not found.");
}

source = source.replace(old, replacement);
fs.writeFileSync(mainPath, source, "utf8");
console.log("[browser-2d-clickthrough] patched electron/main.cjs");
