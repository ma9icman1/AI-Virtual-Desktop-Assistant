const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

const typeHandler = `  'TYPE_TEXT' {
    Add-Type -AssemblyName System.Windows.Forms
    $value = [string]$scriptArgs[1]
    if ([string]::IsNullOrEmpty($value)) { break }
    $oldClipboard = $null
    try { $oldClipboard = [System.Windows.Forms.Clipboard]::GetText() } catch {}
    try {
      [System.Windows.Forms.Clipboard]::SetText($value)
      Start-Sleep -Milliseconds 150
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      Start-Sleep -Milliseconds 250
    } finally {
      if ($null -ne $oldClipboard) { try { [System.Windows.Forms.Clipboard]::SetText($oldClipboard) } catch {} }
    }
  }`;

// Current main.cjs keeps the switch cases inline on single lines. Match the
// complete TYPE_TEXT case without depending on a particular KEY_PRESS layout.
const typeCase = /  'TYPE_TEXT'\s*\{[\s\S]*?\}(?=\s*'KEY_PRESS'\s*\{)/;
if (!typeCase.test(text)) {
  throw new Error("[desktop-input] Could not find TYPE_TEXT case in electron/main.cjs");
}

text = text.replace(typeCase, typeHandler + "\n");
fs.writeFileSync(electronFile, text, "utf8");
console.log("[desktop-input] Installed robust literal clipboard typing.");
