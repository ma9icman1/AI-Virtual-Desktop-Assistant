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

const switchCase = /  'TYPE_TEXT'\s*\{[\s\S]*?\n  \}(?=\s*\n\s*'[A-Z_]+')/;
if (switchCase.test(text)) {
  text = text.replace(switchCase, typeHandler);
} else {
  const keyPressMarker = "  'KEY_PRESS' {";
  const markerIndex = text.indexOf(keyPressMarker);
  if (markerIndex < 0) {
    throw new Error("[desktop-input] Could not find the KEY_PRESS insertion point in electron/main.cjs");
  }
  text = text.slice(0, markerIndex) + typeHandler + "\n" + text.slice(markerIndex);
}

fs.writeFileSync(electronFile, text, "utf8");
console.log("[desktop-input] Installed robust literal clipboard typing.");
