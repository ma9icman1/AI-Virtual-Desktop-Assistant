const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");

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
    "$proc = Get-Process -Name '" + "${requested}" + "' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
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

// The planner structure has changed over time. Do not fail the entire build
// merely because the optional combined open/type injection marker is absent.
// The current server already performs desktop-intent normalization and the
// dedicated desktop-action patchers handle the executable/action details.
console.log("[desktop-input] Installed literal clipboard typing and launch focus.");
