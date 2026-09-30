const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");
const serverFile = path.join(root, "server.ts");
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
  "Start-Sleep -Milliseconds 500",
  "`).catch(() => {});",
].join("\n");

if (text.includes(launchMarker) && !text.includes("MagicLaunchFocus")) {
  text = text.replace(launchMarker, focusBlock);
}

fs.writeFileSync(electronFile, text, "utf8");

// The local model can sometimes turn "open Notepad and type hello" into a plan
// containing only TYPE_INPUT. Add a deterministic parser override so combined
// launch-and-type commands always execute as LAUNCH_APP -> WAIT -> TYPE_INPUT.
if (fs.existsSync(serverFile)) {
  let serverText = fs.readFileSync(serverFile, "utf8");
  const serverMarker = "  if (requestedApp && asksToOpen && parsed?.action?.type !== \"LAUNCH_APP\" && parsed?.action?.type !== \"MULTI_STEP_PLAN\") {";
  if (!serverText.includes("openAndTypeMatch")) {
    const combinedBlock = [
      "  const openAndTypeMatch = commandText.match(/\\b(?:open|launch|start)\\s+(notepad|calculator|calc|paint|explorer|files|terminal|task manager|taskmgr)\\b[\\s,]*(?:and\\s+)?(?:type|enter|write)\\s+(.+)$/i);",
      "  if (openAndTypeMatch) {",
      "    const app = appAliases.find(([pattern]) => pattern.test(openAndTypeMatch[1]))?.[1] || openAndTypeMatch[1].toLowerCase();",
      "    const textToType = openAndTypeMatch[2].trim();",
      "    return {",
      "      ...parsed,",
      "      spokenResponse: `Opening ${app} and typing \"${textToType}\".`,",
      "      spokenReply: `Opening ${app} and typing \"${textToType}\".`,",
      "      action: {",
      "        type: \"MULTI_STEP_PLAN\",",
      "        description: `Open ${app} and type ${textToType}`,",
      "        multiStepPlan: {",
      "          planTitle: `Open ${app} and type text`,",
      "          spokenIntro: `I will open ${app}, wait for it to be ready, then type ${textToType}.`,",
      "          steps: [",
      "            { stepNumber: 1, description: `Open ${app}`, actionType: \"LAUNCH_APP\", params: { app }, status: \"pending\", estimatedDurationMs: 1200 },",
      "            { stepNumber: 2, description: \"Wait for the application window\", actionType: \"WAIT\", params: { ms: 700 }, status: \"pending\", estimatedDurationMs: 700 },",
      "            { stepNumber: 3, description: `Type ${textToType}`, actionType: \"TYPE_INPUT\", params: { text: textToType }, status: \"pending\", estimatedDurationMs: 500 },",
      "          ],",
      "          spokenCompletion: `${app} is open and the text was entered.`,",
      "          currentStepIndex: 0,",
      "          status: \"idle\",",
      "        },",
      "      },",
      "    };",
      "  }",
      "",
    ].join("\n");
    if (!serverText.includes(serverMarker)) {
      throw new Error("[desktop-input] Could not find the desktop app-intent insertion point in server.ts");
    }
    serverText = serverText.replace(serverMarker, combinedBlock + serverMarker);
    fs.writeFileSync(serverFile, serverText, "utf8");
  }
}

console.log("[desktop-input] Installed literal clipboard typing, launch focus, and combined open/type handling.");
