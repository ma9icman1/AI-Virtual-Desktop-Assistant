const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");
  const aliasMarker = 'const aliases = { files: "explorer", explorer: "explorer", terminal: "windowsterminal", calculator: "calculator", taskmgr: "taskmgr" };';
  const aliasReplacement = 'const aliases = { files: "explorer", explorer: "explorer", terminal: "windowsterminal", calculator: "calculator", taskmgr: "taskmgr", roblox: "robloxplayerbeta" };';
  if (text.includes(aliasMarker)) text = text.replace(aliasMarker, aliasReplacement);

  const launchMarker = '    const candidates = aliases[requested];\n    if (!candidates) throw new Error(`Application is not allowed: ${requested || "requested app"}.`);';
  const launchLines = [
    '    if (requested === "roblox") {',
    '      const versionsRoot = path.join(process.env.LOCALAPPDATA || "", "Roblox", "Versions");',
    '      let robloxTarget = "";',
    '      try {',
    '        const versions = fs.readdirSync(versionsRoot, { withFileTypes: true })',
    '          .filter((entry) => entry.isDirectory())',
    '          .map((entry) => path.join(versionsRoot, entry.name))',
    '          .filter((dir) => fs.existsSync(path.join(dir, "RobloxPlayerBeta.exe")))',
    '          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);',
    '        if (versions.length) robloxTarget = path.join(versions[0], "RobloxPlayerBeta.exe");',
    '      } catch {}',
    '      if (!robloxTarget) throw new Error("Could not find the Roblox Player executable. Make sure Roblox is installed.");',
    '      const child = spawn(robloxTarget, [], { detached: true, stdio: "ignore", windowsHide: true });',
    '      await new Promise((resolve, reject) => {',
    '        child.once("error", (error) => reject(new Error("Windows could not launch Roblox: " + error.message)));',
    '        child.once("spawn", resolve);',
    '      });',
    '      child.unref();',
    '      const verified = await verifyProcessRunning("robloxplayerbeta");',
    '      if (!verified) throw new Error("Roblox started, but the Roblox Player process could not be verified.");',
    '      if (desktopPermission === "one_action") desktopPermission = "none";',
    '      return { ok: true, verified: true, process: "roblox", executable: robloxTarget };',
    '    }',
    '',
    '    const candidates = aliases[requested];',
    '    if (!candidates) throw new Error(`Application is not allowed: ${requested || "requested app"}.`);'
  ];
  const launchReplacement = launchLines.join("\n");
  if (text.includes(launchMarker) && !text.includes('requested === "roblox"')) text = text.replace(launchMarker, launchReplacement);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed dynamic RobloxPlayerBeta launcher and focus alias.");
}

if (fs.existsSync(serverFile)) {
  let text = fs.readFileSync(serverFile, "utf8");
  const aliasMarker = '    [/\\b(power ?shell|terminal)\\b/, "terminal"],';
  const aliasReplacement = '    [/\\b(power ?shell|terminal)\\b/, "terminal"],\n    [/\\broblox(?: player)?\\b/, "roblox"],';
  if (text.includes(aliasMarker) && !text.includes('[/\\broblox')) text = text.replace(aliasMarker, aliasReplacement);
  const plannerMarker = '"LAUNCH_APP": { "app": "browser" | "brave" | "edge" | "chrome" | "firefox" | "notepad" | "calculator" | "paint" | "explorer" | "files" | "terminal" | "taskmgr" }';
  const plannerReplacement = '"LAUNCH_APP": { "app": "browser" | "brave" | "edge" | "chrome" | "firefox" | "notepad" | "calculator" | "paint" | "explorer" | "files" | "terminal" | "taskmgr" | "roblox" }';
  if (text.includes(plannerMarker)) text = text.replace(plannerMarker, plannerReplacement);
  fs.writeFileSync(serverFile, text, "utf8");
}

console.log("[roblox] Roblox voice command support installed.");
