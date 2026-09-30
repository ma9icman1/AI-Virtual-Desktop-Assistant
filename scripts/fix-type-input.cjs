const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");

if (!fs.existsSync(electronFile)) {
  throw new Error("[desktop-input] electron/main.cjs not found");
}

let text = fs.readFileSync(electronFile, "utf8");

// Replace the TYPE_TEXT PowerShell action with literal clipboard paste.
const typeRegex = /  'TYPE_TEXT' \{[^\n]*\}/;
const typeHandler = "  'TYPE_TEXT' { Add-Type -AssemblyName System.Windows.Forms; $text = [string]$scriptArgs[1]; if ([string]::IsNullOrEmpty($text)) { break }; [System.Windows.Forms.Clipboard]::SetText($text); Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 150 }";
if (typeRegex.test(text)) {
  text = text.replace(typeRegex, typeHandler);
} else if (!text.includes("[System.Windows.Forms.Clipboard]::SetText($text)")) {
  throw new Error("[desktop-input] Could not find TYPE_TEXT handler in electron/main.cjs");
}

// Focus the newly launched application before returning from LAUNCH_APP.
const launchMarker = "    if (!verified) throw new Error(`Windows started ${requested}, but the process could not be verified.`);";
if (text.includes(launchMarker) && !text.includes("MagicLaunchFocus")) {
  const focusLines = [
    launchMarker,
    "    await runPowerShell(`",
    "$proc = Get-Process -Name '${requested}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    "if ($proc) {",
    "  Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class MagicLaunchFocus { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }",
    "'@",
    "  [void][MagicLaunchFocus]::SetForegroundWindow($proc.MainWindowHandle)",
    "}",
    "Start-Sleep -Milliseconds 500",
    "`);",
  ];
  text = text.replace(launchMarker, focusLines.join("\n"));
}

fs.writeFileSync(electronFile, text, "utf8");

// Deterministically handle common combined open-and-type commands.
if (fs.existsSync(serverFile)) {
  let serverText = fs.readFileSync(serverFile, "utf8");
  if (!serverText.includes("const magicOpenTypeMatch =")) {
    const marker = "        if (parsed && parsed.steps) {\n          return res.json(validateAgentPlan(parsed));\n        }";
    if (!serverText.includes(marker)) {
      throw new Error("[desktop-input] Could not find planner validation block in server.ts");
    }

    const replacement = [
      "        const magicOpenTypeMatch = String(goal).match(/^\\s*(?:open|launch|start)\\s+(notepad|calculator|calc|paint|explorer|files|terminal|task manager|taskmgr)\\s+(?:and\\s+)?(?:type|write|enter)\\s+(.+?)\\s*[.!]?\\s*$/i);",
      "        if (magicOpenTypeMatch) {",
      "          const rawApp = magicOpenTypeMatch[1].toLowerCase();",
      "          const app = rawApp === \"calc\" ? \"calculator\" : rawApp === \"task manager\" ? \"taskmgr\" : rawApp;",
      "          const textToType = magicOpenTypeMatch[2].trim();",
      "          return res.json(validateAgentPlan({",
      "            planTitle: \"Open \" + app + \" and type text\",",
      "            spokenIntro: \"Opening \" + app + \", then typing \" + textToType + \".\",",
      "            steps: [",
      "              { stepNumber: 1, description: \"Open \" + app, actionType: \"LAUNCH_APP\", params: { app }, estimatedDurationMs: 1200 },",
      "              { stepNumber: 2, description: \"Wait for the application window\", actionType: \"WAIT\", params: { ms: 700 }, estimatedDurationMs: 700 },",
      "              { stepNumber: 3, description: \"Type \" + textToType, actionType: \"TYPE_INPUT\", params: { text: textToType }, estimatedDurationMs: 500 },",
      "            ],",
      "            spokenCompletion: app + \" is open and the text was entered.\",",
      "          }));",
      "        }",
      "",
      "        if (parsed && parsed.steps) {",
      "          return res.json(validateAgentPlan(parsed));",
      "        }",
    ].join("\n");

    serverText = serverText.replace(marker, replacement);
    fs.writeFileSync(serverFile, serverText, "utf8");
  }
}

console.log("[desktop-input] Installed literal clipboard typing, launch focus, and deterministic open/type planning.");
