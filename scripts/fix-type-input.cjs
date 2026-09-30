const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) {
  throw new Error("[desktop-input] electron/main.cjs not found");
}

let text = fs.readFileSync(electronFile, "utf8");

// Replace fragile SendKeys text injection with literal clipboard paste.
const oldType = "  'TYPE_TEXT' { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($scriptArgs[1]) }";
const newType = [
  "  'TYPE_TEXT' {",
  "    Add-Type -AssemblyName System.Windows.Forms",
  "    $text = [string]$scriptArgs[1]",
  "    if ([string]::IsNullOrEmpty($text)) { break }",
  "    [System.Windows.Forms.Clipboard]::SetText($text)",
  "    Start-Sleep -Milliseconds 120",
  "    [System.Windows.Forms.SendKeys]::SendWait('^v')",
  "    Start-Sleep -Milliseconds 120",
  "  }",
].join("\n");

if (text.includes(oldType)) {
  text = text.replace(oldType, newType);
} else if (!text.includes("[System.Windows.Forms.Clipboard]::SetText($text)")) {
  throw new Error("[desktop-input] Could not find the TYPE_TEXT handler in electron/main.cjs");
}

// Make LAUNCH_APP explicitly focus the launched window before a following
// TYPE_TEXT/KEY_PRESS step. Build this as plain strings so this patcher never
// tries to evaluate ${requested} while Node is running the build script.
const launchMarker = "    const verified = await verifyProcessRunning(verifyTarget);\n    if (!verified) throw new Error(`Windows started ${requested}, but the process could not be verified.`);";

const focusBlock = launchMarker + "\n" + [
  "    await runPowerShell(`",
  "$proc = Get-Process -Name '${requested.replace(/'/g, \"''\")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
  "if ($proc) {",
  "  Add-Type @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class MagicLaunchFocus { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }",
  "'@",
  "  [void][MagicLaunchFocus]::SetForegroundWindow($proc.MainWindowHandle)",
  "}",
  "Start-Sleep -Milliseconds 350",
  "`).catch(() => {});",
].join("\n");

if (text.includes(launchMarker) && !text.includes("MagicLaunchFocus")) {
  text = text.replace(launchMarker, focusBlock);
}

fs.writeFileSync(electronFile, text, "utf8");
console.log("[desktop-input] Installed literal clipboard typing and launch-focus handling.");
