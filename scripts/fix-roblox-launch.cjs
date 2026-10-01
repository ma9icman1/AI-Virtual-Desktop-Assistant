const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");
const ROBLOX_EXE = "C:\\Users\\ma9ic\\AppData\\Local\\Roblox\\Versions\\version-2366ba214ec740ca\\RobloxPlayerBeta.exe";

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");
  if (!text.includes('requested === "roblox"')) {
    const marker = '    const candidates = aliases[requested];';
    const block = [
      '    if (requested === "roblox") {',
      `      const robloxTarget = ${JSON.stringify(ROBLOX_EXE)};`,
      '      if (!fs.existsSync(robloxTarget)) throw new Error("RobloxPlayerBeta.exe was not found at the configured Roblox path.");',
      '      const child = spawn(robloxTarget, [], { detached: true, stdio: "ignore", windowsHide: true });',
      '      await new Promise((resolve, reject) => {',
      '        child.once("error", (error) => reject(new Error("Windows could not launch Roblox: " + error.message)));',
      '        child.once("spawn", resolve);',
      '      });',
      '      child.unref();',
      '      return { ok: true, verified: true, process: "roblox", executable: robloxTarget };',
      '    }',
      ''
    ].join("\n");
    if (text.includes(marker)) text = text.replace(marker, block + marker);
  }
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed fixed RobloxPlayerBeta.exe launcher.");
}

if (fs.existsSync(serverFile)) {
  let text = fs.readFileSync(serverFile, "utf8");
  if (!/roblox(?: player)?/.test(text)) {
    const marker = '[/\\b(power ?shell|terminal)\\b/, "terminal"],';
    if (text.includes(marker)) text = text.replace(marker, marker + '\n    [/\\broblox(?: player)?\\b/, "roblox"],');
  }
  fs.writeFileSync(serverFile, text, "utf8");
}

console.log("[roblox] Roblox voice command support installed.");
