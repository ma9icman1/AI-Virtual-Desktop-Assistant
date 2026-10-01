const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

const typeStart = text.indexOf("'TYPE_TEXT'");
const nextActionAfterType = typeStart >= 0
  ? text.slice(typeStart + 1).search(/\n\s*'[A-Z_]+(?:'|\s*\{)/)
  : -1;

const typeHandler = `'TYPE_TEXT' {
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

if (typeStart >= 0 && nextActionAfterType > 0) {
  const end = typeStart + 1 + nextActionAfterType;
  text = text.slice(0, typeStart) + typeHandler + text.slice(end);
} else if (typeStart < 0) {
  const scrollStart = text.indexOf("'SCROLL'");
  if (scrollStart < 0) throw new Error("[desktop-input] Could not find a desktop action insertion point in electron/main.cjs");
  text = text.slice(0, scrollStart) + typeHandler + "\n  " + text.slice(scrollStart);
}

fs.writeFileSync(electronFile, text, "utf8");
console.log("[desktop-input] Installed robust literal clipboard typing.");
