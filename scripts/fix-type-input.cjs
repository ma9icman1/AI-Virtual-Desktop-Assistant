const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

// Do not depend on whitespace, line breaks, or the exact KEY_PRESS formatting.
// The desktop-action repair scripts may rewrite the switch before this script runs.
const typeStart = text.indexOf("'TYPE_TEXT' {");
const keyStart = typeStart === -1 ? -1 : text.indexOf("'KEY_PRESS' {", typeStart);

if (typeStart === -1 || keyStart === -1) {
  if (/TYPE_TEXT/.test(text)) {
    console.log("[desktop-input] TYPE_TEXT already present; skipped switch-case repair.");
    process.exit(0);
  }
  throw new Error("[desktop-input] Could not find TYPE_TEXT handler in electron/main.cjs");
}

const typeHandler = `  'TYPE_TEXT' {
    Add-Type -AssemblyName System.Windows.Forms
    # actionArgs layout is: action, x, y, text/key/app/value, endX, endY.
    # The old handler incorrectly used scriptArgs[1], which is the X coordinate.
    $value = [string]$scriptArgs[3]
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
  }
`;

text = text.slice(0, typeStart) + typeHandler + text.slice(keyStart);
fs.writeFileSync(electronFile, text, "utf8");
console.log("[desktop-input] Installed literal clipboard typing using the actual text argument.");