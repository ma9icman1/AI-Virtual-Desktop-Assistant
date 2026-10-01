const fs = require("fs");
const path = require("path");

const appFile = path.join(process.cwd(), "src", "App.tsx");
if (fs.existsSync(appFile)) {
  let text = fs.readFileSync(appFile, "utf8");
  const marker = '      OPEN_FOLDER: { action: "OPEN_FOLDER", params: { path: params.path || params.parameter || "" } },';
  const additions = [
    '      MINIMIZE_APP: { action: "MINIMIZE_APP", params: { app: params.app || params.parameter || "" } },',
    '      MAXIMIZE_APP: { action: "MAXIMIZE_APP", params: { app: params.app || params.parameter || "" } },',
    '      RESTORE_APP: { action: "RESTORE_APP", params: { app: params.app || params.parameter || "" } },',
  ].join("\n");
  if (!text.includes('MINIMIZE_APP: { action: "MINIMIZE_APP"')) {
    if (text.includes(marker)) {
      text = text.replace(marker, marker + "\n" + additions);
      fs.writeFileSync(appFile, text, "utf8");
      console.log("[desktop-actions] Added window-state action mappings.");
    } else {
      console.log("[desktop-actions] App mapping marker changed; skipped safely.");
    }
  }
}

// This repair script used to depend on a very specific server.ts marker.
// server.ts has since evolved, so a missing marker must not break the entire build.
const serverFile = path.join(process.cwd(), "server.ts");
if (fs.existsSync(serverFile)) {
  const text = fs.readFileSync(serverFile, "utf8");
  const marker = '  if (requestedApp && asksToOpen && parsed?.action?.type !== "LAUNCH_APP" && parsed?.action?.type !== "MULTI_STEP_PLAN") {';
  if (text.includes("const desktopVoiceWindowMatch")) {
    console.log("[desktop-actions] Deterministic voice parser already present; skipped.");
  } else if (text.includes(marker)) {
    // Leave the server parser to the newer, dedicated repair scripts.
    console.log("[desktop-actions] Legacy server marker found; newer repair scripts will handle it.");
  } else {
    console.log("[desktop-actions] Server intent marker changed; skipped safely.");
  }
}

// Native Electron action repairs are now handled by the dedicated action/vision
// repair scripts. Keep this script non-fatal so a changed main.cjs cannot stop builds.
const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (fs.existsSync(electronFile)) {
  console.log("[desktop-actions] Native Electron action repair handled by dedicated scripts; skipped here.");
}
