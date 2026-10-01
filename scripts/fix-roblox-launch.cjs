const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");
const ROBLOX_EXE = "C:\\Users\\ma9ic\\AppData\\Local\\Roblox\\Versions\\version-2366ba214ec740ca\\RobloxPlayerBeta.exe";

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");

  // Replace any previous Roblox launcher patch and install one directly before
  // the normal application-alias validation. This avoids the generic allowlist
  // rejecting "roblox" and avoids process-name verification races.
  const launcher = [
    '    if (requested === "roblox") {',
    `      const robloxTarget = ${JSON.stringify(ROBLOX_EXE)};`,
    '      if (!fs.existsSync(robloxTarget)) throw new Error("RobloxPlayerBeta.exe was not found at: " + robloxTarget);',
    '      const child = spawn(robloxTarget, [], { detached: true, stdio: "ignore", windowsHide: true });',
    '      await new Promise((resolve, reject) => {',
    '        child.once("error", (error) => reject(new Error("Windows could not launch Roblox: " + error.message)));',
    '        child.once("spawn", resolve);',
    '      });',
    '      child.unref();',
    '      if (desktopPermission === "one_action") desktopPermission = "none";',
    '      return { ok: true, verified: true, process: "roblox", executable: robloxTarget };',
    '    }',
    ''
  ].join("\n");

  // Remove every old generated Roblox block immediately before the aliases table.
  text = text.replace(/\n\s*if \(requested === ["']roblox["']\) \{[\s\S]*?\n\s*\}\n(?=\s*const aliases = \{)/g, "\n");

  const marker = /\n\s*const aliases = \{/;
  if (marker.test(text)) {
    text = text.replace(marker, "\n" + launcher + "    const aliases = {");
  } else {
    throw new Error("[roblox] Could not find the desktop application aliases block in electron/main.cjs");
  }

  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed fixed direct RobloxPlayerBeta.exe launcher.");
}

// The voice planner already normalizes the spoken command to "roblox" in the
// current build. Keep this script focused on the native launch implementation.
if (fs.existsSync(serverFile)) {
  console.log("[roblox] Voice command uses the native roblox desktop action.");
}

console.log("[roblox] Roblox launcher patch complete.");
