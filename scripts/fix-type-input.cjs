const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

// Desktop action arguments:
// [action, x, y, text/key/app/value, endX, endY]
// Use keybd_event's documented Unicode mode for TYPE_TEXT. This avoids the
// INPUT/union marshaling problem that can make SendInput return 0.
const newBlock = `  'TYPE_TEXT' {
    $value = [string]$scriptArgs[3]
    if ([string]::IsNullOrEmpty($value)) { break }

    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicTextInput {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  public static void TypeText(string text) {
    foreach (char c in text) {
      keybd_event(0, (byte)(c & 0xFF), KEYEVENTF_UNICODE, UIntPtr.Zero);
      keybd_event(0, (byte)(c & 0xFF), KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
  }
}
'@

    Write-Host "[TYPE_TEXT] Sending text: $value"
    [MagicTextInput]::TypeText($value)
    Write-Host "[TYPE_TEXT] Complete"
  }
`;

const keyPressBlock = `  'KEY_PRESS' {
    $key = ([string]$scriptArgs[3]).Trim().ToUpperInvariant()
    $vk = switch ($key) {
      'ENTER' { 0x0D }; 'RETURN' { 0x0D }; 'TAB' { 0x09 }
      'ESC' { 0x1B }; 'ESCAPE' { 0x1B }; 'BACKSPACE' { 0x08 }
      'SPACE' { 0x20 }; 'LEFT' { 0x25 }; 'UP' { 0x26 }; 'RIGHT' { 0x27 }
      'DOWN' { 0x28 }; 'DELETE' { 0x2E }; 'HOME' { 0x24 }; 'END' { 0x23 }
      'PAGEUP' { 0x21 }; 'PAGEDOWN' { 0x22 }
      'F1' { 0x70 }; 'F2' { 0x71 }; 'F3' { 0x72 }; 'F4' { 0x73 }
      'F5' { 0x74 }; 'F6' { 0x75 }; 'F7' { 0x76 }; 'F8' { 0x77 }
      'F9' { 0x78 }; 'F10' { 0x79 }; 'F11' { 0x7A }; 'F12' { 0x7B }
      default { if ($key.Length -eq 1) { [byte][char]$key[0] } else { 0 } }
    }
    if (-not $vk) { throw "Unsupported key: $key" }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicKeyInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public const uint KEYUP = 0x0002;
}
'@
    [MagicKeyInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [MagicKeyInput]::keybd_event([byte]$vk, 0, [MagicKeyInput]::KEYUP, [UIntPtr]::Zero)
    Write-Host "[KEY_PRESS] Complete: $key"
  }
`;

const waitBlock = `  'WAIT' {
    $ms = [int]$scriptArgs[3]
    if ($ms -lt 0 -or $ms -gt 10000) { throw "WAIT duration is outside the allowed range." }
    Start-Sleep -Milliseconds $ms
  }
`;

// Replace an existing TYPE_TEXT case, regardless of implementation.
const existingCase = /  ['\"]TYPE_TEXT['\"]\s*\{[\s\S]*?(?=\n\s*['\"]KEY_PRESS['\"]\s*\{)/;
if (existingCase.test(text)) {
  text = text.replace(existingCase, newBlock);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Replaced TYPE_TEXT with keybd_event Unicode handler.");
  process.exit(0);
}

// If TYPE_TEXT is missing but KEY_PRESS remains, insert it immediately before KEY_PRESS.
const keyPressCase = /\n\s*['\"]KEY_PRESS['\"]\s*\{/;
if (keyPressCase.test(text)) {
  text = text.replace(keyPressCase, `\n${newBlock}  'KEY_PRESS' {`);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Inserted keybd_event Unicode TYPE_TEXT handler.");
  process.exit(0);
}

// If both are missing, restore the input cases before the PowerShell switch closes.
const switchEndPattern = /(  'SCROLL'\s*\{[\s\S]*?\n  \}\n)(  \}\`;)/;
if (switchEndPattern.test(text)) {
  text = text.replace(switchEndPattern, `$1${newBlock}${keyPressBlock}${waitBlock}$2`);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Restored TYPE_TEXT/KEY_PRESS/WAIT handlers.");
  process.exit(0);
}

console.warn("[desktop-input] No compatible input switch block found; leaving electron/main.cjs unchanged.");
process.exit(0);
