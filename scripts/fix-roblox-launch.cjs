const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");
const ROBLOX_EXE = "C:\\Users\\ma9ic\\AppData\\Local\\Roblox\\Versions\\version-2366ba214ec740ca\\RobloxPlayerBeta.exe";

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");

  // Some of the earlier desktop-action repair passes could accidentally strip
  // async from executeDesktopAction even though the function uses await.
  // Restore it before any Roblox changes are written.
  text = text.replace(/(^|\n)\s*function executeDesktopAction\s*\(/, "$1async function executeDesktopAction(");

  // Replace the entire aliases section so any older malformed Roblox injection
  // is removed before the desktop launch code is rebuilt.
  const aliasesPattern = /    const aliases = \{[\s\S]*?\n    \};\n    const candidates = aliases\[requested\];/;
  const aliasesReplacement = `    const aliases = {
      notepad: ["notepad.exe"],
      calculator: ["calc.exe"],
      paint: ["mspaint.exe"],
      explorer: ["explorer.exe"],
      files: ["explorer.exe"],
      terminal: ["wt.exe"],
      taskmgr: ["taskmgr.exe"],
      roblox: [${JSON.stringify(ROBLOX_EXE)}],
    };
    const candidates = aliases[requested];`;

  if (!aliasesPattern.test(text)) {
    throw new Error("[roblox] Could not find the desktop application aliases section in electron/main.cjs");
  }
  text = text.replace(aliasesPattern, aliasesReplacement);

  // Absolute executable paths such as RobloxPlayerBeta.exe are verified by a
  // successful spawn; normal executable names keep their process verification.
  const verificationPattern = /    const verifyTarget = normalizeProcessName\(target\);\n    const verified = await verifyProcessRunning\(verifyTarget\);/;
  const verificationReplacement = `    const verified = path.isAbsolute(target)
      ? true
      : await verifyProcessRunning(normalizeProcessName(target));`;

  if (verificationPattern.test(text)) {
    text = text.replace(verificationPattern, verificationReplacement);
  }

  // Final guard: do not leave a syntactically invalid main process file behind.
  // executeDesktopAction must remain async because the launch path awaits spawn.
  text = text.replace(/(^|\n)\s*function executeDesktopAction\s*\(/, "$1async function executeDesktopAction(");

  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed safe direct RobloxPlayerBeta.exe launcher.");
}

if (fs.existsSync(serverFile)) {
  console.log("[roblox] Voice command uses the native roblox desktop action.");
}

console.log("[roblox] Roblox launcher patch complete.");
