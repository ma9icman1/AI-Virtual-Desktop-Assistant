const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");

  // Make "focus Roblox" resolve to the actual RobloxPlayerBeta process.
  const aliasMarker = 'const aliases = { files: "explorer", explorer: "explorer", terminal: "windowsterminal", calculator: "calculator", taskmgr: "taskmgr" };';
  const aliasReplacement = 'const aliases = { files: "explorer", explorer: "explorer", terminal: "windowsterminal", calculator: "calculator", taskmgr: "taskmgr", roblox: "robloxplayerbeta" };';
  if (text.includes(aliasMarker)) text = text.replace(aliasMarker, aliasReplacement);

  // Launch the installed Roblox Player executable dynamically. Roblox installs
  // each player version under %LOCALAPPDATA%\\Roblox\\Versions, so never hard-code
  // a version number or a machine-specific path.
  const launchMarker = '    const candidates = aliases[requested];\n    if (!candidates) throw new Error(`Application is not allowed: ${requested || "requested app"}.`);';
  const launchReplacement = `    if (requested === "roblox") {\n      const versionsRoot = path.join(process.env.LOCALAPPDATA || "", "Roblox", "Versions");\n      let robloxTarget = "";\n      try {\n        const versions = fs.readdirSync(versionsRoot, { withFileTypes: true })\n          .filter((entry) => entry.isDirectory())\n          .map((entry) => path.join(versionsRoot, entry.name))\n          .filter((dir) => fs.existsSync(path.join(dir, "RobloxPlayerBeta.exe")))\n          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);\n        if (versions.length) robloxTarget = path.join(versions[0], "RobloxPlayerBeta.exe");\n      } catch {}\n      if (!robloxTarget) throw new Error("Could not find the Roblox Player executable. Make sure Roblox is installed.");\n      const child = spawn(robloxTarget, [], { detached: true, stdio: "ignore", windowsHide: true });\n      await new Promise((resolve, reject) => {\n        child.once("error", (error) => reject(new Error(`Windows could not launch Roblox: ${error.message}`)));\n        child.once("spawn", resolve);\n      });\n      child.unref();\n      const verified = await verifyProcessRunning("robloxplayerbeta");\n      if (!verified) throw new Error("Roblox started, but the Roblox Player process could not be verified.");\n      if (desktopPermission === "one_action") desktopPermission = "none";\n      return { ok: true, verified: true, process: "roblox", executable: robloxTarget };\n    }\n\n    const candidates = aliases[requested];\n    if (!candidates) throw new Error(`Application is not allowed: ${requested || "requested app"}.`);`;

  if (text.includes(launchMarker) && !text.includes('requested === "roblox"')) {
    text = text.replace(launchMarker, launchReplacement);
  }

  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed dynamic RobloxPlayerBeta launcher and focus alias.");
}

if (fs.existsSync(serverFile)) {
  let text = fs.readFileSync(serverFile, "utf8");

  // Teach the deterministic voice parser that "Roblox" is an allowed app.
  const aliasMarker = '    [/\\b(power ?shell|terminal)\\b/, "terminal"],';
  const aliasReplacement = '    [/\\b(power ?shell|terminal)\\b/, "terminal"],\n    [/\\broblox(?: player)?\\b/, "roblox"],';
  if (text.includes(aliasMarker) && !text.includes('[/\\b(?:roblox|roblox player)')) {
    text = text.replace(aliasMarker, aliasReplacement);
  }

  // Keep the planner's explicit executable app allow-list in sync.
  const plannerMarker = '\"LAUNCH_APP\": { \"app\": \"browser\" | \"brave\" | \"edge\" | \"chrome\" | \"firefox\" | \"notepad\" | \"calculator\" | \"paint\" | \"explorer\" | \"files\" | \"terminal\" | \"taskmgr\" }';
  const plannerReplacement = '\"LAUNCH_APP\": { \"app\": \"browser\" | \"brave\" | \"edge\" | \"chrome\" | \"firefox\" | \"notepad\" | \"calculator\" | \"paint\" | \"explorer\" | \"files\" | \"terminal\" | \"taskmgr\" | \"roblox\" }';
  if (text.includes(plannerMarker)) text = text.replace(plannerMarker, plannerReplacement);

  fs.writeFileSync(serverFile, text, "utf8");
}

console.log("[roblox] Roblox voice command support installed.");
