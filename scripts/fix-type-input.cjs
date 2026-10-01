const fs = require("fs");
const path = require("path");

const root = process.cwd();
const electronFile = path.join(root, "electron", "main.cjs");

if (!fs.existsSync(electronFile)) {
  throw new Error("[desktop-input] electron/main.cjs not found");
}

let text = fs.readFileSync(electronFile, "utf8");

// TYPE_TEXT must paste literal text instead of using SendKeys directly.
// This avoids special-character interpretation and prevents text such as
// punctuation, spaces, and symbols from being mangled by SendKeys.
const typeRegex = /'TYPE_TEXT'\s*\{[\s\S]*?\n\s*\}/;
const typeHandler = `'TYPE_TEXT' {
    Add-Type -AssemblyName System.Windows.Forms
    $value = [string]$scriptArgs[1]
    if ([string]::IsNullOrEmpty($value)) { break }
    $oldClipboard = $null
    try { $oldClipboard = [System.Windows.Forms.Clipboard]::GetText() } catch {}
    [System.Windows.Forms.Clipboard]::SetText($value)
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 180
    if ($null -ne $oldClipboard) {
      try { [System.Windows.Forms.Clipboard]::SetText($oldClipboard) } catch {}
    }
  }`;

if (typeRegex.test(text)) {
  text = text.replace(typeRegex, typeHandler);
} else if (!text.includes("[System.Windows.Forms.Clipboard]::SetText($value)")) {
  throw new Error("[desktop-input] Could not find TYPE_TEXT handler in electron/main.cjs");
}

// Replace the old SendKeys scroll implementation with native mouse wheel input.
const scrollRegex = /'SCROLL'\s*\{[\s\S]*?\n\s*\}/;
const scrollHandler = `'SCROLL' {
    [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2])
    [MagicInput]::mouse_event(0x0800, 0, 0, [int]$scriptArgs[3], [UIntPtr]::Zero)
  }`;
if (scrollRegex.test(text) && text.includes("'SCROLL'")) {
  text = text.replace(scrollRegex, scrollHandler);
}

// Focus the newly launched application using the actual requested process name.
// The previous patch accidentally emitted the literal JavaScript expression
// ${requested} into PowerShell. Pass the value through runPowerShell instead.
if (!text.includes("[desktop-input] launch focus v2")) {
  const launchMarker = "    if (!verified) throw new Error(`Windows started ${requested}, but the process could not be verified.`);";
  if (text.includes(launchMarker)) {
    const focusBlock = [
      launchMarker,
      "    // [desktop-input] launch focus v2",
      "    await runPowerShell(`",
      "$processName = $scriptArgs[0]",
      "$proc = Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if ($proc) {",
      "  Add-Type @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class MagicLaunchFocusV2 { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }",
      "'@",
      "  [void][MagicLaunchFocusV2]::ShowWindowAsync($proc.MainWindowHandle, 9)",
      "  [void][MagicLaunchFocusV2]::SetForegroundWindow($proc.MainWindowHandle)",
      "}",
      "Start-Sleep -Milliseconds 500",
      "`, [requested]);",
    ].join("\n");
    text = text.replace(launchMarker, focusBlock);
  }
}

fs.writeFileSync(electronFile, text, "utf8");
console.log("[desktop-input] Installed literal clipboard typing, native scroll, and reliable launch focus.");
