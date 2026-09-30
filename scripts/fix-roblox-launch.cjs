const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");

if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, "utf8");

  // Add Roblox to whatever alias object the current desktop-action code uses.
  if (!/roblox\s*:\s*["']robloxplayerbeta["']/.test(text)) {
    text = text.replace(
      /const aliases\s*=\s*\{([\s\S]*?)\};/,
      (match, body) => `const aliases = {${body}, roblox: "robloxplayerbeta" };`
    );
  }

  // Inject the Roblox executable resolver immediately before the normal alias lookup.
  if (!text.includes('requested === "roblox"')) {
    const marker = '    const candidates = aliases[requested];';
    const block = [
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
      ''
    ].join("\n");
    if (text.includes(marker)) text = text.replace(marker, block + marker);
  }

  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[roblox] Installed dynamic RobloxPlayerBeta launcher and focus alias.");
}

if (fs.existsSync(serverFile)) {
  let text = fs.readFileSync(serverFile, "utf8");

  // Add a direct voice alias regardless of the exact surrounding alias list.
  if (!/roblox\s*\(\?: player\)\?/.test(text) && !/\\broblox/.test(text)) {
    text = text.replace(
      /([ \t]*\[\/\\b\(power \?shell\|terminal\)\\b\/, "terminal"\],)/,
      '$1\n    [/\\broblox(?: player)?\\b/, "roblox"],'
    );
  }

  // Extend the explicit LAUNCH_APP schema when that exact union is present.
  text = text.replace(
    /("LAUNCH_APP"\s*:\s*\{\s*"app"\s*:\s*[\s\S]*?\|\s*"taskmgr"\s*\})/,
    (match) => match.includes('"roblox"') ? match : match.replace('"taskmgr" }', '"taskmgr" | "roblox" }')
  );

  fs.writeFileSync(serverFile, text, "utf8");
}

console.log("[roblox] Roblox voice command support installed.");
