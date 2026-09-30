const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) {
  throw new Error("[type-input] electron/main.cjs not found");
}

let text = fs.readFileSync(electronFile, "utf8");

const old = "  'TYPE_TEXT' { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($scriptArgs[1]) }";
const replacement = `  'TYPE_TEXT' {
    Add-Type -AssemblyName System.Windows.Forms
    $text = [string]$scriptArgs[1]
    if ([string]::IsNullOrEmpty($text)) { break }
    try {
      [System.Windows.Forms.Clipboard]::SetText($text)
      Start-Sleep -Milliseconds 80
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      Start-Sleep -Milliseconds 80
    } finally {
      # Do not leave the clipboard locked by the PowerShell process.
      try { [System.Windows.Forms.Clipboard]::GetDataObject() | Out-Null } catch {}
    }
  }`;

if (text.includes(old)) {
  text = text.replace(old, replacement);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[type-input] Replaced SendKeys text entry with clipboard paste.");
} else if (text.includes("[System.Windows.Forms.Clipboard]::SetText($text)")) {
  console.log("[type-input] Clipboard text entry is already installed.");
} else {
  throw new Error("[type-input] Could not find the TYPE_TEXT handler in electron/main.cjs");
}
