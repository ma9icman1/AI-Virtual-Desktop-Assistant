const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");
const ROBLOX_EXE = "C:\\Users\\ma9ic\\AppData\\Local\\Roblox\\Versions\\version-2366ba214ec740ca\\RobloxPlayerBeta.exe";

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");

  // Keep the native desktop action handler async because the launch path awaits
  // the child-process spawn and focus/verification work.
  text = text.replace(/(^|\n)\s*function executeDesktopAction\s*\(/, "$1async function executeDesktopAction(");

  // The desktop-action repair scripts can change whitespace or the contents of
  // the aliases object. Do not depend on the old exact block; find the aliases
  // object itself and add Roblox to it.
  const aliasesPattern = /(\bconst aliases\s*=\s*\{)([\s\S]*?)(\n\s*\};)/;
  const aliasesMatch = text.match(aliasesPattern);
  if (!aliasesMatch) {
    throw new Error("[roblox] Could not find the desktop application aliases object in electron/main.cjs");
  }

  if (!/\broblox\s*:/.test(aliasesMatch[2])) {
    const robloxLine = `\n      roblox: [${JSON.stringify(ROBLOX_EXE)}],`;
    text = text.replace(aliasesPattern, `$1$2${robloxLine}$3`);
  } else {
    // Replace an older Roblox alias with the deterministic executable path.
    text = text.replace(/(\broblox\s*:\s*)\[[^\]]*\]/, `$1[${JSON.stringify(ROBLOX_EXE)}]`);
  }

  // Absolute executable paths are already deterministic launch targets. They
  // do not need process-name verification, which can fail because Roblox may
  // hand off to another process during startup.
  const verificationPattern = /\s*const verifyTarget = normalizeProcessName\(target\);\s*\n\s*const verified = await verifyProcessRunning\(verifyTarget\);/;
  const verificationReplacement = `
    const verifyTarget = normalizeProcessName(target);
    const verified = path.isAbsolute(target)
      ? true
      : await verifyProcessRunning(verifyTarget);`;

  if (verificationPattern.test(text)) {
    text = text.replace(verificationPattern, verificationReplacement);
  }

  // Final guard: never leave executeDesktopAction non-async.
  text = text.replace(/(^|\n)\s*function executeDesktopAction\s*\(/, "$1async function executeDesktopAction(");

  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed safe direct RobloxPlayerBeta.exe launcher.");
}

if (fs.existsSync(serverFile)) {
  console.log("[roblox] Voice command uses the native roblox desktop action.");
}

console.log("[roblox] Roblox launcher patch complete.");
