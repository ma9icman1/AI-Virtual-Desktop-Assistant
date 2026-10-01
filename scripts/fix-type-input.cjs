const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

// The desktop action argument layout is:
// [action, x, y, text/key/app/value, endX, endY]
// Therefore TYPE_TEXT must use scriptArgs[3], never scriptArgs[1] (the X coordinate).
const oldLine = "  'TYPE_TEXT' { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($scriptArgs[1]) }";
const newBlock = `  'TYPE_TEXT' {
    Add-Type -AssemblyName System.Windows.Forms
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
      if ($null -ne $oldClipboard) {
        try { [System.Windows.Forms.Clipboard]::SetText($oldClipboard) } catch {}
      }
    }
  }`;

if (text.includes(oldLine)) {
  text = text.replace(oldLine, newBlock);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Replaced TYPE_TEXT X-coordinate bug with clipboard typing.");
  process.exit(0);
}

// Handle the multiline form too, in case another repair script formatted it differently.
const multiline = /  'TYPE_TEXT'\s*\{\s*Add-Type -AssemblyName System\.Windows\.Forms;\s*\[System\.Windows\.Forms\.SendKeys\]::SendWait\(\$scriptArgs\[1\]\)\s*\}/;
if (multiline.test(text)) {
  text = text.replace(multiline, newBlock);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Replaced formatted TYPE_TEXT X-coordinate bug with clipboard typing.");
  process.exit(0);
}

// Already fixed: verify the handler is using the actual text argument.
if (/['\"]TYPE_TEXT['\"]\s*\{[\s\S]*?scriptArgs\[3\]/.test(text)) {
  console.log("[desktop-input] TYPE_TEXT already uses the text argument; skipped.");
  process.exit(0);
}

if (/TYPE_TEXT/.test(text)) {
  throw new Error("[desktop-input] TYPE_TEXT exists, but its handler format is unknown; refusing to modify it blindly.");
}

throw new Error("[desktop-input] Could not find TYPE_TEXT handler in electron/main.cjs");